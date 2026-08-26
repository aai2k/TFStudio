/**
 * Performance benchmark for multi-environment optimization.
 * Quantifies the performance overhead of multi-environment Jacobian evaluation.
 * 
 * Run: node tests/multi_env_benchmark.mjs
 */

import { buildEnvironmentSpecs, calcMFMultiEnv } from '../src/utils/physics/optimizer/multiEnv.js';
import { getMeritAccumulation } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand } from '../src/utils/physics/optimizer/operandModel.js';
import { LSQEngine } from '../src/utils/physics/optimizer/lsqEngine.js';

// Simple material resolver for benchmarking
function simpleResolveMat(name) {
    const materials = {
        'Air': 1.0, 'Water': 1.33, 'BK7': 1.52,
        'SiO2': 1.46, 'TiO2': 2.4
    };
    const n = materials[name] || 1.5;
    return { getNK: (_lam) => [n, 0] };
}

// Create a test design with multiple layers
function createDesign(numLayers, environments = []) {
    const layers = [];
    for (let i = 0; i < numLayers; i++) {
        layers.push({
            id: `l${i}`,
            material: i % 2 === 0 ? 'TiO2' : 'SiO2',
            thickness: 50 + Math.random() * 100,
            locked: false
        });
    }
    return {
        id: 'benchmark-design',
        name: 'Benchmark',
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        exitMedium: 'Air',
        surfaceMode: 'front_only',
        mfEvalMode: 'side',
        frontLayers: layers,
        backLayers: [],
        referenceWavelength: 550,
        notes: '',
        meritEnvironments: environments
    };
}

// Create test operands
function createOperands() {
    return [
        makeOperand({ type: 'R', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.5, weight: 1.0 }),
        makeOperand({ type: 'T', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.5, weight: 1.0 }),
    ];
}

// Create environments
function createEnvironments(count) {
    const media = ['Air', 'Water', 'Glass', 'Oil', 'Vacuum'];
    const envs = [];
    for (let i = 0; i < count; i++) {
        envs.push({
            id: `env-${i}`,
            incidentMedium: media[i % media.length],
            exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            weight: 1.0 / count
        });
    }
    return envs;
}

console.log('=== Multi-Environment Performance Benchmark ===\n');

const operands = createOperands();
const resolveMat = simpleResolveMat;

// Benchmark configurations
const configs = [
    { layers: 5, envs: [1, 2, 4, 8] },
    { layers: 10, envs: [1, 2, 4] },
    { layers: 20, envs: [1, 2] },
];

for (const cfg of configs) {
    console.log(`--- ${cfg.layers} layers ---`);
    
    for (const envCount of cfg.envs) {
        const environments = createEnvironments(envCount);
        const design = createDesign(cfg.layers, environments);
        
        // Warm up
        const engine = new LSQEngine(operands, design, resolveMat, { environments });
        engine.mfAt(engine.thicknesses);
        
        // Benchmark mfAt
        const iterations = 100;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            engine.mfAt(engine.thicknesses);
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / iterations;
        
        console.log(`  ${envCount} envs: ${avgMs.toFixed(3)} ms/mfAt`);
    }
    console.log();
}

// Gradient benchmark
console.log('--- Gradient benchmark (10 layers) ---');
for (const envCount of [1, 2, 4]) {
    const environments = createEnvironments(envCount);
    const design = createDesign(10, environments);
    const engine = new LSQEngine(operands, design, resolveMat, { environments });
    
    // Warm up
    engine.gradMF(engine.thicknesses);
    
    const iterations = 20;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        engine.gradMF(engine.thicknesses);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    
    console.log(`  ${envCount} envs: ${avgMs.toFixed(3)} ms/gradMF`);
}

console.log('\n=== Benchmark complete ===');
