/**
 * A spectrum file read and a design compared with a measured curve
 * (src/api/measured.js) against Measured Spectra's import and the MCURVE and
 * PPEF merit rows its Fit… dialog writes.
 *
 *   1. Files the app writes or reads: a design spectrum CSV with Measured
 *      Spectra's condition lines, the window's own CSV and JCAMP-DX exports
 *      of measured curves, an instrument table in µm with decimal commas and
 *      a UTF-16 one. readSpectrumFile gives the curves the window's import
 *      adds (useImportActions, driven as the window drives it), at the
 *      panel's opening settings and with every setting changed.
 *   2. On the corpus designs with no catalog, the cone design among them,
 *      against T and R curves of those files, on each grid, a range, dB and
 *      the level free: rms and ppef equal the MCURVE and PPEF rows the Fit…
 *      dialog's snapshot makes, as the Merit Function Editor shows them; the
 *      wavelengths and measured values are the snapshot's.
 *   3. On the measured-curve-ppef fixture, its thicknesses changed: the RMS
 *      equals the fixture's own MCURVE row and the PPEF its PPEF row, from
 *      the same snapshot.
 *   4. Cross-checks: rms is the RMS of deviation, which is design less
 *      measured less level, under a cone too; a curve wider than the
 *      materials' span is clipped; on designs with no cone, design equals `spectrum`
 *      at the same wavelengths, in dB too; a design compared with its own
 *      spectrum differs by nothing.
 *   5. The objects: tf.readSpectrumFile() and design.compareMeasured() give
 *      the plain calls' answers, start and end standing for from and to; the
 *      refusals of both, in the plain calls' and the objects' words.
 *
 * Run: node tests/api_measured_difference.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { makeOperand, makeConeSpec, coneIsActive, logValue } = await import('../src/utils/physics/optimizer.js');
const model = await import('../src/components/windows/dataExchange/spectrumExchange/model.js');
const { default: mainPaths } = await import('../src/main/paths.js');

shimBrowserGlobals();
await loadApp();
const { renderToStaticMarkup } = await import('react-dom/server');
const { useImportActions } = await import('../src/components/windows/dataExchange/spectrumExchange/importActions.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b) || (Number.isNaN(a) && Number.isNaN(b));

const tf = await objects.start();
const t = makeLocale();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-measured-'));

// ── 1. Files and the window's import ─────────────────────────────────────
const source = api.stackFromFormula(api.newDesign({ name: 'Scan source' }), { formula: '(HL)^3 H' });
const FILES = {};
FILES.spectrum = path.join(dir, 'source spectrum.csv');
new objects.Design(source).spectrum(400, 800, { step: 2, angles: [30] }).saveCsv(FILES.spectrum);
const measuredCurves = {
    name: 'Bench scans',
    measuredCurves: [
        { id: 'a', name: 'T scan', quantity: 'T', x: [420, 470, 520, 570, 620, 670, 720], y: [0.62, 0.48, 0.71, 0.93, 0.88, 0.51, 0.66], aoi: 8, pol: 's' },
        { id: 'b', name: 'R scan', quantity: 'R', x: [420, 470, 520, 570, 620, 670, 720], y: [0.37, 0.5, 0.28, 0.06, 0.11, 0.47, 0.33], aoi: 8, pol: 's' },
    ],
};
FILES.exported = path.join(dir, 'exported.csv');
fs.writeFileSync(FILES.exported, model.measuredExportDocument(measuredCurves, 'csv').text);
FILES.jcamp = path.join(dir, 'exported.dx');
fs.writeFileSync(FILES.jcamp, model.measuredExportDocument(measuredCurves, 'jcamp').text);
FILES.instrument = path.join(dir, 'instrument.txt');
fs.writeFileSync(FILES.instrument, 'Sample: witness 3\nWavelength [µm];R [%]\n0,450;4,12\n0,500;3,05\n0,550;2,61\n0,600;2,94\n0,650;3,88\n');
FILES.utf16 = path.join(dir, 'utf16.csv');
fs.writeFileSync(FILES.utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('nm,%T\r\n500,91.5\r\n550,92.25\r\n600,90.75\r\n', 'utf16le')]));

// The curves the window's import adds from `file`, with the panel set as
// `panel` says after the file is read ({ aoi, pol, quantity, yscale, xUnit }).
// The panel asks for an angle for the columns that state none, and for a
// polarization only when the file states none (ImportTab's ColumnConditions).
async function windowImport(file, panel = {}) {
    const said = {};
    const props = {
        sx: t.spectrumExchange, design: { measuredCurves: [] }, checkpoint() {}, flash: (type, text) => { said.flash = [type, text]; },
        updateDesign: patch => { said.update = patch; }, setLoading() {}, clearStatus() {}, setColIdx() {}, setOv() {}, setSelectedCurveId() {},
        setParsed: v => { said.parsed = v; }, setFileName: v => { said.fileName = v; }, setXUnit: v => { said.xUnit = v; },
        setAoi: v => { said.aoi = v; }, setPol: v => { said.pol = v; }, aoi: panel.aoi ?? 0, pol: panel.pol ?? 'avg',
    };
    let actions;
    const Probe = ({ extra }) => { actions = useImportActions({ ...props, ...extra }); return null; };
    renderToStaticMarkup(React.createElement(Probe, { extra: {} }));
    window.electronAPI = { spectrumPickFile: async () => ({ success: true, text: mainPaths.readTextAuto(file), fileName: path.basename(file) }) };
    await actions.onImport();
    if (said.update) return said.update.measuredCurves;
    const set = { ...(panel.quantity ? { quantity: panel.quantity } : {}), ...(panel.yscale ? { yscale: panel.yscale } : {}) };
    renderToStaticMarkup(React.createElement(Probe, {
        extra: {
            parsed: said.parsed, fileName: said.fileName, colIdx: 0, xUnit: panel.xUnit ?? said.xUnit,
            aoi: panel.aoi ?? said.aoi ?? 0, pol: said.pol ?? panel.pol ?? 'avg', ov: Object.fromEntries(said.parsed.columns.map((_c, i) => [i, set])),
        },
    }));
    return actions.previewCurves;
}
const asApi = curve => ({ name: curve.name, quantity: curve.quantity, angle: curve.aoi, pol: curve.pol, wavelength: curve.x, values: curve.y });

const imported = {};
for (const [key, file] of Object.entries(FILES)) {
    const read = api.readSpectrumFile(file);
    imported[key] = await windowImport(file);
    ok(`${key}: readSpectrumFile gives the curves the window's import adds`, isDeepStrictEqual(read.curves, imported[key].map(asApi)),
        JSON.stringify(read.curves).slice(0, 300));
    ok(`${key}: its format`, read.format === (key === 'jcamp' ? 'jcamp' : 'table') && read.fileName === path.basename(file));
    const changed = key === 'jcamp' ? { angle: 12, pol: 'p' } : { angle: 12, pol: 'p', quantity: 'R', scale: 'percent', xUnit: 'nm' };
    const panel = { aoi: 12, pol: 'p', quantity: changed.quantity, yscale: changed.scale, xUnit: changed.xUnit };
    ok(`${key}: and with every setting of the panel changed`, isDeepStrictEqual(api.readSpectrumFile(file, changed).curves, (await windowImport(file, panel)).map(asApi)));
}
{
    const read = api.readSpectrumFile(FILES.spectrum);
    ok('the spectrum CSV comes back at its own angle, each column its quantity and polarization', read.curves.every(c => c.angle === 30)
        && read.curves.map(c => c.quantity + c.pol).join() === 'Ravg,Tavg,Aavg,Rs,Rp,Ts,Tp,As,Ap', JSON.stringify(read.curves.map(c => [c.name, c.quantity, c.pol])));
    const instrument = api.readSpectrumFile(FILES.instrument);
    ok('the instrument table is read in µm, its percent as fractions', instrument.xUnit === 'um' && instrument.curves[0].wavelength[0] === 450
        && Math.abs(instrument.curves[0].values[0] - 0.0412) < 1e-15 && instrument.curves[0].quantity === 'R', JSON.stringify(instrument));
    const kept = api.readSpectrumFile(FILES.exported, { angle: 12, pol: 'p' }).curves;
    const filled = api.readSpectrumFile(FILES.instrument, { angle: 12, pol: 'p' }).curves;
    ok('the angle and polarization a file states are kept, and the options fill in those it leaves unsaid',
        kept.every(c => c.angle === 8 && c.pol === 's') && filled[0].angle === 12 && filled[0].pol === 'p', JSON.stringify([kept[0], filled[0]]).slice(0, 300));
    ok('the UTF-16 file is read', api.readSpectrumFile(FILES.utf16).curves[0].values.join() === '0.915,0.9225,0.9075');
}
{
    // A curve wider than the span the design's materials have data for is
    // compared over that span, and says so.
    const wide = { quantity: 'R', wavelength: Array.from({ length: 200 }, (_, i) => 100 + 100 * i), values: Array(200).fill(0.05) };
    const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '0.5H L' });
    const found = api.measuredDifference(ar, wide);
    ok('a range the materials\' span cuts is clipped', found.clipped && found.wavelength.length < 200, JSON.stringify([found.clipped, found.wavelength.length]));
}

// ── 2. The corpus against the Fit… dialog's MCURVE and PPEF rows ──────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const designs = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]).filter(([, design]) => !thrown(() => api.spectrum(design, { from: 500, to: 501 })));
const isConed = design => coneIsActive(makeConeSpec(design.cone || {}));
ok('the corpus holds a design under a cone', designs.some(([, design]) => isConed(design)));

const [sourceR, sourceT, , sourceRs, , , sourceTp] = imported.spectrum;
const CASES = [
    [sourceT, {}], [sourceR, { grid: 'thinned', thinEvery: 3, from: 450, to: 700 }], [sourceTp, { grid: 'uniform', step: 5 }], [sourceRs, {}],
    [sourceT, { db: true, levelFree: true }], [imported.instrument[0], { levelFree: true }], [imported.exported[0], { grid: 'uniform', from: 430, to: 710 }],
];
// The Fit… dialog's settings for the options `o`, as its fields hold them.
const dialogFields = o => ({
    ...(o.grid ? { mode: o.grid } : {}), ...(o.thinEvery ? { thinEvery: o.thinEvery } : {}), ...(o.step ? { stepNm: o.step } : {}),
    ...(o.from ? { rangeMin: o.from } : {}), ...(o.to ? { rangeMax: o.to } : {}), ...(o.db ? { scale: 'dB' } : {}),
});
// The rows the dialog writes for `curve` on `design`, and what the Merit Function Editor shows for them.
function editorRows(design, curve, o) {
    const config = model.clampedFitRange(design, { ...model.defaultMeasuredFitOptions(curve), ...dialogFields(o) });
    const block = { ...model.measuredFitSnapshot(design, curve, config).operand, ...(o.levelFree ? { levelFree: true } : {}) };
    const rows = [block, makeOperand({ type: 'PPEF', refId: block.id, target: 0, weight: 1 })];
    return { block, shown: api.merit({ ...design, meritOperands: rows }).rows };
}
for (const [name, design] of designs) {
    const cases = isConed(design) ? CASES.slice(0, 2) : CASES;
    for (const [curve, o] of cases) {
        const found = api.measuredDifference(design, asApi(curve), o);
        const { block, shown } = editorRows(design, curve, o);
        const at = `${name} ${curve.name} ${JSON.stringify(o)}`;
        ok(`${at}: rms is the MCURVE row and ppef the PPEF row`, same(found.rms, shown[0].value) && same(found.ppef, shown[1].value) && !shown[0].error,
            `${found.rms} ${shown[0].value} ${found.ppef} ${shown[1].value}`);
        ok(`${at}: on the snapshot's points`, isDeepStrictEqual([found.wavelength, found.measured], [block.sampleLambdas, block.sampleTargets]));
        ok(`${at}: the mode is the merit's`, found.mode === api.spectrum(design, { from: 500, to: 501 }).evalMode);
    }
}

// ── 3. The fixture's own rows ────────────────────────────────────────────
{
    const fixture = api.scaleThicknesses(api.openDesign(fixtureFile('measured-curve-ppef')), { factor: 1.01 });
    const [stored] = fixture.measuredCurves;
    const found = api.measuredDifference(fixture, asApi(stored), { db: true, levelFree: true });
    const rows = api.merit(fixture).rows;
    const [block] = fixture.meritOperands;
    ok('the fixture: rms is its MCURVE row and ppef its PPEF row', found.rms === rows[0].value && found.ppef === rows[1].value && found.rms > 0.01,
        `${found.rms} ${rows[0].value} ${found.ppef} ${rows[1].value}`);
    ok('from the same snapshot', isDeepStrictEqual([found.wavelength, found.measured], [block.sampleLambdas, block.sampleTargets]));
}

// ── 4. Cross-checks ──────────────────────────────────────────────────────
for (const [name, design] of designs) {
    for (const [curve, o] of isConed(design) ? CASES.slice(0, 2).map(([c, x]) => [c, { ...x, levelFree: true }]) : CASES) {
        const found = api.measuredDifference(design, asApi(curve), o);
        const rms = Math.sqrt(found.deviation.reduce((sum, d) => sum + d * d, 0) / found.deviation.length);
        const offset = found.level ?? 0;
        ok(`${name} ${JSON.stringify(o)}: rms is the RMS of deviation, design less measured less level`, rms === found.rms
            && found.deviation.every((d, i) => Math.abs(d - (found.design[i] - found.measured[i] - offset)) <= 1e-12 * Math.max(1, Math.abs(found.design[i]))), `${rms} ${found.rms}`);
        if (isConed(design)) continue;
        const s = api.spectrum(design, { from: 400, to: 800, step: 1, angles: [found.angle] });
        const key = found.pol === 'avg' ? found.quantity : `${found.quantity}${found.pol}`;
        const series = s.angles[found.angle][key];
        const expected = found.wavelength.map(w => series[s.lambda.indexOf(w)]).map(v => (found.db ? logValue('dB', v) : v));
        const known = found.wavelength.every(w => s.lambda.includes(w));
        ok(`${name} ${JSON.stringify(o)}: design is spectrum's ${key} at the same wavelengths`, !known
            || found.design.every((v, i) => Math.abs(v - expected[i]) <= 1e-9 * Math.max(1, Math.abs(expected[i]))), JSON.stringify([found.design.slice(0, 3), expected.slice(0, 3)]));
    }
}
{
    const own = api.measuredDifference(source, asApi(sourceT));
    ok('a design compared with its own spectrum differs by nothing', own.rms < 1e-12 && own.ppef < 1e-9 && own.wavelength.length === 201, `${own.rms} ${own.ppef}`);
}

// ── 5. The objects and the refusals ──────────────────────────────────────
{
    ok('tf.readSpectrumFile() is readSpectrumFile', isDeepStrictEqual(tf.readSpectrumFile(FILES.exported, { angle: 5 }), api.readSpectrumFile(FILES.exported, { angle: 5 })));
    const design = new objects.Design(designs[0][1]);
    ok('design.compareMeasured() is measuredDifference, start and end for from and to', isDeepStrictEqual(
        design.compareMeasured(FILES.spectrum, { curve: 'source spectrum: R at 30 deg', start: 450, end: 650, grid: 'thinned' }),
        api.measuredDifference(designs[0][1], FILES.spectrum, { curve: 0, from: 450, to: 650, grid: 'thinned' })));
    const plain = (fn, re) => { const err = thrown(fn); ok(`refused: ${re}`, re.test(err?.message ?? ''), err?.message); };
    const d = designs[0][1];
    plain(() => api.measuredDifference(d, FILES.spectrum), /^measuredDifference: .* holds 9 curves \(source spectrum: R at 30 deg,.*\); curve names/);
    plain(() => api.measuredDifference(d, FILES.spectrum, { curve: 9 }), /^measuredDifference: curve is the name or the number from 0 of one of the file's curves/);
    plain(() => api.measuredDifference(d, asApi(sourceR), { db: true }), /^measuredDifference: db is true or false; true for a T curve only, and this one is R/);
    plain(() => api.measuredDifference(d, asApi(sourceT), { step: 2 }), /^measuredDifference: step is a wavelength step in nm above 0, with grid 'uniform'/);
    plain(() => api.measuredDifference(d, asApi(sourceT), { grid: 'fine' }), /^measuredDifference: grid is 'measured', 'thinned' or 'uniform'/);
    plain(() => api.measuredDifference(d, asApi(sourceT), { angle: 5 }), /^measuredDifference: unknown option 'angle'; the options are grid, step/);
    plain(() => api.measuredDifference(d, { ...asApi(sourceT), quantity: 'PSI', angle: 0 }), /^measuredDifference: a Ψ or Δ curve at normal incidence says nothing about the film/);
    plain(() => api.measuredDifference(d, { ...asApi(sourceT), quantity: 'r' }), /^measuredDifference: quantity is 'T', 'R' or 'A'.*, not "r"$/);
    {
        const psi = path.join(dir, 'psi.csv');
        fs.writeFileSync(psi, 'nm,Psi\n500,30\n600,31\n');
        plain(() => api.measuredDifference(d, psi), /^measuredDifference: a Ψ or Δ curve at normal incidence says nothing about the film/);
    }
    plain(() => api.measuredDifference(d, { ...asApi(sourceT), side: 'back' }), /^measuredDifference: 'side' is not a field of a curve/);
    plain(() => api.measuredDifference(d, asApi(sourceT), { from: 900, to: 1000 }), /^measuredDifference: no measured point lies inside/);
    plain(() => api.measuredDifference(d, asApi(sourceT), { from: 900 }), /^measuredDifference: from and to are wavelengths in nm, 0 < from < to; without them, the curve's first and last, 400 and 800 nm$/);
    plain(() => api.measuredDifference(d, 42), /^measuredDifference: measured is the path of a spectrum file or a curve/);
    plain(() => api.readSpectrumFile(FILES.jcamp, { quantity: 'R' }), /^readSpectrumFile: unknown option 'quantity'; the options are angle, pol$/);
    plain(() => api.readSpectrumFile(path.join(dir, 'none.csv')), /^readSpectrumFile: .*none\.csv: /);
    const words = path.join(dir, 'words.txt');
    fs.writeFileSync(words, 'no numbers here\nat all\n');
    plain(() => api.readSpectrumFile(words), /holds no spectrum Measured Spectra's import reads/);
    const object = (fn, text) => { const err = thrown(fn); ok(`refused in the objects' words: ${text}`, err?.message === text, err?.message); };
    object(() => design.compareMeasured(asApi(sourceT), { to: 700 }), "compareMeasured: unknown option 'to'; the options are curve, angle, pol, quantity, scale, xUnit, grid, step, thinEvery, db, levelFree, start, end");
    object(() => design.compareMeasured(asApi(sourceT), { start: 900, end: 1000 }), 'compareMeasured: no measured point lies inside the range asked for and the span every material of the design has data for');
    object(() => design.compareMeasured(asApi(sourceT), { start: 900 }), 'compareMeasured: start and end are wavelengths in nm, 0 < start < end');
    object(() => design.compareMeasured(asApi(sourceT), { end: -1 }), 'compareMeasured: end is a wavelength in nm above 0, not -1');
    object(() => tf.readSpectrumFile(FILES.exported, { xUnit: 'mm' }), "readSpectrumFile: xUnit is 'nm', 'um', 'cm-1' or 'eV', not \"mm\"");
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
