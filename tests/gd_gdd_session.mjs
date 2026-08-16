import assert from 'node:assert/strict';
import {
    readGDGDDSession,
    writeGDGDDSession,
} from '../src/components/windows/analysis/gdGddEvaluation/sessionState.js';

const frontDesign = {
    id: 'front-design',
    referenceWavelength: 625,
    frontLayers: [{ material: 'SiO2', thickness: 100 }],
    backLayers: [],
};
const backDesign = {
    id: 'back-design',
    referenceWavelength: 780,
    frontLayers: [],
    backLayers: [{ material: 'SiO2', thickness: 120 }],
};

assert.deepEqual(readGDGDDSession(frontDesign), {
    designId: 'front-design',
    side: 'front',
    target: 'R',
    quantity: 'gd',
    pol: 'avg',
    lamStart: 400,
    lamEnd: 800,
    theta: 0,
    refLam: 625,
    showRef: true,
    showTargets: true,
    showTable: false,
    yAuto: true,
    yMin: null,
    yMax: null,
});

writeGDGDDSession({
    side: 'back',
    target: 'T',
    quantity: 'tod',
    pol: 'p',
    lamStart: 610,
    lamEnd: 910,
    theta: 37,
    refLam: 730,
    showRef: false,
    showTargets: false,
});

const remounted = readGDGDDSession(frontDesign);
assert.equal(remounted.side, 'back');
assert.equal(remounted.target, 'T');
assert.equal(remounted.quantity, 'tod');
assert.equal(remounted.pol, 'p');
assert.equal(remounted.lamStart, 610);
assert.equal(remounted.lamEnd, 910);
assert.equal(remounted.theta, 37);
assert.equal(remounted.refLam, 730);
assert.equal(remounted.showRef, false);
assert.equal(remounted.showTargets, false);

remounted.quantity = 'phase';
assert.equal(readGDGDDSession(frontDesign).quantity, 'tod',
    'callers cannot mutate the session store through a returned snapshot');

const changedDesign = readGDGDDSession(backDesign);
assert.equal(changedDesign.side, 'back', 'a new design chooses its populated coating');
assert.equal(changedDesign.refLam, 780, 'a new design adopts its reference wavelength');
assert.equal(changedDesign.quantity, 'tod', 'display controls survive a design change');
assert.equal(changedDesign.lamStart, 610);

writeGDGDDSession({ side: 'total', target: 'R' });
assert.equal(readGDGDDSession(backDesign).side, 'front',
    'reflection cannot restore the transmission-only total side');

console.log('gd_gdd_session: passed');
