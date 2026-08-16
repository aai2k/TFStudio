import assert from 'node:assert/strict';
import {
    readMaterialDispersionSession,
    writeMaterialDispersionSession,
} from '../src/components/windows/analysis/materialDispersion/sessionState.js';

const initial = readMaterialDispersionSession();
assert.deepEqual(initial, {
    materialId: 'builtin:SiO2',
    thicknessMm: 1,
    thicknessUnit: 'mm',
    quantity: 'gdd',
    start: 400,
    end: 1100,
    showTable: false,
});

writeMaterialDispersionSession({
    materialId: 'builtin:BK7',
    thicknessMm: 2.5,
    thicknessUnit: 'um',
    quantity: 'tod',
    start: 450,
    end: 900,
});

assert.deepEqual(readMaterialDispersionSession(), {
    materialId: 'builtin:BK7',
    thicknessMm: 2.5,
    thicknessUnit: 'um',
    quantity: 'tod',
    start: 450,
    end: 900,
    showTable: false,
});

const snapshot = readMaterialDispersionSession();
snapshot.quantity = 'phase';
assert.equal(readMaterialDispersionSession().quantity, 'tod',
    'callers cannot mutate the session store through a returned snapshot');

console.log('material_dispersion_session: passed');
