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

const ARC_FLAT = 0.0015;
const ARC_SEED = 8;
const ARC_MAXDEPTH = 9;

function segDeviation(P, A, B) {
    const bx = B[0] - A[0], by = B[1] - A[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-12) return Math.hypot(P[0] - A[0], P[1] - A[1]);
    return Math.abs(bx * (A[1] - P[1]) - (A[0] - P[0]) * by) / len;
}

function sampleArcAdaptive(Y_R, eta, delta) {
    const Yat = (frac) => transferAdmittance(Y_R, eta, [delta[0] * frac, delta[1] * frac]);
    const re = [], im = [];
    const push = (Y) => { re.push(Y[0]); im.push(Y[1]); };

    function refine(f0, Y0, f1, Y1, depth) {
        if (depth < ARC_MAXDEPTH) {
            const fm = (f0 + f1) / 2;
            const Ym = Yat(fm);
            const chord = Math.hypot(Y1[0] - Y0[0], Y1[1] - Y0[1]);
            const dev = segDeviation(Ym, Y0, Y1);
            if (dev > ARC_FLAT * chord && dev > 1e-9) {
                refine(f0, Y0, fm, Ym, depth + 1);
                refine(fm, Ym, f1, Y1, depth + 1);
                return;
            }
        }
        push(Y1);
    }

    let prevF = 0, prevY = Yat(0);
    push(prevY);
    for (let s = 1; s <= ARC_SEED; s++) {
        const f = s / ARC_SEED, Y = Yat(f);
        refine(prevF, prevY, f, Y, 0);
        prevF = f; prevY = Y;
    }
    return { re, im };
}

export function sideStackLayers(design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    return side === 'back' ? [...layers].reverse() : layers;
}

function buildOnePol(design, lambda_nm, theta_deg, pol, side = 'front') {
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
    const arcs = [];

    for (let k = N - 1; k >= 0; k--) {
        const lyr = valid[k];
        const cosThJ = snellCos(n0, sinTheta0c, lyr.n);
        const eta = layerEta(lyr.n, cosThJ, pol);
        const delta = layerDelta(lyr.n, lyr.d, lambda_nm, cosThJ);
        const Y_R = Y[k + 1];
        const { re, im } = sampleArcAdaptive(Y_R, eta, delta);
        arcs.push({ k, layerNum: k + 1, material: lyr.material, re, im });
    }

    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0c, sinTheta0c)));
    const eta0 = layerEta(n0, cosTheta0, pol);
    const flipY = (p) => [p[0], -p[1]];
    const dArcs = arcs.map(a => ({ ...a, im: a.im.map(v => -v) }));
    const dY = Y.map(flipY);
    return { pol, side, Y: dY, N, arcs: dArcs, eta0: flipY(eta0), etaS: dY[N] };
}

export function sideHasLayers(design, side) {
    return side === 'back'
        ? !!(design?.backLayers?.length)
        : !!(design?.frontLayers?.length);
}

export function buildDiagramData(design, lambda_nm, theta_deg, pol, side = 'front') {
    if (!sideHasLayers(design, side)) return null;
    const pols = pol === 'avg' ? ['s', 'p'] : [pol];
    return pols.map(p => buildOnePol(design, lambda_nm, theta_deg, p, side));
}
