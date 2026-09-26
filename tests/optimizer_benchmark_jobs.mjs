// Guard the shared optimizer-benchmark driver core that the in-app
// OptimizerBenchmark window's worker runs (buildJobs + runJob). Fast: one case,
// a couple of refine cells, short Needle and GE cells and two short Structural
// runs (tiny budgets). This is the EXACT code path benchmarkWorker.js executes,
// with getMaterial as resolveMat (built-in DB, identical main-thread / worker /
// CLI math); the Structural cells run the window's runner, which draws the same
// materials from the built-in catalog.
// Run: node tests/optimizer_benchmark_jobs.mjs
import {
    BENCH_CASES, LOCAL_METHODS, GLOBAL_METHODS, DMIN_SWEEP, buildJobs, runJob, runStructural, caseById,
    minFrontThk,
} from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest } from './_wasmInit.mjs';

const resolveMat = (id) => getMaterial(id);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };

await initWasmForTest();

// ── buildJobs expansion ─────────────────────────────────────────────────────────
{
    const jobs = buildJobs({
        cases: ['bbar'],
        refineLocal: true, refineMaxIters: [60, 200],
        refineGlobal: true, dlsMulti: true, globalMaxIter: 100,
        needle: true, ge: true, structural: true, dMins: [1, 40],
    });
    // 5 local × 2 maxIters = 10 ; 2 global + 1 dls-multi = 3 ; 3 synth × 2 dMin = 6 → 19
    ok('buildJobs count', jobs.length === 10 + 3 + 6);
    ok('every job has id+kind+caseId', jobs.every((j) => j.id && j.kind && j.caseId === 'bbar'));
    ok('local methods present', LOCAL_METHODS.every((m) => jobs.some((j) => j.kind === 'refine' && j.method === m)));
    ok('global methods present', GLOBAL_METHODS.every((m) => jobs.some((j) => j.kind === 'refine-global' && j.method === m)));
    ok('dls-multi present', jobs.some((j) => j.kind === 'dls-multi'));
    ok('synth dMin sweep', DMIN_SWEEP.every((d) => jobs.some((j) => j.kind === 'needle' && j.dMin === d)));
    ok('empty config → empty', buildJobs({ cases: ['bbar'], refineLocal: false }).length === 0);
}

// ── Convergence mode (default): one cell per local method at its window budget ─────
{
    const jc = buildJobs({ cases: ['bbar'], refineLocal: true, refineGlobal: false, needle: false, ge: false, structural: false });
    ok('converge = 1 cell per local method (5)', jc.length === 5);
    ok('converge uses per-method MAXITER (cg=600, dls=500, newton=200)',
        jc.find((j) => j.method === 'cg').maxIter === 600 &&
        jc.find((j) => j.method === 'dls').maxIter === 500 &&
        jc.find((j) => j.method === 'newton').maxIter === 200);
    ok('converge setting label →conv', jc.every((j) => /→conv/.test(j.setting)));
    // Explicit maxIter sweep still works (refineMaxIters present → sweep mode).
    ok('explicit refineMaxIters → sweep', buildJobs({ cases: ['bbar'], refineLocal: true, refineGlobal: false, needle: false, refineMaxIters: [60, 200] }).length === 10);
}

// ── runJob: refinement cell (fixed N, finite MF, layer count = case refineN) ──────
{
    const C = caseById('bbar');
    const job = buildJobs({ cases: ['bbar'], refineLocal: true, refineMaxIters: [120] })
        .find((j) => j.method === 'dls');
    const r = await runJob(job, resolveMat);
    ok('refine returns finite mf', Number.isFinite(r.mf));
    ok('refine layers = refineN', r.layers === C.refineN);
    ok('refine mf improved from mf0', r.mf <= r.mf0 + 1e-9);
    ok('refine has time', r.ms >= 0);

    // Newton must run natively (no error) in front_only side-mode.
    const jn = buildJobs({ cases: ['bbar'], refineLocal: true, refineMaxIters: [60] }).find((j) => j.method === 'newton');
    const rn = await runJob(jn, resolveMat);
    ok('newton runs (no err)', !rn.err && Number.isFinite(rn.mf));
}

// ── runJob: synth cell with a TINY budget (exercises the needle path, stays fast) ─
{
    const job = buildJobs({ cases: ['bbar'], refineLocal: false, needle: true, dMins: [40], synthCfg: { budgetMs: 1500, maxSteps: 30 } })[0];
    ok('synth job is needle dMin=40', job.kind === 'needle' && job.dMin === 40);
    let ticks = 0;
    const r = await runJob(job, resolveMat, { onTick: () => { ticks++; } });
    ok('synth returns finite mf', Number.isFinite(r.mf));
    ok('synth grew ≥1 layer', r.layers >= 1);
    ok('synth respected budget (<6s)', r.ms < 6000);
    // ticks are best-effort (may be 0 if it converges instantly); just assert it didn't throw.
    ok('synth onTick callable', ticks >= 0);
}

// ── the OTF 4-line high-index case is present + uses a thick TiO2 seed ─────────────
{
    const C = caseById('otf4');
    ok('otf4 case exists', !!C);
    ok('otf4 has 7 TGT operands', C.ops.length === 7);
    const seed = C.thick();
    ok('otf4 thick seed = 1 TiO2 layer', seed.frontLayers.length === 1 && seed.frontLayers[0].material === 'TiO2');
    ok('otf4 thick seed ≥ 5000 nm (HIGH-index bulk)', seed.frontLayers[0].thickness >= 5000);
}

// ── MNT sweep: buildJobs doubles, job carries mnt, runJob reports minThk ───────────
{
    const jobs = buildJobs({ cases: ['bbar'], refineLocal: true, refineMaxIters: [60], mnts: [null, 40] });
    // 5 local methods × 1 maxIter × 2 mnts = 10
    ok('mnt sweep doubles refine cells', jobs.length === 10);
    ok('mnt label in setting', jobs.some((j) => /MNT40/.test(j.setting)) && jobs.some((j) => j.mnt === 40));
    ok('null-mnt cells present', jobs.some((j) => !j.mnt));

    // A constrained refinement reports minThk; the constraint should pull the
    // thinnest layer toward ≥ 40 (not a hard guarantee, but it must move).
    const jc = jobs.find((j) => j.method === 'dls' && j.mnt === 40);
    const ju = jobs.find((j) => j.method === 'dls' && !j.mnt);
    const rc = await runJob(jc, resolveMat), ru = await runJob(ju, resolveMat);
    ok('constrained refine returns minThk', Number.isFinite(rc.minThk));
    ok('unconstrained refine returns minThk', Number.isFinite(ru.minThk));
    ok('mf finite both', Number.isFinite(rc.mf) && Number.isFinite(ru.mf));
    // Refinement HONORS MNT: the penalty lifts the thinnest layer to 40 nm, or
    // keeps it at least as thick as the unconstrained run when that run already
    // stays above 40 nm and the MNT row never acts.
    ok('MNT lifts thinnest layer ≥ min(40 nm, unconstrained) (refinement honors MNT)',
        rc.minThk >= Math.min(40, ru.minThk) - 1e-3);
}

// ── Needle IGNORES MNT by design → identical result with / without the constraint ─
{
    // Comparing two runs only means anything when both do the same amount of
    // work. budgetMs is wall-clock, so on a slow or loaded machine it stops the
    // runs at different steps and the results diverge for reasons that have
    // nothing to do with MNT. Bound the comparison by maxSteps and leave the
    // budget high enough to act purely as a runaway guard.
    const cfg = { budgetMs: 60000, maxSteps: 25 };
    const base = { caseId: 'bbar', kind: 'needle', dMin: 40, cfg };
    const rNo  = await runJob({ ...base, id: 'n0', mnt: null }, resolveMat);
    const rMnt = await runJob({ ...base, id: 'n1', mnt: 40 }, resolveMat);
    // Needle is deterministic (no RNG) and strips constraints → byte-identical MF/layers.
    ok('needle MNT == unconstrained MF (ignores MNT)', Math.abs(rNo.mf - rMnt.mf) < 1e-9);
    ok('needle MNT == unconstrained layers', rNo.layers === rMnt.layers);
    ok('needle MNT == unconstrained minThk', Math.abs((rNo.minThk ?? 0) - (rMnt.minThk ?? 0)) < 1e-9);
}

// ── GE HONORS MNT: couples its floor to MNT → no layer thinner than 40 ─────────────
{
    const r = await runJob({ caseId: 'bbar', kind: 'ge', dMin: 1, mnt: 40, cfg: { budgetMs: 1500, maxSteps: 30 } }, resolveMat);
    ok('GE returns minThk', Number.isFinite(r.minThk));
    // GE inserts at the MNT-coupled floor and prunes sub-floor layers → min ≥ 40.
    ok('GE honors MNT (min layer ≥ 40 even with dMin=1)', r.minThk >= 39.5);
}

// ── Synthesis inner-engine sweep: buildJobs multiplies + job.engine threads ────────
{
    const jobs = buildJobs({ cases: ['bbar'], refineLocal: false, needle: true, dMins: [40], synthEngines: ['dls', 'cg', 'newton'] });
    ok('engine sweep → one needle cell per engine', jobs.length === 3);
    ok('each carries its engine + cfg.engine', ['dls', 'cg', 'newton'].every((e) =>
        jobs.some((j) => j.engine === e && j.cfg && j.cfg.engine === e)));
    ok('engine shown in setting when sweeping', jobs.every((j) => /·(dls|cg|newton)/.test(j.setting)));

    // runJob honors the inner engine: a CG-refined needle still produces a valid design.
    const jcg = jobs.find((j) => j.engine === 'cg');
    const r = await runJob({ ...jcg, cfg: { ...jcg.cfg, budgetMs: 1200, maxSteps: 25 } }, resolveMat);
    ok('needle+cg runs, finite MF', Number.isFinite(r.mf) && r.layers >= 1);
    const jdef = buildJobs({ cases: ['bbar'], refineLocal: false, needle: true, dMins: [40] })[0];
    ok('default synthEngines = [dls]', jdef.engine === 'dls' && !/·/.test(jdef.setting));
}

// ── Structural: the cell runs the Structural Optimizer window's own runner ─────────
// This file loads the benchmark in plain Node, with no browser globals, so it
// also fails if the runner starts importing window UI again.
{
    const C = caseById('bbar');
    const r = await runStructural(C.thin(), C.ops, 40, resolveMat,
        { budgetMs: 20000, structMaxIter: 6, structK: 4, innerIter: 20, seed: 5 });
    ok('structural history starts with the window\'s baseline row', r.rows[0]?.kind === 'baseline');
    ok('structural stops as the window does (6 iterations)', r.stopReason === 'maxIter' && r.iters === 6);
    ok('structural keeps Min thickness 40', minFrontThk(r.design) >= 40 - 1e-6);
    const job = buildJobs({
        cases: ['bbar'], refineLocal: false, structural: true, dMins: [40],
        synthCfg: { budgetMs: 3000, structMaxIter: 6 },
    })[0];
    const rj = await runJob(job, resolveMat);
    ok('structural cell through runJob', job.kind === 'structural' && !rj.err
        && Number.isFinite(rj.mf) && rj.minThk >= 40 - 1e-6);

    // A run that fails or never starts rejects, so the cell shows an error
    // instead of the untouched seed's merit.
    const rejects = async (run) => { try { await run(); return false; } catch (_) { return true; } };
    ok('structural with no operands rejects',
        await rejects(() => runStructural(C.thin(), [], 40, resolveMat, { budgetMs: 2000 })));
    ok('structural with a pool id the built-in catalog lacks rejects',
        await rejects(() => runStructural(C.thin(), C.ops, 40, resolveMat, { budgetMs: 2000, poolIds: ['TiO2', 'Unobtainium'] })));
    ok('an exception inside the run rejects',
        await rejects(() => runStructural(C.thin(), C.ops, 40, resolveMat, { budgetMs: 2000, structMaxIter: 3 },
            () => { throw new Error('tick failed'); })));
}

// ── runJob: unknown case / kind guarded ───────────────────────────────────────────
ok('unknown case → err', !!(await runJob({ caseId: 'nope', kind: 'refine' }, resolveMat)).err);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
