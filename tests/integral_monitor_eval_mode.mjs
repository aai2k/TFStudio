/**
 * An integral status monitor scores what the design's evaluation mode scores.
 *
 * Every monitor follows the design's evaluation mode, as the INTEGRAL check,
 * its TIW row and the Integral Values window do; the integral monitor alone
 * used to score the whole part, back surface included, so on a one-sided
 * design scored on its coated side it read several points below the check.
 *
 * Checks:
 *   1. On a quarter-wave MgF2 layer on BK7, scored on its side and as the whole
 *      part, the integral monitor equals the TIW row on the same design.
 *   2. The two modes give different values, so the check is not empty.
 *
 * Run: node tests/integral_monitor_eval_mode.mjs
 */

const api = await import('../src/api/index.js');
const { computeMonitor } = await import('../src/utils/physics/statusMonitorEvaluation.js');
const { makeOperand, evaluateOperands, buildEvalContext } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const band = { lambdaStart: 380, lambdaEnd: 780 };
const weighting = { source: { id: 'D65' }, detector: { id: 'photopic' } };
const monitor = { type: 'integral', qty: 'T', ...band, aoi: 0, pol: 'avg', ...weighting };
const values = {};
for (const mode of ['side', 'total']) {
    const design = api.insertLayer(api.newDesign({ mfEvalMode: mode }), { material: 'MgF2', thickness: 99.6 });
    const lookup = designMaterialLookup(design);
    const shown = computeMonitor(monitor, design, lookup);
    const row = evaluateOperands([makeOperand({ type: 'TIW', ...band, aoi: 0, pol: 'avg', target: 0, weight: 1, ...weighting })],
        buildEvalContext(design, lookup))[0] * 100;
    ok(`scored as '${mode}', the monitor reads the TIW row`, Math.abs(shown - row) <= 1e-10, `${shown} against ${row}`);
    values[mode] = shown;
}
ok('the coated side alone and the whole part read differently', Math.abs(values.side - values.total) > 1, JSON.stringify(values));

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
