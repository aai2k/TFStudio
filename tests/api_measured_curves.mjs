/**
 * Measured curves a design holds (src/api/measuredCurves.js), an ellipsometer
 * file read (src/api/ellipsometryFile.js), a Ψ or Δ curve compared
 * (measuredDifference) and a spectrum saved as JCAMP-DX, against the windows
 * of Measured Spectra and Measured Ellipsometry.
 *
 *   1. readEllipsometryFile gives the curves Measured Ellipsometry's Add all
 *      adds (useImportActions, driven as the window drives it) on the
 *      fixture's own measured export, two-column files each way round, a cos
 *      Δ file and the API's own Ψ/Δ CSV, whose # lines give the angle and
 *      side back; at the panel's opening settings and with each changed.
 *   2. addMeasuredCurves puts on the design what each window's Add puts on
 *      it, ids, file names and source units aside: R, T and A on the
 *      spectra, Ψ and Δ on the ellipsometry.
 *   3. fitMeasured adds the rows the Fit… dialogs' OK adds
 *      (measuredFitMeritOperands of the snapshot), on the corpus designs with
 *      no catalog and each option, and on the Ψ/Δ fixture, ids aside.
 *   4. exportMeasuredCurves writes what the Export tabs write
 *      (measuredExportDocument, measuredDocument), and readSpectrumFile reads
 *      the curves back; saveJcamp writes the Export tab's design JCAMP-DX on
 *      the corpus, read back as nine curves at each angle less A s and A p.
 *   5. measuredDifference on Ψ and Δ: rms is the Ψ/Δ block's merit row; the
 *      fixture's PSI and DEL rows read the design value it gives at 633 nm;
 *      a design against its own Ψ/Δ CSV differs by nothing; a fitted row's
 *      value equals measuredDifference with the same options.
 *   6. The objects: the methods give the plain calls' answers; refusals.
 *
 * Run: node tests/api_measured_curves.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const model = await import('../src/components/windows/dataExchange/spectrumExchange/model.js');
const eModel = await import('../src/components/windows/dataExchange/measuredEllipsometry/model.js');
const { ellipsometryFitSnapshot } = await import('../src/components/windows/dataExchange/measuredEllipsometry/fitModel.js');
const { computeOpticalSpectrum } = await import('../src/components/windows/analysis/opticalEvaluation/spectrum.js');
const { makeConeSpec, coneIsActive } = await import('../src/utils/physics/optimizer.js');
const { default: mainPaths } = await import('../src/main/paths.js');

shimBrowserGlobals();
await loadApp();
const { renderToStaticMarkup } = await import('react-dom/server');
const spectraImport = await import('../src/components/windows/dataExchange/spectrumExchange/importActions.js');
const ellipsometryImport = await import('../src/components/windows/dataExchange/measuredEllipsometry/importActions.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const t = makeLocale();
const tf = await objects.start();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-measured-curves-'));
const write = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return file; };
// A curve record as the API compares it: what the design computes and shows with, its id, file name and source unit aside.
const held = ({ id: _id, source: _s, xUnit: _x, yWasPercent: _p, ...curve }) => curve;
// A merit row without its id, which is drawn at random, and a block's link to its curve.
const rowOf = ({ id: _id, curveId: _c, ...row }) => row;

// ── 1. readEllipsometryFile against Measured Ellipsometry's Add all ─────
// What Add all puts on a design from `file`, the panel set as `panel` says
// after the file is read ({ aoi, side, deltaConvention, xUnit, quantities }).
async function ellipsometryAddAll(file, panel = {}) {
    const session = { aoi: 70, side: 'front', deltaConvention: 'azzam', xUnit: 'nm', ov: {} };
    const said = {};
    const props = {
        design: { measuredEllipsometry: [] }, checkpoint() {}, mx: t.measuredEllipsometry, setLoading() {}, clearStatus() {},
        flash() {}, updateDesign: patch => { said.update = patch; }, setField: (key, value) => { session[key] = value; },
    };
    let actions;
    const Probe = () => { actions = ellipsometryImport.useImportActions({ ...props, session: { ...session } }); return null; };
    renderToStaticMarkup(React.createElement(Probe));
    window.electronAPI = { spectrumPickFile: async () => ({ success: true, text: mainPaths.readTextAuto(file), fileName: path.basename(file) }) };
    await actions.onImport();
    Object.assign(session, {
        ...(panel.aoi !== undefined ? { aoi: panel.aoi } : {}), ...(panel.side ? { side: panel.side } : {}),
        ...(panel.deltaConvention ? { deltaConvention: panel.deltaConvention } : {}), ...(panel.xUnit ? { xUnit: panel.xUnit } : {}),
        ov: Object.fromEntries((panel.quantities || []).map((q, i) => [i, q ? { quantity: q } : {}])),
    });
    renderToStaticMarkup(React.createElement(Probe));
    actions.addCurves(actions.previewCurves.filter((_c, index) => !!actions.columnQuantity(index)));
    return said.update?.measuredEllipsometry ?? [];
}
const asEllipsometry = curve => ({
    name: curve.name, quantity: curve.quantity, angle: curve.aoi, side: curve.side,
    deltaConvention: curve.quantity === 'DEL' ? curve.deltaConvention : null, cosDelta: eModel.looksLikeCosDelta(curve),
    wavelength: curve.x, values: curve.y,
});

const fixture = api.openDesign(fixtureFile('measured-ellipsometry-psi-delta'));
const twoSided = { ...fixture, surfaceMode: 'both_independent', backLayers: fixture.frontLayers.map(layer => ({ ...layer, id: `${layer.id}b` })) };
const ownCsv = path.join(dir, 'own psi delta.csv');
new objects.Design(fixture).ellipsometry(400, 1000, { step: 20, angles: [65] }).saveCsv(ownCsv);
const FILES = {
    fixture: write('fixture measured.csv', eModel.measuredDocument(fixture, { curves: fixture.measuredEllipsometry }).text),
    psiFirst: write('psi first.txt', 'nm A B\n400 24.9 242.6\n500 20.7 218.4\n600 18.1 189.5\n'),
    deltaFirst: write('delta first.txt', 'nm A B\n400 242.6 24.9\n500 218.4 20.7\n600 189.5 18.1\n'),
    cosDelta: write('cos delta.csv', 'Wavelength (nm),Psi,Delta\n400,0.4,-0.6\n500,0.5,-0.2\n600,0.6,0.3\n'),
    own: ownCsv,
};
const readFiles = {};
for (const [key, file] of Object.entries(FILES)) {
    const read = api.readEllipsometryFile(file);
    readFiles[key] = read;
    ok(`${key}: readEllipsometryFile gives the curves Add all adds`, isDeepStrictEqual(read.curves, (await ellipsometryAddAll(file)).map(asEllipsometry)),
        JSON.stringify(read.curves.map(c => [c.name, c.quantity, c.angle, c.side])));
    const changed = { angle: 55, side: 'back', deltaConvention: 'reversed', xUnit: 'um', quantities: read.curves.length === 2 ? ['DEL', 'PSI'] : undefined };
    const panel = { aoi: 55, side: 'back', deltaConvention: 'reversed', xUnit: 'um', quantities: changed.quantities };
    ok(`${key}: and with every setting of the panel changed`, isDeepStrictEqual(api.readEllipsometryFile(file, Object.fromEntries(Object.entries(changed).filter(([, v]) => v))).curves,
        (await ellipsometryAddAll(file, panel)).map(asEllipsometry)));
}
ok('two columns are typed by their values either way round', readFiles.psiFirst.curves.map(c => c.quantity).join() === 'PSI,DEL'
    && readFiles.deltaFirst.curves.map(c => c.quantity).join() === 'DEL,PSI' && readFiles.psiFirst.curves[0].angle === 70);
ok('a Δ of cos Δ is flagged', readFiles.cosDelta.curves[1].cosDelta === true && readFiles.psiFirst.curves[1].cosDelta === false);
ok('the API\'s own Ψ/Δ CSV comes back at its angle and side, typed Ψ and Δ', readFiles.own.curves.map(c => [c.quantity, c.angle, c.side].join()).join(';') === 'PSI,65,front;DEL,65,front',
    JSON.stringify(readFiles.own.curves.map(c => [c.quantity, c.angle, c.side])));
{
    const back = path.join(dir, 'back.csv');
    new objects.Design({ ...fixture, surfaceMode: 'back_only', backLayers: fixture.frontLayers, frontLayers: [] }).ellipsometry(400, 600, { step: 100, angles: [70] }).saveCsv(back);
    ok('a back side\'s Ψ/Δ CSV says so', api.readEllipsometryFile(back).curves.every(c => c.side === 'back'), fs.readFileSync(back, 'utf8').split('\n').slice(0, 2).join(' | '));
    const several = path.join(dir, 'several.csv');
    new objects.Design(fixture).ellipsometry(400, 600, { step: 100, angles: [60, 70] }).saveCsv(several);
    ok('a CSV of several angles has no # lines', !fs.readFileSync(several, 'utf8').startsWith('#'));
}

// ── 2. addMeasuredCurves against the windows' Add ────────────────────────
async function spectraAdd(file) {
    const said = {};
    const props = {
        sx: t.spectrumExchange, design: { measuredCurves: [] }, checkpoint() {}, flash() {}, updateDesign: patch => { said.update = patch; },
        setLoading() {}, clearStatus() {}, setColIdx() {}, setOv() {}, setSelectedCurveId() {},
        setParsed: v => { said.parsed = v; }, setFileName: v => { said.fileName = v; }, setXUnit: v => { said.xUnit = v; },
        setAoi: v => { said.aoi = v; }, setPol: v => { said.pol = v; }, aoi: 0, pol: 'avg',
    };
    let actions;
    const Probe = ({ extra }) => { actions = spectraImport.useImportActions({ ...props, ...extra }); return null; };
    renderToStaticMarkup(React.createElement(Probe, { extra: {} }));
    window.electronAPI = { spectrumPickFile: async () => ({ success: true, text: mainPaths.readTextAuto(file), fileName: path.basename(file) }) };
    await actions.onImport();
    if (said.update) return said.update.measuredCurves;
    renderToStaticMarkup(React.createElement(Probe, {
        extra: { parsed: said.parsed, fileName: said.fileName, colIdx: 0, xUnit: said.xUnit, aoi: said.aoi ?? 0, pol: said.pol ?? 'avg', ov: {} },
    }));
    actions.onAdd();
    return said.update.measuredCurves;
}
const source = api.stackFromFormula(api.newDesign({ name: 'Scan source' }), { formula: '(HL)^3 H' });
const spectrumCsv = path.join(dir, 'source spectrum.csv');
new objects.Design(source).spectrum(400, 800, { step: 4, angles: [30] }).saveCsv(spectrumCsv);
const bench = {
    name: 'Bench scans',
    measuredCurves: [
        { id: 'a', name: 'T scan', quantity: 'T', x: [420, 470, 520, 570, 620, 670, 720], y: [0.62, 0.48, 0.71, 0.93, 0.88, 0.51, 0.66], aoi: 8, pol: 's' },
        { id: 'b', name: 'R scan', quantity: 'R', x: [420, 470, 520, 570, 620, 670, 720], y: [0.37, 0.5, 0.28, 0.06, 0.11, 0.47, 0.33], aoi: 8, pol: 's' },
    ],
};
const benchDx = write('bench.dx', model.measuredExportDocument(bench, 'jcamp').text);
for (const file of [spectrumCsv, benchDx]) {
    const added = api.addMeasuredCurves(api.newDesign(), api.readSpectrumFile(file).curves).measuredCurves;
    ok(`${path.basename(file)}: addMeasuredCurves puts on the design what Measured Spectra's Add puts on it`,
        isDeepStrictEqual(added.map(held), (await spectraAdd(file)).map(held)), JSON.stringify(added.map(held)[0]).slice(0, 200));
    ok(`${path.basename(file)}: each with an id of its own`, new Set(added.map(c => c.id)).size === added.length);
}
for (const key of ['fixture', 'deltaFirst']) {
    const design = api.addMeasuredCurves(api.newDesign(), readFiles[key].curves);
    ok(`${key}: addMeasuredCurves puts on the design what Measured Ellipsometry's Add all puts on it`,
        isDeepStrictEqual(design.measuredEllipsometry.map(held), (await ellipsometryAddAll(FILES[key])).map(held)) && design.measuredCurves === undefined);
}
{
    const mixed = api.addMeasuredCurves(source, [...api.readSpectrumFile(spectrumCsv).curves.slice(0, 2), ...readFiles.fixture.curves]);
    ok('R, T and A go on the spectra and Ψ and Δ on the ellipsometry, after what the design holds',
        mixed.measuredCurves.length === 2 && mixed.measuredEllipsometry.length === 2
        && api.addMeasuredCurves(mixed, readFiles.fixture.curves[0]).measuredEllipsometry.length === 3);
}

// ── 3. fitMeasured against the Fit… dialogs' OK ──────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, f]) => Object.keys(f.variants).join() === 'default').map(([name]) => name);
const designs = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]).filter(([, d]) => !thrown(() => api.spectrum(d, { from: 500, to: 501 })));
const scans = api.readSpectrumFile(spectrumCsv).curves.slice(0, 2);
const OPTIONS = [
    {}, { grid: 'thinned', thinEvery: 3, from: 450, to: 700 }, { grid: 'uniform', step: 5, weight: 2 }, { db: true, output: 'replace' },
    { constraints: { min: 20, max: 400, weight: 0.5 } }, { constraints: {} },
];
// The dialog's fields for the options `o`, as its OK reads them.
const dialogFields = o => ({
    ...(o.grid ? { mode: o.grid } : {}), ...(o.thinEvery ? { thinEvery: o.thinEvery } : {}), ...(o.step ? { stepNm: o.step } : {}),
    ...(o.from ? { rangeMin: o.from } : {}), ...(o.to ? { rangeMax: o.to } : {}), ...(o.db ? { scale: 'dB' } : {}),
    ...(o.weight !== undefined ? { weight: o.weight } : {}), ...(o.output ? { outputMode: o.output } : {}),
    ...(o.constraints ? { constraintsEnabled: true, minThicknessNm: o.constraints.min ?? 10, maxThicknessNm: o.constraints.max ?? 1000, constraintWeight: o.constraints.weight ?? 1 } : {}),
});
// The rows the dialog's OK leaves on `design` for its curve `curve`.
function dialogRows(design, curve, o, snapshotOf = model.measuredFitSnapshot) {
    const config = model.clampedFitRange(design, { ...model.defaultMeasuredFitOptions(curve), ...dialogFields(o) });
    return model.measuredFitMeritOperands(design.meritOperands, snapshotOf(design, curve, config).operand, config);
}
for (const [name, design] of designs) {
    const holding = api.addMeasuredCurves(design, scans);
    for (const [index, o] of OPTIONS.entries()) {
        const curve = holding.measuredCurves[holding.measuredCurves.length - 2 + (index % 2)];
        if (o.db && curve.quantity !== 'T') continue;
        const fitted = api.fitMeasured(holding, curve.name, o);
        const expected = dialogRows(holding, curve, o);
        ok(`${name} ${JSON.stringify(o)}: fitMeasured adds the rows the dialog's OK adds`, isDeepStrictEqual(fitted.meritOperands.map(rowOf), expected.map(rowOf)),
            JSON.stringify(fitted.meritOperands.map(rowOf).slice(-1)[0]).slice(0, 200));
        ok(`${name} ${JSON.stringify(o)}: the block points at its curve`, fitted.meritOperands.some(row => row.type === 'MCURVE' && row.curveId === curve.id));
    }
}
{
    const holding = api.addMeasuredCurves({ ...fixture, measuredEllipsometry: [] }, readFiles.fixture.curves);
    for (const [index, o] of [{}, { grid: 'uniform', step: 7 }, { grid: 'thinned', from: 450, to: 900, constraints: {} }].entries()) {
        const curve = holding.measuredEllipsometry[index % 2];
        const fitted = api.fitMeasured(holding, curve.name, o);
        ok(`Ψ/Δ fixture ${curve.quantity} ${JSON.stringify(o)}: fitMeasured adds the rows Measured Ellipsometry's dialog adds`,
            isDeepStrictEqual(fitted.meritOperands.map(rowOf), dialogRows(holding, curve, o, ellipsometryFitSnapshot).map(rowOf)));
    }
}

// ── 4. The files ─────────────────────────────────────────────────────────
{
    const holding = api.addMeasuredCurves(api.newDesign({ name: 'Bench' }), [...api.readSpectrumFile(benchDx).curves, ...readFiles.fixture.curves]);
    const cases = [
        [{}, model.measuredExportDocument(holding, 'csv', { curves: holding.measuredCurves })],
        [{ format: 'jcamp', xUnit: 'um', scale: 'fraction' }, model.measuredExportDocument(holding, 'jcamp', { curves: holding.measuredCurves, xUnit: 'um', asPercent: false })],
        [{ curves: ['R scan'], xUnit: 'cm-1' }, model.measuredExportDocument(holding, 'csv', { curves: [holding.measuredCurves[1]], xUnit: 'cm-1' })],
        [{ curves: holding.measuredEllipsometry.map(c => c.name), xUnit: 'eV' }, eModel.measuredDocument(holding, { curves: holding.measuredEllipsometry, xUnit: 'eV' })],
    ];
    for (const [index, [o, document]] of cases.entries()) {
        const file = path.join(dir, `export ${index}${o.format === 'jcamp' ? '.dx' : '.csv'}`);
        api.exportMeasuredCurves(holding, file, o);
        ok(`${JSON.stringify(o)}: exportMeasuredCurves writes what the Export tab writes`, fs.readFileSync(file, 'utf8') === document.text);
    }
    const back = api.readSpectrumFile(path.join(dir, 'export 0.csv')).curves;
    const sameCurve = (c, i) => {
        const held = holding.measuredCurves[i];
        return [c.angle, c.pol, c.quantity].join() === [held.aoi, held.pol, held.quantity].join() && c.values.every((v, k) => Math.abs(v - held.y[k]) < 1e-12);
    };
    ok('the CSV reads back as the curves, at their angle and polarization', back.length === 2 && back.every(sameCurve), JSON.stringify(back[0]));
    const eBack = api.readEllipsometryFile(path.join(dir, 'export 3.csv'), { xUnit: 'eV' }).curves;
    ok('the Ψ/Δ CSV reads back as the curves', eBack.map(c => c.quantity).join() === 'PSI,DEL'
        && eBack[0].values.every((v, k) => Math.abs(v - holding.measuredEllipsometry[0].y[k]) < 1e-9), JSON.stringify(eBack[0].values.slice(0, 3)));
    const only = api.addMeasuredCurves(api.newDesign({ name: 'Witness' }), readFiles.fixture.curves);
    const onlyFile = path.join(dir, 'only.csv');
    api.exportMeasuredCurves(only, onlyFile);
    ok('a design holding Ψ and Δ alone writes them without curves named', fs.readFileSync(onlyFile, 'utf8') === eModel.measuredDocument(only, { curves: only.measuredEllipsometry }).text);
}
for (const [name, design] of designs.filter(([, d]) => !coneIsActive(makeConeSpec(d.cone || {})))) {
    const file = path.join(dir, `${name}.dx`);
    const angles = [0, 45];
    const s = new objects.Design(design).spectrum(500, 520, { step: 5, angles });
    s.saveJcamp(file);
    const spec = computeOpticalSpectrum(design, { lambdaStart: 500, lambdaEnd: 520, lambdaStep: 5, thetas: angles }, s.mode);
    const window = model.designExportDocument({ spec, design, quantities: ['T', 'R', 'A'], includeSP: true, expFormat: 'jcamp', base: 'x' }).text;
    ok(`${name}: saveJcamp writes the Export tab's design JCAMP-DX`, fs.readFileSync(file, 'utf8') === window);
    const back = api.readSpectrumFile(file).curves;
    ok(`${name}: read back as 14 curves`, back.length === 14 && back[3].name.endsWith('T s @0°'), JSON.stringify(back.map(c => c.name)));
}

// ── 5. measuredDifference on Ψ and Δ ─────────────────────────────────────
{
    const [psi, delta] = readFiles.fixture.curves;
    for (const [curve, o] of [[psi, {}], [delta, {}], [delta, { grid: 'uniform', step: 7 }], [psi, { grid: 'thinned', from: 450, to: 900 }]]) {
        const found = api.measuredDifference(fixture, curve, o);
        const holding = api.addMeasuredCurves({ ...fixture, meritOperands: [] }, curve);
        const fitted = api.fitMeasured(holding, curve.name, o);
        const row = api.merit(fitted).rows[0];
        ok(`${curve.quantity} ${JSON.stringify(o)}: rms is the fitted Ψ/Δ block's merit row`, found.rms === row.value && found.mode === 'front' && found.ppef === null,
            `${found.rms} ${row.value}`);
        const rms = Math.sqrt(found.deviation.reduce((sum, d) => sum + d * d, 0) / found.deviation.length);
        ok(`${curve.quantity} ${JSON.stringify(o)}: rms is the RMS of deviation, design less measured the short way round`, Math.abs(rms - found.rms) <= 1e-12 * found.rms
            && found.deviation.every((d, i) => Math.abs(((found.design[i] - found.measured[i] + 540) % 360) - 180 - d) < 1e-9), `${rms} ${found.rms}`);
    }
    const reversed = api.measuredDifference(fixture, { ...delta, deltaConvention: 'reversed', values: delta.values.map(v => (360 - v) % 360) });
    ok('a Δ written in the reversed sign gives the same rms', Math.abs(reversed.rms - api.measuredDifference(fixture, delta).rms) < 1e-9);
    // The fixture's PSI and DEL rows at 633 nm read the design as measuredDifference does.
    const rows = api.merit(fixture).rows;
    const at633 = (quantity, deltaConvention) => api.measuredDifference(fixture, { quantity, angle: 70, wavelength: [633], values: [0], ...(deltaConvention ? { deltaConvention } : {}) });
    ok('the fixture\'s PSI and DEL rows read the design value measuredDifference gives', Math.abs(at633('PSI').design[0] - rows[0].value) < 1e-9
        && Math.abs(at633('DEL', 'reversed').design[0] - rows[1].value) < 1e-9, `${at633('PSI').design[0]} ${rows[0].value} ${at633('DEL', 'reversed').design[0]} ${rows[1].value}`);
    const own = readFiles.own.curves.map(curve => api.measuredDifference(fixture, curve).rms);
    ok('a design against its own Ψ/Δ CSV differs by nothing', own.every(rms => rms < 1e-9), JSON.stringify(own));
    ok('on a two-sided design Ψ and Δ are the front\'s', api.measuredDifference(twoSided, psi).rms === api.measuredDifference(fixture, psi).rms);
}

// ── 6. The objects and the refusals ──────────────────────────────────────
{
    ok('tf.readEllipsometryFile() is readEllipsometryFile', isDeepStrictEqual(tf.readEllipsometryFile(FILES.psiFirst, { angle: 60 }), api.readEllipsometryFile(FILES.psiFirst, { angle: 60 })));
    const design = new objects.Design(source);
    design.addMeasuredCurves(scans);
    design.fitMeasured(scans[1].name, { start: 450, end: 700, grid: 'thinned' });
    const plain = api.fitMeasured(api.addMeasuredCurves(source, scans), scans[1].name, { from: 450, to: 700, grid: 'thinned' });
    ok('design.addMeasuredCurves() and fitMeasured() are the plain calls, start and end for from and to', isDeepStrictEqual(design._data.meritOperands.map(rowOf), plain.meritOperands.map(rowOf))
        && isDeepStrictEqual(design._data.measuredCurves.map(held), plain.measuredCurves.map(held)));
    const file = path.join(dir, 'object.csv');
    tf.exportMeasuredCurves(design, file, { scale: 'fraction' });
    ok('tf.exportMeasuredCurves() is exportMeasuredCurves', fs.readFileSync(file, 'utf8') === model.measuredExportDocument(design._data, 'csv', { curves: design._data.measuredCurves, asPercent: false }).text);
    const plainRefused = (fn, re) => { const err = thrown(fn); ok(`refused: ${re}`, re.test(err?.message ?? ''), err?.message); };
    const holding = api.addMeasuredCurves(fixture, readFiles.fixture.curves);
    plainRefused(() => api.exportMeasuredCurves(holding, file), /object\.csv exists; pass \{ overwrite: true \} to write over it$/);
    plainRefused(() => api.exportMeasuredCurves(api.newDesign(), path.join(dir, 'none.csv')), /^exportMeasuredCurves: the design holds no measured curve$/);
    plainRefused(() => api.exportMeasuredCurves(holding, path.join(dir, 'x.dx'), { format: 'jcamp' }), /^exportMeasuredCurves: format is 'csv' for Ψ and Δ, not "jcamp"$/);
    plainRefused(() => api.exportMeasuredCurves(holding, path.join(dir, 'x.csv'), { scale: 'fraction' }), /^exportMeasuredCurves: scale is not taken for Ψ and Δ/);
    plainRefused(() => api.exportMeasuredCurves(holding, path.join(dir, 'x.csv'), { xUnit: 'cm-1' }), /^exportMeasuredCurves: xUnit is 'nm', 'um' or 'eV' for Ψ and Δ, not "cm-1"$/);
    plainRefused(() => api.exportMeasuredCurves(api.addMeasuredCurves(api.newDesign(), scans), path.join(dir, 'x.dx'), { format: 'jcamp', xUnit: 'eV' }), /^exportMeasuredCurves: xUnit is 'nm', 'um' or 'cm-1', not "eV"$/);
    plainRefused(() => api.exportMeasuredCurves(api.addMeasuredCurves(holding, scans), path.join(dir, 'x.csv'), { curves: [scans[0].name, readFiles.fixture.curves[0].name] }), /^exportMeasuredCurves: curves are all R, T and A/);
    plainRefused(() => api.fitMeasured(holding, 'nothing'), /^fitMeasured: curve is the name of a curve the design holds: .*Psi/);
    plainRefused(() => api.fitMeasured(api.addMeasuredCurves(holding, readFiles.fixture.curves[0]), readFiles.fixture.curves[0].name), /^fitMeasured: the design holds 2 curves named/);
    plainRefused(() => api.fitMeasured(holding, readFiles.fixture.curves[0].name, { db: true }), /^fitMeasured: db is true or false; true for a T curve only, and this one is PSI/);
    plainRefused(() => api.fitMeasured(holding, readFiles.fixture.curves[0].name, { constraints: { min: 50, max: 10 } }), /^fitMeasured: constraints are \{ min, max, weight \}/);
    plainRefused(() => api.fitMeasured(holding, readFiles.fixture.curves[0].name, { output: 'add' }), /^fitMeasured: output is 'append' or 'replace'/);
    plainRefused(() => api.fitMeasured({ ...holding, surfaceMode: 'back_only', backLayers: holding.frontLayers, frontLayers: [] }, readFiles.fixture.curves[0].name), /^fitMeasured: Ψ and Δ are scored on the front side, and this design is scored on its back alone$/);
    const atZero = api.addMeasuredCurves(fixture, { ...readFiles.fixture.curves[0], name: 'flat', angle: 0 });
    plainRefused(() => api.fitMeasured(atZero, 'flat'), /^fitMeasured: a Ψ or Δ curve at normal incidence says nothing about the film/);
    plainRefused(() => api.measuredDifference(fixture, { ...readFiles.fixture.curves[0], side: 'back' }), /^measuredDifference: a Ψ or Δ curve measured on the back side is not scored/);
    plainRefused(() => api.measuredDifference(fixture, readFiles.fixture.curves[0], { levelFree: true }), /^measuredDifference: levelFree is true or false; true for a T, R or A curve only, and this one is PSI/);
    plainRefused(() => api.measuredDifference(fixture, { ...scans[0], side: 'back' }), /^measuredDifference: 'side' is not a field of a curve; a T, R or A curve has name, quantity/);
    plainRefused(() => api.addMeasuredCurves(fixture, []), /^addMeasuredCurves: curves is a curve or a list of curves/);
    plainRefused(() => api.addMeasuredCurves(fixture, { ...readFiles.fixture.curves[1], deltaConvention: 'nulling' }), /^addMeasuredCurves: deltaConvention is 'azzam' or 'reversed', not "nulling"$/);
    plainRefused(() => api.addMeasuredCurves(fixture, { ...readFiles.fixture.curves[0], pol: 's' }), /^addMeasuredCurves: pol is 'avg' for Ψ and Δ, not "s"$/);
    plainRefused(() => api.readEllipsometryFile(FILES.psiFirst, { quantities: ['PSI'] }), /^readEllipsometryFile: quantities is a list of one type per column of the file \(2\)/);
    plainRefused(() => api.readEllipsometryFile(FILES.psiFirst, { pol: 'avg' }), /^readEllipsometryFile: unknown option 'pol'; the options are angle, side, deltaConvention, xUnit, quantities$/);
    plainRefused(() => api.readEllipsometryFile(write('words.txt', 'no numbers\nhere\n')), /holds no table of numbers Measured Ellipsometry's import reads/);
    const object = (fn, text) => { const err = thrown(fn); ok(`refused in the objects' words: ${text}`, err?.message === text, err?.message); };
    object(() => design.fitMeasured(scans[1].name, { to: 700 }), "fitMeasured: unknown option 'to'; the options are grid, step, thinEvery, db, weight, output, constraints, start, end");
    object(() => design.fitMeasured(scans[1].name, { start: 700, end: 450 }), 'fitMeasured: start and end are wavelengths in nm, 0 < start < end');
    object(() => tf.exportMeasuredCurves(design._data, file), 'exportMeasuredCurves: design is a Design, as tf.newDesign() or tf.openDesign() gives one');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
