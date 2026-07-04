/**
 * Structural DEEP-search policy tests.
 *
 * Run: node tests/structural_deep_search.mjs
 *
 * Deep mode turns the single-shot structural anneal into an open-ended Iterated
 * Local Search / Basin Hopping loop: drop the maxIter cap + patience early-stop,
 * keep a global best, and on stagnation REHEAT (restore T0) and KICK the design
 * out of its basin instead of finishing. The pure policy lives in three helpers
 * in src/utils/synthesis/structuralOptimizer.js:
 *
 *   • deepTemperature(cycleIter, coolPeriod, T0, Tend) — per-cycle cooling that
 *     resets to T0 on each reheat.
 *   • stagnationAction({deepMode, noImprove, patience}) — continue | stop | reheat.
 *   • basinKick(layers, ctx) — a few amplified structural mutations to escape.
 *
 * These tests are deliberately small + fast (no React, no workers) so the
 * algorithm can be iterated on rapidly. Part A unit-tests each helper; Part B
 * runs a compact mini-driver (the same loop the window uses, with a toy merit +
 * trivial refiner) on a MULTIMODAL layer-count landscape and asserts the emergent
 * behavior: single-shot STALLS in the easy basin, deep mode REHEATS across the
 * barrier to the deeper global basin, and the global best is never lost.
 */

import {
    makeRng, proposeMutation, metropolisAccept, temperatureAt,
    deepTemperature, stagnationAction, basinKick, MUTATION_KINDS,
} from '../src/utils/synthesis/structuralOptimizer.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const DMIN = 1, DMAX = 2000;
const POOL = [{ id: 'TiO2', name: 'TiO2' }, { id: 'SiO2', name: 'SiO2' }, { id: 'Ta2O5', name: 'Ta2O5' }];

// ── A1. deepTemperature: per-cycle geometric cooling, resets to T0 ───────────────
console.log('— deepTemperature —');
{
    const T0 = 0.2, Tend = 0.001, P = 50;
    ok(near(deepTemperature(0, P, T0, Tend), T0), 'cycleIter 0 → T0 (full reheat)');
    ok(near(deepTemperature(P, P, T0, Tend), Tend, 1e-6), 'cycleIter = period → Tend');
    ok(deepTemperature(2 * P, P, T0, Tend) <= Tend + 1e-9, 'past period clamps at Tend (no negative frac blow-up)');
    // Monotone decreasing within a cycle.
    let mono = true, prev = Infinity;
    for (let i = 0; i <= P; i++) { const T = deepTemperature(i, P, T0, Tend); if (T > prev + 1e-12) mono = false; prev = T; }
    ok(mono, 'monotone decreasing across a cycle');
    // Equivalent to temperatureAt over the cycle fraction.
    ok(near(deepTemperature(20, P, T0, Tend), temperatureAt(20 / P, T0, Tend)), 'matches temperatureAt(cycleIter/period)');
    // coolPeriod ≤ 0 guarded (treated as 1 → immediate Tend for cycleIter ≥ 1).
    ok(Number.isFinite(deepTemperature(5, 0, T0, Tend)), 'coolPeriod 0 does not NaN');
}

// ── A2. stagnationAction: continue / stop (single-shot) / reheat (deep) ──────────
console.log('— stagnationAction —');
{
    ok(stagnationAction({ deepMode: false, noImprove: 5,  patience: 20 }) === 'continue', 'below patience → continue (single-shot)');
    ok(stagnationAction({ deepMode: true,  noImprove: 5,  patience: 20 }) === 'continue', 'below patience → continue (deep)');
    ok(stagnationAction({ deepMode: false, noImprove: 20, patience: 20 }) === 'stop',     'at patience, single-shot → stop');
    ok(stagnationAction({ deepMode: false, noImprove: 99, patience: 20 }) === 'stop',     'past patience, single-shot → stop');
    ok(stagnationAction({ deepMode: true,  noImprove: 20, patience: 20 }) === 'reheat',   'at patience, deep → reheat (never stops)');
    ok(stagnationAction({ deepMode: true,  noImprove: 99, patience: 20 }) === 'reheat',   'past patience, deep → reheat');
}

// ── A3. basinKick: valid escape, respects locks, amplified, ≥1 mutation ──────────
console.log('— basinKick —');
{
    const base = () => [
        { id: 'A', material: 'TiO2', thickness: 100, locked: false },
        { id: 'B', material: 'SiO2', thickness: 80,  locked: false },
        { id: 'C', material: 'TiO2', thickness: 50,  locked: true  },   // locked
        { id: 'D', material: 'SiO2', thickness: 120, locked: false },
    ];
    const lockedSig = (L) => L.filter(l => l.locked).map(l => `${l.material}:${l.thickness}`).join('|');
    let changedCount = 0, kickN = 0;
    const ctx = { pool: POOL, dMin: DMIN, dMax: DMAX, addMaxNm: 120, jitterPct: 0.15, kinds: MUTATION_KINDS, maxKick: 3 };
    for (let s = 1; s <= 60; s++) {
        const layers = base();
        const sig0 = JSON.stringify(layers);
        const out = basinKick(layers, { ...ctx, rng: makeRng(s * 13 + 1) });
        ok(Array.isArray(out) && out.length >= 1, `s${s}: returns non-empty stack`);
        // Locked layer survives untouched.
        ok(lockedSig(out) === lockedSig(base()), `s${s}: locked layer preserved`);
        // Bounds respected.
        for (const l of out) ok(l.thickness >= DMIN - 1e-9 && l.thickness <= DMAX + 1e-9, `s${s}: thickness in bounds`);
        // Input not mutated in place.
        ok(JSON.stringify(layers) === sig0, `s${s}: input not mutated`);
        if (JSON.stringify(out) !== sig0) changedCount++;
        // Layer-count delta is bounded by maxKick structural ops (each ±1 or +2).
        ok(Math.abs(out.length - base().length) <= 2 * 3, `s${s}: count delta within maxKick·2`);
    }
    ok(changedCount >= 55, `kick almost always changes the stack (got ${changedCount}/60)`);

    // Amplified jitter: with ONLY perturb enabled, a kick should move thicknesses
    // more than a single default-jitter perturb would (×3, capped 0.6).
    const flat = [{ id: 'A', material: 'TiO2', thickness: 100, locked: false }];
    let maxRel = 0;
    for (let s = 1; s <= 40; s++) {
        const out = basinKick(flat, { pool: POOL, dMin: DMIN, dMax: DMAX, jitterPct: 0.15, kinds: ['perturb'], maxKick: 1, rng: makeRng(s) });
        maxRel = Math.max(maxRel, Math.abs(out[0].thickness - 100) / 100);
    }
    ok(maxRel > 0.15, `amplified perturb exceeds base jitter 0.15 (max rel move ${maxRel.toFixed(2)})`);
}

// ── B. Integration: single-shot STALLS, deep mode ESCAPES the basin ──────────────
//
// Toy MULTIMODAL landscape over layer COUNT n (thickness is refined away, so MF
// depends only on structure): an easy LOCAL basin at n=3 (floor 0.10) and the
// deeper GLOBAL basin at n=8 (floor 0.005), separated by a hump near n=5 (~0.18).
// A monotone-cooling single-shot anneal started at n=3 gets trapped; deep mode
// reheats + basin-kicks across the barrier.
console.log('— integration: single-shot vs deep —');
{
    const floorN = (n) => Math.min(0.10 + 0.02 * (n - 3) ** 2, 0.005 + 0.02 * (n - 8) ** 2);
    const mfOf = (layers) => floorN(layers.length);
    // Trivial "refiner": thickness is irrelevant to this toy MF; just normalize so
    // proposeMutation always sees clean layers. MF = structural floor only.
    const refine = (layers) => {
        const L = layers.map(l => ({ ...l, thickness: 100 }));
        return { layers: L, mf: mfOf(L) };
    };
    const start = () => ([
        { id: 's0', material: 'TiO2', thickness: 100, locked: false },
        { id: 's1', material: 'SiO2', thickness: 100, locked: false },
        { id: 's2', material: 'TiO2', thickness: 100, locked: false },
    ]);
    const T0 = 0.5, patience = 10, coolPeriod = 30;
    const mutCtx = { pool: POOL, dMin: DMIN, dMax: DMAX, addMaxNm: 120, jitterPct: 0.15, kinds: MUTATION_KINDS };

    // The SAME accept/cool/stagnation loop the window runs, condensed (K=1, no UI).
    function drive({ deepMode, seed, maxIter, budgetIters }) {
        const rng = makeRng(seed);
        let current = refine(start());
        let best = { layers: current.layers.map(l => ({ ...l })), mf: current.mf };
        let bestEver = best.mf, monotone = true;
        let noImprove = 0, reheats = 0, cycleStart = 1, it = 0;
        const bound = deepMode ? budgetIters : maxIter;
        for (it = 1; it <= bound; it++) {
            const T = deepMode
                ? deepTemperature(it - cycleStart, coolPeriod, T0, T0 * 0.005)
                : temperatureAt(it / maxIter, T0, T0 * 0.005);
            const p = proposeMutation(current.layers, { ...mutCtx, rng });
            const cand = p ? refine(p.layers) : null;
            if (cand) {
                if (cand.mf < best.mf - 1e-12) { best = { layers: cand.layers.map(l => ({ ...l })), mf: cand.mf }; noImprove = 0; }
                else noImprove++;
                if (metropolisAccept(current.mf, cand.mf, T, rng)) current = cand;
            } else noImprove++;
            if (current.mf > best.mf * 1.3) current = { layers: best.layers.map(l => ({ ...l })), mf: best.mf };

            const action = stagnationAction({ deepMode, noImprove, patience });
            if (action === 'stop') break;
            if (action === 'reheat') {
                reheats++;
                const kicked = basinKick(best.layers, { ...mutCtx, rng, maxKick: 3 });
                current = refine(kicked);
                if (current.mf < best.mf - 1e-12) best = { layers: current.layers.map(l => ({ ...l })), mf: current.mf };
                cycleStart = it + 1; noImprove = 0;
            }
            if (best.mf > bestEver + 1e-15) monotone = false;
            bestEver = best.mf;
        }
        return { best, reheats, iters: it - 1, monotone };
    }

    let deepWins = 0, deepReachedGlobal = 0;
    const SEEDS = [1, 7, 42, 1234];
    for (const seed of SEEDS) {
        const single = drive({ deepMode: false, seed, maxIter: 80 });
        const deep   = drive({ deepMode: true,  seed, maxIter: 80, budgetIters: 600 });

        ok(single.reheats === 0, `seed ${seed}: single-shot never reheats`);
        ok(single.best.mf <= 0.10 + 1e-9 && single.best.mf >= 0.005, `seed ${seed}: single-shot reaches a basin floor`);
        ok(deep.reheats > 0, `seed ${seed}: deep mode reheats on stagnation (got ${deep.reheats})`);
        ok(deep.monotone, `seed ${seed}: deep-mode global best never increases across reheats`);
        ok(deep.best.mf <= single.best.mf + 1e-12, `seed ${seed}: deep ≤ single (${deep.best.mf.toFixed(4)} vs ${single.best.mf.toFixed(4)})`);
        if (deep.best.mf < single.best.mf - 1e-9) deepWins++;
        if (deep.best.mf < 0.02) deepReachedGlobal++;
    }
    // Single-shot is trapped at ~0.10; deep should strictly beat it and reach the
    // n=8 global basin (<0.02) on the clear majority of seeds.
    ok(deepWins >= 3, `deep mode strictly beats single-shot on ≥3/4 seeds (got ${deepWins})`);
    ok(deepReachedGlobal >= 3, `deep mode reaches the global basin (<0.02) on ≥3/4 seeds (got ${deepReachedGlobal})`);
    console.log(`  deep beat single on ${deepWins}/4 seeds; reached global basin on ${deepReachedGlobal}/4`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (fails === 0) console.log('\n✓ ALL STRUCTURAL DEEP-SEARCH TESTS PASSED');
else { console.error(`\n✗ ${fails} assertion(s) failed`); process.exit(1); }
