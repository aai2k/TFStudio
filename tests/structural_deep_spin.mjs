/**
 * DEEP-MODE SPIN — reporting tool, not pass/fail.
 *
 * Drives the headless structural optimizer (`runStructural`, the faithful port of
 * StructuralOptimizer.js) on the HARD constrained-min-thickness cases — exactly
 * the regime where GE/Structural were bailing to the trivial low-layer seed —
 * comparing single-shot vs the new open-ended Deep mode (#1 + #2: drop maxIter +
 * patience, reheat + basin-kick on stagnation). Run across a SMALL pool
 * (TiO2/SiO2) and a BIG pool (7 dielectrics) so we see whether extra materials
 * help or just enlarge the search space.
 *
 * Each cell gets the SAME wallclock budget; single-shot will stop early on
 * patience, deep mode spends the whole budget reheating. WIN for deep = lower
 * optical MF at an equal-or-reasonable layer count, with the dMin floor honored.
 *
 * Run: node tests/structural_deep_spin.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { caseById, runStructural, opticalMF, minFrontThk } from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initTmmWasmMainThread, tmmWasmActive } from '../src/utils/workers/tmmWasm.js';

const resolveMat = (id) => getMaterial(id);

// ── Enable the WASM TMM kernel (10–21× faster hot paths) so the structural loop
// is fast enough that single-shot REACHES its maxIter cap in a blink, leaving the
// budget for deep mode to keep going. Without it the serial driver is so slow that
// the wall budget binds both modes and reheats never fire.
const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');
if (existsSync(wasmPath)) {
    await initTmmWasmMainThread(readFileSync(wasmPath), true);
    console.log(`WASM TMM kernel: ${tmmWasmActive() ? 'ACTIVE' : 'inactive (init failed)'}`);
} else {
    console.log('WASM kernel not built (npm run build:wasm) — running on pure JS (slower).');
}

// Pools. Big = dielectric set spanning low→high index; drop any id the DB lacks.
const SMALL = ['TiO2', 'SiO2'];
const BIG_WANT = ['TiO2', 'SiO2', 'Ta2O5', 'Nb2O5', 'HfO2', 'MgF2', 'Al2O3'];
const BIG = BIG_WANT.filter((id) => { try { return !!resolveMat(id); } catch { return false; } });

const CASES = ['bandpass', 'shortpass'];   // hard, multi-target edges
const DMIN = 40;                           // constrained min thickness
const BUDGET_MS = 40000;                   // generous budget: let each mode hit ITS OWN stop
// GUI-default-ish settings (now affordable on the WASM kernel): single-shot runs
// its full 80-iter cap in a few seconds, then STOPS — leaving the budget for deep
// mode to keep growing / reheating. If single still stops on 'budget' the driver
// is too slow and the comparison is meaningless (raise the budget).
const TUNE = { innerIter: 12, structMaxIter: 80, structK: 4 };

const fmt = (x, n = 5) => (Number.isFinite(x) ? x.toFixed(n) : '×');
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

console.log(`\nDEEP-MODE SPIN — constrained dMin=${DMIN} nm, budget ${BUDGET_MS / 1000}s/cell`);
console.log(`small pool = [${SMALL.join(', ')}]   big pool = [${BIG.join(', ')}]\n`);
console.log(pad('case', 11), pad('pool', 7), pad('mode', 7),
            padL('MF', 9), padL('lyr', 5), padL('minThk', 7), padL('iters', 6), padL('reheat', 7), padL('time', 7), '  stop');
console.log('─'.repeat(86));

const rows = [];
for (const caseId of CASES) {
    const C = caseById(caseId);
    for (const [poolName, poolIds] of [['small', SMALL], ['big', BIG]]) {
        const baseCfg = { poolIds, budgetMs: BUDGET_MS, engine: 'cg', seed: 777, ...TUNE };
        const start = C.thin();   // thin start = where the bail-to-trivial happened
        const single = runStructural(start, C.ops, DMIN, resolveMat, { ...baseCfg, deepMode: false });
        const deep   = runStructural(C.thin(), C.ops, DMIN, resolveMat, { ...baseCfg, deepMode: true });
        for (const [mode, r] of [['single', single], ['deep', deep]]) {
            const mfOpt = opticalMF(r.design, C.ops, resolveMat);
            const row = { caseId, poolName, mode, mf: mfOpt, layers: r.layers, minThk: minFrontThk(r.design),
                          reheats: r.reheats ?? 0, iters: r.iters ?? 0, stopReason: r.stopReason ?? '?', ms: r.ms };
            rows.push(row);
            console.log(pad(caseId, 11), pad(poolName, 7), pad(mode, 7),
                        padL(fmt(mfOpt), 9), padL(row.layers, 5), padL(fmt(row.minThk, 1), 7),
                        padL(row.iters, 6), padL(row.reheats, 7), padL((row.ms / 1000).toFixed(1) + 's', 7), '  ' + row.stopReason);
        }
    }
}

// ── Verdict: per (case × pool), did deep improve on single-shot? ────────────────
console.log('\n── deep vs single (optical MF) ──');
let wins = 0, total = 0;
for (const caseId of CASES) {
    for (const poolName of ['small', 'big']) {
        const s = rows.find((r) => r.caseId === caseId && r.poolName === poolName && r.mode === 'single');
        const d = rows.find((r) => r.caseId === caseId && r.poolName === poolName && r.mode === 'deep');
        if (!s || !d) continue;
        total++;
        const rel = s.mf > 0 ? (s.mf - d.mf) / s.mf * 100 : 0;
        const better = d.mf < s.mf - 1e-9;
        if (better) wins++;
        const tag = better ? `▼ ${rel.toFixed(0)}% better` : (d.mf > s.mf + 1e-9 ? `▲ ${(-rel).toFixed(0)}% worse` : '= tie');
        console.log(`  ${pad(caseId, 11)} ${pad(poolName, 6)}  single ${fmt(s.mf)} (${s.layers}L)  →  deep ${fmt(d.mf)} (${d.layers}L, ${d.reheats} reheats)   ${tag}`);
    }
}
console.log(`\nDeep mode improved ${wins}/${total} cells. Min-thickness floor (${DMIN} nm) honored: ` +
            `${rows.every((r) => r.minThk >= DMIN - 1e-6 || r.layers === 0) ? 'YES' : 'NO — VIOLATION'}.`);
console.log('(Reporting tool — no pass/fail.)\n');
