/**
 * The step of a spectrum read in another spectral unit.
 *
 * nm and µm sample a spectrum evenly in wavelength. cm⁻¹, THz and eV are each
 * proportional to 1/λ, so a spectrum read in one of them is sampled evenly in
 * wavenumber and its step is entered in that unit. Switching between the two
 * kinds converts the step so the range keeps its number of points; within a
 * kind the points stay where they are. The results table, the crosshair and the
 * CSV read in the unit, and Settings and the report's spectrum block follow the
 * same rule.
 *
 * Run: node tests/spectral_unit_step.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildLambdaGrid, evaluateSpectrumAt } = await import('../src/utils/physics/thinFilmMath.js');
const { buildWavenumberGrid, spectralGrid } = await import('../src/utils/physics/spectralGrid.js');
const { gridEvenIn, spectralStepControl, switchSpectralUnit } = await import('../src/utils/physics/spectralAxis.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');
const { parseSpectrumTable, makeMeasuredCurve, X_UNITS } = await import('../src/utils/io/spectrumTable.js');
const { computeOpticalSpectrum } = await import('../src/components/windows/analysis/opticalEvaluation/spectrum.js');
const { buildChartOption, buildCSV } = await import('../src/components/windows/analysis/opticalEvaluation/model.js');
const { DataTable } = await import('../src/components/windows/analysis/opticalEvaluation/DataTable.js');
const { SpectralRange } = await import('../src/components/windows/analysis/opticalEvaluation/SetupPanel.js');
const { SpectralRangeRows } = await import('../src/components/dialogs/settings/analysis/SpectralRangeRows.js');
const { evalParamsSession } = await import('../src/state/evalParamsSession.js');
const { BlockSettingsPanel } = await import('../src/components/windows/information/report/BlockSettings.js');
const { settingsFromWindow } = await import('../src/components/windows/information/report/blockSources.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');

const c = makeTheme();
const en = makeLocale('en');
const UNITS = ['nm', 'um', 'cm1', 'THz', 'eV'];

// A two-layer coating on glass, with materials from the built-in library.
const design = {
    id: 'two-layer', name: 'Two layers', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ material: 'TiO2', thickness: 60 }, { material: 'SiO2', thickness: 95 }],
    backLayers: [], surfaceMode: 'front_only',
};

// ── The grid even in wavenumber ──────────────────────────────────────────────
{
    // 400-800 nm is 25000-12500 cm⁻¹: 800 steps of 15.625 cm⁻¹.
    const grid = buildWavenumberGrid(400, 800, 15.625);
    assert.equal(grid.length, 801, 'one point per step, both ends included');
    assert.equal(grid[0], 400, 'the range starts on its own wavelength');
    assert.equal(grid[800], 800, 'and ends on its own wavelength');
    for (let i = 1; i < grid.length; i++) {
        assert.ok(grid[i] > grid[i - 1], `point ${i} lies above point ${i - 1} in wavelength`);
        const step = 1e7 / grid[i - 1] - 1e7 / grid[i];
        assert.ok(Math.abs(step - 15.625) < 1e-6, `points ${i - 1} and ${i} are ${step} cm⁻¹ apart, not 15.625`);
    }
}
{
    // Every 1000 cm⁻¹ down from 25000 stops at 13000; the end follows after
    // one shorter interval, at the long-wave end.
    const grid = buildWavenumberGrid(400, 800, 1000);
    assert.equal(grid.length, 14);
    assert.equal(grid[12], 769.230769231, 'the last full step, at 13000 cm⁻¹');
    assert.equal(grid[13], 800, 'then the end wavelength');
}
{
    const range = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 0.5, wavenumberStep: 15.625 };
    assert.deepEqual(spectralGrid({ ...range, evenIn: 'wavenumber' }), buildWavenumberGrid(400, 800, 15.625),
        'a spectrum read in cm⁻¹, THz or eV is sampled evenly in wavenumber');
    assert.deepEqual(spectralGrid({ ...range, evenIn: 'wavelength' }), buildLambdaGrid(400, 800, 0.5),
        'one read in nm or µm evenly in wavelength');
    assert.deepEqual(spectralGrid({ lambdaStart: 400, lambdaEnd: 420, lambdaStep: 5 }), [400, 405, 410, 415, 420],
        'as is one that names no unit');
}

// ── Switching the unit ───────────────────────────────────────────────────────
{
    const nm = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 0.5, wavenumberStep: 3, spectralUnit: 'nm' };
    const toCm = switchSpectralUnit(nm, 'cm1');
    assert.deepEqual(toCm, { spectralUnit: 'cm1', wavenumberStep: 15.625 },
        '0.5 nm over 400-800 nm is 800 intervals, so the cm⁻¹ step is 12500 / 800');
    const cm = { ...nm, ...toCm };
    assert.deepEqual(switchSpectralUnit(cm, 'nm'), { spectralUnit: 'nm', lambdaStep: 0.5 }, 'and switching back gives 0.5 nm');
    assert.deepEqual(switchSpectralUnit(nm, 'um'), { spectralUnit: 'um' }, 'nm to µm leaves the points where they are');
    assert.deepEqual(switchSpectralUnit(cm, 'eV'), { spectralUnit: 'eV' }, 'and so does cm⁻¹ to eV');
    assert.deepEqual(switchSpectralUnit({ ...nm, lambdaEnd: 400 }, 'cm1'), { spectralUnit: 'cm1' },
        'a range of one wavelength has no intervals to keep, so its step stays as it is');
}
{
    // A step that does not divide the range: 571.4 intervals of 0.7 nm.
    const odd = { lambdaStart: 380, lambdaEnd: 780, lambdaStep: 0.7, wavenumberStep: 1, spectralUnit: 'nm' };
    const there = { ...odd, ...switchSpectralUnit(odd, 'THz') };
    assert.equal(spectralGrid({ ...there, evenIn: 'wavenumber' }).length, buildLambdaGrid(380, 780, 0.7).length,
        'the range keeps its number of points in THz');
    const back = { ...there, ...switchSpectralUnit(there, 'nm') };
    assert.ok(Math.abs(back.lambdaStep - 0.7) < 1e-9, `and comes back at 0.7 nm, not ${back.lambdaStep}`);
}
{
    const defaults = Object.fromEntries(Object.entries(ANALYSIS_DEFAULTS.opticalEvaluation.numbers)
        .map(([key, spec]) => [key, spec.def]));
    assert.equal(spectralGrid({ ...defaults, evenIn: 'wavenumber' }).length, spectralGrid(defaults).length,
        'out of the box, cm⁻¹, THz and eV sample the range with as many points as nm does');
}

// ── The step field in each unit ──────────────────────────────────────────────
{
    const params = { lambdaStep: 0.5, wavenumberStep: 15.625 };
    assert.deepEqual(UNITS.map(unit => spectralStepControl(unit, params).value), [0.5, 0.0005, 15.625, 0.46843, 0.0019373],
        'the step reads in the unit, to five significant figures');
    assert.deepEqual(spectralStepControl('um', params).patch(0.001), { lambdaStep: 1 }, 'a step typed in µm is stored in nm');
    const typed = { nm: 0.25, um: 0.002, cm1: 20, THz: 0.5, eV: 0.002 };
    for (const unit of UNITS) {
        const stored = { ...params, ...spectralStepControl(unit, params).patch(typed[unit]) };
        assert.equal(spectralStepControl(unit, stored).value, typed[unit], `a step typed in ${unit} reads back as typed`);
    }
}

// ── The window computes on that grid ─────────────────────────────────────────
{
    const params = {
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 0.5, wavenumberStep: 250, evenIn: 'wavenumber', thetas: [0],
    };
    const shown = computeOpticalSpectrum(design, params, 'front');
    const grid = buildWavenumberGrid(400, 800, 250);
    assert.deepEqual(shown.lambda, grid, 'Optical Evaluation in cm⁻¹, THz or eV computes at wavelengths even in wavenumber');
    const layers = design.frontLayers.map(layer => ({ material: getMaterial(layer.material), thickness: layer.thickness }));
    const direct = evaluateSpectrumAt(grid, { theta: 0, polarization: 'avg' }, getMaterial('Air'), getMaterial('BK7'), layers);
    shown.series[0].T.forEach((value, i) => assert.ok(Math.abs(value - direct.T[i]) < 1e-12,
        `T at ${grid[i]} nm is the coating's own: ${value} vs ${direct.T[i]}`));
}

// ── The results table reads in the unit ──────────────────────────────────────
{
    const table = (locale, spectralUnit, lambda) => renderToStaticMarkup(React.createElement(DataTable, {
        data: { lambda, series: [{ theta: 0, T: lambda.map(() => 0.9) }] },
        showCurves: { T: true }, yScale: 'percent', spectralUnit, units: locale.units, c, oe: locale.opticalEval,
    }));
    const grid = buildWavenumberGrid(400, 800, 15.625).slice(0, 3);
    const cm = table(en, 'cm1', grid);
    assert.ok(cm.includes('ν̃ (cm⁻¹)'), 'the heading names the wavenumber in cm⁻¹');
    assert.match(cm, />25000\.000</, 'the rows are wavenumbers');
    assert.match(cm, />24984\.375</, 'to the decimals of the 15.625 cm⁻¹ step');
    assert.ok(table(makeLocale('ru'), 'cm1', grid).includes('ν̃ (см⁻¹)'), 'the unit is written in the language\'s own script');
    const ev = table(en, 'eV', grid);
    assert.ok(ev.includes('E (eV)'), 'a table in eV reads photon energy');
    assert.match(ev, />3\.0996050</, 'to the decimals of its 0.0019373 eV step');
    const um = table(en, 'um', [400, 400.5]);
    assert.ok(um.includes(`λ (${en.units.um})`), 'one in µm reads wavelength in µm');
    assert.match(um, />0\.4005</);
}

// ── The crosshair reads in the unit ──────────────────────────────────────────
{
    const data = { lambda: [500, 600], series: [{ theta: 0, T: [0.9, 0.8] }] };
    const tooltip = spectralUnit => buildChartOption({
        data, showCurves: { T: true }, targets: [], targetsVisible: false, overlays: [],
        paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
        editMode: false, yRange: { auto: true }, spectralUnit, lamRange: { min: 500, max: 600 },
        spectralTitles: en.spectralAxis, curveLabels: en.opticalEval.curveLabels, legendNames: en.legendNames,
    }).tooltip;
    // 1e7 / 17000 nm is 588.24 nm, 17000 cm⁻¹, 509.65 THz and 2.1077 eV.
    const at = 1e7 / 17000;
    const label = unit => tooltip(unit).axisPointer.label.formatter({ axisDimension: 'x', value: at });
    assert.deepEqual(UNITS.map(label), ['588.24', '0.58824', '17000', '509.65', '2.1077'],
        'the label under the crosshair reads the pointer in the axis unit');
    const readout = tooltip('cm1').formatter([{ axisValue: at, seriesIndex: 0, value: [at, 90], marker: '' }]);
    assert.ok(readout.startsWith('<div style="margin-bottom:3px">17000</div>'), 'and so does the readout\'s first line');
}

// ── The CSV reads in the unit, and imports back ──────────────────────────────
{
    // Each unit's CSV is written from the points the window samples in it: even
    // in wavelength for nm and µm, even in wavenumber for cm⁻¹, THz and eV.
    const gridFor = unit => (gridEvenIn(unit) === 'wavenumber'
        ? buildWavenumberGrid(400, 800, 15.625) : buildLambdaGrid(400, 800, 0.5));
    const csv = unit => {
        const lambda = gridFor(unit);
        const data = { lambda, series: [{ theta: 0, T: lambda.map(() => 0.9), R: lambda.map(() => 0.1) }] };
        return buildCSV(data, { T: true, R: true }, 'percent', unit);
    };
    const firstColumn = text => text.split('\n').slice(0, 3).map(row => row.split(',')[0]);
    assert.deepEqual(firstColumn(csv('nm')), ['lambda_nm', '400.00', '400.50'], 'in nm the CSV is written as before');
    assert.deepEqual(firstColumn(csv('cm1')), ['Wavenumber (cm-1)', '25000.000', '24984.375'],
        'in cm⁻¹ the first column is the wavenumber, to the decimals the table prints');
    const imported = { um: X_UNITS.UM, cm1: X_UNITS.CM1, eV: X_UNITS.EV };
    for (const [unit, xUnit] of Object.entries(imported)) {
        const lambda = gridFor(unit);
        const read = parseSpectrumTable(csv(unit));
        assert.equal(read.xUnit, xUnit, `a CSV in ${unit} is read as ${xUnit}`);
        const curve = makeMeasuredCurve({ x: read.x, xUnit: read.xUnit, y: read.columns[0].values, quantity: 'T', isPercent: true });
        const worst = Math.max(...curve.x.map((nm, i) => Math.abs(nm - lambda[i])));
        assert.ok(curve.x.length === lambda.length && worst < 1e-4,
            `and imports at the wavelengths it was written at, within ${worst} nm`);
    }
    const fine = buildCSV({ lambda: [400, 400.001], series: [{ theta: 0, T: [0.9, 0.9] }] }, { T: true }, 'percent', 'nm');
    assert.deepEqual(firstColumn(fine).slice(1), ['400.000', '400.001'], 'a step under 0.01 nm does not print two rows alike');
}

// ── Settings → Analysis ──────────────────────────────────────────────────────
{
    const rowsIn = (numbers, spectralUnit, stored) => SpectralRangeRows({
        registry: ANALYSIS_DEFAULTS.opticalEvaluation,
        resolved: resolveAnalysisSettings('opticalEvaluation', { opticalEvaluation: { numbers, enums: { spectralUnit } } }),
        onChange: (section, key, value) => stored.push([section, key, value]),
        c, t: en,
    }).props.children.filter(Boolean);

    const stored = [];
    const [unitRow] = rowsIn({ lambdaStep: 1 }, 'nm', stored);
    unitRow.props.onChange('cm1');
    assert.deepEqual(stored, [['enums', 'spectralUnit', 'cm1'], ['numbers', 'wavenumberStep', 31.25]],
        'switching Settings to cm⁻¹ converts the step as the window does: 1 nm over 400-800 nm is 31.25 cm⁻¹');

    const typed = [];
    const [, , , stepRow] = rowsIn({ wavenumberStep: 15.625 }, 'eV', typed);
    assert.equal(stepRow.props.label, en.settings.analysis.rangeStep(en.units.eV), 'the step row is labelled in the unit');
    assert.equal(stepRow.props.value, 0.0019373, 'and reads in it');
    stepRow.props.onCommit(0.002);
    assert.equal(typed.length, 1);
    assert.deepEqual(typed[0].slice(0, 2), ['numbers', 'wavenumberStep'], 'a step typed in eV is stored as a wavenumber step');
    assert.equal(spectralStepControl('eV', { wavenumberStep: typed[0][2] }).value, 0.002, 'that reads back as typed');
}

// ── The report's spectrum block ──────────────────────────────────────────────
{
    const block = newBlock('spectrum', { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 1, spectralUnit: 'nm' });
    const changes = [];
    const panel = BlockSettingsPanel({
        c, W: en.report.window, t: en, block, index: 0, count: 1, design,
        onChange: (id, change) => changes.push(change), onMove() {}, onRemove() {}, onClose() {},
    });
    const range = panel[1].props.children.flat().find(child => child?.type === SpectralRange);
    range.props.setSpectralUnit('cm1');
    assert.deepEqual(changes, [{ spectralUnit: 'cm1', wavenumberStep: 31.25 }],
        'switching the block to cm⁻¹ converts its step as the window does');

    const switched = newBlock('spectrum', { ...block.settings, ...changes[0] });
    const data = gatherDesignData(design, [switched]).blocks[switched.id];
    assert.deepEqual(data.lambda, buildWavenumberGrid(400, 800, 31.25), 'and the block computes on the grid even in wavenumber');
    const kept = gatherDesignData(design, [block]).blocks[block.id];
    assert.deepEqual(kept.lambda, buildLambdaGrid(400, 800, 1), 'while a block in nm keeps its grid even in wavelength');

    evalParamsSession.write(null, { spectralUnit: 'eV', wavenumberStep: 40 });
    const copied = settingsFromWindow('spectrum', design);
    assert.equal(copied.spectralUnit, 'eV');
    assert.equal(copied.wavenumberStep, 40, 'a block made from the window copies its eV step');
}

console.log('spectral_unit_step: passed');
