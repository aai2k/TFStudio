import { tmmWithAdmittances } from '../../physics/thinFilmMath.js';
import { nReal } from './nReal.js';
import { toNDLayers } from './prototypeLayers.js';

/** Complex division (a+bi)/(c+di) → [re, im]. */
function cdiv2(a, b, c, d) {
    const q = c * c + d * d;
    return [(a * c + b * d) / q, (b * c - a * d) / q];
}

/** Fold a phase thickness into (0, π]; δ and δ+π describe the same layer. */
function wrapPhase(delta) {
    const v = delta % Math.PI;
    return v > 1e-12 ? v : v + Math.PI;
}

/**
 * Input admittance of the embedded filter at λ₀, in units of the free-space
 * admittance, so a real value reads as a refractive index. Normal incidence, so
 * the incident medium does not enter.
 *
 * Returned in Macleod's convention (ñ = n − ik), which is the conjugate of the
 * one `thinFilmMath` carries, so the algebra below matches the textbook forms.
 */
function filterAdmittance(filterLayers, lambda0_nm, nSub) {
    const v = nSub(lambda0_nm);
    const ns = Array.isArray(v) ? v : [v, 0];
    const { Y } = tmmWithAdmittances(lambda0_nm, 0, 's', ns, ns, toNDLayers(filterLayers, lambda0_nm));
    return [Y[0][0], -Y[0][1]];
}

/** Admittance seen through a lossless layer of index n and phase thickness δ on top of Y. */
function throughLayer(n, delta, Y) {
    const c = Math.cos(delta), s = Math.sin(delta);
    return cdiv2(Y[0] * c, Y[1] * c + n * s, c - (Y[1] / n) * s, (Y[0] / n) * s);
}

/** Reflectance of an assembly of admittance Y in a medium of admittance η₀. */
function reflectanceOf(eta0, Y) {
    const [a, b] = cdiv2(eta0 - Y[0], -Y[1], eta0 + Y[0], Y[1]);
    return a * a + b * b;
}

/**
 * Phase thicknesses of the two-layer coating that nulls the reflectance of
 * inc | n₁ | n₂ | Y at one wavelength.
 *
 * With r₁, r₂, r₃ the three interface amplitude coefficients and x = exp(−2iδ₁),
 * y = exp(−2iδ₂), the numerator of the multiple-beam reflectance is
 * r₁ + r₂x + r₃xy + r₁r₂r₃y, so x = −r₁(1 + r₂r₃y) / (r₂ + r₃y). Requiring
 * |x| = 1 leaves one real equation in δ₂ alone,
 *
 *   Re(r₃y) = [ r₂² + |r₃|² − r₁² − r₁²r₂²|r₃|² ] / [ 2·r₂·(r₁² − 1) ]
 *
 * with one solution on each side of arg r₃; δ₁ then follows from arg x. This is
 * the classic two-root "V coat". r₁ and r₂ are real because the wizard only
 * accepts lossless coating materials; Y may be complex.
 *
 * Reference: Macleod, Thin-Film Optical Filters 5th ed., §4.3.
 *
 * @returns {{d1:number, d2:number}[]} phase thicknesses in radians, δ ∈ (0, π]
 */
function solveTwoLayerMatch(eta0, n1, n2, Y) {
    const r1 = (eta0 - n1) / (eta0 + n1);
    const r2 = (n1 - n2) / (n1 + n2);
    const r3 = cdiv2(n2 - Y[0], -Y[1], n2 + Y[0], Y[1]);
    const R3 = Math.hypot(r3[0], r3[1]);
    if (!(Math.abs(r2) > 1e-12 && R3 > 1e-12)) return [];
    const r1sq = r1 * r1, R3sq = R3 * R3;
    const target = (r2 * r2 + R3sq - r1sq - r1sq * r2 * r2 * R3sq) / (2 * r2 * (r1sq - 1));
    if (!(Math.abs(target) <= R3)) return [];

    const phi3 = Math.atan2(r3[1], r3[0]);
    const spread = Math.acos(target / R3);
    return [phi3 - spread, phi3 + spread].map((theta) => {
        const y = [Math.cos(theta), -Math.sin(theta)];
        const r3y = [r3[0] * y[0] - r3[1] * y[1], r3[0] * y[1] + r3[1] * y[0]];
        const x = cdiv2(-r1 * (1 + r2 * r3y[0]), -r1 * r2 * r3y[1], r2 + r3y[0], r3y[1]);
        return { d1: wrapPhase(-Math.atan2(x[1], x[0]) / 2), d2: wrapPhase(theta / 2) };
    });
}

/**
 * Phase thickness of the single layer of index n that leaves the least
 * reflectance. R(δ) is a Möbius image of a circle in the admittance plane, so a
 * coarse sweep over the whole (0, π] period followed by a local ternary search
 * lands on the global minimum without a thickness grid over the full stack.
 */
function solveOneLayerMatch(eta0, n, Y) {
    const SWEEP = 360;
    const Rof = (delta) => reflectanceOf(eta0, throughLayer(n, delta, Y));
    let best = Math.PI, bestR = Infinity;
    for (let i = 1; i <= SWEEP; i++) {
        const delta = (i / SWEEP) * Math.PI;
        const r = Rof(delta);
        if (r < bestR) { bestR = r; best = delta; }
    }
    // δ and δ+π are the same layer, so the bracket stays inside one period: a
    // minimum at the boundary is the half-wave absentee, which is the honest
    // answer when neither material can improve on the bare surface.
    const eps = Math.PI / (SWEEP * 1e3);
    let lo = Math.max(eps, best - Math.PI / SWEEP), hi = Math.min(Math.PI, best + Math.PI / SWEEP);
    for (let i = 0; i < 60; i++) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (Rof(a) < Rof(b)) hi = b; else lo = a;
    }
    return (lo + hi) / 2;
}

/** Physical thickness (nm) of a layer of index n at phase thickness δ and λ₀. */
function physicalThickness(delta, n, lambda0_nm) {
    return delta * lambda0_nm / (2 * Math.PI * n);
}

/**
 * Coat candidates for a mode, each scored by the reflectance it leaves at λ₀.
 * Layers are ordered incident→substrate, so the last entry faces the filter.
 */
function coatCandidates({ mode, eta0, Y, lambda0_nm, mkLayer, indexOf }) {
    const out = [];
    const push = (tags, deltas) => {
        const layers = tags.map((tag, i) => mkLayer(tag, physicalThickness(deltas[i], indexOf(tag), lambda0_nm)));
        let y = Y;
        for (let i = deltas.length - 1; i >= 0; i--) y = throughLayer(indexOf(tags[i]), deltas[i], y);
        out.push({ layers, R: reflectanceOf(eta0, y) });
    };
    if (mode === '1layer') {
        for (const tag of ['L', 'H']) push([tag], [solveOneLayerMatch(eta0, indexOf(tag), Y)]);
        return out;
    }
    for (const tags of [['L', 'H'], ['H', 'L']]) {
        const [n1, n2] = tags.map(indexOf);
        for (const root of solveTwoLayerMatch(eta0, n1, n2, Y)) push(tags, [root.d1, root.d2]);
    }
    return out;
}

/**
 * Pick the coat to deposit: the thinnest that reaches a clean match, else the
 * one that leaves the least reflectance.
 */
function pickCoat(candidates) {
    if (!candidates.length) return null;
    const totalOf = (c) => c.layers.reduce((s, l) => s + l.d, 0);
    const matched = candidates.filter((c) => c.R < 1e-6);
    if (matched.length) return matched.reduce((a, b) => (totalOf(b) < totalOf(a) ? b : a));
    return candidates.reduce((a, b) => (b.R < a.R ? b : a));
}

/**
 * Prepend the coat to the filter. Its inner layer and the outermost filter
 * layer merge into one when they are the same material, which is why the coat
 * adds one layer to an H-terminated filter and two to an L-terminated one.
 */
function attachCoat(filterLayers, coatLayers) {
    if (!coatLayers.length) return filterLayers.slice();
    const inner = coatLayers[coatLayers.length - 1];
    const outermost = filterLayers[0];
    if (outermost && outermost.tag === inner.tag) {
        return [
            ...coatLayers.slice(0, -1),
            { ...outermost, d: outermost.d + inner.d },
            ...filterLayers.slice(1),
        ];
    }
    return [...coatLayers, ...filterLayers];
}

/**
 * Transition an embedded filter design to the real incident medium (air) by
 * adding an antireflection coating on the incident side. (Step 6.)
 *
 * Steps 1–5 design the filter embedded, with the incident index equal to the
 * substrate index. In air the front surface reflects and the passband drops. At
 * λ₀ the finished filter presents one admittance to the incident medium, so the
 * coat is the two-layer match from air to that admittance, solved in closed
 * form, with no search over thicknesses. Whenever T(λ₀) = 1 embedded, that
 * admittance is the substrate index and the problem reduces to the familiar
 * three-medium one, air | L | H | n_sub.
 *
 * The filter layers are taken in incident→substrate order; coat layers are
 * PREPENDED, and the inner one merges into the outermost filter layer when they
 * share a material.
 *
 * @param {object} p
 * @param {Array}  p.filterLayers   engine layers (incident→substrate), embedded design
 * @param {function} p.nH @param {function} p.nL @param {function} p.nInc @param {function} p.nSub
 * @param {number} p.lambda0_nm
 * @param {'none'|'1layer'|'vcoat'} p.mode
 * @returns {{ layers:Array, arLayers:Array, mode:string, residualR:number }}
 *   residualR is the reflectance the coat leaves at λ₀.
 */
export function adjustToIncidentMedium({
    filterLayers, nH, nL, nInc, nSub, lambda0_nm, mode = 'vcoat',
}) {
    const eta0 = nReal(nInc, lambda0_nm);
    const Y = filterAdmittance(filterLayers, lambda0_nm, nSub);
    if (mode === 'none') return { layers: filterLayers.slice(), arLayers: [], mode, residualR: reflectanceOf(eta0, Y) };

    const nHv = nReal(nH, lambda0_nm), nLv = nReal(nL, lambda0_nm);
    const indexOf = (tag) => (tag === 'H' ? nHv : nLv);
    const mkLayer = (tag, d) => ({ tag, role: 'ar', order: 0, nk: tag === 'H' ? nH : nL, n0: indexOf(tag), d });

    const best = pickCoat(coatCandidates({ mode, eta0, Y, lambda0_nm, mkLayer, indexOf }));
    if (!best) return { layers: filterLayers.slice(), arLayers: [], mode, residualR: reflectanceOf(eta0, Y) };
    return { layers: attachCoat(filterLayers, best.layers), arLayers: best.layers, mode, residualR: best.R };
}
