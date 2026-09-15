import { tmmWithAdmittances } from '../../physics/thinFilmMath.js';
import { nReal } from './nReal.js';
import { toNDLayers } from './prototypeLayers.js';
import { cosInside, invariantOf } from './tiltEnvironment.js';

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
 * Tilted admittance of a lossless medium of index n, in units of the free-space
 * admittance, for a wave of invariant κ (Macleod, Thin-Film Optical Filters
 * 5th ed., §9.2: η_s = n·cos θ, η_p = n/cos θ). At κ = 0 both are n, which is
 * why the whole match below reduces to the familiar index algebra at normal
 * incidence.
 *
 * The real-index form of what `tmmWithAdmittances` computes in
 * physics/thinFilmMath.js, which is the authority on which plane gets the
 * product and which the quotient; the two have to agree.
 *
 * Past critical, where cos θ is 0, the p admittance is unbounded. The floor
 * keeps it a finite number so the match below reports the reflectance it cannot
 * remove instead of returning NaN thicknesses; no coat is found in that case and
 * the caller gets the bare surface.
 */
function tiltedEta(n, kappa, pol) {
    const c = cosInside(kappa, n);
    return pol === 'p' ? n / Math.max(c, 1e-12) : n * c;
}

/**
 * Input admittance of the embedded filter, in units of the free-space
 * admittance, so a real value reads as a refractive index at normal incidence.
 * Taken at the angle the invariant gives inside the substrate, since the coat
 * looks into the filter through the substrate's own medium.
 *
 * Returned in Macleod's convention (ñ = n − ik), which is the conjugate of the
 * one `thinFilmMath` carries, so the algebra below matches the textbook forms.
 */
function filterAdmittance(filterLayers, lambda0_nm, nSub, kappa, pol) {
    const v = nSub(lambda0_nm);
    const ns = Array.isArray(v) ? v : [v, 0];
    const subAngle = Math.asin(Math.min(1, kappa / Math.max(ns[0], 1e-12))) * 180 / Math.PI;
    const { Y } = tmmWithAdmittances(lambda0_nm, subAngle, pol, ns, ns, toNDLayers(filterLayers, lambda0_nm));
    return [Y[0][0], -Y[0][1]];
}

/** Admittance seen through a lossless layer of admittance η and phase thickness δ on top of Y. */
function throughLayer(eta, delta, Y) {
    const c = Math.cos(delta), s = Math.sin(delta);
    return cdiv2(Y[0] * c, Y[1] * c + eta * s, c - (Y[1] / eta) * s, (Y[0] / eta) * s);
}

/** Reflectance of an assembly of admittance Y in a medium of admittance η₀. */
function reflectanceOf(eta0, Y) {
    const [a, b] = cdiv2(eta0 - Y[0], -Y[1], eta0 + Y[0], Y[1]);
    return a * a + b * b;
}

/**
 * Phase thicknesses of the two-layer coating that nulls the reflectance of
 * inc | η₁ | η₂ | Y at one wavelength.
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
function solveTwoLayerMatch(eta0, eta1, eta2, Y) {
    const r1 = (eta0 - eta1) / (eta0 + eta1);
    const r2 = (eta1 - eta2) / (eta1 + eta2);
    const r3 = cdiv2(eta2 - Y[0], -Y[1], eta2 + Y[0], Y[1]);
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
 * Phase thickness of the single layer of admittance η that leaves the least
 * reflectance. R(δ) is a Möbius image of a circle in the admittance plane, so a
 * coarse sweep over the whole (0, π] period followed by a local ternary search
 * lands on the global minimum without a thickness grid over the full stack.
 */
function solveOneLayerMatch(eta0, eta, Y) {
    const SWEEP = 360;
    const Rof = (delta) => reflectanceOf(eta0, throughLayer(eta, delta, Y));
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

/**
 * Physical thickness (nm) of a layer of index n whose phase thickness is δ at λ₀
 * and invariant κ. A tilted layer needs more physical thickness for the same
 * phase, since δ = 2π·n·d·cos θ/λ (§9.2, Eq. 9.2).
 */
function physicalThickness(delta, n, lambda0_nm, kappa) {
    return delta * lambda0_nm / (2 * Math.PI * n * cosInside(kappa, n));
}

/**
 * The admittances one polarization presents at λ₀: the incident medium, the two
 * coating materials, and the filter underneath.
 */
function admittanceSet({ filterLayers, lambda0_nm, nInc, nSub, nHv, nLv, kappa, pol }) {
    return {
        eta0: tiltedEta(nReal(nInc, lambda0_nm), kappa, pol),
        etaOf: (tag) => tiltedEta(tag === 'H' ? nHv : nLv, kappa, pol),
        Y: filterAdmittance(filterLayers, lambda0_nm, nSub, kappa, pol),
    };
}

/**
 * Reflectance a set of coat layers leaves, averaged over the polarizations being
 * scored. Phase thickness does not depend on polarization, so one set of layers
 * is scored against every admittance set.
 */
function meanReflectance(sets, coat) {
    let total = 0;
    for (const set of sets) {
        let y = set.Y;
        for (let i = coat.length - 1; i >= 0; i--) y = throughLayer(set.etaOf(coat[i].tag), coat[i].delta, y);
        total += reflectanceOf(set.eta0, y);
    }
    return total / sets.length;
}

/**
 * Coat candidates for a mode, as lists of {tag, delta}. The roots are solved
 * once per polarization being scored, because a coat that nulls s-reflectance is
 * not the one that nulls p; every root is then scored against all of them, so an
 * unpolarized design gets whichever of the two leaves the least on average.
 *
 * Layers are ordered incident→substrate, so the last entry faces the filter.
 */
function coatRoots(mode, sets) {
    const out = [];
    for (const set of sets) {
        if (mode === '1layer') {
            for (const tag of ['L', 'H']) {
                out.push([{ tag, delta: solveOneLayerMatch(set.eta0, set.etaOf(tag), set.Y) }]);
            }
            continue;
        }
        for (const tags of [['L', 'H'], ['H', 'L']]) {
            for (const root of solveTwoLayerMatch(set.eta0, set.etaOf(tags[0]), set.etaOf(tags[1]), set.Y)) {
                out.push([{ tag: tags[0], delta: root.d1 }, { tag: tags[1], delta: root.d2 }]);
            }
        }
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
 * The match is made at the angle the filter is used at, where the admittances of
 * every medium split between the two planes of polarization (§9.1) and a layer
 * needs more physical thickness for the same phase. A coat solved at normal
 * incidence and used at 45° leaves enough reflectance to pull the passband off
 * centre, which is the one thing the design reference was set to avoid.
 *
 * The filter layers are taken in incident→substrate order; coat layers are
 * PREPENDED, and the inner one merges into the outermost filter layer when they
 * share a material.
 *
 * @param {object} p
 * @param {Array}  p.filterLayers   engine layers (incident→substrate), embedded design
 * @param {function} p.nH @param {function} p.nL @param {function} p.nInc @param {function} p.nSub
 * @param {number} p.lambda0_nm     wavelength the match is made at
 * @param {'none'|'1layer'|'vcoat'} p.mode
 * @param {number} [p.aoiDeg=0]     working angle in the INCIDENT medium, degrees
 * @param {'s'|'p'|'avg'} [p.pol='s']
 * @returns {{ layers:Array, arLayers:Array, mode:string, residualR:number }}
 *   residualR is the reflectance the coat leaves at λ₀ and the working angle,
 *   averaged over both planes when the polarization is 'avg'.
 */
export function adjustToIncidentMedium({
    filterLayers, nH, nL, nInc, nSub, lambda0_nm, mode = 'vcoat', aoiDeg = 0, pol = 's',
}) {
    const kappa = invariantOf(aoiDeg, nReal(nInc, lambda0_nm));
    const nHv = nReal(nH, lambda0_nm), nLv = nReal(nL, lambda0_nm);
    const sets = (pol === 'avg' ? ['s', 'p'] : [pol]).map((q) => admittanceSet({
        filterLayers, lambda0_nm, nInc, nSub, nHv, nLv, kappa, pol: q,
    }));
    const bare = { layers: filterLayers.slice(), arLayers: [], mode, residualR: meanReflectance(sets, []) };
    if (mode === 'none') return bare;

    const mkLayer = (tag, d) => ({ tag, role: 'ar', order: 0, nk: tag === 'H' ? nH : nL, n0: tag === 'H' ? nHv : nLv, d });
    const candidates = coatRoots(mode, sets).map((coat) => ({
        layers: coat.map((c) => mkLayer(c.tag, physicalThickness(c.delta, c.tag === 'H' ? nHv : nLv, lambda0_nm, kappa))),
        R: meanReflectance(sets, coat),
    }));
    const best = pickCoat(candidates);
    if (!best) return bare;
    return { layers: attachCoat(filterLayers, best.layers), arLayers: best.layers, mode, residualR: best.R };
}
