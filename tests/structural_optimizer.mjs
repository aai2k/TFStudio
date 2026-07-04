/**
 * Structural optimizer engine tests.
 *
 * Run: node tests/structural_optimizer.mjs
 *
 * The engine (src/utils/synthesis/structuralOptimizer.js) is the PURE core of
 * the Structural Optimizer: seedable RNG, five structural mutation
 * operators, a scale-invariant Metropolis accept rule, and a geometric cooling
 * schedule. The async refinement loop lives in the window component; here we
 * assert the deterministic, side-effect-free invariants:
 *
 *   • RNG is deterministic for a seed and reasonably uniform.
 *   • Each mutation produces a VALID stack — never moves/removes/splits/merges a
 *     LOCKED layer, never violates thickness bounds, changes the layer count by
 *     the right delta (add +1, split +2, remove −1, merge −1, perturb 0).
 *   • proposeMutation falls through inapplicable kinds and respects `kinds`.
 *   • metropolisAccept: improvements always accepted; uphill accepted with the
 *     right scale-invariant probability; frozen (T=0) rejects all uphill.
 *   • temperatureAt: monotone T0→Tend geometric schedule.
 */

import {
    makeRng, proposeMutation, metropolisAccept, temperatureAt,
    clampThickness, MUTATION_KINDS, DEFAULT_MUTATION_WEIGHTS,
} from '../src/utils/synthesis/structuralOptimizer.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const DMIN = 1, DMAX = 2000;
const POOL = [{ id: 'TiO2', name: 'TiO2' }, { id: 'SiO2', name: 'SiO2' }, { id: 'Ta2O5', name: 'Ta2O5' }];

// A reference stack with one LOCKED layer (index 2) to test invariants.
function baseStack() {
    return [
        { id: 'A', material: 'TiO2', thickness: 100, locked: false },
        { id: 'B', material: 'SiO2', thickness: 80,  locked: false },
        { id: 'C', material: 'TiO2', thickness: 5,   locked: true  },   // locked, thin
        { id: 'D', material: 'SiO2', thickness: 120, locked: false },
    ];
}

const lockedSig = (layers) => layers
    .filter(l => l.locked)
    .map(l => `${l.material}:${l.thickness}`)
    .join('|');

function assertValid(out, tag) {
    ok(Array.isArray(out), `${tag}: returns array`);
    for (const l of out) {
        ok(l.thickness >= DMIN - 1e-9 && l.thickness <= DMAX + 1e-9,
            `${tag}: thickness ${l.thickness} in [${DMIN},${DMAX}]`);
        ok(Number.isFinite(l.thickness), `${tag}: thickness finite`);
        ok(typeof l.material === 'string' && l.material.length > 0, `${tag}: has material`);
        ok(typeof l.id === 'string' && l.id.length > 0, `${tag}: has id`);
    }
}

// ── 1. RNG determinism + range ───────────────────────────────────────────────
console.log('— RNG —');
{
    const a = makeRng(12345), b = makeRng(12345), c = makeRng(99);
    let sameAB = true, diffAC = false, inRange = true, sum = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
        const x = a(), y = b(), z = c();
        if (x !== y) sameAB = false;
        if (x !== z) diffAC = true;
        if (x < 0 || x >= 1) inRange = false;
        sum += x;
    }
    ok(sameAB, 'same seed → identical sequence');
    ok(diffAC, 'different seed → different sequence');
    ok(inRange, 'all draws in [0,1)');
    const mean = sum / N;
    ok(mean > 0.45 && mean < 0.55, `mean ≈ 0.5 (got ${mean.toFixed(3)})`);
}

// ── 2. Each mutation kind: validity + locked invariant + count delta ─────────
console.log('— mutation operators —');
{
    const ctx = (rng) => ({ rng, pool: POOL, dMin: DMIN, dMax: DMAX, addMaxNm: 120, jitterPct: 0.15 });
    const deltas = { add: +1, split: +2, remove: -1, merge: -1, perturb: 0 };

    for (const kind of MUTATION_KINDS) {
        // Run several seeds so we exercise different random picks per kind.
        let got = 0;
        for (let s = 1; s <= 40; s++) {
            const layers = baseStack();
            const before = layers.length;
            const lockBefore = lockedSig(layers);
            const res = proposeMutation(layers, { ...ctx(makeRng(s * 7 + 1)), kinds: [kind] });
            if (!res) continue;
            got++;
            ok(res.mutation.kind === kind, `${kind}: mutation.kind matches`);
            assertValid(res.layers, kind);
            // Locked layer(s) must survive untouched.
            ok(lockedSig(res.layers) === lockBefore, `${kind}: locked layer preserved`);
            ok(res.layers.length === before + deltas[kind],
                `${kind}: layer delta ${deltas[kind]} (got ${res.layers.length - before})`);
            // Originals are not mutated in place.
            ok(layers.length === before, `${kind}: input array not mutated`);
        }
        ok(got > 0, `${kind}: applicable at least once`);
    }
}

// ── 3. Split/merge never touch a locked layer even when adjacent ─────────────
console.log('— locked adjacency —');
{
    // Stack where the ONLY adjacent pair straddles a locked layer → merge must
    // be inapplicable; split must avoid the locked layer.
    const layers = [
        { id: 'L', material: 'TiO2', thickness: 50, locked: true },
        { id: 'M', material: 'SiO2', thickness: 60, locked: false },
    ];
    let mergeApplied = false;
    for (let s = 1; s <= 50; s++) {
        const res = proposeMutation(layers, { rng: makeRng(s), pool: POOL, dMin: DMIN, dMax: DMAX, kinds: ['merge'] });
        if (res) mergeApplied = true;
    }
    ok(!mergeApplied, 'merge inapplicable when only pair includes a locked layer');

    // split should only ever split the unlocked layer M (id changes), never L.
    for (let s = 1; s <= 50; s++) {
        const res = proposeMutation(layers, { rng: makeRng(s), pool: POOL, dMin: DMIN, dMax: DMAX, addMaxNm: 30, kinds: ['split'] });
        if (res) ok(res.layers.some(l => l.id === 'L' && l.locked && l.thickness === 50), 'split keeps locked L intact');
    }
}

// ── 4. proposeMutation falls through inapplicable kinds ──────────────────────
console.log('— fall-through —');
{
    // Single locked layer: add is the only thing that can apply (pool present);
    // remove/merge/split/perturb all inapplicable.
    const layers = [{ id: 'X', material: 'TiO2', thickness: 100, locked: true }];
    let kinds = new Set();
    for (let s = 1; s <= 60; s++) {
        const res = proposeMutation(layers, { rng: makeRng(s), pool: POOL, dMin: DMIN, dMax: DMAX });
        if (res) kinds.add(res.mutation.kind);
    }
    ok(kinds.size === 1 && kinds.has('add'),
        `only 'add' applies on a single locked layer (got ${[...kinds].join(',')})`);

    // No pool + only locked layers → nothing applies → null.
    const res = proposeMutation(layers, { rng: makeRng(1), pool: [], dMin: DMIN, dMax: DMAX });
    ok(res === null, 'returns null when no mutation applies');
}

// ── 5. add/split introduce a contrasting material when possible ──────────────
console.log('— contrast material —');
{
    // A uniform stack; an inserted layer should prefer a material != neighbours.
    const layers = [{ id: 'A', material: 'TiO2', thickness: 200, locked: false }];
    let allContrast = true;
    for (let s = 1; s <= 40; s++) {
        const res = proposeMutation(layers, { rng: makeRng(s), pool: POOL, dMin: DMIN, dMax: DMAX, addMaxNm: 40, kinds: ['add'] });
        if (res && res.mutation.materialId === 'TiO2') allContrast = false;
    }
    ok(allContrast, 'added layer avoids the neighbour material when alternatives exist');
}

// ── 6. Metropolis accept rule ────────────────────────────────────────────────
console.log('— metropolis —');
{
    const always1 = () => 0.0;     // smallest roll → most permissive
    const always0 = () => 0.9999;  // largest roll → most restrictive

    ok(metropolisAccept(1.0, 0.5, 0.1, always0) === true, 'improvement always accepted (even with high roll)');
    ok(metropolisAccept(1.0, 1.0, 0.1, always0) === true, 'equal accepted');
    ok(metropolisAccept(1.0, 2.0, 0.0, always1) === false, 'T=0 rejects all uphill');

    // Scale invariance: same relative worsening → same accept probability,
    // regardless of absolute MF magnitude.
    const relWorse = 0.2;   // 20% worse
    const T = 0.1;
    const pExpected = Math.exp(-relWorse / T);
    // Monte-Carlo the acceptance rate at two very different MF scales.
    const rate = (mfOld) => {
        const rng = makeRng(2024);
        let acc = 0; const N = 20000;
        for (let i = 0; i < N; i++) if (metropolisAccept(mfOld, mfOld * (1 + relWorse), T, rng)) acc++;
        return acc / N;
    };
    const r1 = rate(1e-3), r2 = rate(40);     // ~40000× apart (scale note)
    ok(Math.abs(r1 - pExpected) < 0.02, `accept rate @1e-3 ≈ exp(-relΔ/T) (got ${r1.toFixed(3)} vs ${pExpected.toFixed(3)})`);
    ok(Math.abs(r2 - pExpected) < 0.02, `accept rate @40 ≈ exp(-relΔ/T)  (got ${r2.toFixed(3)} vs ${pExpected.toFixed(3)})`);
    ok(Math.abs(r1 - r2) < 0.02, 'accept rate is scale-invariant across 40000× MF range');
}

// ── 7. Temperature schedule ──────────────────────────────────────────────────
console.log('— cooling —');
{
    const T0 = 0.2, Tend = 0.001;
    ok(near(temperatureAt(0, T0, Tend), T0), 'T(0) = T0');
    ok(near(temperatureAt(1, T0, Tend), Tend, 1e-6), 'T(1) = Tend');
    let mono = true, prev = Infinity;
    for (let i = 0; i <= 20; i++) {
        const T = temperatureAt(i / 20, T0, Tend);
        if (T > prev + 1e-12) mono = false;
        prev = T;
    }
    ok(mono, 'T monotonically decreasing');
    ok(temperatureAt(0.5, T0, Tend) > Tend && temperatureAt(0.5, T0, Tend) < T0, 'T(0.5) between Tend and T0');
}

// ── 8. clampThickness ────────────────────────────────────────────────────────
console.log('— clamp —');
{
    ok(clampThickness(-5, 1, 2000) === 1, 'clamps below to dMin');
    ok(clampThickness(5000, 1, 2000) === 2000, 'clamps above to dMax');
    ok(clampThickness(NaN, 1, 2000) === 1, 'NaN → dMin');
    ok(clampThickness(50, 1, 2000) === 50, 'in-range unchanged');
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (fails === 0) console.log('\n✓ ALL STRUCTURAL OPTIMIZER TESTS PASSED');
else { console.error(`\n✗ ${fails} assertion(s) failed`); process.exit(1); }
