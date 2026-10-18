/**
 * The step at which the Specification window and the report search a band.
 *
 *   1. A check asked for SPECIFICATION_FLAG reads the merit row at that flag,
 *      and without a flag the row at the default one. On two coupled-cavity
 *      peaks 1.9 nm apart the fine step finds the higher peak, which the
 *      default step reads as the lower.
 *   2. FWHM and Edge λ find each crossing by bisection between the scan's
 *      samples, so the width of a 0.36 nm resonance is exact at the default
 *      step, at the monitors' and at the fine one; the step decides only which
 *      peak's crossings are bracketed.
 *   3. The analysis worker gives each design's results at the flag asked for,
 *      and null for a design whose material resolves nowhere.
 *   4. The report prints the results it is handed and evaluates the checks
 *      itself without them.
 *
 * Run: node tests/specification_step.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

shimBrowserGlobals();
await loadApp();
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { evaluateQualifiers, makeQualifier, SPECIFICATION_FLAG } = await import('../src/utils/synthesis/qualifiers.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { fabryPerot, coupled, COUPLED_BAND, row, check, trueFwhm, T } = await import('./_peakDesigns.mjs');

const fine = { flag: SPECIFICATION_FLAG };

// ── 1. A check reads the merit row at its flag ───────────────────────────────
{
    const { lambdaStart: a, lambdaEnd: b } = COUPLED_BAND;
    const peak = { kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, ...COUPLED_BAND };
    const centre = { kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max', cmp: 'eq', target: 557, ...COUPLED_BAND };
    const atFine = check(coupled, peak, fine).value;
    const atDefault = check(coupled, peak).value;
    assert.equal(atFine, row(coupled, 'TMX', a, b, SPECIFICATION_FLAG), 'the band maximum is the TMX row at the fine flag');
    assert.equal(atDefault, row(coupled, 'TMX', a, b), 'and without a flag the row at the default one');
    assert.ok(atFine > 0.97 && atDefault < 0.8, `the fine step reads the higher peak, ${atFine}, the default the lower, ${atDefault}`);
    const centreFine = check(coupled, centre, fine).value;
    assert.equal(centreFine, row(coupled, 'MXWT', a, b, SPECIFICATION_FLAG), 'the central wavelength is the MXWT row at the fine flag');
    assert.ok(Math.abs(centreFine - 556.9) < 0.01, `at the higher peak: ${centreFine} nm`);
}

// ── 2. FWHM and edge crossings are exact at any step ─────────────────────────
{
    const top = row(fabryPerot, 'MXWT', 540, 580, SPECIFICATION_FLAG);
    const width = trueFwhm(fabryPerot, top);
    const band = { channel: 'T', direction: 'max', cmp: 'ge', target: 0, lambdaStart: 540, lambdaEnd: 580 };
    // Reading each crossing off the straight line between the two scan samples
    // around it would put this width 7.5e-3 nm out with 301 samples and
    // 1.0e-2 nm at 0.1 nm.
    // The bisection reference starts from a peak found at a different step, a
    // few 1e-7 nm away, which moves the half height by far less than 1e-9.
    for (const options of [{}, { flag: 2 }, fine]) {
        const label = options.flag ? `flag ${options.flag}` : 'the default step';
        const got = check(fabryPerot, { ...band, kind: 'FWHM' }, options).value;
        assert.ok(Math.abs(got - width) < 1e-9, `FWHM at ${label}: ${got} nm against ${width} nm`);
        const half = T(fabryPerot, top) / 2;
        for (const edgeSide of ['left', 'right']) {
            const edge = check(fabryPerot, { ...band, kind: 'EDGE_LAMBDA', edgeSide }, options).value;
            assert.ok(Math.abs(T(fabryPerot, edge) - half) < 1e-9, `the ${edgeSide} edge at ${label} sits on the half height`);
        }
    }
}

// ── 3. The worker evaluates each design at the flag asked for ────────────────
const specified = { ...coupled, qualifiers: [makeQualifier({
    kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, ...COUPLED_BAND,
})] };
{
    const missing = { ...specified, frontLayers: [{ id: 'x', material: 'user:nowhere', thickness: 50, locked: false }] };
    const [found, none] = dispatchAnalysisEvaluation('specification', { designs: [specified, missing], flag: SPECIFICATION_FLAG });
    assert.deepEqual(found, evaluateQualifiers(specified.qualifiers, specified, designMaterialLookup(specified), fine),
        'the worker gives the results at the flag it is sent');
    assert.equal(none, null, 'and null for a design it cannot evaluate');
}

// ── 4. The report prints the results it is handed ───────────────────────────
{
    const blocks = [newBlock('qualifiers')];
    const id = blocks[0].id;
    const given = evaluateQualifiers(specified.qualifiers, specified, designMaterialLookup(specified), fine);
    const handed = gatherDesignData(specified, blocks, { specification: () => given });
    assert.equal(handed.blocks[id].results, given, 'the report prints the results it is handed');
    const own = gatherDesignData(specified, blocks, {});
    assert.deepEqual(own.blocks[id].results, evaluateQualifiers(specified.qualifiers, specified, designMaterialLookup(specified)),
        'and evaluates the checks at the default step without them');
}

console.log('PASS: specification_step');
