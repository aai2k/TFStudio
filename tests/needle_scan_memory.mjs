/**
 * The analytic needle scan keeps its kernel results within a memory budget
 * (scanners/needleScanPasses.js _makeScanAt), so its memory does not grow with
 * the number of samples a band row takes. A band row at a fine Step samples its
 * band tens of thousands of times; holding every wavelength's results took
 * about 500 MB for one TAV row at 0.1 nm over 400-700 nm on 30 layers and ran
 * out of a 4 GB heap at 0.01 nm. Rows that share a grid of a few hundred
 * samples still share the kernel's results.
 *
 * The scan is the Needle Manual window's (profileScan), run here on this thread
 * where the window runs it in the optimizer worker; the material tables the
 * worker is sent are not part of what this test measures. The scanned values
 * are checked against finite differences by the needle scan tests
 * (needle_scan_spec_merits.mjs and others); this test checks memory.
 *
 * Run: node tests/needle_scan_memory.mjs
 */
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { shimBrowserGlobals } from './_uiShim.mjs';

// The memory the scan keeps alive is what runs out, so each reading is taken
// after a full collection: results let go of wait for one otherwise.
v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc');

shimBrowserGlobals();
const { initWasmForTest, getTmmWasm } = await import('./_wasmInit.mjs');
if (!(await initWasmForTest())) {
    console.log('SKIP: needle_scan_memory (no WASM kernel)');
    process.exit(0);
}
const { makeOperand, isConstraint } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { operandSampleLambdas } = await import('../src/utils/physics/optimizer/sampling.js');
const model = await import('../src/components/windows/optimization/needleManual/model.js');

const resolveMat = id => getMaterial(id);

// 30 TiO2/SiO2 layers: quarter waves at 550 nm with a fixed ripple.
const frontLayers = Array.from({ length: 30 }, (_, i) => {
    const material = i % 2 === 0 ? 'TiO2' : 'SiO2';
    const n = resolveMat(material).getNK(550)[0];
    return { id: `L${i}`, material, thickness: (550 / (4 * n)) * (1 + 0.2 * Math.sin(1.7 * i + 0.3)), locked: false };
});
const design = {
    id: 'needle-memory', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers, backLayers: [], surfaceMode: 'front_only',
    meritOperands: [makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1, flag: 2 })],
};
const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: resolveMat(id) }));

// The heap is read inside the kernel calls, while the scan is under way.
const kernel = getTmmWasm();
const scan = kernel.needleScan;
let calls = 0, peak = 0;
kernel.needleScan = function sampled(...args) {
    if (++calls % 250 === 0) { collect(); peak = Math.max(peak, process.memoryUsage().heapUsed); }
    return scan.apply(this, args);
};

const operands = model.runOperands(design, resolveMat).filter(op => !isConstraint(op.type));
assert.equal(operandSampleLambdas(operands[0]).length, 3001, 'the row at 0.1 nm samples its band 3001 times');

collect();
const start = process.memoryUsage().heapUsed;
const result = model.profileScan({
    operands, design, resolveMat, candidateMats: pool, deltaNm: 0.5, nIntra: 16, side: 'front',
});
kernel.needleScan = scan;

assert.ok(calls >= 3001, `the scan asked the kernel for every sample (${calls} calls)`);
assert.ok(result?.candidates.length > 0 && result.candidates.every(c => Number.isFinite(c.grad)),
    'the scan returns a slope for every candidate');
const growth = (peak - start) / 2 ** 20;
// The scan keeps at most 64 MB of results; holding them all took about 500 MB
// here. The bound leaves room for what the scan builds besides.
assert.ok(growth < 150, `the scan's heap grew by ${growth.toFixed(0)} MB, under 150 MB`);

// A range target gives one slope row per sample, each one value per needle
// position and material; the scan adds each into the slopes as it is made.
// Holding them all took about 205 MB here at 0.01 nm.
const ranged = {
    ...design,
    meritOperands: [makeOperand({ type: 'TGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1, flag: 3 })],
};
const rangedOps = model.runOperands(ranged, resolveMat).filter(op => !isConstraint(op.type));
assert.equal(operandSampleLambdas(rangedOps[0]).length, 30001, 'the range target at 0.01 nm samples its band 30001 times');
calls = 0; peak = 0;
kernel.needleScan = function sampled(...args) {
    if (++calls % 1000 === 0) { collect(); peak = Math.max(peak, process.memoryUsage().heapUsed); }
    return scan.apply(this, args);
};
collect();
const rangedStart = process.memoryUsage().heapUsed;
model.profileScan({
    operands: rangedOps, design: ranged, resolveMat, candidateMats: pool, deltaNm: 0.5, nIntra: 16, side: 'front',
});
kernel.needleScan = scan;
const rangedGrowth = (peak - rangedStart) / 2 ** 20;
assert.ok(rangedGrowth < 150, `the range target scan's heap grew by ${rangedGrowth.toFixed(0)} MB, under 150 MB`);

// Rows on one grid, such as an average of T and one of R over the same band,
// share the kernel's results: one call per sample, not one per row and sample.
const shared = {
    ...design,
    meritOperands: ['TAV', 'RAV'].map(type => makeOperand({ type, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: type === 'TAV' ? 1 : 0, weight: 1 })),
};
const sharedOps = model.runOperands(shared, resolveMat).filter(op => !isConstraint(op.type));
const samples = operandSampleLambdas(sharedOps[0]).length;
let sharedCalls = 0;
kernel.needleScan = function counted(...args) { sharedCalls++; return scan.apply(this, args); };
model.profileScan({
    operands: sharedOps, design: shared, resolveMat, candidateMats: pool, deltaNm: 0.5, nIntra: 16, side: 'front',
});
kernel.needleScan = scan;
assert.equal(sharedCalls, samples, `two rows on one grid of ${samples} samples made ${sharedCalls} kernel calls`);

// On a grid longer than the cache holds, the second row still finds the
// first results that fit (about 400 here).
const fine = { ...shared, meritOperands: shared.meritOperands.map(op => ({ ...op, flag: 2 })) };
const fineOps = model.runOperands(fine, resolveMat).filter(op => !isConstraint(op.type));
const fineSamples = operandSampleLambdas(fineOps[0]).length;
let fineCalls = 0;
kernel.needleScan = function counted(...args) { fineCalls++; return scan.apply(this, args); };
model.profileScan({
    operands: fineOps, design: fine, resolveMat, candidateMats: pool, deltaNm: 0.5, nIntra: 16, side: 'front',
});
kernel.needleScan = scan;
assert.ok(fineCalls <= 2 * fineSamples - 300, `two rows on ${fineSamples} samples made ${fineCalls} kernel calls, sharing what the cache holds`);

console.log(`PASS: needle_scan_memory (heap growth ${growth.toFixed(0)} MB band average, ${rangedGrowth.toFixed(0)} MB range target)`);
