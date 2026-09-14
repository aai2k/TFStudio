import { tmm } from '../../physics/thinFilmMath.js';
import { getTmmWasm, tmmWasmActive } from '../../../tmmcore.js';
import { toNDLayers } from './prototypeLayers.js';

/**
 * Transmittance at one (λ, angle, polarization) for a prepared layer list.
 * `media` is the [incident, substrate] admittance pair.
 *
 * The integer search evaluates this tens of millions of times on stacks of a
 * hundred layers and more, so it goes through the WASM kernel whenever that is
 * active, the same kernel and the same conventions the rest of the app uses.
 * The JS kernel is the reference and stays the fallback; the two agree to
 * float64 round-off (tests/wasm_tmm_equivalence.mjs).
 */
function transmittance(lam, nd, media, aoi, pol) {
    const [n0, ns] = media;
    if (pol === 'avg') {
        return (transmittance(lam, nd, media, aoi, 's') + transmittance(lam, nd, media, aoi, 'p')) / 2;
    }
    if (tmmWasmActive()) return getTmmWasm().tmmOne(lam, aoi, pol === 'p' ? 1 : 0, n0, ns, nd).T;
    return tmm(lam, aoi, pol, n0, ns, nd).T;
}

/**
 * Transmittance at one λ in the EMBEDDED case (incident index = substrate index).
 * @param {Array} layers engine layers
 * @param {number} lam
 * @param {function} nSub substrate index fn (used for BOTH incident and exit)
 * @param {number} [aoi=0]  angle of incidence, degrees
 * @param {'s'|'p'|'avg'} [pol='s']  at normal incidence the two agree
 */
export function embeddedT(layers, lam, nSub, aoi = 0, pol = 's') {
    const v = nSub(lam);
    const ns = Array.isArray(v) ? v : [v, 0];
    return transmittance(lam, toNDLayers(layers, lam), [ns, ns], aoi, pol);
}

/** T at one λ for an arbitrary incident/substrate pair (used for step-6 / air). */
export function spectrumT(layers, lam, nInc, nSub) {
    const a = nInc(lam), b = nSub(lam);
    const n0 = Array.isArray(a) ? a : [a, 0];
    const ns = Array.isArray(b) ? b : [b, 0];
    return transmittance(lam, toNDLayers(layers, lam), [n0, ns], 0, 's');
}

/**
 * Sample T(λ) over a grid. Returns {lambda:[], T:[]}.
 * @param {object} p
 * @param {Array} p.layers
 * @param {number} p.lamLo @param {number} p.lamHi @param {number} p.step
 * @param {function} p.nInc @param {function} p.nSub
 */
export function sampleSpectrum({ layers, lamLo, lamHi, step, nInc, nSub }) {
    const lambda = [], T = [];
    for (let lam = lamLo; lam <= lamHi + 1e-9; lam += step) {
        const x = Math.round(lam * 1000) / 1000;
        lambda.push(x);
        T.push(spectrumT(layers, x, nInc, nSub));
    }
    return { lambda, T };
}
