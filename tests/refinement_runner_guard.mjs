/**
 * Refinement runner guard — before/after identity check for the optimizer-driver
 * runners in `components/windows/optimization/refinement/runners/`
 * (runOptMainThread, runDlsEvent, runMethodsFlow + the promise engines).
 *
 * These runners are the RUN path (worker orchestration + run-state aggregation),
 * which the UI render-hash harness does NOT execute. This guard drives each
 * runner end-to-end against a fake Refinement `ctx` and snapshots its observable
 * output — the design it applies, MF / best / iter, end reason, and the history
 * rows it records — then compares to a committed golden.
 *
 * Determinism:
 *  - runOptMainThread uses the REAL optimizer (no worker). Single-start is
 *    deterministic; multi-start perturbation is made reproducible by seeding
 *    Math.random.
 *  - runDlsEvent / runMethodsFlow consume WORKER messages. A deterministic mock
 *    `Worker` emits a scripted progress→done stream keyed by the restart index,
 *    so the runner's aggregation (global-best selection, cumulative iter, history,
 *    finalize) is exercised identically for the golden and the current run. The
 *    mock stands in for the worker's physics — this guard checks the RUNNER logic,
 *    not the optimizer kernel (that is optimizer_refactor_guard's job).
 *
 * Random ids (history-entry ids) are excluded from the snapshot.
 *
 *   Update baseline (after a verified intentional change):  node tests/refinement_runner_guard.mjs --update
 *   Run the guard:                                          node tests/refinement_runner_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeOperand } from '../src/utils/physics/optimizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'refinement_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

// ── Seeded RNG (mulberry32) installed over Math.random for reproducibility ────
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Async-aware: keeps the seeded RNG installed for the ENTIRE run, including the
// setTimeout-driven perturbation that fires after the runner call returns.
async function withSeed(fn) {
    const orig = Math.random;
    Math.random = mulberry32(0x1234abcd);
    try { return await fn(); } finally { Math.random = orig; }
}

// ── Deterministic mock Worker: scripted progress→done keyed by restart index ──
// mf is a fixed function of the restart index so a specific restart is the clear
// global best; layer thicknesses are a fixed function of the restart index so the
// applied design is reproducible. Both `progress` and `done` are emitted.
class MockWorker {
    constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; this.terminated = false; }
    postMessage(job) {
        if (this.terminated) return;
        setTimeout(() => { if (!this.terminated) this._run(job); }, 0);
    }
    terminate() { this.terminated = true; }
    _run(job) {
        // Parallel-DE path (mfEvalWorker via WorkerPool): score each trial vector
        // with a fixed quadratic bowl so DEOptimizer has a deterministic landscape.
        if (job.type === 'evalBatch') {
            const mfs = (job.vectors || []).map(v => v.reduce((a, x) => a + (x - 100) * (x - 100), 0) * 1e-6);
            this._post({ type: 'done', mfs });
            return;
        }
        if (job.type !== 'start') return;              // ignore init / unknown
        const r = job.restartIdx || 0;                 // 0 = unperturbed baseline
        const mf = 0.05 * (1 / (1 + ((r * 7) % 5)));    // r===2 → global best (0.01)
        const front = (job.design.frontLayers || []).map((l, i) => ({ ...l, thickness: (l.thickness || 0) + r + i }));
        const back  = (job.design.backLayers  || []).map((l, i) => ({ ...l, thickness: (l.thickness || 0) + r + i }));
        this._post({ type: 'progress', iter: 5, mf: mf * 1.1, mfBest: mf * 1.1, omf: mf * 1.1, omfBest: mf * 1.1,
            frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back });
        this._post({ type: 'done', iter: 10, mf, mfBest: mf, omf: mf, omfBest: mf,
            frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back, reason: 'stalled' });
    }
    _post(data) { if (!this.terminated && this.onmessage) this.onmessage({ data }); }
}
globalThis.Worker = MockWorker;

// Import the runners AFTER installing the mock Worker global.
const { runOptMainThread } = await import('../src/components/windows/optimization/refinement/runners/mainThread.js');
const { runDlsEvent }      = await import('../src/components/windows/optimization/refinement/runners/dlsPool.js');
const { runMethodsFlow }   = await import('../src/components/windows/optimization/refinement/runners/methodsFlow.js');

const ref = v => ({ current: v });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build a fake Refinement ctx + a snapshot recorder.
function makeCtx(design, ops, { multi = false, nRestarts = 1, perturbPct = 30, maxIter = 40 } = {}) {
    const snap = { applied: null, mf: null, mfBest: null, mfInitial: null, iter: 0, stopReason: null, history: [] };
    const ctx = {
        runningRef: ref(false), designRef: ref(design), operandsRef: ref(ops),
        maxIterRef: ref(maxIter), multiStartRef: ref(multi), nRestartsRef: ref(nRestarts),
        perturbPctRef: ref(perturbPct), checkpointRef: ref(() => {}),
        optimizerRef: ref(null), timerRef: ref(null), baselineRef: ref(false),
        lastBestRef: ref(null), poolRef: ref([]), dePoolRef: ref(null),
        flowWorkersRef: ref(new Set()), runIdRef: ref(0), histRunCount: ref(0),
        commitBaseline: () => {},
        bumpRunCount: () => { ctx.histRunCount.current += 1; },
        addHistEntry: (e) => { snap.history.push({ label: e.label, iter: e.iter, mf: e.mf, layerCount: e.layerCount, layerSide: e.layerSide ?? null }); },
        killWorker: () => {
            for (const w of ctx.poolRef.current) { try { w.terminate && w.terminate(); } catch (_) {} }
            ctx.poolRef.current = [];
            for (const w of ctx.flowWorkersRef.current) { try { w.terminate && w.terminate(); } catch (_) {} }
            ctx.flowWorkersRef.current.clear();
            if (ctx.dePoolRef.current) { try { ctx.dePoolRef.current.terminate(); } catch (_) {} ctx.dePoolRef.current = null; }
        },
        stopOpt: () => { ctx.runningRef.current = false; ctx.runIdRef.current += 1; ctx.killWorker(); },
        updateDesignRef: ref((patch) => {
            const d = ctx.designRef.current;
            ctx.designRef.current = { ...d, ...patch };
            snap.applied = {
                front: (ctx.designRef.current.frontLayers || []).map(l => l.thickness),
                back:  (ctx.designRef.current.backLayers  || []).map(l => l.thickness),
            };
        }),
        setMf: v => snap.mf = v, setMfBest: v => snap.mfBest = v, setMfInitial: v => snap.mfInitial = v,
        setOmf: () => {}, setOmfBest: () => {}, setOmfInitial: () => {},
        setIter: v => snap.iter = v, setMfHistory: () => {},
        setRunning: () => {}, setCanReset: () => {}, setRestartIdx: () => {},
        setStopReason: v => snap.stopReason = v,
        t: { refinement: { history: { run: (n) => `Run ${n}` } } },
    };
    return { ctx, snap };
}

async function waitIdle(ctx, ms = 8000) {
    const t0 = Date.now();
    while (ctx.runningRef.current) {
        if (Date.now() - t0 > ms) throw new Error('runner did not finish in time');
        await sleep(3);
    }
    await sleep(5);   // let any trailing scheduled callbacks settle
}

// Rounded snapshot (kills last-bit FP noise from the real-optimizer scenarios;
// the mock-worker scenarios are exact anyway).
const rnd = x => (x == null ? x : Number(x.toFixed(9)));
function finalize(snap) {
    return {
        applied: snap.applied && { front: snap.applied.front.map(rnd), back: snap.applied.back.map(rnd) },
        mf: rnd(snap.mf), mfBest: rnd(snap.mfBest), mfInitial: rnd(snap.mfInitial),
        iter: snap.iter, stopReason: snap.stopReason,
        history: snap.history.map(hh => ({ label: hh.label, iter: hh.iter, mf: rnd(hh.mf), layerCount: hh.layerCount, layerSide: hh.layerSide })),
    };
}

// ── Designs / operands ────────────────────────────────────────────────────────
const frontDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'TiO2', thickness: 110, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 90,  locked: false },
        { id: 'L3', material: 'TiO2', thickness: 65,  locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const backDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [],
    backLayers: [
        { id: 'B1', material: 'TiO2', thickness: 105, locked: false },
        { id: 'B2', material: 'SiO2', thickness: 95,  locked: false },
    ],
    surfaceMode: 'back_only', mfEvalMode: 'side',
});
const bothDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'F1', material: 'TiO2', thickness: 100, locked: false }, { id: 'F2', material: 'SiO2', thickness: 120, locked: false }],
    backLayers:  [{ id: 'K1', material: 'TiO2', thickness: 80,  locked: false }, { id: 'K2', material: 'SiO2', thickness: 95,  locked: false }],
    surfaceMode: 'both_independent', mfEvalMode: 'side',
});
const OPS = () => [
    makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];

// ── Scenarios ─────────────────────────────────────────────────────────────────
async function runScenario(name) {
    switch (name) {
        case 'mainThread/single/front': { const { ctx, snap } = makeCtx(frontDesign(), OPS()); await withSeed(async () => { runOptMainThread(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'mainThread/single/back':  { const { ctx, snap } = makeCtx(backDesign(),  OPS()); await withSeed(async () => { runOptMainThread(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'mainThread/multi/front':  { const { ctx, snap } = makeCtx(frontDesign(), OPS(), { multi: true, nRestarts: 4 }); await withSeed(async () => { runOptMainThread(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'mainThread/multi/both':   { const { ctx, snap } = makeCtx(bothDesign(),  OPS(), { multi: true, nRestarts: 3 }); await withSeed(async () => { runOptMainThread(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'dlsPool/single/front':    { const { ctx, snap } = makeCtx(frontDesign(), OPS()); await withSeed(async () => { runDlsEvent(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'dlsPool/multi/front':     { const { ctx, snap } = makeCtx(frontDesign(), OPS(), { multi: true, nRestarts: 5 }); await withSeed(async () => { runDlsEvent(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'dlsPool/multi/back':      { const { ctx, snap } = makeCtx(backDesign(),  OPS(), { multi: true, nRestarts: 5 }); await withSeed(async () => { runDlsEvent(ctx); await waitIdle(ctx); }); return finalize(snap); }
        case 'methodsFlow/cg/front':    { const { ctx, snap } = makeCtx(frontDesign(), OPS()); await withSeed(async () => { await runMethodsFlow(ctx, ['cg']); await waitIdle(ctx); }); return finalize(snap); }
        case 'methodsFlow/multi/front': { const { ctx, snap } = makeCtx(frontDesign(), OPS(), { nRestarts: 4 }); await withSeed(async () => { await runMethodsFlow(ctx, ['cg', 'sa', 'dls-multi']); await waitIdle(ctx); }); return finalize(snap); }
        case 'methodsFlow/cg/both':     { const { ctx, snap } = makeCtx(bothDesign(),  OPS()); await withSeed(async () => { await runMethodsFlow(ctx, ['cg', 'sa']); await waitIdle(ctx); }); return finalize(snap); }
        case 'methodsFlow/de/both':     { const { ctx, snap } = makeCtx(bothDesign(),  OPS()); await withSeed(async () => { await runMethodsFlow(ctx, ['de']); await waitIdle(ctx); }); return finalize(snap); }
        default: throw new Error('unknown scenario ' + name);
    }
}

const SCENARIOS = [
    'mainThread/single/front', 'mainThread/single/back', 'mainThread/multi/front', 'mainThread/multi/both',
    'dlsPool/single/front', 'dlsPool/multi/front', 'dlsPool/multi/back',
    'methodsFlow/cg/front', 'methodsFlow/multi/front', 'methodsFlow/cg/both', 'methodsFlow/de/both',
];

const results = {};
for (const name of SCENARIOS) results[name] = await runScenario(name);

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${SCENARIOS.length} scenarios)`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let fails = 0;
for (const name of SCENARIOS) {
    const a = JSON.stringify(golden[name]), b = JSON.stringify(results[name]);
    if (a !== b) {
        fails++;
        console.log(`DRIFT ❌  ${name}`);
        console.log(`   golden : ${a}`);
        console.log(`   current: ${b}`);
    }
}
if (fails === 0) { console.log(`PASS ✅  refinement runners identical to golden (${SCENARIOS.length} scenarios)`); process.exit(0); }
console.log(`FAIL ❌  ${fails} scenario(s) drifted`);
process.exit(1);
