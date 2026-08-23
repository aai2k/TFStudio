import assert from 'node:assert/strict';
import {
    DLSOptimizer, makeOperand, mirrorLayers,
    rankLayerDeletions, eliminateWithinMeritBudget,
} from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

const layer = (id, material, thickness, locked = false) => ({ id, material, thickness, locked });
const media = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    mfEvalMode: 'side',
};

// Real DLS integration: every unlocked candidate is actually re-optimized with
// a positive iteration cap; the locked layer never becomes a candidate.
const optical = {
    ...media, id: 'merit-real-dls', surfaceMode: 'front_only',
    frontLayers: [
        layer('a', 'TiO2', 60),
        layer('b', 'SiO2', 90, true),
        layer('c', 'TiO2', 45),
    ],
    backLayers: [],
    meritOperands: [makeOperand({
        type: 'RAV', lambdaStart: 500, lambdaEnd: 600,
        aoi: 0, pol: 'avg', target: 0.8, weight: 1,
    })],
};
const resolve = designMaterialLookup(optical);
const iterationCaps = [];
const realRefine = (candidate, maxIter) => {
    iterationCaps.push(maxIter);
    const optimizer = new DLSOptimizer(optical.meritOperands, candidate, resolve, { dMin: 0.001 });
    for (let i = 0; i < maxIter && !optimizer.isConverged(); i++) optimizer.step();
    optimizer.restoreBest();
    return { mf: optimizer.mfBest, design: optimizer.applyToDesign(candidate) };
};
const realRank = rankLayerDeletions({
    design: optical, sides: ['front'], dMin: 0.001, maxIter: 3, refineFn: realRefine,
});
assert.equal(realRank.candidates.length, 2, 'locked layer is not an elimination candidate');
assert.ok(realRank.candidates.every(candidate => Number.isFinite(candidate.deltaMF)));
assert.ok(realRank.candidates[0].deltaMF <= realRank.candidates[1].deltaMF);
assert.ok(iterationCaps.length >= 3 && iterationCaps.every(value => value === 3), 'baseline and candidates use positive re-optimization');

// Deleting B makes the two A layers adjacent; the shared cleanup path must
// merge them in the exact design retained by the ranking row.
const adjacent = {
    ...media, surfaceMode: 'front_only',
    frontLayers: [layer('a1', 'A', 10), layer('b', 'B', 5), layer('a2', 'A', 20)],
    backLayers: [],
};
const identityRefine = candidate => ({
    mf: 3 - candidate.frontLayers.length,
    design: JSON.parse(JSON.stringify(candidate)),
});
const adjacentRank = rankLayerDeletions({
    design: adjacent, sides: ['front'], dMin: 0.001, maxIter: 5, refineFn: identityRefine,
});
const removeMiddle = adjacentRank.candidates.find(candidate => candidate.layerId === 'b');
assert.equal(removeMiddle.design.frontLayers.length, 1, 'same-material neighbours merge after deletion');
assert.equal(removeMiddle.design.frontLayers[0].thickness, 30);

// Absolute budget is cumulative from the original baseline: two +1 removals
// fit a budget of 2, while the third is rejected.
const four = {
    ...media, surfaceMode: 'front_only',
    frontLayers: ['A', 'B', 'C', 'D'].map((material, index) => layer(`l${index}`, material, 10)),
    backLayers: [],
};
const countRefine = candidate => ({
    mf: 4 - candidate.frontLayers.length,
    design: JSON.parse(JSON.stringify(candidate)),
});
const budgeted = eliminateWithinMeritBudget({
    design: four, sides: ['front'], dMin: 0.001, budget: 2,
    maxRemovals: 10, maxIter: 4, refineFn: countRefine,
});
assert.equal(budgeted.removed.length, 2, 'accepts multiple removals within cumulative budget');
assert.equal(budgeted.mfAfter - budgeted.baseline, 2);
assert.equal(budgeted.design.frontLayers.length, 2);
const rejected = eliminateWithinMeritBudget({
    design: four, sides: ['front'], dMin: 0.001, budget: 0.5,
    maxRemovals: 10, maxIter: 4, refineFn: countRefine,
});
assert.equal(rejected.removed.length, 0, 'rejects the cheapest candidate when it exceeds budget');

// Symmetric candidates rebuild the derived back stack; two-sided designs rank
// both physical surfaces when both are requested.
const symmetric = {
    ...media, surfaceMode: 'symmetric',
    frontLayers: [layer('s1', 'A', 10), layer('s2', 'B', 20)],
};
symmetric.backLayers = mirrorLayers(symmetric.frontLayers);
const symmetricRank = rankLayerDeletions({
    design: symmetric, sides: ['front'], dMin: 0.001, maxIter: 2,
    refineFn: candidate => ({ mf: candidate.frontLayers.length, design: candidate }),
});
for (const candidate of symmetricRank.candidates) {
    assert.deepEqual(candidate.design.backLayers, mirrorLayers(candidate.design.frontLayers));
}

const twoSided = {
    ...media, surfaceMode: 'both_independent',
    frontLayers: [layer('f1', 'A', 10)], backLayers: [layer('r1', 'B', 10)],
};
const twoRank = rankLayerDeletions({
    design: twoSided, sides: ['front', 'back'], dMin: 0.001, maxIter: 2,
    refineFn: candidate => ({
        mf: 2 - candidate.frontLayers.length - candidate.backLayers.length,
        design: candidate,
    }),
});
assert.deepEqual(new Set(twoRank.candidates.map(candidate => candidate.side)), new Set(['front', 'back']));

console.log('PASS: merit_aware_elimination');
