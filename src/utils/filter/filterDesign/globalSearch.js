import { qwThickness } from './indexProviders.js';
import { makeClampMirror, makeClampOrder } from './searchClamps.js';
import { makeMfOf, makePartsOf } from './searchEvaluate.js';
import { descend } from './localDescent.js';
import { makeCandidate } from './candidateBuilder.js';
import { makeRecorder } from './candidateTracker.js';
import { mulberry32 } from './rng.js';

/**
 * Global Integer Search: discrete minimization of the embedded MF over per-mirror
 * QW layer counts and per-spacer orders, seeded from a prototype.
 *
 * Coordinate descent with neighbourhood ±1/±2 on each variable, plus multi-start
 * perturbations to surface several near-optimal candidates (the step-5 list).
 * Both vectors are indexed from the substrate.
 *
 * @param {object} p
 * @param {function} p.nH @param {function} p.nL @param {function} p.nSub
 * @param {number}   p.lambda0_nm
 * @param {object}   p.target               from buildFilterTarget; a tiltDeg above
 *   zero on it makes every merit below the pooled normal-and-tilted one
 * @param {number}   p.cavities             N
 * @param {number}   p.seedMirror           initial mirror layer count
 * @param {number}   p.seedSpacer           initial spacer order
 * @param {number[]} [p.seedMirrors]        per-mirror seed vector, overrides seedMirror
 * @param {boolean}  [p.symMirrors=false]
 * @param {boolean}  [p.symCavities=false]
 * @param {number}   [p.minMirror=1] @param {number} [p.maxMirror=41]
 * @param {number}   [p.minOrder=1]  @param {number} [p.maxOrder=400]
 *   The order bound only ever clamps the seed: the descent moves by one or two
 *   from it, and OptiLayer's own prototype tables reach orders in the hundreds.
 * @param {number}   [p.restarts=12]
 * @param {number}   [p.rngSeed]           seeds the multistart, so a run is reproducible
 * @param {function} [p.rng]               overrides rngSeed; defaults to Math.random
 * @param {function} [p.onProgress]         (best, candidates, iteration) callback
 * @returns {{ candidates: Array, best: object }}  candidates sorted by MF asc
 *   each candidate = { mirrors, spacers, mf, mf0, mfTilt, layers:N, thicknessNm }
 */
export function globalIntegerSearch(p) {
    const {
        nH, nL, nSub, lambda0_nm, target, cavities,
        seedMirror, seedSpacer, seedMirrors = null,
        symMirrors = false, symCavities = false,
        minMirror = 1, maxMirror = 41, minOrder = 1, maxOrder = 400,
        restarts = 12, rngSeed = null, onProgress = null,
        rng = rngSeed != null ? mulberry32(rngSeed) : Math.random,
    } = p;

    const dH = qwThickness(nH, lambda0_nm), dL = qwThickness(nL, lambda0_nm);
    const clampMirror = makeClampMirror(minMirror, maxMirror);
    const clampOrder = makeClampOrder(minOrder, maxOrder);
    const evalCtx = { nH, nL, lambda0_nm, symMirrors, symCavities, target, nSub };
    const ctx = {
        clampMirror, clampOrder, mfOf: makeMfOf(evalCtx), partsOf: makePartsOf(evalCtx),
        symMirrors, symCavities, dH, dL,
    };

    const N = cavities;
    const candidates = [];
    const seen = new Set();
    const record = makeRecorder(candidates, seen, onProgress);

    // Seed: a per-mirror vector (e.g. the coupled-cavity prototype with inner
    // mirrors ~2× the outer) if supplied, else a uniform prototype.
    const seedMir = (Array.isArray(seedMirrors) && seedMirrors.length === N + 1)
        ? seedMirrors.map(clampMirror)
        : new Array(N + 1).fill(clampMirror(seedMirror));
    const seedSpa = new Array(N).fill(clampOrder(seedSpacer));
    // ALWAYS keep the raw step-4 prototype the user approved as a candidate, so
    // the list can never contain only lower-MF-but-uglier designs. On hard (wide)
    // targets a design that fills the band can have a lower MF yet visible ripple;
    // keeping the seed lets the user pick the clean prototype regardless.
    record(makeCandidate(seedMir, seedSpa, ctx, { isSeed: true }));
    record(descend(seedMir, seedSpa, ctx));

    // Multi-start: perturb the seed (and tapered seeds — outer mirrors weaker)
    for (let r = 0; r < restarts; r++) {
        const mir = seedMir.map((g, i) => {
            // bias: outer mirrors smaller, inner larger (Chebyshev taper) + noise
            const taper = (i === 0 || i === N) ? -2 : 0;
            const noise = Math.round((rng() - 0.5) * 6);
            return clampMirror(g + taper + noise);
        });
        const spa = seedSpa.map((s) => clampOrder(s + Math.round((rng() - 0.5) * 2)));
        record(descend(mir, spa, ctx), true);
    }

    return { candidates, best: candidates[0] };
}
