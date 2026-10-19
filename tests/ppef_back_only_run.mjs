/**
 * A PPEF row refines on a back-only design.
 *
 * A run expands a measured curve block into one row per point. Each point used
 * to claim front-side incidence whatever the block said, so on a back-only
 * design scored on its side every point failed and the run stopped with
 * workerFailed, while the merit table, scoring the block whole, read the row.
 * A photometric block with no side is measured on the side the design
 * evaluates; a Ψ or Δ block is still scored on the front only.
 *
 * Checks:
 *   1. The PPEF rows Generate MF writes refine on a back-only design.
 *   2. Their points carry no side, and a Ψ block's points still say front.
 *   3. A Ψ block with no side is refused on a back-only design by the merit
 *      table as by a run, and read on a front-side design.
 *
 * Run: node tests/ppef_back_only_run.mjs
 */

const api = await import('../src/api/index.js');
const { makeQualifier, qualifiersToMFOperands } = await import('../src/utils/synthesis/qualifiers.js');
const { makeMeasuredCurve } = await import('../src/utils/io/spectrumTable/measuredCurve.js');
const { expandMeasuredCurveOperand, makeMeasuredCurveOperand } = await import('../src/utils/physics/optimizer/measuredCurveOperand.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const quietly = async run => {
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { return await run(); } finally { console.log = log; console.warn = warn; }
};

await api.init();
let design = api.newDesign({ surfaceMode: 'back_only', mfEvalMode: 'side' });
for (const [material, thickness] of [['TiO2', 57], ['SiO2', 94], ['TiO2', 57], ['SiO2', 94]]) {
    design = api.insertLayer(design, { side: 'back', material, thickness });
}
const x = Array.from({ length: 21 }, (_, i) => 450 + 10 * i);
const curve = makeMeasuredCurve({ name: 'measured', quantity: 'T', x, y: x.map(() => 0.9) });
design = { ...design, measuredCurves: [curve] };
const rows = qualifiersToMFOperands([makeQualifier({ kind: 'PPEF', curveId: curve.id, cmp: 'le', target: 1 })], { design });
const rated = { ...design, meritOperands: rows };

ok('the merit table reads the PPEF row', api.merit(rated).rows.every(row => row.error === null), JSON.stringify(api.merit(rated).rows.map(row => row.error)));
const run = await quietly(() => api.refine(rated, { method: 'dls', maxIter: 3 }));
ok('a run refines it', run.result.completed !== false && run.result.stopReason !== 'workerFailed', JSON.stringify({ completed: run.result.completed, stop: run.result.stopReason }));

const block = rows.find(row => row.type === 'MCURVE');
ok('a photometric block\'s points carry no side', expandMeasuredCurveOperand(block).every(point => !('measurementSide' in point)));
const psi = makeMeasuredCurveOperand({ quantity: 'PSI', sampleLambdas: [500, 600], sampleTargets: [30, 31], weight: 1 });
ok('a Ψ block\'s points are scored on the front', expandMeasuredCurveOperand(psi).every(point => point.measurementSide === 'front'));
const backPsi = makeMeasuredCurveOperand({ quantity: 'PSI', side: 'back', sampleLambdas: [500], sampleTargets: [30], weight: 1 });
ok('a block with a side passes it on', expandMeasuredCurveOperand(backPsi)[0].measurementSide === 'back');

const psiRows = [makeMeasuredCurveOperand({ quantity: 'PSI', aoi: 70, sampleLambdas: [500, 600], sampleTargets: [30, 31], weight: 1 })];
ok('the merit table refuses a Ψ block on a back-only design', api.merit({ ...design, meritOperands: psiRows }).rows[0].error !== null);
let front = api.newDesign();
front = api.insertLayer(front, { material: 'TiO2', thickness: 57 });
ok('and reads it on a front-side design', api.merit({ ...front, meritOperands: psiRows }).rows[0].error === null,
    String(api.merit({ ...front, meritOperands: psiRows }).rows[0].error));

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
