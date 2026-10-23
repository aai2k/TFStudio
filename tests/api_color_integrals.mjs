/**
 * The headless API's color (src/api/color.js) and integrals
 * (src/api/integrals.js) against the Color Evaluation and Integral Values
 * windows' own code, against each other, and against CIE 15:2004.
 *
 *   1. On the corpus designs with no catalog: color with the window's factory
 *      settings, and over R and T, the three polarizations, 0 and 45 degrees,
 *      both observers and the four illuminants, is computeColorReport, the
 *      function the window calls, on the sides the design is scored on;
 *      integrals with the window's factory grid and with a narrower one, at 0
 *      and 45 degrees and each polarization, with custom rows made by the
 *      window's makeCustomDefinition (a blackbody, a source table, a detector
 *      table and a band outside its weighting), is computeSpectrumForMode and
 *      integralTable, the hook's own path; and saveCsv writes the window's
 *      English export.
 *   2. On the cone fixture: color is the analysis worker's colorReport and
 *      integrals the worker's integralSpectrum with integralTable, the windows'
 *      paths under a cone.
 *   3. Cross-checks: Tvis is the colour's Y / 100 for T under D65 with the 2
 *      degree observer, on any two grids with the same nodes on 380-780 nm and
 *      not on others; a band the grid does not span has no value and is not
 *      covered, an empty cell in the CSV as the window shows a dash; a
 *      weighting that is 0 over its whole band gives no value, though covered;
 *      a front with no layers, where computeColorReport shows nothing, gives
 *      the bare surface's colour, which is the colour of spectrum's R there;
 *      the D65, D50 and A whites are within 5e-5 of CIE 15:2004.
 *   4. The sides: without side both follow the design's evaluation mode, in
 *      every surface mode and scoring, and side gives each side; outOfRange
 *      is the windows' range notice, the materials of the sides computed, and
 *      a front's colour and integrals do not name the exit medium.
 *   5. Refusals with their codes and fields: an unknown option, a quantity,
 *      polarization, observer, illuminant, angle, step or side neither takes,
 *      a range that is not one, more points than the limit, every kind of
 *      malformed custom row, a custom table without two different
 *      wavelengths, and a design whose materials resolve to nothing.
 *
 * Run: node tests/api_color_integrals.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { computeColorReport } = await import('../src/components/windows/analysis/colorEvaluation/colorModel.js');
const { computeSpectrumForMode } = await import('../src/components/windows/analysis/integralValues/spectrum.js');
const { integralTable, makeCustomDefinition, INITIAL_BUILDER } = await import('../src/components/windows/analysis/integralValues/integralModel.js');
const { exportColumns, exportRows } = await import('../src/components/windows/analysis/integralValues/exportModel.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { embedDesignMaterials, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { colorReport, COLOR_RANGE_NM } = await import('../src/utils/physics/colorimetry.js');
const { materialsRangeCoverage, rangeMaterials } = await import('../src/utils/materials/materialRange.js');
const { sessionDefaults } = await import('../src/constants/analysisDefaults.js');
const { mirrorLayers, resolveEvalMode, makeConeSpec, coneIsActive } = await import('../src/utils/physics/optimizer.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-colour-'));

// ── The designs ────────────────────────────────────────────────────────────
const MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
const SCORING = ['side', 'total'];
const otherSide = (layers, tag) => [...layers].reverse().map(layer => ({ ...layer, id: `${tag}${layer.id}`, thickness: layer.thickness * 0.8 }));
function made(design, mode) {
    const front = [design.frontLayers, otherSide(design.backLayers, 'f')].find(layers => layers.length);
    const back = { symmetric: mirrorLayers(front) }[mode] ?? [design.backLayers, otherSide(design.frontLayers, 'b')].find(layers => layers.length);
    return { ...design, surfaceMode: mode, frontLayers: front, backLayers: back };
}
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const corpus = opened.filter(([, design]) => resolves(design));
const unresolved = opened.filter(([, design]) => !resolves(design));
const hasCone = design => coneIsActive(makeConeSpec(design.cone || {}));
const COLOUR = sessionDefaults('colorEvaluation');
const GRID = sessionDefaults('integralValues');

// ── 1. Colour: the window's numbers ────────────────────────────────────────
// The window's report (computeColorReport) in the API's shape.
function windowColour(design, mode, { quantity, angle, pol, observer, illuminant, step }) {
    const report = computeColorReport({
        design: withHerpinRecords(design), evalMode: mode, setError: error => { if (error) throw new Error(error); },
        characteristic: quantity, pol, theta: angle, observer: String(observer), illuminant, step,
    });
    return report && {
        ...report.XYZ, ...report.xy, white: report.white, whiteXy: report.whiteXy, lab: report.Lab, luv: report.Luv,
        uv1976: { u: report.uvP.up, v: report.uvP.vp }, uv1960: report.uv60, hunterLab: report.Hunter,
        dominant: { wavelength: report.dom.dom, complementary: report.dom.comp, purity: report.dom.purity },
        cct: report.cct.cct, duv: report.cct.duv, swatch: report.rgb,
    };
}
// The API's colour without its conditions, its swatch as the window writes it.
const computed = c => {
    const { mode, quantity, angle, pol, observer, illuminant, step, outOfRange, srgb, ...rest } = c;
    return { ...rest, swatch: `rgb(${srgb.r}, ${srgb.g}, ${srgb.b})` };
};
const SETTINGS = ['R', 'T'].flatMap(quantity => ['avg', 's', 'p'].flatMap(pol => [0, 45].flatMap(angle => [2, 10].flatMap(observer =>
    ['D65', 'D50', 'A', 'E'].map(illuminant => ({ quantity, pol, angle, observer, illuminant, step: COLOUR.step }))))));
{
    const plain = corpus.filter(([, design]) => !hasCone(design));
    const wrong = plain.flatMap(([name, design]) => {
        const mode = resolveEvalMode(design);
        return SETTINGS.filter(s => {
            const got = api.color(design, s);
            return !same(computed(got), windowColour(design, mode, s)) || !same([got.mode, got.quantity, got.angle, got.pol, got.observer, got.illuminant, got.step],
                [mode, s.quantity, s.angle, s.pol, s.observer, s.illuminant, s.step]);
        }).map(s => `${name} ${JSON.stringify(s)}`);
    });
    ok(`on ${plain.length} designs, color over R and T, three polarizations, 0 and 45 degrees, both observers and the four illuminants (${SETTINGS.length} settings) is computeColorReport`,
        plain.length >= 12 && SETTINGS.length === 96 && wrong.length === 0, wrong.slice(0, 4).join('\n'));
    const factory = plain.filter(([, design]) => !same(api.color(design), api.color(design, { quantity: COLOUR.characteristic, angle: COLOUR.theta,
        pol: COLOUR.pol, observer: Number(COLOUR.observer), illuminant: COLOUR.illuminant, step: COLOUR.step })));
    ok('without options color takes the window\'s factory settings: R, 0 degrees, avg, the 2 degree observer, D65, a 0.5 nm step',
        factory.length === 0 && same([COLOUR.characteristic, COLOUR.theta, COLOUR.pol, COLOUR.observer, COLOUR.illuminant, COLOUR.step], ['R', 0, 'avg', '2', 'D65', 0.5]));
}

// ── 1. Integral values: the window's numbers ───────────────────────────────
const PARTS = en.integralValues.customParts;
// Custom rows as the window's form makes them, each with the API's row for it.
const BUILDERS = [
    { ...INITIAL_BUILDER, source: { id: 'blackbody', T: 3000, table: null } },
    { ...INITIAL_BUILDER, char: 'R', source: { id: 'custom', T: 5778, table: [[420, 0.2], [450, 1], [480, 0.3], [560, 0.6], [650, 0.1]] }, detector: { id: 'flat', table: null }, bandMin: 400, bandMax: 700 },
    { ...INITIAL_BUILDER, char: 'A', source: { id: 'D50', T: 5778, table: null }, detector: { id: 'custom', table: [[600, 0.1], [900, 1], [1100, 0.2]] }, bandMin: 500, bandMax: 1200 },
    { ...INITIAL_BUILDER, bandMin: 1000, bandMax: 1200 },
];
const apiSpec = ({ id, T, table }) => ({ id, ...(id === 'blackbody' ? { T } : {}), ...(id === 'custom' ? { table } : {}) });
const CUSTOM = BUILDERS.map((b, i) => makeCustomDefinition(b, i + 1, PARTS));
const API_CUSTOM = CUSTOM.map((c, i) => ({ key: c.key, quantity: BUILDERS[i].char, source: apiSpec(BUILDERS[i].source), detector: apiSpec(BUILDERS[i].detector), band: [BUILDERS[i].bandMin, BUILDERS[i].bandMax] }));
// The hook's rows (useIntegralValues) in the API's shape.
function windowIntegrals(design, mode, { start, end, step, angle, pol }) {
    const spectrum = computeSpectrumForMode(withHerpinRecords(design), { lambdaStart: start, lambdaEnd: end, lambdaStep: step, theta: angle, polarization: pol }, mode);
    const { definitions, results } = integralTable(spectrum, CUSTOM);
    return definitions.map(({ key, char }) => {
        const r = results[key];
        return { key, quantity: char, value: r.value, min: r.min, minAt: r.lamAtMin, max: r.max, maxAt: r.lamAtMax, band: [r.lamMin, r.lamMax], covered: r.covered, spectrumSpan: r.spectrumSpan };
    });
}
// The window's grid, and one that spans the visible rows and not the solar,
// UV or NIR ones.
const GRIDS = [{ start: GRID.lambdaStart, end: GRID.lambdaEnd, step: GRID.lambdaStep }, { start: 350, end: 1000, step: 1 }];
const INTEGRAL_SETTINGS = GRIDS.flatMap(grid => [0, 45].flatMap(angle => ['avg', 's', 'p'].map(pol => ({ ...grid, angle, pol }))));
{
    const plain = corpus.filter(([, design]) => !hasCone(design));
    const wrong = plain.flatMap(([name, design]) => {
        const mode = resolveEvalMode(design);
        return INTEGRAL_SETTINGS.filter(s => {
            const got = api.integrals(design, { ...s, custom: API_CUSTOM });
            return !same(got.rows, windowIntegrals(design, mode, s)) || !same([got.mode, got.start, got.end, got.step, got.angle, got.pol], [mode, s.start, s.end, s.step, s.angle, s.pol]);
        }).map(s => `${name} ${JSON.stringify(s)}`);
    });
    const rows = api.integrals(plain[0][1], { custom: API_CUSTOM }).rows;
    const shape = [rows.length, rows.slice(10).map(r => r.key).join(), rows.slice(10, 13).every(r => r.covered && r.value > 0)];
    ok(`on ${plain.length} designs, integrals on two grids, at 0 and 45 degrees and each polarization, with blackbody, source-table and detector-table rows, is computeSpectrumForMode and integralTable`,
        plain.length >= 12 && wrong.length === 0 && same(shape, [14, 'custom_1,custom_2,custom_3,custom_4', true]), wrong.slice(0, 4).join('\n'));
    const factory = plain.filter(([, design]) => !same(api.integrals(design), api.integrals(design, { start: GRID.lambdaStart, end: GRID.lambdaEnd, step: GRID.lambdaStep, angle: GRID.theta, pol: GRID.polarization })));
    ok('without options integrals takes the window\'s factory grid: 300 to 2500 nm every 0.5 nm, 0 degrees, avg',
        factory.length === 0 && same([GRID.lambdaStart, GRID.lambdaEnd, GRID.lambdaStep, GRID.theta, GRID.polarization], [300, 2500, 0.5, 0, 'avg']));
    const defaulted = api.integrals(plain[0][1], { custom: [{ key: 'mine' }, { key: 'hot', source: { id: 'blackbody' } }] }).rows.slice(10);
    const window = integralTable(computeSpectrumForMode(withHerpinRecords(plain[0][1]), { lambdaStart: 300, lambdaEnd: 2500, lambdaStep: 0.5, theta: 0, polarization: 'avg' }, resolveEvalMode(plain[0][1])),
        [makeCustomDefinition(INITIAL_BUILDER, 1, PARTS), makeCustomDefinition({ ...INITIAL_BUILDER, source: { id: 'blackbody', T: INITIAL_BUILDER.source.T, table: null } }, 2, PARTS)]).results;
    ok('a custom row\'s fields left out are the window\'s form as it opens: T, D65, photopic, 380-780 nm, a blackbody at 5778 K',
        same(defaulted.map(r => r.value), [window.custom_1.value, window.custom_2.value]) && same(defaulted[0].band, [380, 780]) && defaulted[0].quantity === 'T');
}
{
    // The window's English CSV of the built-in rows, as its export writes it.
    const [, design] = corpus[0];
    const mode = resolveEvalMode(design);
    const spectrum = computeSpectrumForMode(withHerpinRecords(design), { lambdaStart: 400, lambdaEnd: 900, lambdaStep: 1, theta: 0, polarization: 'avg' }, mode);
    const { definitions, results } = integralTable(spectrum, []);
    const file = path.join(WORK, 'integrals.csv');
    new objects.Integrals(api.integrals(design, { start: 400, end: 900, step: 1 })).saveCsv(file);
    const csv = fs.readFileSync(file, 'utf8');
    ok('saveCsv writes the window\'s English export, an empty cell where a row has no value',
        csv === csvFromRows(exportColumns(en), exportRows(definitions, results, en.units)) && /^Tvis,,,,,,,380-780 nm$/m.test(csv), csv.split('\n').slice(0, 3).join(' / '));
}

// ── 2. The cone fixture: the analysis worker's paths ───────────────────────
{
    const coned = corpus.filter(([, design]) => hasCone(design));
    const wrong = coned.flatMap(([name, design]) => {
        const mode = resolveEvalMode(design);
        const portable = embedDesignMaterials(withHerpinRecords(design));
        const colours = SETTINGS.filter((s, i) => i % 7 === 0).filter(s => {
            const shown = dispatchAnalysisEvaluation('colorReport', { design: portable, options: {
                evalMode: mode, characteristic: s.quantity, pol: s.pol, theta: s.angle, observer: String(s.observer), illuminant: s.illuminant, step: s.step,
            } });
            const got = api.color(design, s);
            return !same([got.X, got.Y, got.Z, got.x, got.y, got.lab, got.dominant.purity], [shown.XYZ.X, shown.XYZ.Y, shown.XYZ.Z, shown.xy.x, shown.xy.y, shown.Lab, shown.dom.purity]);
        }).map(s => `${name} colour ${JSON.stringify(s)}`);
        const tables = INTEGRAL_SETTINGS.filter((s, i) => i % 4 === 0).filter(s => {
            const spectrum = dispatchAnalysisEvaluation('integralSpectrum', { design: portable, params: { lambdaStart: s.start, lambdaEnd: s.end, lambdaStep: s.step, theta: s.angle, polarization: s.pol }, evalMode: mode });
            const { results } = integralTable(spectrum, CUSTOM);
            return !api.integrals(design, { ...s, custom: API_CUSTOM }).rows.every(r => same([r.value, r.min, r.max, r.covered], [results[r.key].value, results[r.key].min, results[r.key].max, results[r.key].covered]));
        }).map(s => `${name} integrals ${JSON.stringify(s)}`);
        return [...colours, ...tables];
    });
    const flat = coned.map(([, design]) => [api.color(design, { quantity: 'T' }).Y, api.color({ ...design, cone: { enabled: false } }, { quantity: 'T' }).Y]);
    ok(`on the cone fixture (${coned.map(([n]) => n).join(', ')}), color is the worker's colorReport and integrals its integralSpectrum with integralTable, and the cone changes them`,
        coned.length >= 1 && wrong.length === 0 && flat.every(([cone, axis]) => cone !== axis), wrong.slice(0, 3).join('\n'));
}

// ── 3. Cross-checks ────────────────────────────────────────────────────────
{
    // Tvis integrates D65 times V(λ), the 2 degree ȳ, by the trapezoidal rule
    // on the spectrum's grid; Y does the same on the colour's grid. The two
    // grids are 0.5 nm apart from 300 nm and from 380 nm, so their nodes
    // inside 380-780 nm are the same, and they agree to rounding: 1e-12.
    const wrong = corpus.flatMap(([name, design]) => [0, 45].flatMap(angle => ['avg', 's', 'p'].flatMap(pol => {
        const Y = api.color(design, { quantity: 'T', angle, pol, observer: 2, illuminant: 'D65' }).Y;
        const tvis = api.integrals(design, { angle, pol }).rows.find(r => r.key === 'Tvis').value;
        return Math.abs(Y / 100 - tvis) <= 1e-12 ? [] : [`${name} ${angle} ${pol}: Y/100 ${Y / 100}, Tvis ${tvis}`];
    })));
    ok(`on ${corpus.length} designs, cone included, at 0 and 45 degrees and each polarization, Tvis is the colour's Y / 100 for T under D65 at 2 degrees, to 1e-12`, wrong.length === 0, wrong.slice(0, 3).join('\n'));
    // Any other pair of grids with the same nodes agrees too; grids whose
    // nodes differ do not, which a narrow band filter shows plainly.
    const design = api.stackFromFormula(api.newDesign({ name: 'Narrow band' }), { formula: '(HL)^4 HH (LH)^4' });
    const Y = step => api.color(design, { quantity: 'T', step }).Y / 100;
    const tvis = options => api.integrals(design, options).rows[0].value;
    ok('Tvis is Y / 100 when the two grids share their nodes on 380-780 nm, and not when they do not',
        Math.abs(Y(1) - tvis({ step: 1 })) <= 1e-12 && Math.abs(Y(2) - tvis({ start: 380, end: 900, step: 2 })) <= 1e-12 && Math.abs(Y(0.5) - tvis({ step: 3 })) > 1e-6);
}
{
    const [, design] = corpus[0];
    const { rows } = api.integrals(design, { start: 400, end: 700 });
    const tvis = rows.find(r => r.key === 'Tvis');
    const tuv = rows.find(r => r.key === 'TUV');
    ok('a band the grid does not span has no value: NaN with covered false and the span the spectrum has, as the window shows a dash',
        same([tvis.value, tvis.min, tvis.minAt, tvis.covered, tvis.spectrumSpan, tvis.band], [NaN, NaN, NaN, false, [400, 700], [380, 780]]) && Number.isNaN(tuv.value) && !tuv.covered);
    // A weighting that is 0 over its whole band, a source table of zeros or a
    // blackbody at 1 K, has nothing to divide by: no value, though covered.
    const zero = api.integrals(design, { custom: [{ key: 'zeros', source: { id: 'custom', table: [[400, 0], [700, 0]] } },
        { key: 'cold', source: { id: 'blackbody', T: 1 }, detector: { id: 'flat' } }] }).rows.slice(-2);
    ok('a row whose weighting is 0 over the whole band has no value, though covered', zero.every(r => Number.isNaN(r.value) && r.covered), JSON.stringify(zero));
}
{
    // computeColorReport shows nothing for a front with no layers; the API
    // gives the bare surface, the colour of spectrum's R on the same grid.
    const bare = api.newDesign({ name: 'Bare', substrate: 'BK7' });
    const zeroed = { ...api.stackFromFormula(bare, { formula: '(HL)^2' }) };
    zeroed.frontLayers = zeroed.frontLayers.map(layer => ({ ...layer, thickness: 0 }));
    const s = api.spectrum(bare, { from: 380, to: 780, step: 0.5 });
    const fromSpectrum = colorReport({ lambda: s.lambda, values: s.angles[0].R }, { observer: '2', illuminant: 'D65' });
    const got = api.color(bare);
    const shown = computeColorReport({ design: bare, evalMode: 'front', setError() {}, characteristic: 'R', pol: 'avg', theta: 0, observer: '2', illuminant: 'D65', step: 0.5 });
    const off = Math.max(Math.abs(got.Y - fromSpectrum.XYZ.Y), Math.abs(got.x - fromSpectrum.xy.x));
    ok('a front with no layers, where the window shows nothing, gives the bare surface\'s colour: that of spectrum\'s R, about 4 % for BK7, and the same with layers of no thickness',
        same([shown, got.mode, off < 1e-12, Math.round(got.Y), same(api.color(zeroed), got)], [null, 'front', true, 4, true]), `${got.Y} / ${fromSpectrum.XYZ.Y}`);
}
{
    // CIE 15:2004, Table T.3: chromaticity of the illuminants for the CIE 1931
    // standard colorimetric observer. The white is integrated on the API's
    // default 0.5 nm grid over 380-780 nm.
    const CIE = { D65: [0.31272, 0.32903], D50: [0.34567, 0.35851], A: [0.44757, 0.40745] };
    const design = api.stackFromFormula(api.newDesign({ name: 'Any' }), { formula: 'HL' });
    const off = Object.entries(CIE).map(([illuminant, [x, y]]) => {
        const { whiteXy } = api.color(design, { illuminant });
        return [illuminant, Math.max(Math.abs(whiteXy.x - x), Math.abs(whiteXy.y - y))];
    });
    ok('the D65, D50 and A whites are within 5e-5 of CIE 15:2004 Table T.3', off.every(([, d]) => d <= 5e-5), JSON.stringify(off));
}

// ── 4. The sides ───────────────────────────────────────────────────────────
{
    const pairs = corpus.filter(([, design]) => !hasCone(design)).flatMap(([name, design]) => MODES.flatMap(mode => SCORING.map(mfEvalMode => [`${name} ${mode}/${mfEvalMode}`, { ...made(design, mode), mfEvalMode }])));
    const wrong = pairs.filter(([, design]) => {
        const evalMode = resolveEvalMode(design);
        const colour = api.color(design, { step: 5 });
        const table = api.integrals(design, { step: 5 });
        return !same([colour.mode, table.mode], [evalMode, evalMode]) || !same(colour, api.color(design, { step: 5, side: evalMode })) || !same(table, api.integrals(design, { step: 5, side: evalMode }));
    }).map(([name]) => name);
    ok('without side both follow the design\'s evaluation mode, in every surface mode and scoring, as side does when given it', pairs.length >= 80 && wrong.length === 0, wrong.slice(0, 3).join('; '));
    // The windows' range notice: the materials of the sides computed
    // (rangeMaterials of the design's evaluation mode) over the band read.
    const notice = (design, mode, range) => materialsRangeCoverage(rangeMaterials(design, mode), range).offenders;
    const offRange = pairs.filter(([, design]) => {
        const evalMode = resolveEvalMode(design);
        return !same(api.color(design, { step: 5 }).outOfRange, notice(design, evalMode, COLOR_RANGE_NM))
            || !same(api.integrals(design, { step: 5 }).outOfRange, notice(design, evalMode, [300, 2500]));
    }).map(([name]) => name);
    const listing = pairs.filter(([, design]) => api.integrals(design, { step: 5 }).outOfRange.length > 0).length;
    ok(`outOfRange is the window's notice in every surface mode and scoring, ${listing} of ${pairs.length} listing a material`, offRange.length === 0 && listing > 0, offRange.slice(0, 3).join('; '));
    // HL on BK7 coated on the front alone with a ZnSe exit medium: only the
    // whole part reads ZnSe, whose data start at 500 nm.
    const hl = { ...api.stackFromFormula(api.newDesign({ name: 'HL', substrate: 'BK7' }), { formula: 'HL' }), surfaceMode: 'front_only', exitMedium: 'builtin:ZnSe' };
    const ids = result => result.outOfRange.map(o => o.id);
    const lists = [api.color(hl), api.color(hl, { side: 'total' }), api.color(hl, { side: 'back' })].map(ids);
    ok('the colour of a front with a ZnSe exit medium names ZnSe only when the whole part or the back is computed, as the window does',
        same(lists, [[], ['builtin:ZnSe'], ['builtin:ZnSe']]) && same(ids(api.color({ ...hl, mfEvalMode: 'total' })), notice(hl, 'total', COLOR_RANGE_NM).map(o => o.id)), JSON.stringify(lists));
    ok('and so do its integrals', !ids(api.integrals(hl, { start: 380, end: 780 })).includes('builtin:ZnSe') && ids(api.integrals(hl, { start: 380, end: 780, side: 'total' })).includes('builtin:ZnSe'));
    const [, design] = corpus.find(([n]) => n === 'front-only-total-mode');
    const sides = ['front', 'back', 'total'].map(side => {
        const shown = withHerpinRecords(design);
        const colour = windowColour(design, side, { quantity: 'T', angle: 0, pol: 'avg', observer: 2, illuminant: 'D65', step: 0.5 });
        return same(computed(api.color(design, { quantity: 'T', side })), colour) && api.color(design, { side }).mode === side
            && same(api.integrals(design, { side, custom: API_CUSTOM }).rows, windowIntegrals(shown, side, { start: 300, end: 2500, step: 0.5, angle: 0, pol: 'avg' }));
    });
    ok('side computes the front, the back or the whole part, as the window does in each mode', sides.every(Boolean), sides.join());
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const [, design] = corpus[0];
    const row = extra => ({ custom: [{ key: 'mine', ...extra }] });
    const REFUSED = [
        ['color', 'an option it does not take', () => api.color(design, { characteristic: 'R' }), 'unknownOption', { option: 'characteristic' }, /unknown option 'characteristic'; the options are quantity, angle, pol, observer, illuminant, step, side$/],
        ['color', 'a quantity it does not have', () => api.color(design, { quantity: 'A' }), 'badValue', { option: 'quantity', value: 'A' }, /quantity is 'R' or 'T', not "A"/],
        ['color', 'an observer of 3', () => api.color(design, { observer: 3 }), 'badValue', { option: 'observer', value: 3 }, /observer is 2 or 10, not 3$/],
        ['color', 'an observer given as text', () => api.color(design, { observer: '10' }), 'badValue', { option: 'observer', value: '10' }, /observer is 2 or 10, not "10"$/],
        ['color', 'an illuminant it does not have', () => api.color(design, { illuminant: 'F2' }), 'badValue', { option: 'illuminant', value: 'F2' }, /illuminant is 'D65', 'D50', 'A' or 'E', not "F2"$/],
        ['color', 'a polarization it does not have', () => api.color(design, { pol: 'te' }), 'badValue', { option: 'pol', value: 'te' }, /pol is 'avg', 's' or 'p', not "te"/],
        ['color', 'an angle of 90', () => api.color(design, { angle: 90 }), 'badValue', { option: 'angle', value: 90 }, /angle is an angle of incidence in degrees, 0 <= angle < 90, not 90/],
        ['color', 'a step of 0', () => api.color(design, { step: 0 }), 'badValue', { option: 'step', value: 0 }, /step is a wavelength step in nm above 0, not 0/],
        ['color', 'a side it does not have', () => api.color(design, { side: 'both' }), 'badValue', { option: 'side', value: 'both' }, /side is 'front', 'back' or 'total', not "both"/],
        ['integrals', 'an option it does not take', () => api.integrals(design, { from: 400 }), 'unknownOption', { option: 'from' }, /unknown option 'from'; the options are start, end, step, angle, pol, custom, side$/],
        ['integrals', 'a range that is not one', () => api.integrals(design, { start: 900, end: 400 }), 'wavelengthRange', { from: 900, to: 400 }, /start and end are wavelengths in nm, 0 < start < end$/],
        ['integrals', 'a polarization it does not have', () => api.integrals(design, { pol: 'tm' }), 'badValue', { option: 'pol', value: 'tm' }, /pol is 'avg', 's' or 'p', not "tm"/],
        ['integrals', 'an angle of 95', () => api.integrals(design, { angle: 95 }), 'badValue', { option: 'angle', value: 95 }, /not 95/],
        ['integrals', 'custom that is not a list', () => api.integrals(design, { custom: { key: 'mine' } }), 'badValue', { option: 'custom' }, /custom is a list of rows, each \{ key, quantity, source, detector, band \}/],
        ['integrals', 'a custom row that is not an object', () => api.integrals(design, { custom: ['mine'] }), 'badValue', { option: 'custom[0]', value: 'mine' }, /custom\[0\] is a row \{ key, quantity, source, detector, band \}, not "mine"/],
        ['integrals', 'a field a row does not have', () => api.integrals(design, row({ char: 'T' })), 'unknownOption', { option: 'custom[0].char' }, /unknown option 'custom\[0\]\.char'; the options are key, quantity, source, detector, band$/],
        ['integrals', 'a row with no key', () => api.integrals(design, { custom: [{ quantity: 'T' }] }), 'badValue', { option: 'custom[0].key' }, /custom\[0\]\.key is a name, as text, other than Tvis, .*RNIR, not undefined/],
        ['integrals', 'a built-in key', () => api.integrals(design, { custom: [{ key: 'Tsol' }] }), 'badValue', { option: 'custom[0].key', value: 'Tsol' }, /not "Tsol"$/],
        ['integrals', 'a key another row has', () => api.integrals(design, { custom: [{ key: 'mine' }, { key: 'mine' }] }), 'badValue', { option: 'custom[1].key', value: 'mine' }, /other than .*RNIR, mine, not "mine"$/],
        ['integrals', 'a quantity it does not have', () => api.integrals(design, row({ quantity: 'Ts' })), 'badValue', { option: 'custom[0].quantity', value: 'Ts' }, /'T', 'R' or 'A', not "Ts"/],
        ['integrals', 'a band backwards', () => api.integrals(design, row({ band: [780, 380] })), 'badValue', { option: 'custom[0].band' }, /band is \[start, end\] in nm, start < end, not \[780,380\]/],
        ['integrals', 'a source it does not have', () => api.integrals(design, row({ source: { id: 'F11' } })), 'badValue', { option: 'custom[0].source' }, /source is \{ id \} with an id of 'D65', 'D50', 'A', 'AM1\.5G', 'E', 'blackbody' or 'custom'/],
        ['integrals', 'a source given by its name alone', () => api.integrals(design, row({ source: 'D65' })), 'badValue', { option: 'custom[0].source', value: 'D65' }, /not "D65"$/],
        ['integrals', 'a blackbody below 0 K', () => api.integrals(design, row({ source: { id: 'blackbody', T: -5 } })), 'badValue', { option: 'custom[0].source' }, /a blackbody with T, its temperature in K above 0/],
        ['integrals', 'a custom source with no table', () => api.integrals(design, row({ source: { id: 'custom' } })), 'badValue', { option: 'custom[0].source' }, /a custom one with its table of \[nm, value\] rows, at least two at different wavelengths, not \{"id":"custom"\}$/],
        ['integrals', 'a table of one row, a band of no width', () => api.integrals(design, row({ detector: { id: 'custom', table: [[532, 1]] } })), 'badValue', { option: 'custom[0].detector' }, /at least two at different wavelengths, not \{"id":"custom","table":\[\[532,1\]\]\}$/],
        ['integrals', 'a table whose rows share one wavelength', () => api.integrals(design, row({ source: { id: 'custom', table: [[532, 1], [532, 2]] } })), 'badValue', { option: 'custom[0].source' }, /not \{"id":"custom","table":\[\[532,1\],\[532,2\]\]\}$/],
        ['integrals', 'a table with a row of one number', () => api.integrals(design, row({ source: { id: 'custom', table: [[400, 1], [500]] } })), 'badValue', { option: 'custom[0].source' }, /not \{"id":"custom","table":\[\[400,1\],\[500\]\]\}$/],
        ['integrals', 'a temperature on a source that reads none', () => api.integrals(design, row({ source: { id: 'D65', T: 3000 } })), 'badValue', { option: 'custom[0].source' }, /not \{"id":"D65","T":3000\}$/],
        ['integrals', 'a detector it does not have', () => api.integrals(design, row({ detector: { id: 'scotopic' } })), 'badValue', { option: 'custom[0].detector' }, /detector is \{ id \} with an id of 'photopic', 'flat' or 'custom' and a custom one/],
        ['integrals', 'a custom detector with no table', () => api.integrals(design, row({ detector: { id: 'custom', table: [] } })), 'badValue', { option: 'custom[0].detector' }, /not \{"id":"custom","table":\[\]\}$/],
    ];
    for (const [call, what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call, ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`${call} refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith(`${call}: `)], [code, { call, ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const many = [thrown(() => api.color(design, { step: 0.0001 }))?.message, thrown(() => api.integrals(design, { step: 0.001 }))?.message];
    ok('more wavelengths than the API\'s point limit is refused by both, as spectrum refuses them', /^color: 4000001 points .* is more than 1000000; take a larger step$/.test(many[0])
        && /^integrals: 2200001 points .* is more than 1000000; take a larger step$/.test(many[1]), many.join(' / '));
    const [[name, lost] = []] = unresolved;
    const messages = ['color', 'integrals', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused by both, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
