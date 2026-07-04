/**
 * Real-kernel needle-scan equivalence through the optimizer.
 *
 * Runs scanNeedlesPFunction (which drives tmmNeedleScanEval) once on JS and once
 * with the WASM kernel enabled, and checks every candidate's analytic gradient
 * matches. Validates the tmm_needle_scan wiring + nested-reshape end-to-end on
 * front_only AND a full-system mode.
 *
 * Requires src/wasm/tmm_kernel.wasm; SKIPS if absent.
 * Run: node tests/wasm_needle_scan_run.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeOperand, scanNeedlesPFunction } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initTmmWasmMainThread, setTmmWasmEnabled, tmmWasmActive } from '../src/utils/workers/tmmWasm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');
if (!existsSync(wasmPath)) { console.log('SKIP wasm_needle_scan_run: kernel not built.'); process.exit(0); }

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);
const POOL = ['TiO2', 'SiO2', 'MgF2'].map(id => ({ id, name: id, mat: resolveMat(id) }));

const ops = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];
const mkDesign = (surfaceMode) => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'F1', material: 'TiO2', thickness: 40, locked: false },
        { id: 'F2', material: 'SiO2', thickness: 90, locked: false },
        { id: 'F3', material: 'TiO2', thickness: 30, locked: false },
    ],
    backLayers: surfaceMode === 'symmetric'
        ? [{ id: 'B3', material: 'TiO2', thickness: 30 }, { id: 'B2', material: 'SiO2', thickness: 90 }, { id: 'B1', material: 'TiO2', thickness: 40 }]
        : [],
    surfaceMode,
});

function runScan(surfaceMode) {
    return scanNeedlesPFunction({ operands: ops, design: mkDesign(surfaceMode), resolveMat, candidateMats: POOL, deltaNm: 0.5, nIntra: 8, side: 'front' });
}

for (const mode of ['front_only', 'symmetric']) {
    setTmmWasmEnabled(false);
    const js = runScan(mode);
    await initTmmWasmMainThread(readFileSync(wasmPath), true);
    ok(tmmWasmActive(), `${mode}: wasm active`);
    const w = runScan(mode);

    ok(js.candidates.length === w.candidates.length, `${mode}: candidate count (${js.candidates.length} vs ${w.candidates.length})`);
    ok(Math.abs(js.mf0 - w.mf0) < 1e-12, `${mode}: mf0 Δ=${Math.abs(js.mf0 - w.mf0).toExponential(2)}`);
    let maxG = 0;
    const n = Math.min(js.candidates.length, w.candidates.length);
    for (let i = 0; i < n; i++) maxG = Math.max(maxG, Math.abs(js.candidates[i].grad - w.candidates[i].grad));
    ok(maxG < 1e-10, `${mode}: max |Δ grad| = ${maxG.toExponential(2)} (<1e-10)`);
    console.log(`  ${mode}: ${n} candidates, max|Δgrad|=${maxG.toExponential(2)}, mf0Δ=${Math.abs(js.mf0 - w.mf0).toExponential(2)}`);
    setTmmWasmEnabled(false);
}

if (fails === 0) { console.log('\nPASS — WASM needle scan matches JS through scanNeedlesPFunction.'); process.exit(0); }
else { console.error(`\n${fails} assertion(s) FAILED.`); process.exit(1); }
