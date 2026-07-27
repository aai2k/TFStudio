/**
 * Complex admittance locus model.
 *
 * Theory: Macleod sections 2.4 and 4.1. The transfer convention matches
 * thinFilmMath.js; displayed imaginary admittance is conjugated to preserve
 * Macleod's diagram orientation.
 */

import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { tmmWithAdmittances } from '../../../../utils/physics/thinFilmMath.js';

function cadd([ar, ai], [br, bi]) { return [ar + br, ai + bi]; }
function csub([ar, ai], [br, bi]) { return [ar - br, ai - bi]; }
function cmul([ar, ai], [br, bi]) { return [ar * br - ai * bi, ar * bi + ai * br]; }
function cdiv([ar, ai], [br, bi]) {
    const d = br * br + bi * bi || 1e-300;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}
function csqrt([ar, ai]) {
    const r = Math.sqrt(Math.sqrt(ar * ar + ai * ai));
    const theta = Math.atan2(ai, ar) / 2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
}
function ccos([ar, ai]) { return [Math.cos(ar) * Math.cosh(ai), -Math.sin(ar) * Math.sinh(ai)]; }
function csin([ar, ai]) { return [Math.sin(ar) * Math.cosh(ai), Math.cos(ar) * Math.sinh(ai)]; }

function snellCos(n0, sinTheta0c, nj) {
    const sinThetaJ = cdiv(cmul(n0, sinTheta0c), nj);
    return csqrt(csub([1, 0], cmul(sinThetaJ, sinThetaJ)));
}

function layerEta(nj, cosThJ, pol) {
    return pol === 's' ? cmul(nj, cosThJ) : cdiv(nj, cosThJ);
}

function layerDelta(nj, d_nm, lambda_nm, cosThJ) {
    const k0 = 2 * Math.PI / lambda_nm;
    return cmul(cmul(nj, [k0 * d_nm, 0]), cosThJ);
}

// Y(phi) = eta (Y_R cos(phi) - i eta sin(phi)) / (eta cos(phi) - i Y_R sin(phi)).
function transferAdmittance(Y_R, eta, phi) {
    const cosP = ccos(phi);
    const sinP = csin(phi);
    const num = csub(cmul(Y_R, cosP), cmul([0, 1], cmul(eta, sinP)));
    const den = csub(cmul(eta, cosP), cmul([0, 1], cmul(Y_R, sinP)));
    return cmul(eta, cdiv(num, den));
}

export function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

const MAT_PALETTE = [
    '#4fc3f7', '#ef5350', '#66bb6a', '#ffca28',
    '#ab47bc', '#26c6da', '#ff7043', '#ec407a',
    '#78909c', '#8d6e63',
];

export function buildMatColorMap(layers) {
    const map = {};
    let idx = 0;
    for (const l of layers) {
        if (l.material && !map[l.material]) {
            map[l.material] = MAT_PALETTE[idx % MAT_PALETTE.length];
            idx++;
        }
    }
    return map;
}

const ARC_FLAT = 0.0033;
const ARC_SEED = 24;
const ARC_MAXDEPTH = 10;

function segDeviation(P, A, B) {
    const bx = B[0] - A[0], by = B[1] - A[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-12) return Math.hypot(P[0] - A[0], P[1] - A[1]);
    return Math.abs(bx * (A[1] - P[1]) - (A[0] - P[0]) * by) / len;
}

/**
 * What the diagram draws.
 *
 * The admittance view plots Y directly, in Macleod's convention. The reflection
 * view plots Gamma = (eta0 - Y) / (eta0 + Y), which carries the same information
 * -- the two are related by a Moebius map -- but stays inside the unit circle
 * however far the layer admittances run, and puts |Gamma|^2 = R as the radius.
 *
 * `pole` is where the view's map blows up, expressed in the layer's own Gamma
 * plane; the sampler needs it to place points evenly along the drawn curve.
 */
const ADMITTANCE_VIEW = { point: (Y) => Y, pole: () => [1, 0] };
const INFINITE_POLE = [Infinity, 0];

export function reflectionCoefficient(Y, eta0) {
    return cdiv(csub(eta0, Y), cadd(eta0, Y));
}

function reflectionView(eta0) {
    return {
        point: (Y) => reflectionCoefficient(Y, eta0),
        pole: (eta) => {
            const den = csub(eta0, eta);
            // A layer matching the incident medium turns Gamma about the origin
            // at a constant rate: the map has no finite pole and nothing to undo.
            if (Math.hypot(den[0], den[1]) < 1e-12) return INFINITE_POLE;
            return cdiv(cadd(eta0, eta), den);
        },
    };
}

/**
 * Half-angle map applied on a branch-tracked interval, so a locus running past
 * a half turn keeps a single-valued parameter instead of folding back.
 */
function branchMap(x, halfAngle) {
    const u = x / 2;
    const m = Math.round(u / Math.PI);
    return 2 * (halfAngle(u - m * Math.PI) + m * Math.PI);
}

/**
 * Reparametrization of a layer locus by its image angle.
 *
 * With rho = (Y_R - eta) / (Y_R + eta) and Gamma = rho e^(2i phi), the transfer
 * relation is the Moebius map Y = eta (1 + Gamma) / (1 - Gamma). Where |rho|
 * approaches 1, Gamma passes close to the pole at Gamma = 1 and the locus is
 * traversed within an interval of width ~(1 - |rho|): steps uniform in phase
 * step over it and the arc degenerates into a polygon. Writing Gamma as
 * |rho| e^(i alpha) with alpha = 2 phi + arg(rho), even steps along the curve
 * come from tan(alpha / 2) = k tan(psi / 2), k = (1 - |rho|)/(1 + |rho|).
 *
 * Centring alpha on arg(rho) matters: the crowded stretch sits at the start of a
 * layer entered from a higher admittance and at the end of one entered from a
 * lower admittance, and both occur in the same quarter-wave stack.
 *
 * The crowding is set by where the drawn plane's pole falls in the Gamma plane:
 * Gamma = 1 for the admittance view, elsewhere for the reflection view. Dividing
 * by that pole restores the Gamma = 1 case, so one parametrization serves both.
 *
 * Returns the psi interval spanning the layer and the phase fraction for a given
 * psi. Admittances are still evaluated from that fraction, so the substitution
 * redistributes sample positions without approximating any value.
 */
function arcPhaseMap(Y_R, eta, delta, pole) {
    const theta = 2 * delta[0];
    // No real phase thickness means no angular traverse to correct.
    if (!(Math.abs(theta) > 1e-12)) return { psi0: 0, psi1: 1, fOf: (psi) => psi };

    const rho = cdiv(csub(Y_R, eta), cadd(Y_R, eta));
    const poleAbs = Math.hypot(pole[0], pole[1]);
    const r = Math.min(Math.hypot(rho[0], rho[1]) / poleAbs, 1 - 1e-12);
    const k = Math.max((1 - r) / (1 + r), 1e-300);
    const alpha0 = Math.atan2(rho[1], rho[0]) - Math.atan2(pole[1], pole[0]);
    const psiOf = (alpha) => branchMap(alpha, (u) => Math.atan(Math.tan(u) / k));
    const psi0 = psiOf(alpha0);
    const psi1 = psiOf(alpha0 + theta);

    const fOf = (psi) => {
        if (psi === psi0) return 0;
        if (psi === psi1) return 1;
        return (branchMap(psi, (u) => Math.atan(k * Math.tan(u))) - alpha0) / theta;
    };
    return { psi0, psi1, fOf };
}

export function sampleArcAdaptive(Y_R, eta, delta, view = ADMITTANCE_VIEW) {
    const { psi0, psi1, fOf } = arcPhaseMap(Y_R, eta, delta, view.pole(eta));
    const Yat = (psi) => {
        const f = fOf(psi);
        return view.point(transferAdmittance(Y_R, eta, [delta[0] * f, delta[1] * f]));
    };
    const re = [], im = [];
    const push = (Y) => { re.push(Y[0]); im.push(Y[1]); };

    function refine(p0, Y0, p1, Y1, depth) {
        if (depth < ARC_MAXDEPTH) {
            const pm = (p0 + p1) / 2;
            const Ym = Yat(pm);
            const chord = Math.hypot(Y1[0] - Y0[0], Y1[1] - Y0[1]);
            const dev = segDeviation(Ym, Y0, Y1);
            if (dev > ARC_FLAT * chord && dev > 1e-12) {
                refine(p0, Y0, pm, Ym, depth + 1);
                refine(pm, Ym, p1, Y1, depth + 1);
                return;
            }
        }
        push(Y1);
    }

    let prevPsi = psi0, prevY = Yat(psi0);
    push(prevY);
    for (let s = 1; s <= ARC_SEED; s++) {
        const psi = s === ARC_SEED ? psi1 : psi0 + (psi1 - psi0) * s / ARC_SEED;
        const Y = Yat(psi);
        refine(prevPsi, prevY, psi, Y, 0);
        prevPsi = psi; prevY = Y;
    }
    return { re, im };
}

export function sideStackLayers(design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    return side === 'back' ? [...layers].reverse() : layers;
}

function buildOnePol(design, conditions, pol) {
    const { lambda_nm, theta_deg, side, view: viewKind } = conditions;
    const n0mat = resolveMaterial(side === 'back' ? design.exitMedium : design.incidentMedium);
    const nsmat = resolveMaterial(design.substrate?.material);
    const [n0r, n0k] = n0mat.getNK(lambda_nm);
    const n0 = [n0r, n0k];
    const [nsr, nsk] = nsmat.getNK(lambda_nm);
    const ns = [nsr, nsk];

    const allLayers = sideStackLayers(design, side).map(layer => {
        const mat = resolveMaterial(layer.material);
        const [nr, nk] = mat.getNK(lambda_nm);
        return { n: [nr, nk], d: layer.thickness, material: layer.material, id: layer.id };
    });

    const { Y, N } = tmmWithAdmittances(lambda_nm, theta_deg, pol, n0, ns, allLayers);
    const sinTheta0 = Math.sin(theta_deg * Math.PI / 180);
    const sinTheta0c = [sinTheta0, 0];
    const valid = allLayers.filter(l => l.d > 0);
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0c, sinTheta0c)));
    const eta0 = layerEta(n0, cosTheta0, pol);
    const view = viewKind === 'reflection' ? reflectionView(eta0) : ADMITTANCE_VIEW;
    const arcs = [];

    for (let k = N - 1; k >= 0; k--) {
        const lyr = valid[k];
        const cosThJ = snellCos(n0, sinTheta0c, lyr.n);
        const eta = layerEta(lyr.n, cosThJ, pol);
        const delta = layerDelta(lyr.n, lyr.d, lambda_nm, cosThJ);
        const Y_R = Y[k + 1];
        const { re, im } = sampleArcAdaptive(Y_R, eta, delta, view);
        arcs.push({ k, layerNum: k + 1, material: lyr.material, re, im });
    }

    const flipY = (p) => [p[0], -p[1]];
    const dArcs = arcs.map(a => ({ ...a, im: a.im.map(v => -v) }));
    const dY = Y.map(flipY);
    // Y, eta0 and etaS stay admittances for the readout and the table; marks are
    // the same three points in whatever plane the chart is drawing.
    const marks = {
        Y0: flipY(view.point(Y[0])),
        eta0: flipY(view.point(eta0)),
        etaS: flipY(view.point(Y[N])),
    };
    return { pol, side, view: viewKind, Y: dY, N, arcs: dArcs, eta0: flipY(eta0), etaS: dY[N], marks };
}

export function sideHasLayers(design, side) {
    return side === 'back'
        ? !!(design?.backLayers?.length)
        : !!(design?.frontLayers?.length);
}

/**
 * Loci for one set of evaluation conditions: `lambda_nm`, `theta_deg`, `pol`
 * ('s', 'p' or 'avg' for both), `side` ('front' or 'back') and `view`
 * ('admittance' or 'reflection').
 */
export function buildDiagramData(design, conditions) {
    const { pol, side = 'front', view = 'admittance' } = conditions;
    if (!sideHasLayers(design, side)) return null;
    const pols = pol === 'avg' ? ['s', 'p'] : [pol];
    return pols.map(p => buildOnePol(design, { ...conditions, side, view }, p));
}
