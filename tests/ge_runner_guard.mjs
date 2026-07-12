/**
 * Gradual-Evolution runner guard — before/after identity check for the GE run
 * engines in `components/windows/optimization/geRunners/`
 * (runGeWorker + runGeMainThread).
 *
 * These engines are the RUN path (GE state machine + worker orchestration +
 * run-state aggregation), which the UI render-hash harness does NOT execute.
 * This guard drives each engine end-to-end against a fake GradualEvolution
 * `ctx` and snapshots its observable output — the cycles it records (type / MF /
 * layer count / side / TOT / per-cycle layer snapshot), the design it applies,
 * and the final MF / best / layer count — then compares to a committed golden.
 *
 * Determinism:
 *  - runGeMainThread uses the REAL optimizer (CG inner engine, no worker) on a
 *    tiny design. The GE algorithm is deterministic (needle scan + refine carry
 *    no RNG); only the random cycle ids and wallclock tMs are excluded from the
 *    snapshot.
 *  - runGeWorker consumes WorkerPool messages. A deterministic mock `Worker`
 *    answers each synthesis job (seedDls / scan / candidate / geStep /
 *    removePass) with a scripted result keyed off the current layer count, so
 *    the runner's aggregation (global-best, cycle history, forced-TOT step,
 *    consolidation, finalize) is exercised identically for the golden and the
 *    current run. The mock stands in for the worker physics — this guard checks
 *    the RUNNER logic, not the optimizer kernel (optimizer_refactor_guard's job).
 *  - navigator.hardwareConcurrency is pinned so the pool size (poolSize) and the
 *    scan-slice count are the same on every machine / in CI.
 *
 *   Update baseline (after a verified intentional change):  node tests/ge_runner_guard.mjs --update
 *   Run the guard:                                          node tests/ge_runner_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
// Pin the detected core count so poolSize() (= scan-slice / batch width) is the
// same everywhere. 1 → a single scan slice, the simplest deterministic shape.
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 1 }, configurable: true, writable: true,
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'ge_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

// ── Deterministic mock synthesis Worker ──────────────────────────────────────
// Answers each GE job type with a fixed result derived from the current design
// so the run trajectory (seed → needle accepts → forced-TOT → consolidate) is
// reproducible. MF strictly decreases with total layer count so needles accept.
class MockWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; this.dead = false; }
    postMessage(job) {
        if (this.dead || !job) return;
        if (job.type === 'wasmInit') return;              // one-time pool init: no reply
        setTimeout(() => { if (!this.dead) this._run(job); }, 0);
    }
    terminate() { this.dead = true; }
    _post(data) { if (!this.dead && this.onmessage) this.onmessage({ data }); }
    _run(job) {
        const front = (job.design && job.design.frontLayers) || [];
        const back  = (job.design && job.design.backLayers)  || [];
        const mk = (n, mat) => ({ id: `${mat}_${n}`, material: mat, thickness: 10 + n, locked: false });
        if (job.type === 'seedDls') {
            this._post({ type: 'result', mf: 0.5, frontLayers: front, backLayers: back, omf: 0.5, iters: 0 });
        } else if (job.type === 'scan') {
            const arr = job.side === 'back' ? back : front;
            // Improving needle available on odd layer counts, needle-optimal on even.
            const candidates = (arr.length % 2 === 1)
                ? [{ dMF: -0.1, pos: 0, materialId: 'TiO2', side: job.side }] : [];
            this._post({ type: 'result', candidates });
        } else if (job.type === 'candidate') {
            const grown = [...(job.side === 'back' ? back : front), mk((job.side === 'back' ? back : front).length, 'TiO2')];
            const nf = job.side === 'back' ? front : grown;
            const nb = job.side === 'back' ? grown : back;
            const total = nf.length + nb.length;
            this._post({ type: 'result', mfNow: 0.5 - 0.02 * total, frontLayers: nf, backLayers: nb, nLayers: total, omf: 0.5 - 0.02 * total });
        } else if (job.type === 'geStep') {
            const grown = [...(job.side === 'back' ? back : front), mk((job.side === 'back' ? back : front).length, 'SiO2')];
            const nf = job.side === 'back' ? front : grown;
            const nb = job.side === 'back' ? grown : back;
            const total = nf.length + nb.length;
            this._post({ type: 'result', empty: false, mfNew: 0.5 - 0.01 * total, mf0: 0.5, frontLayers: nf, backLayers: nb, materialId: 'SiO2', pos: (job.side === 'back' ? back : front).length, side: job.side, nLayers: total });
        } else if (job.type === 'removePass') {
            const dropFront = front.length >= back.length && front.length > 0;
            const nf = dropFront ? front.slice(0, -1) : front;
            const nb = dropFront ? back : back.slice(0, -1);
            const total = nf.length + nb.length;
            this._post({ type: 'result', removed: 1, mf: 0.2, frontLayers: nf, backLayers: nb, nLayers: total, baseLayers: front.length + back.length, baseMf: 0.25, omf: 0.2 });
        } else {
            this._post({ type: 'result' });
        }
    }
}
globalThis.Worker = MockWorker;

// Import engines + primitives AFTER the shim + mock Worker global are installed.
const { runGeMainThread } = await import('../src/components/windows/optimization/geRunners/mainThread.js');
const { runGeWorker }     = await import('../src/components/windows/optimization/geRunners/workerPool.js');
const { makeOperand }     = await import('../src/utils/physics/optimizer.js');
const { resolveMat }      = await import('../src/components/windows/optimization/synthesisHelpers.js');

const ref = v => ({ current: v });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build a fake GradualEvolution ctx + a snapshot recorder.
function makeCtx(design, ops, settings) {
    const snap = { applied: null, mf: null, mfBest: null, omf: null, omfBest: null, layerCount: null, geSteps: null, status: null };
    const designRef = ref(JSON.parse(JSON.stringify(design)));
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef,
        operandsRef: ref(ops), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        updateDesignRef: ref((patch) => {
            designRef.current = { ...designRef.current, ...patch };
            snap.applied = {
                front: (designRef.current.frontLayers || []).map(l => l.thickness),
                back:  (designRef.current.backLayers  || []).map(l => l.thickness),
            };
        }),
        checkpointRef: ref(() => {}),
        maxLayersRef: ref(settings.maxLayers), maxGeCyclesRef: ref(settings.maxGeCycles),
        targetMFRef: ref(settings.targetMF), dlsIterRef: ref(settings.dlsIter), dMinRef: ref(settings.dMin),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: () => {}, setStatusMsg: v => snap.status = v, setCanReset: () => {},
        setMf: v => snap.mf = v, setOmf: v => snap.omf = v, setMfBest: v => snap.mfBest = v, setOmfBest: v => snap.omfBest = v,
        setCycles: () => {}, setGeneration: () => {}, setLayerCount: v => snap.layerCount = v, setGeSteps: v => snap.geSteps = v,
        reconcileBaseWithEdits: () => {},
        stopOpt: (msg) => { ctx.runningRef.current = false; if (msg != null) snap.status = msg; },
        getPoolMaterials: () => [
            { id: 'TiO2', name: 'TiO2', mat: resolveMat('TiO2') },
            { id: 'SiO2', name: 'SiO2', mat: resolveMat('SiO2') },
        ],
        t: { gradualEvolution: { noOperands: 'no-ops', smartSeeding: (n) => `seeding ${n}` } },
    };
    return { ctx, snap };
}

async function waitIdle(ctx, ms = 10000) {
    const t0 = Date.now();
    while (ctx.runningRef.current) {
        if (Date.now() - t0 > ms) throw new Error('engine did not finish in time');
        await sleep(3);
    }
    await sleep(5);   // let any trailing scheduled callbacks settle
}

// Rounded snapshot (kills last-bit FP noise from the real-optimizer scenarios;
// the mock-worker scenarios are exact anyway). id + tMs are excluded.
const rnd = x => (x == null ? x : Number(x.toFixed(9)));
const rndLayers = arr => (arr || []).map(l => ({ material: l.material, thickness: rnd(l.thickness) }));
function sanitizeCycle(cy) {
    return {
        genNum: cy.genNum, type: cy.type,
        mf: rnd(cy.mf), omf: rnd(cy.omf), dMF: rnd(cy.dMF),
        layerCount: cy.layerCount, insertMat: cy.insertMat ?? null,
        side: cy.side ?? null, tot: rnd(cy.tot),
        layers: rndLayers(cy.layers),
        frontSnap: cy.frontSnap ? rndLayers(cy.frontSnap) : null,
        backSnap:  cy.backSnap  ? rndLayers(cy.backSnap)  : null,
    };
}
function finalize(ctx, snap) {
    return {
        cycles: ctx.cyclesRef.current.map(sanitizeCycle),
        applied: snap.applied && { front: snap.applied.front.map(rnd), back: snap.applied.back.map(rnd) },
        mf: rnd(snap.mf), mfBest: rnd(snap.mfBest), omf: rnd(snap.omf), omfBest: rnd(snap.omfBest),
        layerCount: snap.layerCount, geSteps: snap.geSteps, status: snap.status,
    };
}

// ── Designs / operands ────────────────────────────────────────────────────────
const frontDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'L1', material: 'TiO2', thickness: 110, locked: false }],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const backDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [],
    backLayers: [{ id: 'B1', material: 'TiO2', thickness: 110, locked: false }],
    surfaceMode: 'back_only', mfEvalMode: 'side',
});
const OPS = () => [
    makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];

const MT_SET = { maxLayers: 6, maxGeCycles: 2, targetMF: 1e-9, dlsIter: 5, dMin: 10 };
const WK_SET = { maxLayers: 4, maxGeCycles: 5, targetMF: 1e-9, dlsIter: 5, dMin: 10 };

// ── Scenarios ─────────────────────────────────────────────────────────────────
async function runScenario(name) {
    switch (name) {
        case 'mainThread/front': { const { ctx, snap } = makeCtx(frontDesign(), OPS(), MT_SET); runGeMainThread(ctx); await waitIdle(ctx); return finalize(ctx, snap); }
        case 'mainThread/back':  { const { ctx, snap } = makeCtx(backDesign(),  OPS(), MT_SET); runGeMainThread(ctx); await waitIdle(ctx); return finalize(ctx, snap); }
        case 'worker/front':     { const { ctx, snap } = makeCtx(frontDesign(), OPS(), WK_SET); runGeWorker(ctx); await waitIdle(ctx); return finalize(ctx, snap); }
        case 'worker/back':      { const { ctx, snap } = makeCtx(backDesign(),  OPS(), WK_SET); runGeWorker(ctx); await waitIdle(ctx); return finalize(ctx, snap); }
        default: throw new Error('unknown scenario ' + name);
    }
}

const SCENARIOS = ['mainThread/front', 'mainThread/back', 'worker/front', 'worker/back'];

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
if (fails === 0) { console.log(`PASS ✅  GE runners identical to golden (${SCENARIOS.length} scenarios)`); process.exit(0); }
console.log(`FAIL ❌  ${fails} scenario(s) drifted`);
process.exit(1);
