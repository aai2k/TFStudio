/**
 * Design Cleaner, Re-optimize on a design coated on both sides: cleaning one
 * side leaves the other exactly as it was, thicknesses and locks included, and
 * the pass moves only the side that was cleaned.
 *
 * Run: node tests/design_cleaner_reoptimize_side.mjs
 */
import { readFileSync } from 'node:fs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { applyCleanup, computeCleanupPreview } = await import('../src/components/windows/optimization/designCleaner/model.js');
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const dc = { appliedMsg: () => '', mfRefineMsg: () => '' };
const settings = { reoptimize: true, reoptIters: 40, dMin: 5, inWorker: false };

const stack = (tag, thicknesses) => thicknesses.map((thickness, i) => ({
    id: `${tag}${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false,
}));
const design = {
    id: 'cleaner-two-sided', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 }, surfaceMode: 'both_independent', mfEvalMode: 'total',
    frontLayers: stack('f', [60, 90, 40, 80]),
    backLayers: stack('b', [2, 70, 55, 95]),
    meritOperands: [makeOperand({ type: 'TGT', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 })],
};
const resolveMat = designMaterialLookup(design);
const sameLayers = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const [side, kept, cleaned] of [['back', 'frontLayers', 'backLayers'], ['front', 'backLayers', 'frontLayers']]) {
    const source = side === 'front'
        ? { ...design, frontLayers: stack('f', [2, 60, 90, 40, 80]), backLayers: stack('b', [70, 55, 95]) }
        : design;
    const preview = computeCleanupPreview(source, { dMin: 5, mergeAdjacent: true, side });
    ok(preview.removedCount === 1, `${side}: the cleanup takes out the 2 nm layer`);
    const { nextDesign } = await applyCleanup(preview, source, dc, { ...settings, side }, resolveMat);
    ok(sameLayers(nextDesign[kept], source[kept]), `${side}: the side left alone is exactly as it was`);
    ok(!sameLayers(nextDesign[cleaned], preview.design[cleaned]), `${side}: the cleaned side is re-optimized`);
}

if (fails === 0) { console.log('PASS: design cleaner re-optimize holds the side not cleaned'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
