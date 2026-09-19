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
    loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
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
    { measuredEllipsometrySession, measuredEllipsometryView },
    { spectrumExchangeSession },
    { DesignContext },
] = await Promise.all([
    import('../src/components/windows/dataExchange/measuredEllipsometry/MeasuredEllipsometry.js'),
    import('../src/components/windows/dataExchange/measuredEllipsometry/model.js'),
    import('../src/components/windows/dataExchange/nkCharacterization/model.js'),
    import('../src/utils/io/spectrumTable.js'),
    import('../src/components/docking/windowRegistry.js'),
    import('../src/components/windows/dataExchange/measuredEllipsometry/sessionState.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/sessionState.js'),
    import('../src/state/DesignContext.js'),
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

// ── The angle is asked for only when the file does not state it ──────────────
//
// A pair measured at normal incidence carries nothing about the film, and a
// file that states no angle is the ordinary way to arrive there. The angle
// field sits with the column being configured and covers every column the file
// leaves without one, because "Add all typed columns" adds those too: a
// CompleteEASE export names one per column and asks nothing. Before a file is
// open there is nothing to ask about.
{
    const mx = t.measuredEllipsometry;
    const design = { ...makeSampleDesign(), measuredEllipsometry: [] };
    const render = () => renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), design));
    assert.ok(!render().includes(mx.aoiLabel), 'no file, no angle field');

    const column = (name, aoi) => ({
        name, values: [20, 21], quantity: 'PSI', ...(aoi == null ? {} : { aoi }),
    });
    const parsed = { ok: true, nRows: 2, x: [400, 500], xUnit: 'nm', columns: [column('Psi')], aoi: null, aois: [] };
    measuredEllipsometrySession.write(design, { parsed, fileName: 'bare.txt', colIdx: 0, ov: {} }, null);
    assert.ok(render().includes(mx.aoiLabel), 'a column without an angle asks for one');
    assert.ok(!render().includes(mx.sideLabel),
        'a design coated on one face has no side to tell a measurement apart by');

    measuredEllipsometrySession.write(design, {
        parsed: { ...parsed, columns: [column('Psi @45°', 45)], aoi: 45, aois: [45] },
    }, null);
    assert.ok(!render().includes(mx.aoiLabel), 'a column with its angle from the file asks nothing');

    // The selected column states its angle, the other does not, and "Add all"
    // would add both: the angle the second one takes has to be on screen.
    measuredEllipsometrySession.write(design, {
        parsed: { ...parsed, columns: [column('Psi @45°', 45), column('Delta')], aoi: null, aois: [45] },
        colIdx: 0,
    }, null);
    assert.ok(render().includes(mx.aoiLabel), 'a column left without an angle asks for one');
    measuredEllipsometrySession.reset(design);

    // A coating on each face makes the side a real question.
    const twoSided = { ...design, backLayers: [{ id: 'b1', material: 'builtin:SiO2', thickness: 100 }] };
    measuredEllipsometrySession.write(twoSided, { parsed, fileName: 'bare.txt', colIdx: 0, ov: {} }, null);
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), twoSided));
    assert.ok(html.includes(mx.sideLabel), 'with a back coating the side is asked');
    measuredEllipsometrySession.reset(twoSided);
}

// ── With no design selected there is nothing to import into ──────────────────
//
// Without a design from the explorer the provider shows a placeholder that
// nothing keeps. A file opened then used to look imported and vanish when a
// design was selected.
{
    const mx = t.measuredEllipsometry;
    const value = { ...makeDesignCtx(makeSampleDesign()), hasActiveDesign: false };
    const html = renderToStaticMarkup(React.createElement(DesignContext.Provider, { value },
        React.createElement(MeasuredEllipsometry, { c, t, theme: c })));
    assert.ok(html.includes(mx.noDesign), 'the window says a design is needed');
    assert.ok(!html.includes(mx.importHint), 'and does not invite an import');
    assert.ok(/<button[^>]*disabled=""[^>]*>[^<]*Open file/.test(html), 'the file button is off');
}

// ── An opened file belongs to the design it was opened for ───────────────────
{
    const a = { ...makeSampleDesign(), id: 'design-a' };
    const b = { ...makeSampleDesign(), id: 'design-b' };
    for (const session of [measuredEllipsometrySession, spectrumExchangeSession]) {
        session.write(a, { fileName: 'a.txt', parsed: { ok: true, nRows: 1, x: [500], columns: [] } }, null);
        assert.equal(session.read(b, null).parsed, null, 'the other design is not offered the file');
        assert.equal(session.read(a, null).fileName, 'a.txt', 'the design it was opened for keeps it');
        session.reset(a);
        session.reset(b);
    }
}

// ── The stores stay readable without a browser ──────────────────────────────
//
// A session store is plain data, and windowSession.js defers every React read
// so a store definition can be imported from a plain Node script. Reaching into
// the window chrome for a default value would undo that: those modules read the
// React global as they load.
{
    const { execFileSync } = await import('node:child_process');
    for (const window_ of ['measuredEllipsometry', 'spectrumExchange']) {
        const target = new URL(
            `../src/components/windows/dataExchange/${window_}/sessionState.js`, import.meta.url).href;
        try {
            execFileSync(process.execPath,
                ['--input-type=module', '-e', `await import(${JSON.stringify(target)})`],
                { stdio: 'pipe' });
        } catch (err) {
            assert.fail(`${window_}/sessionState.js needs a browser to load: ${err.stderr}`);
        }
    }
}

// ── Each curve is one card, and fits on its own ──────────────────────────────
//
// Ψ alone determines the thicknesses of a known stack over a spectral range,
// and a Δ taken at another angle is another target, so nothing pairs the
// curves up: a lone Ψ at 70° has its Fit button like the others.
{
    const mx = t.measuredEllipsometry;
    const design = {
        ...makeSampleDesign(),
        measuredEllipsometry: [angular('PSI', 65), angular('DEL', 65), angular('PSI', 70)],
    };
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), design));
    assert.equal(html.split(`>${mx.fit}<`).length - 1, 3, 'one fit button per curve');
    assert.equal(html.split(mx.deltaAzzam).length - 1, 1, 'the Δ sign is shown on the Δ card only');
    assert.ok(html.includes(mx.points(40, 400, 790)), 'a card states its extent');
}

// ── The export's Δ sign is chosen beside the button ──────────────────────────
{
    const mx = t.measuredEllipsometry;
    const design = { ...makeSampleDesign(), measuredEllipsometry: [] };
    measuredEllipsometryView.write(design, { tab: 'export', expSource: 'calculated' }, null);
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), design));
    assert.ok(html.includes(mx.deltaConventionLabel) && html.includes(mx.deltaReversed),
        'the calculated export offers both signs');
    measuredEllipsometryView.reset();
}

// ── The export's sign is its own, and so is the window's arrangement ─────────
//
// The sign the calculated export writes Δ in is the one the instrument's
// software reads. It is a different question from the sign an opened file was
// written in, which every imported Δ is stamped with, so choosing one must not
// answer the other. Neither of them, nor the divider or the export grid, means
// anything about a particular design.
{
    const design = { ...makeSampleDesign(), id: 'design-a', measuredEllipsometry: [] };
    const other = { ...makeSampleDesign(), id: 'design-b', measuredEllipsometry: [] };

    measuredEllipsometryView.write(design, { expDeltaConvention: 'reversed', panelWidth: 520 }, null);
    assert.equal(measuredEllipsometrySession.read(design, null).deltaConvention, 'azzam',
        'the export sign does not reach the sign a file is read under');

    measuredEllipsometrySession.write(design, { deltaConvention: 'reversed' }, null);
    measuredEllipsometrySession.write(other, { deltaConvention: 'azzam' }, null);
    assert.equal(measuredEllipsometrySession.read(design, null).deltaConvention, 'reversed',
        'each design keeps the sign its own file was read under');

    const elsewhere = measuredEllipsometryView.read(other, null);
    assert.equal(elsewhere.panelWidth, 520, 'the divider stays where it was put');
    assert.equal(elsewhere.expDeltaConvention, 'reversed', 'and so does the export sign');
    measuredEllipsometryView.reset();
    measuredEllipsometrySession.reset(design);
    measuredEllipsometrySession.reset(other);
}

// ── A curve on the back face keeps the control that put it there ─────────────
//
// The side is worth asking about only on a design coated on each face, but a
// curve already marked as the back one is refused by the fit, so the control
// has to stay on that card whatever the design now carries.
{
    const mx = t.measuredEllipsometry;
    const design = {
        ...makeSampleDesign(),
        measuredEllipsometry: [angular('PSI', 70, { side: 'back' })],
    };
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), design));
    assert.ok(html.includes(mx.sideLabel), 'the back-side curve can be put back on the front');
}

// ── A restored spectrum carries no side ──────────────────────────────────────
//
// A measurement is taken with the coated face toward the beam, so only an
// ellipsometric block names a face and only its curve gets one back.
{
    const { curveFromFitBlock } = await import(
        '../src/components/windows/dataExchange/fitTargetCurves.js');
    const block = {
        type: 'MCURVE', curveName: 'R', quantity: 'R', aoi: 8, pol: 'avg',
        sampleLambdas: [500, 600], sampleTargets: [0.2, 0.3],
    };
    assert.equal(curveFromFitBlock(block).side, undefined, 'a spectrum has no side to restore');
    assert.equal(curveFromFitBlock({ ...block, quantity: 'PSI', side: 'back' }).side, 'back',
        'an ellipsometric block names the face it was measured on');
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
    const data = { x: [400, 500], psi: [20, 21], delta: [170, 150] };
    const colors = { background: '#000', paper: '#111', grid: '#333', text: '#ccc' };
    const curve = { psi: '#4fc3f7', delta: '#ff8a65' };

    for (const show of [{ psi: true, delta: true }, { psi: true, delta: false },
        { psi: false, delta: true }]) {
        const option = buildEllipsometryOption(data, colors, 'λ (nm)', { curve, show });
        assert.ok(option.xAxis.splitLine.show, 'the vertical grid is always drawn');
        const gridding = option.yAxis.filter(axis => axis.show && axis.splitLine.show);
        assert.equal(gridding.length, 1,
            `exactly one visible axis must carry the grid for ${JSON.stringify(show)}, `
            + `got ${gridding.length}`);
    }

    // Δ is drawn on a 0 to 360° axis. CompleteEASE writes it in -90 to 270°,
    // so a reading of -12° has to land at 348° and not below the axis. A curve
    // that runs past the top of the axis comes back at the bottom, the way the
    // design's own Δ does.
    const overlays = [
        { name: 'm', aoi: 75, psi: false, x: [400, 500], y: [-12, 8] },
        { name: 'm', aoi: 75, psi: true, x: [400, 500], y: [20, 21] },
    ];
    const option = buildEllipsometryOption(data, colors, 'λ (nm)', { curve, overlays });
    const [measuredDelta, measuredPsi] = option.series.slice(2);
    assert.deepEqual(measuredDelta.data, [[400, 348], [500, 8]], 'Δ moved onto its axis');
    assert.deepEqual(measuredPsi.data.map(point => point[1]), [20, 21], 'Ψ untouched');
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
