/**
 * One step of Newton, trust-region or SQP keeps its second-derivative kernel
 * packages within a memory budget (newtonAssembly/hessianSampler.js), so the
 * memory the step takes to assemble its second derivatives does not grow with
 * the samples of the rows. On 60 alternating TiO2 and SiO2 layers with TMX 0.9
 * and TAV 1 rows over 400-1600 nm, holding every wavelength's package grew the
 * heap by about 440 MB in one step with the rows at Step 2 (0.1 nm, 12001
 * samples), about ten times what it did at Step 1, and one step at Step 3 ran
 * out of a 4 GB heap.
 *
 * The heap is read while the step assembles its second derivatives, after a
 * full collection; the reading is the JavaScript heap, without the arrays the
 * WASM kernel's packages keep outside it.
 *
 *   1. For each engine, the heap of one step with the rows at Step 2 exceeds
 *      the one at Step 1 by less than the budget, 64 MB. Keeping every
 *      package made it grow about tenfold.
 *   2. The step's merit and thicknesses are the ones pinned below, bit for
 *      bit: on the rows above at Step 2 for each engine, and on an RAV and a
 *      TAV row on one grid at Step 1, front and back, where the budget is full
 *      before the second row reads it.
 *   3. Rows on one grid still share the packages that fit: about 500 on 60
 *      layers, so the second row makes that many fewer kernel calls.
 *
 * Run: node tests/newton_step_memory.mjs
 */
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

// The memory the step keeps alive is what runs out, so each reading is taken
// after a full collection.
v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc');

const { initWasmForTest, getTmmWasm } = await import('./_wasmInit.mjs');
if (!(await initWasmForTest())) {
    console.log('SKIP: newton_step_memory (no WASM kernel)');
    process.exit(0);
}
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { operandSampleLambdas } = await import('../src/utils/physics/optimizer/sampling.js');

const resolveMat = id => getMaterial(id);
const ENGINES = ['newton', 'trust-region', 'sqp'];
// The sampler's budget, HESSIAN_CACHE_BYTES.
const BUDGET_MB = 64;

// 60 alternating TiO2 and SiO2 layers, 60 to 149 nm.
const layers = Array.from({ length: 60 }, (_, i) => ({
    id: `L${i}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2', thickness: 60 + ((i * 37) % 90), locked: false,
}));
const designOn = side => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: side === 'front' ? layers : [], backLayers: side === 'back' ? layers : [],
    surfaceMode: `${side}_only`, mfEvalMode: 'side',
});
const row = (type, target, weight, flag) => makeOperand({
    type, lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target, weight, flag,
});
const itemRows = flag => [row('TMX', 0.9, 1, flag), row('TAV', 1, 1, flag)];
const sharedRows = flag => [row('RAV', 0, 2, flag), row('TAV', 1, 1, flag)];

// One step from the design above. The heap is read inside the Hessian kernel
// calls, every `readEvery` calls, while the step assembles its system.
const kernel = getTmmWasm();
const hessian = kernel.tmmHessian;
function oneStep(method, operands, side, readEvery = 0) {
    const engine = makeEngine(method, operands, designOn(side), resolveMat, {});
    let calls = 0, peak = 0;
    kernel.tmmHessian = function sampled(...args) {
        calls++;
        if (readEvery && calls % readEvery === 0) { collect(); peak = Math.max(peak, process.memoryUsage().heapUsed); }
        return hessian.apply(this, args);
    };
    collect();
    const start = process.memoryUsage().heapUsed;
    try { engine.step(); } finally { kernel.tmmHessian = hessian; }
    return { mf: engine.mf, thk: [...engine.thicknesses], calls, growthMB: (peak - start) / 2 ** 20 };
}

// The first 16 hex digits of a SHA-256 of the thicknesses' bits.
const bits = thk => createHash('sha256').update(new Uint8Array(Float64Array.from(thk).buffer)).digest('hex').slice(0, 16);

// One step's merit and thickness bits.
const PINNED = {
    'newton, TMX and TAV, front, Step 2':       { mf: 0.4711524428989336, thk: 'd6ed5f878f315937' },
    'trust-region, TMX and TAV, front, Step 2': { mf: 0.4429174535828584, thk: '598cf9471ecd2f36' },
    'sqp, TMX and TAV, front, Step 2':          { mf: 0.4802686999055054, thk: '68179294c7cd9af3' },
    'newton, RAV and TAV, front, Step 1':       { mf: 0.6875546078123381, thk: '75dbbacff09ef2ca' },
    'newton, RAV and TAV, back, Step 1':        { mf: 0.6891472361411833, thk: 'a9f6b7a6c138a89f' },
};
function assertPinned(name, step) {
    const want = PINNED[name];
    assert.equal(step.mf, want.mf, `${name}: merit ${step.mf}, pinned ${want.mf}`);
    assert.equal(bits(step.thk), want.thk, `${name}: the thicknesses moved`);
}

const samples = flag => operandSampleLambdas(itemRows(flag)[1]).length;
assert.equal(samples(1), 1201, 'the TAV row at Step 1 samples its band 1201 times');
assert.equal(samples(2), 12001, 'the TAV row at Step 2 samples its band 12001 times');

// ── 1 and 2: heap from Step 1 to Step 2, and the pinned results ───────────────
const growth = {};
for (const method of ENGINES) {
    const coarse = oneStep(method, itemRows(1), 'front', 100);
    const fine = oneStep(method, itemRows(2), 'front', 1000);
    assert.equal(coarse.calls, 1201, `${method} at Step 1 asked the kernel once per sample (${coarse.calls} calls)`);
    assert.equal(fine.calls, 12001, `${method} at Step 2 asked the kernel once per sample (${fine.calls} calls)`);
    assert.ok(fine.growthMB - coarse.growthMB < BUDGET_MB,
        `${method}: one step grew the heap by ${fine.growthMB.toFixed(1)} MB at Step 2 and ${coarse.growthMB.toFixed(1)} MB at Step 1`);
    assertPinned(`${method}, TMX and TAV, front, Step 2`, fine);
    growth[method] = `${coarse.growthMB.toFixed(0)} to ${fine.growthMB.toFixed(0)} MB`;
}

// ── 2 and 3: rows on one grid, past the budget ────────────────────────────────
for (const side of ['front', 'back']) {
    const step = oneStep('newton', sharedRows(1), side);
    assertPinned(`newton, RAV and TAV, ${side}, Step 1`, step);
    const n = samples(1);
    assert.ok(step.calls >= n && step.calls <= 2 * n - 500,
        `${side}: two rows on ${n} samples made ${step.calls} kernel calls, sharing what the budget holds`);
}

console.log(`PASS: newton_step_memory (heap growth from Step 1 to Step 2: ${ENGINES.map(m => `${m} ${growth[m]}`).join(', ')})`);
