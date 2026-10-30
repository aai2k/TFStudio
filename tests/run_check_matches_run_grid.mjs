/**
 * The check before a Refinement run reads the rows at their default steps
 * (runRefinement.js prepare), and the run
 * reads them on its own, finer grid. The two must agree on whether a row can be
 * evaluated, or a run the check passes stops at its first evaluation, and one
 * it refuses would have run. They agree because a band grid ends on its band's
 * end exactly, whatever its sample count (sampling.js): a group-delay flatness
 * row whose band ends on the last wavelength a material covers stays inside
 * the material's data at every Step.
 *
 * Run: node tests/run_check_matches_run_grid.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { atDefaultSteps } from '../src/utils/physics/meritDisplay.js';
import { computeOperandDisplay } from '../src/utils/refinement/operandCheck.js';
import { densifyForRun } from '../src/utils/refinement/workerInputs.js';

const design = (high, low) => ({
    id: 'edge', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, material: i % 2 ? low : high, thickness: 80 + 7 * (i % 5), locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const flat = (a, b, flag) => makeOperand({ type: 'GDFLAT', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 's', target: 0, weight: 1, flag });
const errorsOf = (d, ops) => (computeOperandDisplay(d, ops)?.errors || []).filter(Boolean);

// Bands that end on the last wavelength a material covers, at Steps whose
// sample counts put the grid's arithmetic one unit in the last place past it.
const CASES = [
    ['HfO2/SiO2, GDFLAT 439.04-2485.8 nm at Step 2', design('HfO2', 'SiO2'), [flat(439.04, 2485.8, 2)]],
    ['MgF2/SiO2 on BK7, GDFLAT 454.8-2500 nm at Step 1', design('MgF2', 'SiO2'), [flat(454.8, 2500, 1)]],
];
for (const [name, d, ops] of CASES) {
    const check = errorsOf(d, atDefaultSteps(ops));
    const ownSteps = errorsOf(d, ops);
    const runGrid = errorsOf(d, densifyForRun(ops, d));
    assert.deepEqual(check, ownSteps, `${name}: the check at the default steps and the row at its own Step agree`);
    assert.deepEqual(check, runGrid, `${name}: and so does the run's own grid`);
    assert.deepEqual(runGrid, [], `${name}: the band is inside the materials' data, so the run starts`);
}

console.log('PASS: run_check_matches_run_grid');
