import assert from 'node:assert/strict';

import { makeShiftedMaterial } from '../src/utils/physics/errorAnalysis/spectrumEval.js';

const dispersiveAbsorber = {
    getNK: (lambda) => lambda === 500 ? [2, 0] : [2, 1],
};
const shifted = makeShiftedMaterial(dispersiveAbsorber, 0, -0.5);

assert.deepEqual(shifted.getNK(500), [2, 0]);
assert.deepEqual(shifted.getNK(550), [2, 0.5]);

console.log('PASS: Monte Carlo index errors preserve passive extinction coefficients');
