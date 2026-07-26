import assert from 'node:assert/strict';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'locked', material: 'TiO2', thickness: 100, locked: true }],
    backLayers: [],
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
};
const operands = [makeOperand({
    type: 'R', lambdaStart: 550, lambdaEnd: 550,
    aoi: 0, pol: 'avg', target: 1, weight: 1,
})];

for (const method of ['dls', 'newton', 'newton-cg', 'sqp']) {
    const engine = makeEngine(method, operands, design, getMaterial);
    assert.ok(engine.mf > engine.tol, `${method}: target starts unmet`);
    assert.equal(engine.iter, 0, `${method}: starts at iteration zero`);
    assert.equal(engine.isConverged(), true, `${method}: no free parameters is terminal`);
}

console.log('optimizer_all_locked: passed');
