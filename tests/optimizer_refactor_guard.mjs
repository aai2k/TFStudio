/**
 * Optimizer refactor guard — a SWIFT before/after identity check.
 *
 * Purpose: when refactoring the optimizer / merit-math core (lsqEngine, evalCore,
 * thinFilmMath, the per-operand Jacobian rows, the Newton/GN system assembly),
 * we need to confirm the numbers did not move — not just that the analytic
 * Jacobian still matches finite differences (the FD-validation tests do that),
 * but that the END-TO-END refinement trajectory is unchanged.
 *
 * How: every deterministic per-step method (dls, newton, newton-cg, sqp, cg) is
 * driven a FIXED number of steps from a FIXED start across cases that exercise
 * each _jacRow branch (single-λ, range-avg, range-target, weighted-integral,
 * min/max, thickness constraint) and every surface mode (front_only, back_only,
 * symmetric, both_independent). The final MF and layer thicknesses are captured
 * to full precision and compared against a committed golden snapshot
 * (`optimizer_refactor_guard.golden.json`).
 *
 * Deterministic by construction: these engines take no RNG on `step()` (only
 * multi-start perturbation does, which this test does not use). Any change in a
 * captured number is a real behavior change and must be explained.
 *
 * Update the baseline INTENTIONALLY (after a change you have verified is a
 * deliberate, correct behavior change):  node tests/optimizer_refactor_guard.mjs --update
 * Run the guard:                          node tests/optimizer_refactor_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initTmmWasmMainThread, setTmmWasmEnabled, tmmWasmActive } from '../src/utils/workers/tmmWasm.js';

const resolveMat = id => getMaterial(id);
const deep = x => JSON.parse(JSON.stringify(x));
const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'optimizer_refactor_guard.golden.json');
const UPDATE = process.argv.includes('--update');
const NOWASM = process.argv.includes('--no-wasm');

// WASM acceleration: route mfAt + the analytic Jacobian through the compiled TMM
// kernel (the production path) when it is built. Falls back to pure JS if the
// kernel is absent or --no-wasm is passed. The kernel mode is recorded in the
// golden so a comparison across modes is flagged rather than mistaken for a
// refactor regression (WASM agrees with JS to ~1e-15/call, not bit-identically).
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');
let wasmOn = false;
if (!NOWASM && existsSync(wasmPath)) {
    await initTmmWasmMainThread(readFileSync(wasmPath), true);
    wasmOn = tmmWasmActive();
} else {
    setTmmWasmEnabled(false);
}

// Perturb a design's free thicknesses deterministically so every method has real
// work to do from an identical, reproducible start.
function perturb(d) {
    const bump = (l, i) => ({ ...l, thickness: l.thickness * (1 + 0.12 * Math.sin(i + 1)) });
    return {
        ...d,
        frontLayers: (d.frontLayers || []).map(bump),
        backLayers:  (d.backLayers  || []).map(bump),
    };
}

const arDesign = (surfaceMode, extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'TiO2', thickness: 110, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 90,  locked: false },
        { id: 'L3', material: 'TiO2', thickness: 65,  locked: false },
        { id: 'L4', material: 'SiO2', thickness: 140, locked: false },
    ],
    backLayers: [], surfaceMode, mfEvalMode: 'side', ...extra,
});

const backDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [],
    backLayers: [
        { id: 'B1', material: 'TiO2', thickness: 105, locked: false },
        { id: 'B2', material: 'SiO2', thickness: 95,  locked: false },
        { id: 'B3', material: 'TiO2', thickness: 70,  locked: false },
    ],
    surfaceMode: 'back_only', mfEvalMode: 'side',
});

const bothDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'F1', material: 'TiO2', thickness: 100, locked: false },
        { id: 'F2', material: 'SiO2', thickness: 120, locked: false },
    ],
    backLayers: [
        { id: 'B1', material: 'Ta2O5', thickness: 80, locked: false },
        { id: 'B2', material: 'MgF2',  thickness: 95, locked: false },
    ],
    surfaceMode: 'both_independent', mfEvalMode: 'side',
});

const AR = makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 });

// Each case: a design + operand set exercising a specific _jacRow branch / mode.
const CASES = {
    'single-λ/front': {
        design: arDesign('front_only'),
        ops: [
            makeOperand({ type: 'T', lambdaStart: 510, aoi: 0, pol: 's', target: 1, weight: 1 }),
            makeOperand({ type: 'R', lambdaStart: 620, aoi: 0, pol: 'p', target: 0, weight: 1 }),
        ],
    },
    'range-avg/front': {
        design: arDesign('front_only'),
        ops: [
            makeOperand({ type: 'TAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
            makeOperand({ type: 'RAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 2 }),
        ],
    },
    'range-target/front': {
        design: arDesign('front_only'),
        ops: [
            makeOperand({ type: 'TGT', lambdaStart: 470, lambdaEnd: 530, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 }),
            makeOperand({ type: 'RGT', lambdaStart: 590, lambdaEnd: 660, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 }),
        ],
    },
    'integral/front': {
        design: arDesign('front_only'),
        ops: [
            makeOperand({ type: 'RIW', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1,
                source: { id: 'E' }, detector: { id: 'flat' } }),
        ],
    },
    'minmax/front': {
        design: arDesign('front_only'),
        ops: [
            makeOperand({ type: 'RMX', lambdaStart: 500, lambdaEnd: 640, aoi: 0, pol: 'avg', target: 0.02, weight: 1 }),
            AR,
        ],
    },
    'constraint/front': {
        design: arDesign('front_only'),
        ops: [
            AR,
            makeOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target: 60, weight: 1 }),
        ],
    },
    'range-avg/back_only': { design: backDesign(), ops: [AR] },
    'range-avg/symmetric': { design: arDesign('symmetric'), ops: [AR] },
    'range-avg/both_independent': { design: bothDesign(), ops: [AR] },
};

const METHODS = ['dls', 'newton', 'newton-cg', 'sqp', 'cg'];
const STEPS = 25;

// Run one (case × method) deterministically and snapshot the result.
function snapshot(design, ops, method) {
    const eng = makeEngine(method, ops, deep(perturb(design)), resolveMat, { dMin: 1 });
    for (let i = 0; i < STEPS; i++) {
        if (eng.mf < 1e-9) break;
        eng.step();
        if ((eng.lamD ?? 0) >= 1e8 || (eng.lamN ?? 0) >= 1e8) break;
    }
    return { mf: eng.mf, thk: Array.from(eng.thicknesses) };
}

console.log(`kernel: ${wasmOn ? 'WASM (accelerated)' : 'pure JS'}`);
const results = {};
for (const [name, { design, ops }] of Object.entries(CASES)) {
    for (const method of METHODS) {
        results[`${name} | ${method}`] = snapshot(design, ops, method);
    }
}
const current = { _meta: { wasm: wasmOn, steps: STEPS }, results };

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(current, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden snapshot (${wasmOn ? 'WASM' : 'JS'}): ${GOLDEN}`);
    console.log(`  ${Object.keys(results).length} (case × method) entries captured.`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const gMeta = golden._meta || {};
const gResults = golden.results || golden;   // tolerate a pre-_meta golden
// Same kernel mode → demand strict numerical identity (a refactor must not move
// any bit-relevant digit). Different mode → the ~1e-15/call WASM↔JS kernel gap
// amplifies over the step sequence, so only assert the trajectories stayed close.
const sameMode = !!gMeta.wasm === wasmOn;
const REL = sameMode ? 1e-9 : 1e-5;
if (!sameMode) {
    console.log(`⚠  golden was captured under ${gMeta.wasm ? 'WASM' : 'JS'}, running under ${wasmOn ? 'WASM' : 'JS'} — using cross-mode tolerance ${REL.toExponential(0)} (kernel gap, not a refactor check). Re-run with matching mode or --update for a strict guard.`);
}

let maxDelta = 0, fails = 0, checked = 0;
const relDiff = (a, b) => Math.abs(a - b) / (Math.max(Math.abs(a), Math.abs(b)) + 1e-30);

for (const key of Object.keys(gResults)) {
    const g = gResults[key], c = results[key];
    checked++;
    if (!c) { console.log(`MISSING ❌  ${key}`); fails++; continue; }
    let dMF = relDiff(g.mf, c.mf);
    let dThk = 0;
    if (g.thk.length !== c.thk.length) { dThk = Infinity; }
    else for (let i = 0; i < g.thk.length; i++) dThk = Math.max(dThk, relDiff(g.thk[i], c.thk[i]));
    const d = Math.max(dMF, dThk);
    maxDelta = Math.max(maxDelta, d);
    if (d > REL) {
        fails++;
        console.log(`DRIFT ❌  ${key}: relΔMF=${dMF.toExponential(2)} relΔthk=${dThk.toExponential(2)}`);
        console.log(`          golden MF=${g.mf}  current MF=${c.mf}`);
    }
}
// Any current entry not in golden (new case added without updating baseline).
for (const key of Object.keys(results)) {
    if (!(key in gResults)) { console.log(`NEW (not in golden) ⚠  ${key} — run with --update`); fails++; }
}

console.log(`\nChecked ${checked} entries · max relΔ = ${maxDelta.toExponential(2)} · tolerance ${REL.toExponential(0)}`);
if (fails === 0) { console.log('PASS ✅  optimizer end-to-end trajectories identical to golden'); process.exit(0); }
console.log(`FAIL ❌  ${fails} entr${fails === 1 ? 'y' : 'ies'} drifted — investigate or --update if intentional`);
process.exit(1);
