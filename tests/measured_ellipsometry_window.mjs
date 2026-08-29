/**
 * The Measured Ellipsometry window, and the line it draws between an
 * ellipsometric measurement and a photometric one.
 *
 * Ψ/Δ and R/T are imported by different windows from different instruments and
 * are kept in different lists on the design. The tests here hold that line: a
 * spectrum must never reach an ellipsometric fit, and a Ψ/Δ pair must never
 * appear among the spectra.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await loadApp();
await initWasmForTest();

const [
    { MeasuredEllipsometry },
    model,
    nkModel,
    { makeMeasuredCurve },
    { WINDOW_REGISTRY },
] = await Promise.all([
    import('../src/components/windows/dataExchange/measuredEllipsometry/MeasuredEllipsometry.js'),
    import('../src/components/windows/dataExchange/measuredEllipsometry/model.js'),
    import('../src/components/windows/dataExchange/nkCharacterization/model.js'),
    import('../src/utils/io/spectrumTable.js'),
    import('../src/components/docking/windowRegistry.js'),
]);

const c = makeTheme();
const t = makeLocale();

const lambdas = Array.from({ length: 40 }, (_, index) => 400 + index * 10);

function angular(quantity, aoi = 70, extra = {}) {
    return {
        ...makeMeasuredCurve({
            name: `${quantity} at ${aoi}`,
            x: lambdas,
            xUnit: 'nm',
            y: lambdas.map((lambda, index) => (quantity === 'PSI' ? 20 + index * 0.1 : 170 - index * 1.2)),
            quantity,
            aoi,
            pol: 'avg',
            side: 'front',
            ...extra,
        }),
        id: `${quantity}-${aoi}`,
    };
}

function photometric(quantity) {
    return {
        ...makeMeasuredCurve({
            name: quantity, x: lambdas, xUnit: 'nm',
            y: lambdas.map(() => 0.5), quantity, aoi: 0, pol: 'avg', side: 'front',
        }),
        id: `${quantity}-curve`,
    };
}

// ── The window is registered where the ribbon expects it ─────────────────────
{
    const entry = WINDOW_REGISTRY['measured-ellipsometry'];
    assert.ok(entry && entry.component, 'the window must be in the registry');
    assert.equal(entry.help, 'data-exchange/measured-ellipsometry');
    assert.equal(WINDOW_REGISTRY['nk-characterization'].help, 'data-exchange/nk-characterization',
        'n,k Characterization moved out of Design');
}

// ── An empty design says what the window is for ──────────────────────────────
{
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), makeSampleDesign()));
    assert.ok(html.includes(t.measuredEllipsometry.importTitle), 'the import panel must render');
    assert.ok(html.includes('Ψ') && html.includes('Δ'), 'the window must name both quantities');
}

// ── The angle is demanded up front ───────────────────────────────────────────
//
// A pair measured at normal incidence carries nothing about the film, and a
// file that states no angle is the ordinary way to arrive there, so the window
// says so before an import rather than after a failed fit.
{
    const design = { ...makeSampleDesign(), measuredEllipsometry: [] };
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), design));
    assert.ok(html.includes(t.measuredEllipsometry.aoiLabel), 'the angle field must be shown');
}

// ── Curves are grouped into the pairs a fit can use ──────────────────────────
{
    const pairs = model.curvePairs([
        angular('PSI', 70), angular('DEL', 70), angular('PSI', 65),
    ]);
    assert.equal(pairs.length, 2, 'two angles, two groups');
    const [at65, at70] = pairs;
    assert.equal(at65.aoi, 65);
    assert.ok(at65.psi && !at65.delta, 'the lone Ψ at 65° must read as incomplete');
    assert.ok(at70.psi && at70.delta, 'the pair at 70° must read as complete');
}

// ── The two measurements never mix ───────────────────────────────────────────
{
    const design = {
        ...makeSampleDesign(),
        measuredCurves: [photometric('T'), photometric('R')],
        measuredEllipsometry: [angular('PSI'), angular('DEL')],
    };

    const spectra = nkModel.characterizableCurves(design, 'photometry');
    const angles = nkModel.characterizableCurves(design, 'ellipsometry');
    assert.deepEqual(spectra.map(curve => curve.quantity), ['T', 'R']);
    assert.deepEqual(angles.map(curve => curve.quantity), ['PSI', 'DEL']);

    assert.equal(nkModel.curveById(design, 'T-curve', 'ellipsometry'), null,
        'a transmittance must not be reachable from an ellipsometric fit');
    assert.equal(nkModel.curveById(design, 'PSI-70', 'photometry'), null,
        'a Ψ curve must not be reachable from a photometric fit');

    assert.equal(model.ellipsometryCurves(design).length, 2);
    assert.ok(model.ellipsometryCurves(design).every(curve => curve.quantity !== 'T'),
        'the ellipsometry list holds no spectra');

    const defaults = nkModel.defaultCurveSelection(design);
    assert.equal(defaults.transmittanceId, 'T-curve');
    assert.equal(defaults.psiId, 'PSI-70');
}

// ── A design carrying only Ψ/Δ opens in the ellipsometric mode ───────────────
{
    const design = { ...makeSampleDesign(), measuredEllipsometry: [angular('PSI'), angular('DEL')] };
    assert.equal(nkModel.defaultMeasurementMode(design), 'ellipsometry');
    assert.equal(nkModel.defaultMeasurementMode(
        { ...makeSampleDesign(), measuredCurves: [photometric('T')] }), 'photometry');
}

// ── Columns are typed without being named ────────────────────────────────────
//
// A SpectraRay export names both of its data columns after the angle, so there
// is nothing to read. Ψ cannot leave 0-90°, which settles it whenever one
// column does and the other does not.
{
    const column = (name, values) => ({ name, values, quantity: null });
    const psi = [12, 30, 51.7, 44];
    const delta = [0.8, 190, 359.2, 120];

    assert.deepEqual(model.typeColumns([column('70.06 (1)', psi), column('70.06 (2)', delta)]),
        ['PSI', 'DEL'], 'the column that passes 90° is Δ');
    assert.deepEqual(model.typeColumns([column('70.06 (1)', delta), column('70.06 (2)', psi)]),
        ['DEL', 'PSI'], 'the order in the file does not decide it');
    assert.deepEqual(model.typeColumns([column('a', [-30, -60]), column('b', [12, 30])]),
        ['DEL', 'PSI'], 'a negative column cannot be Ψ');

    // Neither column settles it, so the order in the file stands.
    assert.deepEqual(model.typeColumns([column('a', [12, 30]), column('b', [40, 80])]),
        ['PSI', 'DEL']);

    // A column that names itself is taken at its word, whatever its values.
    assert.deepEqual(model.typeColumns([
        { name: 'Delta', values: delta, quantity: 'DEL' },
        { name: 'Psi', values: psi, quantity: 'PSI' },
    ]), ['DEL', 'PSI']);

    // Three untyped columns are not a Ψ/Δ pair, so nothing is assumed.
    assert.deepEqual(
        model.typeColumns([column('a', psi), column('b', delta), column('c', psi)]),
        [null, null, null]);
}

// ── A Δ column written as cos Δ is caught ────────────────────────────────────
{
    const cosDelta = { quantity: 'DEL', y: [0.99, 0.5, -0.02, -1] };
    assert.ok(model.looksLikeCosDelta(cosDelta), 'cos Δ must be flagged');
    assert.ok(!model.looksLikeCosDelta({ quantity: 'DEL', y: [170, 150, 0.5] }),
        'a Δ in degrees must not be flagged');
    assert.ok(!model.looksLikeCosDelta({ quantity: 'PSI', y: [0.5, -0.5] }),
        'only Δ carries this trap');
}

// ── A mode with no curves keeps the way back ─────────────────────────────────
//
// Switching to T/R on a design that only holds Ψ/Δ used to close the window
// down to a message, and the message replaced the control row that carries the
// button to switch back. The window has to stay whole until the design holds
// no measurement of either kind.
{
    const { NkCharacterization } = await import(
        '../src/components/windows/dataExchange/nkCharacterization/NkCharacterization.js');
    const nk = t.nkCharacterization;

    const onlyAngular = {
        ...makeSampleDesign(),
        measuredCurves: [],
        measuredEllipsometry: [angular('PSI'), angular('DEL')],
    };
    const render = design => renderToStaticMarkup(withDesign(
        React.createElement(NkCharacterization, { c, t, theme: c }), design));

    // The window opens in the mode the design has curves for, and both mode
    // buttons are on screen.
    const shown = render(onlyAngular);
    assert.ok(shown.includes(nk.photometry) && shown.includes(nk.ellipsometry),
        'both measurement modes must stay reachable');
    assert.ok(!shown.includes(nk.noCurves),
        'a design with a Ψ/Δ pair is not an empty one');

    // With no measurement at all, the bare message is right.
    const empty = render({ ...makeSampleDesign(), measuredCurves: [], measuredEllipsometry: [] });
    assert.ok(empty.includes(nk.noCurves), 'an empty design says where to import');
    assert.ok(!empty.includes(nk.photometry), 'and offers no modes to switch between');
}

// ── Measured Ψ/Δ export as degrees, never as a percentage ────────────────────
{
    const design = { ...makeSampleDesign(), name: 'witness' };
    const { text, fileName } = model.measuredDocument(design, {
        curves: [angular('PSI'), angular('DEL')],
    });
    assert.ok(fileName.endsWith('.csv'));
    const [header, first] = text.trim().split('\n');
    assert.ok(header.includes('Psi (deg)') && header.includes('Delta (deg)'), header);
    const values = first.split(',').map(Number);
    assert.equal(values[0], 400, 'first row is the first wavelength');
    assert.ok(Math.abs(values[1] - 20) < 1e-9, `Ψ must stay in degrees, got ${values[1]}`);
    assert.ok(Math.abs(values[2] - 170) < 1e-9, `Δ must stay in degrees, got ${values[2]}`);
}

// ── The calculated export writes Δ in the convention asked for ───────────────
{
    const design = makeSampleDesign();
    const options = {
        lambdaStart: 500, lambdaEnd: 520, lambdaStep: 10,
        thetaDeg: 70, side: 'front', xUnit: 'nm',
    };
    const read = (convention) => model.calculatedDocument(design, { ...options, deltaConvention: convention })
        .text.trim().split('\n').filter(line => !line.startsWith('#')).slice(1)
        .map(line => Number(line.split(',')[2]));

    const azzam = read('azzam');
    const reversed = read('reversed');
    assert.equal(azzam.length, 3, 'three wavelengths at a 10 nm step');
    azzam.forEach((value, index) => {
        const mirrored = ((360 - reversed[index]) % 360 + 360) % 360;
        assert.ok(Math.abs(value - mirrored) < 1e-9,
            `the two conventions must be reflections of each other: ${value} vs ${mirrored}`);
    });
}

// ── Every plot keeps its grid ────────────────────────────────────────────────
//
// Ψ owns the grid lines while both curves are drawn, because two sets of them
// read as neither. A hidden axis draws nothing, so a plot of Δ alone used to
// come out with no grid at all.
{
    const { buildEllipsometryOption } = await import(
        '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js');
    const data = { x: [400, 500], psi: [20, 21], delta: [170, 150], xLabel: 'λ' };
    const colors = { background: '#000', paper: '#111', grid: '#333', text: '#ccc' };
    const curve = { psi: '#4fc3f7', delta: '#ff8a65' };

    for (const show of [{ psi: true, delta: true }, { psi: true, delta: false },
        { psi: false, delta: true }]) {
        const option = buildEllipsometryOption(data, colors, curve, show);
        assert.ok(option.xAxis.splitLine.show, 'the vertical grid is always drawn');
        const gridding = option.yAxis.filter(axis => axis.show && axis.splitLine.show);
        assert.equal(gridding.length, 1,
            `exactly one visible axis must carry the grid for ${JSON.stringify(show)}, `
            + `got ${gridding.length}`);
    }
}

// ── The sample survives the trip to a worker unchanged ───────────────────────
//
// The extraction runs off the interface thread, which means the three materials
// cross as sampled tables instead of objects. The numbers have to be the same
// ones, or a result would depend on where it was computed.
{
    const [{ portableSample, sampleFromPortable }, { characterizeFilm }, { getMaterial },
        { filmSpectrum, constantFilm }] = await Promise.all([
        import('../src/utils/materials/characterization/portableSample.js'),
        import('../src/utils/materials/characterization/nkFit.js'),
        import('../src/utils/materials/materialDatabase.js'),
        import('../src/utils/materials/characterization/sampleSpectrum.js'),
    ]);
    const grid = Array.from({ length: 60 }, (_, index) => 420 + index * 8);
    const live = {
        incident: getMaterial('Air'), substrate: getMaterial('BK7'), exit: getMaterial('Air'),
        substrateThicknessMm: 1.0, geometry: 'slab',
    };
    const spectrum = filmSpectrum(
        { ...live, lambdas: grid, aoi: 0, pol: 'avg', side: 'front' }, constantFilm(2.25, 0), 300);
    const channels = ['T', 'R'].map(quantity => ({
        quantity, lambdas: grid, values: spectrum[quantity], aoi: 0, pol: 'avg', side: 'front',
    }));

    const request = { channels, indexModel: 'cauchy', thicknessNm: 280 };
    const here = characterizeFilm({ ...request, sample: live });
    const portable = portableSample(live, channels);
    const there = characterizeFilm({ ...request, sample: sampleFromPortable(portable) });

    assert.deepEqual(there.fit, here.fit, 'the fit must not depend on which thread ran it');
    assert.equal(there.thicknessNm, here.thicknessNm);
    assert.doesNotThrow(() => structuredClone(portable),
        'the request has to survive a postMessage');
    assert.doesNotThrow(() => structuredClone(there),
        'so does the result on the way back');
}

console.log('PASS: measured_ellipsometry_window');
