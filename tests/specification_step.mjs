/**
 * The Step a Specification check reads its band at.
 *
 *   1. A peak or centre check searches at its own Step, which Generate MF
 *      writes on the row it makes, so the check and that row read one number.
 *      On two coupled-cavity peaks 1.9 nm apart a Step of 0.01 nm finds the
 *      higher peak, which the default 1 nm reads as the lower. A first pass
 *      (coarse) searches at 1 nm, and a check whose row looks for a dip takes
 *      no Step.
 *   2. FWHM and Edge λ search their peak and scan their band at their own
 *      Step, and find each crossing by bisection between the scan's samples,
 *      so the width of a 0.36 nm resonance is exact at any Step; the Step
 *      decides only which peak's crossings are bracketed, and it is the peak a
 *      Central λ check at the same Step reads. The walk out from the peak reads
 *      only the scan samples it passes.
 *   3. An average or integral check reads its band on a grid no coarser than
 *      its Step, which Generate MF writes on its row: across a Fabry-Perot's
 *      pass band the fringe grid reads about half the average a 0.01 nm grid
 *      reads, and the check and its row agree at each.
 *   4. The analysis worker gives each design's results at the checks' own
 *      Steps, or at their defaults when asked for a first pass, and null for a
 *      design whose material resolves nowhere.
 *   5. The report prints the results it is handed and evaluates the checks
 *      itself at their default steps without them.
 *   6. A Monte Carlo trial reads a check at its own Step. The tolerance
 *      windows' badge shows its first pass, at the default step, marked ≈;
 *      its own-Step pass on the worker is tests/spec_verdict_worker.mjs.
 *
 * Run: node tests/specification_step.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

shimBrowserGlobals();
await loadApp();
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const {
    evaluateQualifier, evaluateQualifiers, makeQualifier,
    qualifiersToMFOperands, rowValue, checkStepKind,
} = await import('../src/utils/synthesis/qualifiers.js');
const { buildEvalContext, resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const { runErrorAnalysisMC } = await import('../src/utils/physics/errorAnalysis.js');
const { SpecVerdict } = await import('../src/components/SpecVerdict.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { fabryPerot, coupled, COUPLED_BAND, row, check, trueFwhm, T } = await import('./_peakDesigns.mjs');

// 0.01 nm, a Step finer than the default.
const FINE = 3;
const coarse = { coarse: true };

// The base row Generate MF writes for a check, and its value on `design`.
function generated(design, fields) {
    const rows = qualifiersToMFOperands([makeQualifier(fields)]);
    const base = rows.find(op => op.weight === 0) || rows[0];
    return { base, value: rowValue(base, buildEvalContext(design, designMaterialLookup(design))) };
}

// ── 1. A peak or centre check searches at its own Step ───────────────────────
{
    const { lambdaStart: a, lambdaEnd: b } = COUPLED_BAND;
    const peak = { kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, ...COUPLED_BAND };
    const centre = { kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max', cmp: 'eq', target: 557, ...COUPLED_BAND };
    const finePeak = { ...peak, flag: FINE };
    const atFine = check(coupled, finePeak).value;
    const atDefault = check(coupled, peak).value;
    assert.equal(atFine, row(coupled, 'TMX', a, b, FINE), 'a check with a 0.01 nm Step reads the TMX row at that flag');
    assert.equal(atDefault, row(coupled, 'TMX', a, b), 'and one without a Step the row at the default');
    assert.ok(atFine > 0.97 && atDefault < 0.8, `0.01 nm reads the higher peak, ${atFine}, 1 nm the lower, ${atDefault}`);
    assert.equal(check(coupled, finePeak, coarse).value, atDefault, 'a first pass searches it at the default');
    const fineCentre = { ...centre, flag: FINE };
    const centreFine = check(coupled, fineCentre).value;
    assert.equal(centreFine, row(coupled, 'MXWT', a, b, FINE), 'the central wavelength is the MXWT row at the check\'s Step');
    assert.ok(Math.abs(centreFine - 556.9) < 0.01, `at the higher peak: ${centreFine} nm`);
    assert.equal(check(coupled, fineCentre, coarse).value, row(coupled, 'MXWT', a, b), 'a first pass searches a centre at the default');

    // Generate MF writes the Step on the row it makes, which reads the check's value.
    for (const [fields, value] of [[finePeak, atFine], [peak, atDefault], [fineCentre, centreFine]]) {
        const { base, value: written } = generated(coupled, fields);
        assert.equal(base.flag, fields.flag, `${base.type} carries the check's Step`);
        assert.equal(written, value, `${base.type} at ${fields.flag ?? 'no'} flag reads the check's value`);
    }
    // A row that looks for a dip searches the fringe grid whatever its flag,
    // so a dip check takes no Step and its row gets none.
    const dip = { ...peak, direction: 'min', flag: FINE };
    assert.ok(generated(coupled, dip).base.type === 'TMN' && generated(coupled, dip).base.flag === undefined,
        'a dip check writes its row without a Step');
    assert.equal(checkStepKind(makeQualifier(peak)), 'peak');
    assert.equal(checkStepKind(makeQualifier(centre)), 'peak');
    assert.equal(checkStepKind(makeQualifier(dip)), null, 'a dip check has no Step to set');
}

// ── 2. FWHM and edge checks scan at their own Step ───────────────────────────
{
    const top = row(fabryPerot, 'MXWT', 540, 580, FINE);
    const width = trueFwhm(fabryPerot, top);
    const band = { channel: 'T', direction: 'max', cmp: 'ge', target: 0, lambdaStart: 540, lambdaEnd: 580 };
    // Reading each crossing off the straight line between the two scan samples
    // around it would put this width 7.5e-3 nm out with 301 samples and
    // 1.0e-2 nm at 0.1 nm.
    // The bisection reference starts from a peak found at a different step, a
    // few 1e-7 nm away, which moves the half height by far less than 1e-9.
    for (const flag of [undefined, 2, FINE]) {
        const label = flag ? `Step ${flag}` : 'the default Step';
        const got = check(fabryPerot, { ...band, kind: 'FWHM', flag }).value;
        assert.ok(Math.abs(got - width) < 1e-9, `FWHM at ${label}: ${got} nm against ${width} nm`);
        const half = T(fabryPerot, top) / 2;
        for (const edgeSide of ['left', 'right']) {
            const edge = check(fabryPerot, { ...band, kind: 'EDGE_LAMBDA', edgeSide, flag }).value;
            assert.ok(Math.abs(T(fabryPerot, edge) - half) < 1e-9, `the ${edgeSide} edge at ${label} sits on the half height`);
        }
    }
    // On the coupled cavities the Step decides which peak is found: at each one
    // the FWHM's edges sit either side of the centre a Central λ check reads.
    const coupledBand = { channel: 'T', direction: 'max', cmp: 'ge', target: 0, ...COUPLED_BAND };
    for (const flag of [undefined, FINE]) {
        const centre = check(coupled, { ...coupledBand, kind: 'CENTRAL_LAMBDA', flag }).value;
        const left = check(coupled, { ...coupledBand, kind: 'EDGE_LAMBDA', edgeSide: 'left', flag }).value;
        const right = check(coupled, { ...coupledBand, kind: 'EDGE_LAMBDA', edgeSide: 'right', flag }).value;
        assert.ok(left < centre && centre < right, `at Step ${flag ?? 'default'} the edges ${left} and ${right} nm hold the centre ${centre} nm`);
    }
    for (const kind of ['FWHM', 'EDGE_LAMBDA']) assert.equal(checkStepKind(makeQualifier({ ...band, kind })), 'scan');
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

// ── 3. Average and integral checks read their grid at their Step ─────────────
{
    const band = { channel: 'T', cmp: 'ge', target: 0, lambdaStart: 500, lambdaEnd: 600 };
    for (const kind of ['T_AVG', 'INTEGRAL']) {
        const auto = check(fabryPerot, { ...band, kind }).value;
        const fine = check(fabryPerot, { ...band, kind, flag: FINE }).value;
        assert.ok(fine > 1.5 * auto, `${kind} on the fringe grid reads ${auto}, at 0.01 nm ${fine}`);
        assert.equal(check(fabryPerot, { ...band, kind, flag: FINE }, coarse).value, auto, `${kind}: a first pass reads the fringe grid`);
        for (const [flag, value] of [[undefined, auto], [FINE, fine]]) {
            const { base, value: written } = generated(fabryPerot, { ...band, kind, flag });
            assert.equal(base.flag, flag, `${kind}: the row carries the check's Step`);
            assert.equal(written, value, `${kind} at ${flag ?? 'no'} Step: the row reads the check's value`);
        }
        assert.equal(checkStepKind(makeQualifier({ ...band, kind })), 'band');
    }
    assert.equal(checkStepKind(makeQualifier({ kind: 'T_AT' })), null, 'a check at one wavelength has no Step');
}

// ── 4. The worker evaluates each design at the checks' own Steps ─────────────
const specified = { ...coupled, qualifiers: [makeQualifier({
    kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, flag: FINE, ...COUPLED_BAND,
})] };
{
    const resolve = designMaterialLookup(specified);
    const missing = { ...specified, frontLayers: [{ id: 'x', material: 'user:nowhere', thickness: 50, locked: false }] };
    const [found, none] = dispatchAnalysisEvaluation('specification', { designs: [specified, missing] });
    assert.deepEqual(found, evaluateQualifiers(specified.qualifiers, specified, resolve),
        'the worker gives the results at the checks\' own Steps');
    assert.ok(found[0].value > 0.97, 'the stepped check reads the higher peak there');
    assert.equal(none, null, 'and null for a design it cannot evaluate');
    const [first] = dispatchAnalysisEvaluation('specification', { designs: [specified], coarse: true });
    assert.deepEqual(first, evaluateQualifiers(specified.qualifiers, specified, resolve, coarse),
        'asked for a first pass, at their default steps');
    assert.ok(first[0].value < 0.8, 'where the stepped check reads the lower peak');
}

// ── 5. The report prints the results it is handed ───────────────────────────
{
    const resolve = designMaterialLookup(specified);
    const blocks = [newBlock('qualifiers')];
    const id = blocks[0].id;
    const given = evaluateQualifiers(specified.qualifiers, specified, resolve);
    const handed = gatherDesignData(specified, blocks, { specification: () => given });
    assert.equal(handed.blocks[id].results, given, 'the report prints the results it is handed');
    const own = gatherDesignData(specified, blocks, {});
    assert.deepEqual(own.blocks[id].results, evaluateQualifiers(specified.qualifiers, specified, resolve, coarse),
        'and evaluates the checks at their default steps without them');
}

// ── 6. Monte Carlo and the tolerance badge ──────────────────────────────────
{
    const resolve = designMaterialLookup(specified);
    // One trial with no error drawn: the design as it is.
    const run = await runErrorAnalysisMC(specified, { lambdaStart: 556, lambdaEnd: 557, lambdaStep: 1, theta: 0, polarization: 'avg' }, resolve, {
        char: 'T', evalMode: resolveEvalMode(specified), nTrials: 1, seed: 1, rmsAbsNm: 0, rmsRelPct: 0, rmsReN: 0, rmsImN: 0,
        evaluateSpec: true, qualifiers: specified.qualifiers, recordTrials: true,
    });
    const trialValue = run.trials[0].spec.results[0].value;
    assert.ok(trialValue > 0.97, `a Monte Carlo trial reads the stepped check at its own Step: ${trialValue}`);
    const t = makeLocale();
    const markup = renderToStaticMarkup(React.createElement(SpecVerdict, { design: specified, c: makeTheme(), t }));
    assert.ok(markup.includes(`≈ 1/1 ${t.specification.failSuffix}`) && markup.includes(t.specification.provisionalTip.slice(0, 20)),
        `the tolerance badge shows its first pass marked: ${markup.slice(0, 200)}`);
}

console.log('PASS: specification_step');
