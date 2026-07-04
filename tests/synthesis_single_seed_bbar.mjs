/**
 * Single-layer seed → BBAR, grown by Gradual Evolution and Structural,
 * UNCONSTRAINED vs CONSTRAINED (min-thickness ≥ 40 nm).
 *
 * The classic "start from almost nothing and let synthesis build the coating"
 * sanity check: seed = ONE 100 nm layer, target =
 * broadband AR (T→1, 420–680 nm) on BK7 in Air, pool = TiO2 (high) + SiO2 (low).
 *
 *   • UNCONSTRAINED : dMin = 1 nm, no MNT  → free synthesis (lowest MF, more,
 *                     possibly very thin layers).
 *   • CONSTRAINED   : dMin = 40 nm + MNT ≥ 40 nm  → manufacturable floor; GE
 *                     couples its insertion floor to MNT and Structural prunes
 *                     sub-floor layers, so every layer ends ≥ 40 nm (higher MF,
 *                     the price of manufacturability).
 *
 * Runs GE and Structural from both a high-index (TiO2) and a low-index (SiO2)
 * 100 nm seed. (Needle is intentionally excluded — it carves a thick seed and
 * adds no bulk, so a 100 nm seed starves it; and it ignores thickness
 * constraints by design. See the benchmark notes.)
 *
 * Uses the shared benchmark drivers (same code the GUI/CLI benchmark runs).
 * Time-budgeted → BENCH set.  Run: node tests/synthesis_single_seed_bbar.mjs
 */
import { caseById, runSynth, runStructural, opticalMF, minFrontThk, mntOperand }
    from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

const resolveMat = (id) => getMaterial(id);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(6) : '—');

await initWasmForTest();
const bbar = caseById('bbar').ops;                      // BBAR: TGT 420–680 → T=1
const BUDGET = 6000;
const MNT = 40;

const seed = (material) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'S', material, thickness: 100, locked: false }],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});

// One scenario = (constrained?) → the ops + dMin each tool actually runs with.
//   GE respects MNT (keep the operand + couple its floor to MNT).
//   Structural respects MNT (keep the operand; prune to the dMin floor).
const SCENARIOS = [
    { label: 'unconstrained', constrained: false, ops: bbar,                       dMin: 1,   mfMax: 0.05 },
    { label: 'MNT≥40 nm',     constrained: true,  ops: [...bbar, mntOperand(MNT)], dMin: MNT, mfMax: 0.10 },
];

console.log(`=== Single 100 nm seed → BBAR (420–680 nm), pool TiO2/SiO2 on BK7 · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`  ${'seed'.padEnd(12)} ${'tool'.padEnd(12)} ${'constraint'.padEnd(14)} ${'MF0'.padStart(9)} ${'MF'.padStart(10)} ${'layers'.padStart(7)} ${'minT'.padStart(6)} ${'time'.padStart(6)}`);

for (const material of ['TiO2', 'SiO2']) {
    const mf0 = opticalMF(seed(material), bbar, resolveMat);
    for (const sc of SCENARIOS) {
        const ge = runSynth(true, seed(material), sc.ops, sc.dMin, resolveMat, { budgetMs: BUDGET });
        const st = runStructural(seed(material), sc.ops, sc.dMin, resolveMat, { budgetMs: BUDGET });
        for (const [tool, r] of [['Gradual Evol.', ge], ['Structural', st]]) {
            const mf = opticalMF(r.design, bbar, resolveMat);   // optical-only, comparable
            const mt = minFrontThk(r.design);
            console.log(`  ${(`${material} 100nm`).padEnd(12)} ${tool.padEnd(12)} ${sc.label.padEnd(14)} ${fmt(mf0).padStart(9)} ${fmt(mf).padStart(10)} ${String(r.layers).padStart(7)} ${String(Math.round(mt)).padStart(6)} ${(`${(r.ms / 1000).toFixed(1)}s`).padStart(6)}`);
            const tag = `${material}/${tool}/${sc.label}`;
            ok(`${tag}: MF finite`, Number.isFinite(mf));
            ok(`${tag}: grew the stack (≥2 layers)`, r.layers >= 2);
            ok(`${tag}: MF improved vs bare seed`, mf < mf0 - 1e-4);
            ok(`${tag}: reached a usable BBAR (MF < ${sc.mfMax})`, mf < sc.mfMax);
            // Constrained synthesis must HONOR the 40 nm manufacturability floor.
            if (sc.constrained) ok(`${tag}: every layer ≥ ${MNT} nm (constraint honored)`, mt >= MNT - 0.5);
        }
    }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
