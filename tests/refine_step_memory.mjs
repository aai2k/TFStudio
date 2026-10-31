/**
 * One refinement step keeps its first-derivative kernel packages within a
 * memory budget (jacobianAssembly/packageCache.js), so the memory the
 * analytic Jacobian takes does not grow with the samples of the rows. Every
 * engine assembles its step from that Jacobian: DLS, CG, Newton-CG, Newton,
 * trust-region and SQP. On 60 alternating TiO2 and SiO2 layers with TMX 0.9
 * and TAV 1 rows over 400-1600 nm, holding every wavelength's package grew the
 * heap of one DLS step by about 80 MB on the front and 180 MB on the back from
 * the rows at Step 2 (0.1 nm, 12001 samples) to Step 3 (0.01 nm, 120001).
 *
 * The heap is read while the step assembles its Jacobian, after a full
 * collection; the reading is the JavaScript heap, without the arrays the WASM
 * kernel's packages keep outside it.
 *
 *   1. On either face, the heap of one DLS step with the rows at Step 3
 *      exceeds the one at Step 2 by less than the budget, 64 MB, and the step
 *      gives the merit and thicknesses pinned below, bit for bit.
 *   2. Under a cone, where each ray of a wavelength has a package of its own,
 *      the step gives the merit and thicknesses pinned below for each engine,
 *      front and back, bit for bit.
 *   3. Rows on one grid past the budget: an RAV and a TAV row over 400-1000 nm
 *      at Step 3, 60001 samples, on either face. The second row finds the
 *      packages that fit, about 32000 on 60 layers, and computes the rest
 *      again, and the step gives the merit and thicknesses pinned below.
 *
 * Run: node tests/refine_step_memory.mjs
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
    console.log('SKIP: refine_step_memory (no WASM kernel)');
    process.exit(0);
}
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { operandSampleLambdas } = await import('../src/utils/physics/optimizer/sampling.js');

const resolveMat = id => getMaterial(id);
const ENGINES = ['dls', 'cg', 'newton-cg', 'newton', 'trust-region', 'sqp'];
// The Jacobian's budget, JACOBIAN_CACHE_BYTES.
const BUDGET_MB = 64;

// 60 alternating TiO2 and SiO2 layers, 60 to 149 nm.
const layers = Array.from({ length: 60 }, (_, i) => ({
    id: `L${i}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2', thickness: 60 + ((i * 37) % 90), locked: false,
}));
const designOn = (side, extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: side === 'front' ? layers : [], backLayers: side === 'back' ? layers : [],
    surfaceMode: `${side}_only`, mfEvalMode: 'side', ...extra,
});
const CONE = { cone: { enabled: true, halfAngleDeg: 10, distribution: 'uniform', gridPoints: 5 } };
const row = (type, target, weight, flag, lambdaEnd = 1600) => makeOperand({
    type, lambdaStart: 400, lambdaEnd, aoi: 0, pol: 'avg', target, weight, flag,
});
const itemRows = flag => [row('TMX', 0.9, 1, flag), row('TAV', 1, 1, flag)];
const sharedRows = (flag, lambdaEnd) => [row('RAV', 0, 2, flag, lambdaEnd), row('TAV', 1, 1, flag, lambdaEnd)];

// Steps from the design above until its thicknesses move, at most `maxSteps`,
// since a step whose trial is rejected leaves them where they were. The heap
// is read inside the Jacobian kernel calls, every `readEvery` calls.
const kernel = getTmmWasm();
const jacobian = kernel.jacobian;
function stepsUntilMoved(method, operands, design, { readEvery = 0, maxSteps = 3, options = {} } = {}) {
    const engine = makeEngine(method, operands, design, resolveMat, options);
    const start = bits(engine.thicknesses);
    let calls = 0, peak = 0, steps = 0;
    kernel.jacobian = function sampled(...args) {
        calls++;
        if (readEvery && calls % readEvery === 0) { collect(); peak = Math.max(peak, process.memoryUsage().heapUsed); }
        return jacobian.apply(this, args);
    };
    collect();
    const heapBefore = process.memoryUsage().heapUsed;
    try {
        do { engine.step(); steps++; } while (bits(engine.thicknesses) === start && steps < maxSteps);
    } finally { kernel.jacobian = jacobian; }
    return { steps, mf: engine.mf, thk: bits(engine.thicknesses), calls, growthMB: (peak - heapBefore) / 2 ** 20 };
}

// The first 16 hex digits of a SHA-256 of the thicknesses' bits.
function bits(thk) {
    return createHash('sha256').update(new Uint8Array(Float64Array.from(thk).buffer)).digest('hex').slice(0, 16);
}

// The steps taken until the thicknesses moved, the merit and the thickness bits.
const PINNED = {
    'dls, TMX and TAV, front, Step 2':               [1, 0.47370426229253687, '7d7ab6101a02563b'],
    'dls, TMX and TAV, front, Step 3':               [1, 0.4737418387016964, 'baaaa112253aa0f3'],
    'dls, TMX and TAV, back, Step 2':                [1, 0.49014902619518397, '58b89a74392966a4'],
    'dls, TMX and TAV, back, Step 3':                [1, 0.49074350873600425, '28055fd661f92767'],
    'dls, RAV and TAV under a cone, front':          [1, 0.9365291714266015, '3a9bd23f35f31630'],
    'cg, RAV and TAV under a cone, front':           [1, 0.793076339236179, 'f49190c291e40706'],
    'newton-cg, RAV and TAV under a cone, front':    [2, 0.9311628256180337, 'ea2c58500620e964'],
    'newton, RAV and TAV under a cone, front':       [2, 0.9365291714266196, '16c1ab9a5956d26c'],
    'trust-region, RAV and TAV under a cone, front': [3, 0.8992867831287391, '33af47dea45990e2'],
    'sqp, RAV and TAV under a cone, front':          [1, 0.7798550456018843, '4f926dd9cb5a271c'],
    'dls, RAV and TAV under a cone, back':           [1, 0.9101531700247731, '56afa8cda1df6f00'],
    'cg, RAV and TAV under a cone, back':            [1, 0.7916755870867026, '92d241f11a6fc823'],
    'newton-cg, RAV and TAV under a cone, back':     [2, 0.919974052099088, '8892fa54c8fb2142'],
    'newton, RAV and TAV under a cone, back':        [1, 0.8988810518647945, '6094a3b10c3aa2f2'],
    'trust-region, RAV and TAV under a cone, back':  [3, 0.9000608650979431, '46ff4c9b9e7e57d8'],
    'sqp, RAV and TAV under a cone, back':           [1, 0.8641991297063334, 'db5495ea913cfd00'],
    'dls, RAV and TAV over 400-1000 nm, front, Step 3': [1, 0.945733532814864, '1b09d3515a1cfa12'],
    'dls, RAV and TAV over 400-1000 nm, back, Step 3':  [1, 0.9247848462527063, '9d1e995295316eec'],
};
function assertPinned(name, run) {
    const [steps, mf, thk] = PINNED[name];
    assert.equal(run.steps, steps, `${name}: the thicknesses moved after ${run.steps} steps, pinned ${steps}`);
    assert.equal(run.mf, mf, `${name}: merit ${run.mf}, pinned ${mf}`);
    assert.equal(run.thk, thk, `${name}: the thicknesses moved elsewhere`);
}

const samples = (flag, lambdaEnd) => operandSampleLambdas(row('TAV', 1, 1, flag, lambdaEnd)).length;
assert.equal(samples(2), 12001, 'the TAV row at Step 2 samples its band 12001 times');
assert.equal(samples(3), 120001, 'the TAV row at Step 3 samples its band 120001 times');
assert.equal(samples(3, 1000), 60001, 'and over 400-1000 nm 60001 times');

// ── 1: heap from Step 2 to Step 3, and the pinned results ─────────────────────
// A starting damping of 1000 lets the first DLS step move the thicknesses, so
// one Jacobian decides each pinned result.
const growth = {};
for (const side of ['front', 'back']) {
    const options = { lamInit: 1000 };
    const coarse = stepsUntilMoved('dls', itemRows(2), designOn(side), { readEvery: 1000, maxSteps: 1, options });
    const fine = stepsUntilMoved('dls', itemRows(3), designOn(side), { readEvery: 10000, maxSteps: 1, options });
    assert.ok(fine.growthMB - coarse.growthMB < BUDGET_MB,
        `${side}: one DLS step grew the heap by ${fine.growthMB.toFixed(1)} MB at Step 3 and ${coarse.growthMB.toFixed(1)} MB at Step 2`);
    assertPinned(`dls, TMX and TAV, ${side}, Step 2`, coarse);
    assertPinned(`dls, TMX and TAV, ${side}, Step 3`, fine);
    growth[side] = `${coarse.growthMB.toFixed(0)} to ${fine.growthMB.toFixed(0)} MB`;
}

// ── 2: every engine under a cone ──────────────────────────────────────────────
for (const side of ['front', 'back']) {
    for (const method of ENGINES) {
        assertPinned(`${method}, RAV and TAV under a cone, ${side}`,
            stepsUntilMoved(method, sharedRows(1, 700), designOn(side, CONE)));
    }
}

// ── 3: rows on one grid past the budget ───────────────────────────────────────
for (const side of ['front', 'back']) {
    const run = stepsUntilMoved('dls', sharedRows(3, 1000), designOn(side), { maxSteps: 1, options: { lamInit: 1000 } });
    assertPinned(`dls, RAV and TAV over 400-1000 nm, ${side}, Step 3`, run);
    const n = samples(3, 1000);
    assert.ok(run.calls > n && run.calls <= 2 * n - 30000,
        `${side}: two rows on ${n} samples made ${run.calls} kernel calls, sharing what the budget holds`);
}

console.log(`PASS: refine_step_memory (heap growth of one DLS step from Step 2 to Step 3: front ${growth.front}, back ${growth.back})`);
