import { embeddedT } from './spectrum.js';

/**
 * Embedded merit function: RMS weighted deviation of T(λ) from the target.
 * Lower is better. The target weights are BAND-BALANCED by `buildFilterTarget`
 * (passband and stopband carry equal total weight) — without that, the stopband's
 * far larger sample count dominates and the integer search minimizes the MF by
 * COLLAPSING the passband (a near-empty filter "wins" on the many stop samples).
 * With balancing, a true flat-top is the merit minimum.
 */
export function meritFunctionEmbedded(layers, target, nSub) {
    let sw = 0, ss = 0;
    for (let i = 0; i < target.lambda.length; i++) {
        const w = target.weight[i];
        if (w <= 0) continue;
        const T = embeddedT(layers, target.lambda[i], nSub);
        const d = T - target.target[i];
        ss += w * d * d;
        sw += w;
    }
    return sw > 0 ? Math.sqrt(ss / sw) : 0;
}
