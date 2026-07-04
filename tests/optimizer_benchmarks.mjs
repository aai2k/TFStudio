/**
 * Optimizer benchmark suite.
 *
 * Runs the LOCAL engine (DLS) and the GLOBAL/large-design engines (DE, SA, CG)
 * on a few canonical thin-film problems and reports final merit function, wall
 * time and iteration count side by side. This is a REPORTING tool (not strict
 * pass/fail) for comparing convergence and speed.
 *
 * All engines optimize thicknesses of a FIXED stack (refinement), so the layer
 * count is identical across methods — only the thicknesses differ.
 *
 * Run: node tests/optimizer_benchmarks.mjs
 *      node tests/optimizer_benchmarks.mjs --multistart   (DLS×N restarts ref)
 */

import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

// ── Canonical cases ────────────────────────────────────────────────────────────

function caseBBAR4() {
    return {
        name: 'BBAR 4-layer (TiO2/SiO2), Ravg→0, 450–650 nm',
        design: {
            incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            frontLayers: [
                { id: 'F1', material: 'TiO2', thickness: 80,  locked: false },
                { id: 'F2', material: 'SiO2', thickness: 140, locked: false },
                { id: 'F3', material: 'TiO2', thickness: 60,  locked: false },
                { id: 'F4', material: 'SiO2', thickness: 120, locked: false },
            ],
            backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
        },
        operands: [ makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }) ],
    };
}

function caseBBAR1() {
    return {
        name: 'BBAR 1-layer MgF2, Ravg→0, 400–700 nm (two basins ~94 & ~290 nm)',
        design: {
            incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            frontLayers: [ { id: 'F1', material: 'MgF2', thickness: 180, locked: false } ],
            backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
        },
        operands: [ makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }) ],
    };
}

function caseBeamSplitter() {
    return {
        name: '50/50 Beamsplitter (TiO2/SiO2 ×8), Ravg→0.5, 450–650 nm',
        design: {
            incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            frontLayers: Array.from({ length: 8 }, (_, i) => ({
                id: 'F' + i, material: i % 2 === 0 ? 'TiO2' : 'SiO2',
                thickness: i % 2 === 0 ? 55 : 95, locked: false,
            })),
            backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
        },
        operands: [ makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0.5, weight: 1 }) ],
    };
}

function caseHR30() {
    const N = 30;
    // Detuned QW stack (each layer scaled by a fixed +18%/−12% zig-zag) so the
    // start is well off the optimum and every method has real work to do — a
    // meaningful large-design timing case (the CG niche).
    return {
        name: 'HR 30-layer, detuned QW, Tavg→0 500–700 nm (large-design / CG niche)',
        design: {
            incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            frontLayers: Array.from({ length: N }, (_, i) => ({
                id: 'F' + i, material: i % 2 === 0 ? 'TiO2' : 'SiO2',
                thickness: (i % 2 === 0 ? 62 : 100) * (i % 2 === 0 ? 1.18 : 0.88), locked: false,
            })),
            backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
        },
        operands: [ makeOperand({ type: 'TAV', lambdaStart: 500, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }) ],
    };
}

// ── Runner ───────────────────────────────────────────────────────────────────

const METHODS = [
    { id: 'dls', label: 'DLS (local)',  maxIter: 400 },
    { id: 'cg',  label: 'CG  (local)',  maxIter: 600 },
    { id: 'de',  label: 'DE  (global)', maxIter: 250 },
    { id: 'sa',  label: 'SA  (global)', maxIter: 400 },
];

function run(testCase) {
    const mf0 = new DLSOptimizer(testCase.operands, testCase.design, resolveMat).mf;
    console.log(`\n■ ${testCase.name}`);
    console.log(`  start MF = ${mf0.toFixed(6)}`);
    console.log('  ' + 'method'.padEnd(14) + 'finalMF'.padStart(12) + 'iters'.padStart(8) + 'time(ms)'.padStart(11) + '   improvement');
    for (const m of METHODS) {
        const eng = makeEngine(m.id, testCase.operands, testCase.design, resolveMat, { seed: 12345, maxIter: m.maxIter });
        const t0 = now();
        let it = 0;
        for (; it < m.maxIter && !eng.isConverged(); it++) eng.step();
        const dt = now() - t0;
        const imp = mf0 > 0 ? (100 * (1 - eng.mfBest / mf0)).toFixed(1) + '%' : '—';
        console.log('  ' + m.label.padEnd(14) + eng.mfBest.toFixed(6).padStart(12) + String(eng.iter).padStart(8) + dt.toFixed(1).padStart(11) + `   ${imp}`);
    }
}

console.log('=== TFStudio optimizer benchmarks (lower MF = better) ===');
[caseBBAR1(), caseBBAR4(), caseBeamSplitter(), caseHR30()].forEach(run);
console.log('\nNote: DE/SA are stochastic (fixed seed here for reproducibility); a single');
console.log('run is one sample. DLS/CG are deterministic. All times are serial, single-thread');
console.log('(production DE evaluates the population across the worker pool).\n');
