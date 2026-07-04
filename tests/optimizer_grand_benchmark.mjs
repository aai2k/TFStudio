/**
 * GRAND optimizer benchmark — CLI report.
 *
 * Console front-end over the shared driver core
 * (src/utils/benchmark/optimizerBenchmark.js) — the SAME module the in-app
 * OptimizerBenchmark window's worker uses, so the CLI numbers and the GUI
 * numbers are produced by identical code. Exercises every optimizer family on
 * the WASM kernel:
 *
 *   • Refinement (local, fixed N): dls · cg · newton · newton-cg · sqp  (× maxIter)
 *   • Refinement (global):         de · sa · dls-multi
 *   • Needle / Gradual Evolution / Structural  (× dMin ∈ {1,40})
 *
 * Metrics: final merit function (lower better), wall time, layer count.
 * Synthesis runs are TIME-BUDGETED + self-terminate at convergence.
 *
 * REPORTING tool (no pass/fail) — in the BENCH set, excluded from `npm test`.
 *   node tests/optimizer_grand_benchmark.mjs            (~4-6 min)
 *   node tests/optimizer_grand_benchmark.mjs --quick    (2 cases, ~1.5 min)
 *   node tests/optimizer_grand_benchmark.mjs --long     (bigger synth budgets)
 */
import {
    BENCH_CASES, LOCAL_METHODS, GLOBAL_METHODS, SYNTH_ENGINES, refineStart,
    runRefine, runDlsMulti, runSynth, runStructural, caseSeeds, paretoFront,
    mntOperand, opticalMF, minFrontThk, describePool, REFINE_MAXITER, GLOBAL_MAXITER,
} from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

const resolveMat = (id) => getMaterial(id);
const QUICK = process.argv.includes('--quick');
const LONG  = process.argv.includes('--long');
const MNT   = process.argv.includes('--mnt40') ? 40 : null;   // add a min-thickness ≥ 40 nm constraint
const ENGINES = process.argv.includes('--engines') ? SYNTH_ENGINES : ['dls']; // sweep synthesis inner refiner
const SWEEP = process.argv.includes('--sweep');   // sweep flat maxIter caps; default = run to convergence (matches window)
const CASES = QUICK ? BENCH_CASES.slice(0, 2) : BENCH_CASES;
const MAXITS = QUICK ? [200] : [60, 200, 500];
const DMINS = [1, 40];
const synthCfg = LONG ? { budgetMs: 25000, maxSteps: 400, structMaxIter: 120 } : {};
// Operands the optimizer SEES (with MNT penalty when --mnt40); MF is always
// REPORTED optical-only on C.ops so constrained / unconstrained stay comparable.
const opsOf = (C) => (MNT ? [...C.ops, mntOperand(MNT)] : C.ops);
const mfRep = (C, r) => (r.design ? opticalMF(r.design, C.ops, resolveMat) : r.mf);
const minT  = (r) => (r.design ? Math.round(minFrontThk(r.design)) : null);

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const fmtMF = (x) => (x == null || !Number.isFinite(x) ? '   —    ' : x.toFixed(6));
const fmtMs = (x) => `${(x / 1000).toFixed(1)}s`;

const summary = [];

console.log('═'.repeat(78));
console.log('  TFStudio GRAND OPTIMIZER BENCHMARK');
const wasm = await initWasmForTest();
console.log(`  WASM kernel: ${wasm && tmmWasmActive() ? 'ACTIVE ✓' : 'INACTIVE (JS fallback)'}`);
console.log(`  Mode: ${QUICK ? 'quick' : LONG ? 'long' : 'default'} · cases: ${CASES.length}${MNT ? ` · MNT ≥ ${MNT} nm constraint ON` : ''}`);
console.log(`  Synthesis pool: ${describePool(resolveMat)}`);
if (ENGINES.length > 1) console.log(`  Inner-engine sweep: ${ENGINES.join(', ')}`);
if (MNT) console.log('  NOTE: NEEDLE strips thickness constraints by design (its candidate scan is\n        optical-only) → expect "minT" violations (!) on Needle rows. GE, Structural\n        and Refinement HONOR MNT (penalty kept in the DLS refine).');
console.log('═'.repeat(78));

for (const C of CASES) {
    console.log(`\n\n████ ${C.name}`);
    const sd = caseSeeds(C);
    console.log('  Starting points:');
    console.log(`    refine : ${sd.refine}`);
    console.log(`    needle : ${sd.thick}`);
    console.log(`    GE/str.: ${sd.thin}`);

    if (SWEEP) {
        console.log(`\n  ── Refinement (local, fixed ${C.refineN}-layer stack, dMin=10, maxIter sweep) ──`);
        console.log(`  ${pad('method', 12)} ${MAXITS.map((m) => padL(`MF@${m}it`, 11)).join(' ')}   ${padL('best ms', 9)}`);
        for (const m of LOCAL_METHODS) {
            const cells = []; let bestMs = 0, bestMF = Infinity;
            for (const mi of MAXITS) {
                const r = runRefine(m, refineStart(C.refineN), opsOf(C), mi, 10, resolveMat);
                if (r.err) { cells.push(padL('ERR', 11)); continue; }
                const mf = mfRep(C, r);
                cells.push(padL(fmtMF(mf), 11));
                if (mf < bestMF) { bestMF = mf; bestMs = r.ms; }
            }
            summary.push({ case: C.name, opt: `refine:${m}`, setting: `maxIter≤${MAXITS[MAXITS.length - 1]}`, mf: bestMF, layers: C.refineN, ms: bestMs });
            console.log(`  ${pad(m, 12)} ${cells.join(' ')}   ${padL(bestMs.toFixed(0) + 'ms', 9)}`);
        }
    } else {
        console.log(`\n  ── Refinement (local, fixed ${C.refineN}-layer stack, dMin=10, → CONVERGENCE @ window budgets) ──`);
        console.log(`  ${pad('method', 12)} ${padL('MF', 11)} ${padL('iters', 7)} ${padL('minT', 6)} ${padL('time', 8)}`);
        for (const m of LOCAL_METHODS) {
            const r = runRefine(m, refineStart(C.refineN), opsOf(C), REFINE_MAXITER[m], 10, resolveMat);
            if (r.err) { console.log(`  ${pad(m, 12)} ERR ${r.err}`); continue; }
            const mf = mfRep(C, r);
            summary.push({ case: C.name, opt: `refine:${m}`, setting: `→conv(${REFINE_MAXITER[m]})`, mf, layers: C.refineN, ms: r.ms, minT: minT(r) });
            console.log(`  ${pad(m, 12)} ${padL(fmtMF(mf), 11)} ${padL(r.it, 7)} ${padL(minT(r) ?? '—', 6)} ${padL(fmtMs(r.ms), 8)}`);
        }
    }

    console.log(`\n  ── Refinement (global/stochastic, ${C.refineN}-layer, → convergence) ──`);
    console.log(`  ${pad('method', 12)} ${padL('MF', 11)}  ${padL('iters', 7)}  ${padL('time', 8)}`);
    for (const m of GLOBAL_METHODS) {
        const r = runRefine(m, refineStart(C.refineN), opsOf(C), GLOBAL_MAXITER[m], 10, resolveMat);
        if (r.err) { console.log(`  ${pad(m, 12)} ERR ${r.err}`); continue; }
        const mf = mfRep(C, r);
        summary.push({ case: C.name, opt: `refine:${m}`, setting: 'global', mf, layers: C.refineN, ms: r.ms });
        console.log(`  ${pad(m, 12)} ${padL(fmtMF(mf), 11)}  ${padL(r.it, 7)}  ${padL(fmtMs(r.ms), 8)}`);
    }
    {
        const r = runDlsMulti(refineStart(C.refineN), opsOf(C), GLOBAL_MAXITER['dls-multi'], 10, resolveMat, 6);
        const mf = mfRep(C, r);
        summary.push({ case: C.name, opt: 'refine:dls-multi', setting: '6 starts', mf, layers: C.refineN, ms: r.ms });
        console.log(`  ${pad('dls-multi', 12)} ${padL(fmtMF(mf), 11)}  ${padL(r.it + 'st', 7)}  ${padL(fmtMs(r.ms), 8)}`);
    }

    console.log(`\n  ── Synthesis (grows layers; fewer layers better)${ENGINES.length > 1 ? ' · inner-engine sweep' : ''} ──`);
    console.log(`  ${pad('optimizer', 14)} ${pad('engine', 10)} ${padL('dMin', 5)} ${padL('MF', 11)} ${padL('layers', 7)} ${padL('minT', 6)} ${padL('time', 7)}`);
    const synthRow = (label, seed, forced, isStruct) => {
        // Needle ignores MNT by design (strips constraints) → base ops; GE &
        // Structural respect it → constrained ops.
        const isNeedle = !isStruct && !forced;
        const isGE = forced && !isStruct;
        const synthOps = isNeedle ? C.ops : opsOf(C);
        for (const eng of ENGINES) {
            for (const dMin of DMINS) {
                // GE couples its floor to MNT (mirrors GradualEvolution.js) so it honors it.
                const effDmin = (isGE && MNT) ? Math.max(dMin, MNT) : dMin;
                const cfg = { ...synthCfg, engine: eng };
                const r = isStruct ? runStructural(seed(), synthOps, effDmin, resolveMat, cfg)
                                   : runSynth(forced, seed(), synthOps, effDmin, resolveMat, cfg);
                const mf = mfRep(C, r);
                const mt = minT(r);
                const flag = (MNT && mt != null && mt < MNT - 0.5) ? '!' : '';
                const optKey = (isStruct ? 'structural' : (forced ? 'ge' : 'needle')) + (ENGINES.length > 1 ? `/${eng}` : '');
                summary.push({ case: C.name, opt: optKey, tool: isStruct ? 'structural' : (forced ? 'ge' : 'needle'), engine: eng, setting: `dMin=${dMin}${MNT ? ' MNT' + MNT : ''}`, mf, layers: r.layers, ms: r.ms, minT: mt });
                console.log(`  ${pad(label, 14)} ${pad(eng, 10)} ${padL(dMin, 5)} ${padL(fmtMF(mf), 11)} ${padL(r.layers, 7)} ${padL((mt ?? '—') + flag, 6)} ${padL(fmtMs(r.ms), 7)}`);
            }
        }
    };
    synthRow('Needle', C.thick, false, false);
    synthRow('Gradual Evol.', C.thin, true, false);
    synthRow('Structural', C.thin, false, true);
}

// ── inner-engine comparison: best engine per synthesis tool, per case ─────────────
if (ENGINES.length > 1) {
    console.log(`\n\n${'═'.repeat(78)}`);
    console.log('  SYNTHESIS INNER-ENGINE COMPARISON — best inner refiner per tool, per case');
    console.log('  (lowest MF over the dMin sweep; "fewer layers / less time" break ties in your head)');
    console.log('═'.repeat(78));
    for (const C of CASES) {
        console.log(`\n  ${C.name}`);
        for (const tool of ['needle', 'ge', 'structural']) {
            const rows = summary.filter((s) => s.case === C.name && s.tool === tool);
            if (!rows.length) continue;
            const byEng = ENGINES.map((eng) => rows.filter((r) => r.engine === eng).sort((a, b) => a.mf - b.mf)[0]).filter(Boolean);
            const best = byEng.slice().sort((a, b) => a.mf - b.mf)[0];
            console.log(`    ${pad(tool, 12)} ${byEng.map((r) => `${r.engine}=${fmtMF(r.mf)}${r === best ? '★' : ''}`).join('  ')}`);
            console.log(`    ${pad('', 12)} → best: ${best.engine} (MF=${fmtMF(best.mf)}, ${best.layers} layers, ${fmtMs(best.ms)}, ${best.setting})`);
        }
    }
}

console.log(`\n\n${'═'.repeat(78)}`);
console.log('  SUMMARY — best MF achieved per optimizer family, per case');
console.log('═'.repeat(78));
const families = ['refine:dls', 'refine:cg', 'refine:newton', 'refine:newton-cg', 'refine:sqp',
    'refine:de', 'refine:sa', 'refine:dls-multi', 'needle', 'ge', 'structural'];
for (const C of CASES) {
    console.log(`\n  ${C.name}`);
    const rows = summary.filter((s) => s.case === C.name);
    const best = {};
    for (const f of families) {
        const fr = rows.filter((r) => r.opt === f).sort((a, b) => a.mf - b.mf)[0];
        if (fr) best[f] = fr;
    }
    const winner = Object.values(best).sort((a, b) => a.mf - b.mf)[0];
    console.log(`  ${pad('optimizer', 18)} ${padL('best MF', 11)} ${padL('layers', 7)} ${padL('setting', 12)} ${padL('time', 7)}`);
    for (const f of families) {
        const r = best[f];
        if (!r) continue;
        const star = r === winner ? '  ★' : '';
        console.log(`  ${pad(f, 18)} ${padL(fmtMF(r.mf), 11)} ${padL(r.layers, 7)} ${padL(r.setting, 12)} ${padL(fmtMs(r.ms), 7)}${star}`);
    }
}
console.log(`\n  ★ = lowest MF for that case.  Refinement layer count is FIXED (no layer`);
console.log('    synthesis); needle/GE/structural grow the stack — judge MF AND layers');
console.log('    together.  DE/SA are stochastic (vary by seed).');

// ── Pareto frontier over (MF, time, layers) — all minimized ───────────────────────
console.log(`\n\n${'═'.repeat(78)}`);
console.log('  PARETO FRONTIER — non-dominated (MF ↓ · time ↓ · layers ↓), per case');
console.log('═'.repeat(78));
for (const C of CASES) {
    const rows = summary.filter((s) => s.case === C.name)
        .map((s) => ({ ...s, layers: s.layers, ms: s.ms }));
    const front = paretoFront(rows).sort((a, b) => a.mf - b.mf);
    console.log(`\n  ${C.name}`);
    console.log(`  ${pad('optimizer', 18)} ${padL('MF', 11)} ${padL('layers', 7)} ${padL('time', 7)} ${padL('setting', 12)}`);
    for (const r of front)
        console.log(`  ${pad(r.opt, 18)} ${padL(fmtMF(r.mf), 11)} ${padL(r.layers, 7)} ${padL(fmtMs(r.ms), 7)} ${padL(r.setting, 12)}`);
}
console.log('\n  These are the configurations where you cannot improve one of {MF, time,');
console.log('  layers} without giving up another — the rational choices to pick among.');
console.log('');
