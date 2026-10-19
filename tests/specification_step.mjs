/**
 * The step at which the Specification window and the report search a band.
 *
 *   1. A peak or centre check searches at its own Step, which Generate MF
 *      writes on the row it makes, so the check and that row read one number.
 *      On two coupled-cavity peaks 1.9 nm apart a Step of 0.01 nm finds the
 *      higher peak, which the default 1 nm reads as the lower. The worker's
 *      FWHM and edge step leaves it alone, a first pass (coarse) searches at
 *      1 nm, and a check whose row looks for a dip takes no Step.
 *   2. FWHM and Edge λ find each crossing by bisection between the scan's
 *      samples, so the width of a 0.36 nm resonance is exact at the default
 *      step, at the monitors' and at the fine one; the step decides only which
 *      peak's crossings are bracketed. The walk out from the peak reads only
 *      the scan samples it passes.
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
const {
    evaluateQualifier, evaluateQualifiers, makeQualifier, SPECIFICATION_FLAG,
    qualifiersToMFOperands, rowValue, checkTakesStep,
} = await import('../src/utils/synthesis/qualifiers.js');
const { buildEvalContext } = await import('../src/utils/physics/optimizer.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { fabryPerot, coupled, COUPLED_BAND, row, check, trueFwhm, T } = await import('./_peakDesigns.mjs');

const fine = { flag: SPECIFICATION_FLAG };

// ── 1. A peak or centre check searches at its own Step ───────────────────────
{
    const { lambdaStart: a, lambdaEnd: b } = COUPLED_BAND;
    const peak = { kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, ...COUPLED_BAND };
    const centre = { kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max', cmp: 'eq', target: 557, ...COUPLED_BAND };
    const finePeak = { ...peak, flag: SPECIFICATION_FLAG };
    const atFine = check(coupled, finePeak).value;
    const atDefault = check(coupled, peak).value;
    assert.equal(atFine, row(coupled, 'TMX', a, b, SPECIFICATION_FLAG), 'a check with a 0.01 nm Step reads the TMX row at that flag');
    assert.equal(atDefault, row(coupled, 'TMX', a, b), 'and one without a Step the row at the default');
    assert.ok(atFine > 0.97 && atDefault < 0.8, `0.01 nm reads the higher peak, ${atFine}, 1 nm the lower, ${atDefault}`);
    assert.equal(check(coupled, peak, fine).value, atDefault, 'the worker\'s FWHM and edge step leaves a peak check at its own Step');
    assert.equal(check(coupled, finePeak, { coarse: true }).value, atDefault, 'a first pass searches it at the default');
    const fineCentre = { ...centre, flag: SPECIFICATION_FLAG };
    const centreFine = check(coupled, fineCentre).value;
    assert.equal(centreFine, row(coupled, 'MXWT', a, b, SPECIFICATION_FLAG), 'the central wavelength is the MXWT row at the check\'s Step');
    assert.ok(Math.abs(centreFine - 556.9) < 0.01, `at the higher peak: ${centreFine} nm`);

    // Generate MF writes the Step on the row it makes, which reads the check's value.
    const ctx = buildEvalContext(coupled, designMaterialLookup(coupled));
    for (const [fields, value] of [[finePeak, atFine], [peak, atDefault], [fineCentre, centreFine]]) {
        const [base] = qualifiersToMFOperands([makeQualifier(fields)]);
        assert.equal(base.flag, fields.flag, `${base.type} carries the check's Step`);
        assert.equal(rowValue(base, ctx), value, `${base.type} at ${fields.flag ?? 'no'} flag reads the check's value`);
    }
    // A row that looks for a dip searches the fringe grid whatever its flag,
    // so a dip check takes no Step and its row gets none.
    const dip = makeQualifier({ ...peak, direction: 'min', flag: SPECIFICATION_FLAG });
    const [dipRow] = qualifiersToMFOperands([dip]);
    assert.ok(dipRow.type === 'TMN' && dipRow.flag === undefined, 'a dip check writes its row without a Step');
    assert.ok(checkTakesStep(makeQualifier(peak)) && checkTakesStep(makeQualifier(centre)) && !checkTakesStep(dip),
        'the window offers a Step on peak and centre checks, not on a dip');
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

// ── 2b. The walk reads only the samples it passes ────────────────────────────
// The wavelengths the materials are read at, counted: a FWHM check reads those
// of its peak search, which a central-wavelength check on the band reads too,
// and the few samples and bisection steps around its two crossings, far fewer
// than its scan's 301 samples.
{
    const readsOf = kind => {
        const resolve = designMaterialLookup(fabryPerot);
        const seen = new Set();
        const counting = id => {
            const material = resolve(id);
            return new Proxy(material, {
                get(target, key) {
                    if (key === 'getNK') return lam => { seen.add(lam); return target.getNK(lam); };
                    const value = target[key];
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        };
        const fields = { kind, channel: 'T', direction: 'max', cmp: 'ge', target: 0, lambdaStart: 540, lambdaEnd: 580 };
        evaluateQualifier(makeQualifier(fields), fabryPerot, counting);
        return seen.size;
    };
    const extra = readsOf('FWHM') - readsOf('CENTRAL_LAMBDA');
    assert.ok(extra < 301, `the FWHM check reads ${extra} wavelengths beyond its peak search, not the whole scan`);
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
