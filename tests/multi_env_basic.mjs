/**
 * Basic test for multi-environment optimization support.
 * Tests: buildEnvironmentSpecs, calcMFMultiEnv, LSQEngine multi-env mode.
 */

import { buildEnvironmentSpecs, calcMFMultiEnv } from '../src/utils/physics/optimizer/multiEnv.js';
import { buildEvalContext, getMeritAccumulation } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand } from '../src/utils/physics/optimizer/operandModel.js';
import { LSQEngine } from '../src/utils/physics/optimizer/lsqEngine.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

// Simple material resolver for testing (avoids DesignContext React dependency)
// Materials must expose getNK(lambda) → [n, k]
function simpleResolveMat(name) {
    const materials = {
        'Air': 1.0,
        'Water': 1.33,
        'BK7': 1.52,
        'SiO2': 1.46,
        'TiO2': 2.4
    };
    const n = materials[name] || 1.5;
    return { getNK: (_lam) => [n, 0] };
}

// Setup: simple design with one layer (constructed directly, not via makeDefaultDesign)
const design = {
    id: 'test-design',
    name: 'Test',
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
    frontLayers: [],
    backLayers: [],
    referenceWavelength: 550,
    notes: '',
    meritEnvironments: []
};

const designWithFilm = {
    ...design,
    frontLayers: [
        { id: 'l1', material: 'SiO2', thickness: 100, locked: false }
    ]
};
const resolveMat = simpleResolveMat;

// Simple operand: R at 550nm, target=0, weight=1
const operands = [
    makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 550,
        aoi: 0, pol: 'avg', target: 0, weight: 1.0 })
];

console.log('=== Test 1: buildEnvironmentSpecs ===');

// 1a. Empty environments → single spec
const single = buildEnvironmentSpecs(designWithFilm, resolveMat);
ok(single.length === 1, 'Empty environments should return 1 spec');
ok(single[0].weight === 1.0, 'Single env weight should be 1.0');
ok(single[0].ctx._isEvalContext === true, 'ctx should have _isEvalContext');
console.log('  1a. Single env: PASS');

// 1b. Two environments
const design2 = {
    ...designWithFilm,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 0.6 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 0.4 }
    ]
};
const multi = buildEnvironmentSpecs(design2, resolveMat);
ok(multi.length === 2, '2 environments should return 2 specs');
ok(multi[0].weight === 0.6, 'First env weight should be 0.6');
ok(multi[1].weight === 0.4, 'Second env weight should be 0.4');
console.log('  1b. Multi env: PASS');

console.log('\n=== Test 2: calcMFMultiEnv ===');

// 2a. Single env MF
const singleResult = calcMFMultiEnv(single, operands, { getMeritAccumulation });
ok(singleResult.perEnvMf.length === 1, 'Single env should have 1 perEnvMf');
ok(typeof singleResult.mf === 'number', 'mf should be a number');
ok(isFinite(singleResult.mf), 'mf should be finite');
console.log(`  2a. Single env MF: ${singleResult.mf.toFixed(6)} PASS`);

// 2b. Multi env MF
const multiResult = calcMFMultiEnv(multi, operands, { getMeritAccumulation });
ok(multiResult.perEnvMf.length === 2, 'Multi env should have 2 perEnvMf');
console.log(`  2b. Multi env MF: ${multiResult.mf.toFixed(6)} (env0: ${multiResult.perEnvMf[0].toFixed(6)}, env1: ${multiResult.perEnvMf[1].toFixed(6)}) PASS`);

// 2c. Zero weight env should not affect result
const design3 = {
    ...designWithFilm,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 0.0 }
    ]
};
const zeroSpecs = buildEnvironmentSpecs(design3, resolveMat);
const zeroResult = calcMFMultiEnv(zeroSpecs, operands, { getMeritAccumulation });
ok(Math.abs(zeroResult.mf - singleResult.mf) < 0.001,
    `Zero weight env should not affect MF: ${zeroResult.mf} vs ${singleResult.mf}`);
console.log(`  2c. Zero weight env: PASS`);

console.log('\n=== Test 3: LSQEngine multi-env mode ===');

// 3a. Single env engine (backward compatible)
const engine1 = new LSQEngine(operands, designWithFilm, resolveMat, {});
ok(!engine1._multiEnvMode, 'Engine without environments should not be in multi-env mode');
const mf1 = engine1.mfAt(engine1.thicknesses);
ok(isFinite(mf1), 'Single env engine mfAt should be finite');
console.log(`  3a. Single env engine MF: ${mf1.toFixed(6)} PASS`);

// 3b. Multi env engine
const engine2 = new LSQEngine(operands, design2, resolveMat, {
    environments: design2.meritEnvironments
});
ok(engine2._multiEnvMode, 'Engine with environments should be in multi-env mode');
ok(engine2._envCtxs.length === 2, 'Engine should have 2 env contexts');
const mf2 = engine2.mfAt(engine2.thicknesses);
ok(isFinite(mf2), 'Multi env engine mfAt should be finite');
console.log(`  3b. Multi env engine MF: ${mf2.toFixed(6)} PASS`);

// 3c. Gradient in multi-env mode
const grad2 = engine2.gradMF(engine2.thicknesses);
ok(grad2.length === engine2.thicknesses.length, 'Gradient length should match thickness length');
ok(grad2.every(g => isFinite(g)), 'All gradient values should be finite');
console.log(`  3c. Multi env gradient: [${grad2.map(g => g.toFixed(4)).join(', ')}] PASS`);

console.log('\n=== Summary ===');
console.log(`multi_env_basic: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);
