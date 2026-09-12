import assert from 'node:assert/strict';
import {
    loadApp,
    makeSampleDesign,
    shimBrowserGlobals,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { computeProfile } =
    await import('../src/components/windows/analysis/eFieldEvaluation/profileModel.js');
const { computeEFieldProfile } = await import('../src/utils/physics/thinFilmMath.js');
const { getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { buildProfileTable } =
    await import('../src/components/windows/analysis/eFieldEvaluation/profileViewModel.js');
const { efieldOption, efieldSeries } =
    await import('../src/components/windows/analysis/eFieldEvaluation/chartModel.js');

const { plotMargin } =
    await import('../src/components/windows/analysis/chrome/plot.js');

// Curve names and axis titles are display text, so they come from the locale
// rather than from the chart and table modules.
const { getLocale } = await import('../src/constants/locales/index.js');
const ef = getLocale('en').eField;

function legacyMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function legacyProfile(design, lambdaNm, thetaDeg, pol, side = 'front') {
    if (!design) return null;
    const sourceLayers = side === 'back' ? design.backLayers : design.frontLayers;
    if (!sourceLayers?.length) return null;

    const incident = legacyMaterial(side === 'back' ? design.exitMedium : design.incidentMedium);
    const substrate = legacyMaterial(design.substrate?.material);
    const n0raw = incident.getNK(lambdaNm);
    const nsraw = substrate.getNK(lambdaNm);
    const n0 = [n0raw[0], n0raw[1]];
    const ns = [nsraw[0], nsraw[1]];
    const ordered = side === 'back' ? [...sourceLayers].reverse() : sourceLayers;
    const validLayers = ordered
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => {
            const [nr, nk] = legacyMaterial(layer.material).getNK(lambdaNm);
            return { n: [nr, nk], d: layer.thickness, materialId: layer.material };
        });
    if (!validLayers.length) return null;

    const layerInput = validLayers.map(({ n, d }) => ({ n, d }));
    const incidentIndex = n0[0];
    if (pol === 'avg') {
        const s = computeEFieldProfile(lambdaNm, thetaDeg, 's', n0, ns, layerInput, 60);
        const p = computeEFieldProfile(lambdaNm, thetaDeg, 'p', n0, ns, layerInput, 60);
        const mean = key => s[key].map((value, index) => (value + p[key][index]) / 2);
        const avg = {
            ...s, e2: mean('e2'), e2Tangential: mean('e2Tangential'), e2Normal: mean('e2Normal'),
        };
        return { s, p, avg, validLayers, side, incidentIndex };
    }
    const result = computeEFieldProfile(lambdaNm, thetaDeg, pol, n0, ns, layerInput, 60);
    return { [pol]: result, validLayers, side, incidentIndex };
}

const design = makeSampleDesign();
design.backLayers = [
    { material: 'builtin:SiO2', thickness: 60 },
    { material: 'builtin:TiO2', thickness: 40 },
];

const front = computeProfile(design, 550, 37, 'avg', 'front');
assert.deepEqual(front, legacyProfile(design, 550, 37, 'avg', 'front'),
    'front profile or numerical operation order changed');
assert.equal(front.side, 'front');
assert.equal(front.avg.e2.length, front.s.e2.length);
assert.deepEqual(front.avg.e2, front.s.e2.map((v, i) => (v + front.p.e2[i]) / 2));

const back = computeProfile(design, 550, 37, 's', 'back');
assert.deepEqual(back, legacyProfile(design, 550, 37, 's', 'back'),
    'back profile or propagation order changed');
assert.equal(back.side, 'back');
assert.deepEqual(back.validLayers.map(layer => layer.materialId), ['builtin:TiO2', 'builtin:SiO2']);
assert.deepEqual(back.validLayers.map(layer => layer.d), [40, 60]);

// The percentage quantity is today's reading of the total field, so the view
// model, the table and the series are characterized against it.
const PERCENT = { quantity: 'fractionSquared', component: 'total' };

const table = buildProfileTable(front, 'avg', ef, PERCENT);
assert.deepEqual(table.columns.map(column => column.label), [
    'z (nm)', '|E|² (avg) [%]', '|E|² (s-pol) [%]', '|E|² (p-pol) [%]',
]);
assert.equal(table.rows.length, front.avg.z.length);
assert.equal(table.rows[7].c0, front.avg.e2[7] * 100);

const series = efieldSeries(front, 'avg', undefined, ef, PERCENT);
assert.deepEqual(series.map(item => item.name),
    ['|E|² (avg)', '|E|² (s-pol)', '|E|² (p-pol)']);
assert.deepEqual(series[0].data.map(point => point[1]), front.avg.e2.map(value => value * 100));
const option = efieldOption(front, 'avg', {}, {
    bgColor: '#1', paperColor: '#2', gridColor: '#3', textColor: '#4', accentColor: '#5',
}, { tr: ef, display: PERCENT });
assert.equal(option.xAxis.name, ef.xAxisTitle);
assert.equal(option.yAxis.name, '|E|² (%)');
// A readout with no unit is ambiguous once three quantities are on offer, and
// the suffix only reaches the tooltip when a formatter is installed.
assert.equal(typeof option.tooltip.formatter, 'function',
    'the hover readout has no formatter, so its unit would be dropped');

// The three components are three readings of one computed profile, so a
// component on its own keeps the axis symbol and the array it reads.
for (const [component, symbol, key] of [
    ['tangential', '|Eₜ|²', 'e2Tangential'],
    ['normal', '|Eₙ|²', 'e2Normal'],
]) {
    const display = { quantity: 'fractionSquared', component };
    const drawn = efieldSeries(front, 'p', undefined, ef, display);
    assert.deepEqual(drawn[0].data.map(point => point[1]), front.p[key].map(value => value * 100));
    assert.equal(efieldOption(front, 'p', {}, {}, { tr: ef, display }).yAxis.name, `${symbol} (%)`);
}

// Amplitude in V/m for 1 W/m^2 incident is the default quantity. The sample
// design sits in air, so the incident amplitude is the vacuum value and the
// axis is floored at it.
const AMPLITUDE = { quantity: 'amplitude', component: 'total' };
const vacuumAmplitude = Math.sqrt(2 / (8.8541878128e-12 * 2.99792458e8));
const amplitudeSeries = efieldSeries(front, 's', undefined, ef, AMPLITUDE);
assert.deepEqual(amplitudeSeries[0].data.map(point => point[1]),
    front.s.e2.map(value => Math.sqrt(value) * vacuumAmplitude));
const amplitudeOption = efieldOption(front, 's', {}, {}, { tr: ef, display: AMPLITUDE });
assert.equal(amplitudeOption.yAxis.name, 'E (V/m)');
assert.ok(Math.abs(amplitudeOption.series[0].markLine.data.at(-1).yAxis - vacuumAmplitude) < 1e-9,
    'the incident level is ruled at the incident amplitude');
assert.deepEqual([option.xAxis.min, option.xAxis.max], [0, 190]);
// Shared margin and axis-title treatment. The Results strip sits directly under
// this plot, so a title without the standoff ends up against it.
assert.deepEqual(
    [option.grid.left, option.grid.right, option.grid.top, option.grid.bottom],
    Object.values(plotMargin()),
);
assert.equal(option.xAxis.nameGap, 30);
assert.equal(option.xAxis.nameTextStyle.fontSize, 11);
assert.equal(option.series[0].markArea.data.length, 2);
assert.equal(option.series[0].markLine.data.find(mark => mark.yAxis === 100).lineStyle.color, '#588');
assert.equal(option.yAxis.interval, 10, 'the percentage axis is still ruled in tens');

console.log('PASS: e_field_evaluation_characterization');
