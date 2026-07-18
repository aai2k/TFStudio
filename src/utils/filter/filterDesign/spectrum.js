import { tmm } from '../../physics/thinFilmMath.js';
import { toNDLayers } from './prototypeLayers.js';

/**
 * Transmittance at one λ in the EMBEDDED case (incident index = substrate index).
 * @param {Array} layers engine layers
 * @param {number} lam
 * @param {function} nSub substrate index fn (used for BOTH incident and exit)
 */
export function embeddedT(layers, lam, nSub) {
    const v = nSub(lam);
    const ns = Array.isArray(v) ? v : [v, 0];
    const { T } = tmm(lam, 0, 's', ns, ns, toNDLayers(layers, lam));
    return T;
}

/** T at one λ for an arbitrary incident/substrate pair (used for step-6 / air). */
export function spectrumT(layers, lam, nInc, nSub) {
    const a = nInc(lam), b = nSub(lam);
    const n0 = Array.isArray(a) ? a : [a, 0];
    const ns = Array.isArray(b) ? b : [b, 0];
    const { T } = tmm(lam, 0, 's', n0, ns, toNDLayers(layers, lam));
    return T;
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
