import { qwThickness } from './indexProviders.js';
import { makeClampMirror, makeClampOrder } from './searchClamps.js';
import { makeMfOf } from './searchEvaluate.js';
import { descend } from './localDescent.js';
import { makeCandidate } from './candidateBuilder.js';
import { makeRecorder } from './candidateTracker.js';

/**
 * Global Integer Search: discrete minimization of the embedded MF over per-mirror
 * QW layer counts (odd) and per-spacer orders (integer), seeded from a prototype.
 *
 * Coordinate descent with neighbourhood ±step on each variable, plus multi-start
 * perturbations to surface several near-optimal candidates (the
 * step-5 list). Mirror counts stay odd (±2 moves); spacer orders ≥1.
 *
 * @param {object} p
 * @param {function} p.nH @param {function} p.nL @param {function} p.nSub
 * @param {number}   p.lambda0_nm
 * @param {object}   p.target               from buildFilterTarget
 * @param {number}   p.cavities             N
 * @param {number}   p.seedMirror           initial mirror layer count (odd)
 * @param {number}   p.seedSpacer           initial spacer order
 * @param {'H'|'L'}  [p.spacerKind='L']
 * @param {boolean}  [p.symMirrors=false]
 * @param {boolean}  [p.symCavities=false]
 * @param {number}   [p.minMirror=1] @param {number} [p.maxMirror=41]
 * @param {number}   [p.minOrder=1]  @param {number} [p.maxOrder=8]
 * @param {number}   [p.restarts=12]
 * @param {function} [p.rng=Math.random]
 * @param {function} [p.onProgress]         (best, candidates) callback
 * @returns {{ candidates: Array, best: object }}  candidates sorted by MF asc
 *   each candidate = { mirrors, spacers, mf, layers:N, thicknessNm }
 */
export function globalIntegerSearch(p) {
    const {
        nH, nL, nSub, lambda0_nm, target, cavities,
        seedMirror, seedSpacer, seedMirrors = null, spacerKind = 'L',
        symMirrors = false, symCavities = false,
        minMirror = 1, maxMirror = 41, minOrder = 1, maxOrder = 200,
        restarts = 12, rng = Math.random, onProgress = null,
    } = p;

    const spacerIsL = spacerKind !== 'H';
    const dH = qwThickness(nH, lambda0_nm), dL = qwThickness(nL, lambda0_nm);
    const clampMirror = makeClampMirror(minMirror, maxMirror);
    const clampOrder = makeClampOrder(minOrder, maxOrder);
    const mfOf = makeMfOf({ nH, nL, lambda0_nm, spacerKind, symMirrors, symCavities, target, nSub });
    const ctx = { clampMirror, clampOrder, mfOf, symMirrors, symCavities, dH, dL, spacerIsL };

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
        record(descend(mir, spa, ctx));
    }

    return { candidates, best: candidates[0] };
}
