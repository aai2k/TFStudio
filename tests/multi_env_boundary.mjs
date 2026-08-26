/**
 * Boundary tests for multi-environment optimization.
 * Tests edge cases: zero weight, single environment degeneracy, many environments.
 * 
 * Run: node tests/multi_env_boundary.mjs
 */

import { buildEnvironmentSpecs, calcMFMultiEnv } from '../src/utils/physics/optimizer/multiEnv.js';
import { getMeritAccumulation, calcMF } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand } from '../src/utils/physics/optimizer/operandModel.js';
import { LSQEngine } from '../src/utils/physics/optimizer/lsqEngine.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

// Simple material resolver
function simpleResolveMat(name) {
    const materials = {
        'Air': 1.0, 'Water': 1.33, 'BK7': 1.52,
        'SiO2': 1.46, 'TiO2': 2.4
    };
    const n = materials[name] || 1.5;
    return { getNK: (_lam) => [n, 0] };
}

const resolveMat = simpleResolveMat;
const operands = [
    makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 550,
        aoi: 0, pol: 'avg', target: 0, weight: 1.0 })
];

console.log('=== Boundary Tests ===\n');

// Test 1: Zero weight environment should not affect result
console.log('Test 1: Zero weight environment');
{
    const design = {
        id: 'test1', name: 'Test1', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
        backLayers: [], referenceWavelength: 550, notes: '', meritEnvironments: []
    };
    
    // Single environment baseline
    const singleSpecs = buildEnvironmentSpecs(design, resolveMat);
    const singleResult = calcMFMultiEnv(singleSpecs, operands, { getMeritAccumulation });
    
    // Two environments: one with zero weight
    design.meritEnvironments = [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 0.0 }
    ];
    const zeroSpecs = buildEnvironmentSpecs(design, resolveMat);
    const zeroResult = calcMFMultiEnv(zeroSpecs, operands, { getMeritAccumulation });
    
    ok(Math.abs(zeroResult.mf - singleResult.mf) < 0.001,
        `Zero weight env should not affect MF: ${zeroResult.mf} vs ${singleResult.mf}`);
    console.log(`  Single: ${singleResult.mf.toFixed(6)}, Zero-weight: ${zeroResult.mf.toFixed(6)} PASS`);
}

// Test 2: Single environment degeneracy
console.log('\nTest 2: Single environment degeneracy');
{
    const design = {
        id: 'test2', name: 'Test2', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
        backLayers: [], referenceWavelength: 550, notes: '',
        meritEnvironments: [
            { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 }
        ]
    };
    
    // With meritEnvironments
    const multiSpecs = buildEnvironmentSpecs(design, resolveMat);
    const multiResult = calcMFMultiEnv(multiSpecs, operands, { getMeritAccumulation });
    
    // Without meritEnvironments (baseline)
    design.meritEnvironments = [];
    const singleSpecs = buildEnvironmentSpecs(design, resolveMat);
    const singleResult = calcMFMultiEnv(singleSpecs, operands, { getMeritAccumulation });
    
    ok(Math.abs(multiResult.mf - singleResult.mf) < 0.001,
        `Single env should match baseline: ${multiResult.mf} vs ${singleResult.mf}`);
    console.log(`  Multi-env: ${multiResult.mf.toFixed(6)}, Baseline: ${singleResult.mf.toFixed(6)} PASS`);
}

// Test 3: Many environments performance
console.log('\nTest 3: Many environments (10 envs)');
{
    const envs = [];
    for (let i = 0; i < 10; i++) {
        envs.push({
            id: `env-${i}`,
            incidentMedium: i % 2 === 0 ? 'Air' : 'Water',
            exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            weight: 0.1
        });
    }
    
    const design = {
        id: 'test3', name: 'Test3', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [
            { id: 'l1', material: 'TiO2', thickness: 80, locked: false },
            { id: 'l2', material: 'SiO2', thickness: 120, locked: false }
        ],
        backLayers: [], referenceWavelength: 550, notes: '',
        meritEnvironments: envs
    };
    
    const specs = buildEnvironmentSpecs(design, resolveMat);
    ok(specs.length === 10, `Should have 10 specs, got ${specs.length}`);
    
    const start = performance.now();
    const result = calcMFMultiEnv(specs, operands, { getMeritAccumulation });
    const elapsed = performance.now() - start;
    
    ok(isFinite(result.mf), `MF should be finite, got ${result.mf}`);
    ok(elapsed < 100, `10 envs should complete in < 100ms, took ${elapsed.toFixed(2)}ms`);
    console.log(`  10 envs: ${elapsed.toFixed(2)}ms, MF: ${result.mf.toFixed(6)} PASS`);
}

// Test 4: Empty environments array
console.log('\nTest 4: Empty environments array');
{
    const design = {
        id: 'test4', name: 'Test4', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
        backLayers: [], referenceWavelength: 550, notes: '',
        meritEnvironments: []
    };
    
    const specs = buildEnvironmentSpecs(design, resolveMat);
    ok(specs.length === 1, `Empty array should return 1 spec, got ${specs.length}`);
    ok(specs[0].weight === 1.0, `Default weight should be 1.0, got ${specs[0].weight}`);
    console.log(`  Empty array → 1 spec, weight 1.0 PASS`);
}

// Test 5: Undefined environments
console.log('\nTest 5: Undefined environments');
{
    const design = {
        id: 'test5', name: 'Test5', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
        backLayers: [], referenceWavelength: 550, notes: ''
        // meritEnvironments not defined
    };
    
    const specs = buildEnvironmentSpecs(design, resolveMat);
    ok(specs.length === 1, `Undefined should return 1 spec, got ${specs.length}`);
    console.log(`  Undefined → 1 spec PASS`);
}

// Test 6: LSQEngine with empty environments
console.log('\nTest 6: LSQEngine with empty environments');
{
    const design = {
        id: 'test6', name: 'Test6', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
        backLayers: [], referenceWavelength: 550, notes: '',
        meritEnvironments: []
    };
    
    const engine = new LSQEngine(operands, design, resolveMat, {});
    ok(!engine._multiEnvMode, 'Empty environments should not enable multi-env mode');
    
    const mf = engine.mfAt(engine.thicknesses);
    ok(isFinite(mf), `MF should be finite, got ${mf}`);
    console.log(`  Empty envs → single-env mode, MF: ${mf.toFixed(6)} PASS`);
}

// Test 7: Gradient consistency
console.log('\nTest 7: Gradient consistency (single vs multi-env)');
{
    const design = {
        id: 'test7', name: 'Test7', incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 }, exitMedium: 'Air',
        surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [
            { id: 'l1', material: 'TiO2', thickness: 80, locked: false },
            { id: 'l2', material: 'SiO2', thickness: 120, locked: false }
        ],
        backLayers: [], referenceWavelength: 550, notes: '',
        meritEnvironments: []
    };
    
    // Single env gradient
    const engine1 = new LSQEngine(operands, design, resolveMat, {});
    const grad1 = engine1.gradMF(engine1.thicknesses);
    
    // Multi-env with single environment (should match)
    design.meritEnvironments = [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 }
    ];
    const engine2 = new LSQEngine(operands, design, resolveMat, { environments: design.meritEnvironments });
    const grad2 = engine2.gradMF(engine2.thicknesses);
    
    ok(grad1.length === grad2.length, `Gradient lengths should match`);
    for (let i = 0; i < grad1.length; i++) {
        const diff = Math.abs(grad1[i] - grad2[i]);
        ok(diff < 0.01, `Gradient[${i}] should match: ${grad1[i]} vs ${grad2[i]}, diff=${diff}`);
    }
    console.log(`  Single vs multi-env gradient match PASS`);
}

console.log('\n=== Summary ===');
console.log(`multi_env_boundary: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);
