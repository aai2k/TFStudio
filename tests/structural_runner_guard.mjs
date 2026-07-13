/**
 * Structural runner identity guard.
 *
 * A scripted optimizer Worker drives the exported orchestration end-to-end. The
 * snapshots cover both active sides and a symmetric smart-seed run with one
 * failed seed job.
 * Random generation ids and elapsed wallclock fields are excluded.
 *
 * Update after an intentional behavior change:
 *   node tests/structural_runner_guard.mjs --update
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 1 }, configurable: true, writable: true,
});

const realDateNow = Date.now;
Date.now = () => 1700000000000;

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'structural_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');
let activeScript = null;

const copy = value => JSON.parse(JSON.stringify(value));

class MockWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.dead = false;
        activeScript.constructed += 1;
    }

    postMessage(job) {
        if (this.dead || !job) return;
        activeScript.jobs += 1;
        setTimeout(() => this.run(job), 0);
    }

    terminate() {
        if (!this.dead) activeScript.terminated += 1;
        this.dead = true;
    }

    post(data) {
        if (!this.dead && this.onmessage) this.onmessage({ data });
    }

    run(job) {
        if (this.dead) return;
        activeScript.startJobs += 1;
        const phase = activeScript.phase;
        if (phase === 'smart' && !activeScript.failedSeed) {
            activeScript.failedSeed = true;
            this.post({ type: 'error', message: 'scripted seed failure' });
            return;
        }
        const phaseCall = (activeScript.phaseCalls[phase] || 0) + 1;
        activeScript.phaseCalls[phase] = phaseCall;
        let mf;
        if (phase === 'smart') mf = 0.55 - Math.min(phaseCall, 4) * 0.05;
        else if (phase === 'reheat') mf = 0.1;
        else if (phase === 'baseline') mf = 0.8;
        else mf = activeScript.normalMf[Math.min(phaseCall - 1, activeScript.normalMf.length - 1)];
        const frontLayers = copy(job.design.frontLayers || []);
        const backLayers = copy(job.design.backLayers || []);
        this.post({ type: 'progress', mf: mf + 0.01, omf: mf + 0.02 });
        activeScript.progress += 1;
        this.post({
            type: 'done', mfBest: mf, omfBest: mf + 0.001,
            bestFrontLayers: frontLayers, bestBackLayers: backLayers,
        });
    }
}

globalThis.Worker = MockWorker;
localStorage.setItem('tfstudio-worker-threads', '1');

const { runStructuralWorker } = await import(
    '../src/components/windows/optimization/structuralOptimizer/runners/workerPool.js');

const ref = current => ({ current });
const round = value => value == null ? value : Number(value.toFixed(9));
const layers = value => (value || []).map(layer => ({
    material: layer.material, thickness: round(layer.thickness), locked: !!layer.locked,
}));

function designFor(surfaceMode) {
    const frontLayers = surfaceMode === 'back_only' ? [] : [
        { id: 'F1', material: 'TiO2', thickness: 90, locked: false },
        { id: 'F2', material: 'SiO2', thickness: 110, locked: false },
    ];
    const backLayers = surfaceMode === 'front_only' ? [] : [
        { id: 'B1', material: 'SiO2', thickness: 105, locked: false },
        { id: 'B2', material: 'TiO2', thickness: 95, locked: false },
    ];
    return {
        id: `guard-${surfaceMode}`, referenceWavelength: 550,
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers, backLayers, surfaceMode, mfEvalMode: 'side',
    };
}

const OPERANDS = [{
    id: 'guard-op', type: 'RAV', enabled: true,
    lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20,
    aoi: 0, pol: 'avg', target: 0.5, weight: 1,
}];

function makeCtx(surfaceMode, options) {
    const initial = designFor(surfaceMode);
    const designRef = ref(copy(initial));
    const snapshots = {
        applied: [], status: [], iter: 0, temp: null, accRate: null,
        mf: null, mfBest: null, omf: null, omfBest: null,
        layerCount: null, generations: [], trend: [], topCount: 0,
        reheats: 0, running: false, canReset: false, checkpoints: 0, cacheWrites: 0,
    };
    const workersRef = ref([]);
    const runningRef = ref(false);
    const ctx = {
        cfgRef: ref({
            maxIter: options.maxIter, targetMF: options.targetMF, T0: 0.08,
            jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120,
            maxLayers: 20, kinds: new Set(['perturb']),
            deepMode: options.deepMode, deepMaxMin: 0,
        }),
        runningRef, workersRef, runIdRef: ref(0), designRef,
        operandsRef: ref(copy(OPERANDS)), savedDesignRef: ref(null), baseDesignRef: ref(null),
        gensRef: ref([]), genCountRef: ref(0), trendRef: ref([]),
        updateDesignRef: ref((patch) => {
            designRef.current = { ...designRef.current, ...copy(patch) };
            snapshots.applied.push({
                front: layers(designRef.current.frontLayers),
                back: layers(designRef.current.backLayers),
            });
        }),
        checkpointRef: ref(() => { snapshots.checkpoints += 1; }),
        selectedCatsRef: ref(new Set(['builtin'])), excludedMatsRef: ref(new Set()),
        killWorkers: () => {
            for (const worker of workersRef.current) worker.terminate();
            workersRef.current = [];
        },
        saveCache: () => { snapshots.cacheWrites += 1; },
        stopOpt: message => {
            runningRef.current = false;
            snapshots.running = false;
            snapshots.status.push(String(message));
        },
        ts: {
            noOperands: 'no-operands', noMaterials: 'no-materials',
            statusBaseline: 'baseline', statusNoMut: 'no-mutation',
            statusDone: 'done', statusMaxIter: 'max-iterations', statusCap: 'layer-cap',
            statusTimeUp: 'time-up', statusStopped: 'stopped',
            smartSeeding: count => `smart:${count}`,
            statusRefining: count => `refining:${count}`,
            statusReheat: count => `reheat:${count}`,
            statusConverged: mf => `converged:${mf.toFixed(3)}`,
            statusStalled: patience => `stalled:${patience}`,
        },
        setRunning: value => { snapshots.running = value; },
        setIter: value => { snapshots.iter = value; },
        setTemp: value => { snapshots.temp = value; },
        setAccRate: value => { snapshots.accRate = value; },
        setMf: value => { snapshots.mf = value; },
        setMfBest: value => { snapshots.mfBest = value; },
        setOmf: value => { snapshots.omf = value; },
        setOmfBest: value => { snapshots.omfBest = value; },
        setLayerCount: value => { snapshots.layerCount = value; },
        setGenerations: value => { snapshots.generations = value; },
        setTopDesigns: value => { snapshots.topCount = value.length; },
        setTrend: value => { snapshots.trend = value; },
        setCanReset: value => { snapshots.canReset = value; },
        setStatusMsg: value => {
            snapshots.status.push(value);
            if (value.startsWith('smart:')) activeScript.phase = 'smart';
            else if (value.startsWith('refining:')) activeScript.phase = 'normal';
            else if (value.startsWith('reheat:')) activeScript.phase = 'reheat';
            else if (value === 'baseline') activeScript.phase = 'baseline';
        },
        setReheats: value => { snapshots.reheats = value; },
    };
    return { ctx, snapshots };
}

function sanitizeGeneration(generation) {
    return {
        genNum: generation.genNum, mf: round(generation.mf), omf: round(generation.omf),
        dMF: round(generation.dMF), side: generation.side, kind: generation.kind,
        layerCount: generation.layerCount, tot: round(generation.tot),
        insertMat: generation.insertMat,
        layers: layers(generation.layers),
        frontSnap: layers(generation.frontSnap), backSnap: layers(generation.backSnap),
    };
}

function resultOf(ctx, snapshots) {
    return {
        workers: {
            constructed: activeScript.constructed, terminated: activeScript.terminated,
            startJobs: activeScript.startJobs, progress: activeScript.progress,
            failedSeed: activeScript.failedSeed,
        },
        generations: ctx.gensRef.current.map(sanitizeGeneration),
        trend: ctx.trendRef.current.map(point => ({
            iter: point.iter, cur: round(point.cur), best: round(point.best),
        })),
        design: {
            front: layers(ctx.designRef.current.frontLayers),
            back: layers(ctx.designRef.current.backLayers),
        },
        final: {
            running: snapshots.running, iter: snapshots.iter, temp: snapshots.temp,
            accRate: round(snapshots.accRate), mf: round(snapshots.mf),
            mfBest: round(snapshots.mfBest), omf: round(snapshots.omf),
            omfBest: round(snapshots.omfBest), layerCount: snapshots.layerCount,
            reheats: snapshots.reheats, canReset: snapshots.canReset,
            status: snapshots.status.at(-1), checkpoints: snapshots.checkpoints,
            cacheWrites: snapshots.cacheWrites, appliedCount: snapshots.applied.length,
            topCount: snapshots.topCount,
        },
    };
}

async function runScenario(name, surfaceMode, options) {
    localStorage.setItem('tfstudio-synth-smart-seed-structural', options.smartSeed ? '1' : '0');
    activeScript = {
        name, phase: 'baseline', normalMf: options.normalMf,
        phaseCalls: {}, constructed: 0, terminated: 0, jobs: 0,
        startJobs: 0, progress: 0, failedSeed: false,
    };
    const { ctx, snapshots } = makeCtx(surfaceMode, options);
    await runStructuralWorker(ctx);
    if (ctx.runningRef.current) throw new Error(`${name} did not finalize`);
    if (activeScript.startJobs === 0) throw new Error(`${name} did not run a worker`);
    return resultOf(ctx, snapshots);
}

const scenarios = {
    'front-normal': ['front_only', {
        smartSeed: false, deepMode: false, maxIter: 3, targetMF: 0,
        normalMf: [0.6, 0.7, 0.4],
    }],
    'back-normal': ['back_only', {
        smartSeed: false, deepMode: false, maxIter: 3, targetMF: 0,
        normalMf: [0.65, 0.75, 0.45],
    }],
    'symmetric-smart-failure': ['symmetric', {
        smartSeed: true, deepMode: false, maxIter: 3, targetMF: 0,
        normalMf: [0.8],
    }],
};

const results = {};
for (const [name, [surfaceMode, options]] of Object.entries(scenarios)) {
    results[name] = await runScenario(name, surfaceMode, options);
}
Date.now = realDateNow;

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${Object.keys(scenarios).length} scenarios)`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let failures = 0;
for (const name of Object.keys(scenarios)) {
    const expected = JSON.stringify(golden[name]);
    const actual = JSON.stringify(results[name]);
    if (expected !== actual) {
        failures += 1;
        console.error(`DRIFT ${name}`);
        console.error(`  golden: ${expected}`);
        console.error(`  actual: ${actual}`);
    }
}
if (failures) {
    console.error(`FAIL: ${failures} Structural runner scenario(s) drifted`);
    process.exit(1);
}
console.log(`PASS: Structural runner matches golden (${Object.keys(scenarios).length} scenarios)`);
