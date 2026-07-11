/**
 * Behavioral gate for the Needle main-thread engine (needleEngine.js).
 *
 * The standalone-needle main-thread loop drives the whole synthesis phase
 * machine (scan → insert → DLS refine → accept-or-revert → repeat) on the UI
 * thread. It had no automated coverage — the synthesis_* tests exercise the
 * worker/optimizer primitives, not this orchestration. This test builds a
 * minimal `ctx` (refs + recorder setters + a fixed pool) and runs the loop to
 * completion on a small BBAR case, asserting it: grows the stack, improves the
 * merit monotonically per accepted generation, reaches a usable BBAR, and is
 * deterministic run-to-run. It gates the extraction + decomposition of the
 * engine against any behavior change.
 *
 * Run: node tests/needle_main_thread.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { runNeedleMainThread } = await import('../src/components/windows/optimization/needleEngine.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };

// Quiet the engine's per-step console.log spam.
const _log = console.log; console.log = () => {};

const ops = caseById('bbar').ops;   // BBAR: TGT 420–680 → T=1
const POOL = [
    { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
    { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
    { id: 'MgF2', name: 'MgF2', mat: getMaterial('MgF2') },
];
const seedDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'S', material: 'SiO2', thickness: 100, locked: false }],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});

// Build a ctx: refs are {current}, setters are recorders/noops. The engine
// writes gensRef.current directly, so the run's generations are read back there.
function makeRun() {
    const design = seedDesign();
    const noop = () => {};
    const ref = (v) => ({ current: v });
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(design),
        operandsRef: ref(ops.map(o => ({ ...o, enabled: true }))),
        gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null),
        maxLayersRef: ref(6), deltaNmRef: ref(0.5), dMinRef: ref(1.0),
        dlsIterRef: ref(30), targetMFRef: ref(1e-4),
        selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
        updateDesignRef: ref(noop), checkpointRef: ref(noop),
        setPhase: (p) => { if (p === 'idle' && ctx.runningRef.current === false && ctx._started) resolveDone(); },
        setStatusMsg: noop, setMf: noop, setMfBest: noop, setOmf: noop, setOmfBest: noop,
        setLayerCount: noop, setCanReset: noop, setGeneration: noop,
        setGenerations: noop, setTopDesigns: noop,
        reconcileBaseWithEdits: noop,
        getPoolMaterials: () => POOL,
        setCachedOptState: noop,
        _started: false,
    };
    return { ctx, done };
}

async function runOnce() {
    const { ctx, done } = makeRun();
    ctx._started = true;
    runNeedleMainThread(ctx);
    if (ctx.runningRef.current) {
        await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]);
    }
    return ctx.gensRef.current.map(g => ({ genNum: g.genNum, layerCount: g.layerCount, mf: g.mf }));
}

const gensA = await runOnce();
const gensB = await runOnce();
console.log = _log;

console.log(`=== Needle main-thread engine · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`  generations: ${gensA.length}`);
for (const g of gensA) console.log(`  gen ${g.genNum}: ${g.layerCount} layers, MF=${g.mf.toFixed(6)}`);

ok('grew the stack (≥1 accepted generation)', gensA.length >= 1);
ok('every generation has ≥2 layers (grew past the seed)', gensA.every(g => g.layerCount >= 2));
ok('merit finite', gensA.every(g => Number.isFinite(g.mf)));
// Accept rule guarantees each accepted generation strictly improves the best.
let mono = true;
for (let i = 1; i < gensA.length; i++) if (!(gensA[i].mf < gensA[i - 1].mf - 1e-9)) mono = false;
ok('merit improves monotonically across accepted generations', mono);
ok('reached a usable BBAR (final MF < 0.05)', gensA.length && gensA[gensA.length - 1].mf < 0.05);

// Determinism: the main-thread loop has no RNG affecting the math, so two runs
// from the same seed must produce an identical generation sequence.
const same = gensA.length === gensB.length &&
    gensA.every((g, i) => g.layerCount === gensB[i].layerCount && Math.abs(g.mf - gensB[i].mf) < 1e-12);
ok('deterministic run-to-run (identical generation sequence)', same);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
