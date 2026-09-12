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

    const refLambda = design.referenceWavelength > 0 ? design.referenceWavelength : lambdaNm;
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
            const material = legacyMaterial(layer.material);
            const [nr, nk] = material.getNK(lambdaNm);
            return {
                n: [nr, nk], nRef: material.getNK(refLambda)[0],
                d: layer.thickness, materialId: layer.material,
            };
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
        return { s, p, avg, validLayers, side, incidentIndex, refLambda };
    }
    const result = computeEFieldProfile(lambdaNm, thetaDeg, pol, n0, ns, layerInput, 60);
    return { [pol]: result, validLayers, side, incidentIndex, refLambda };
}

const design = makeSampleDesign();
design.backLayers = [
    { material: 'builtin:SiO2', thickness: 60 },
    { material: 'builtin:TiO2', thickness: 40 },
];

const front = computeProfile(design, { lambda: 550, theta: 37, pol: 'avg', side: 'front' });
assert.deepEqual(front, legacyProfile(design, 550, 37, 'avg', 'front'),
    'front profile or numerical operation order changed');
assert.equal(front.side, 'front');
assert.equal(front.avg.e2.length, front.s.e2.length);
assert.deepEqual(front.avg.e2, front.s.e2.map((v, i) => (v + front.p.e2[i]) / 2));

const back = computeProfile(design, { lambda: 550, theta: 37, pol: 's', side: 'back' });
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

// ── Depth axis ───────────────────────────────────────────────────────────────
//
// Optical distance accumulates n·d layer by layer, and n is taken at the
// design's reference wavelength rather than at the wavelength the field is
// computed at. That is Essential Macleod's convention: its Electric Field plot
// measures optical distance from the medium in FWOT, and the manual fixes
// those "in terms of full waves at the reference wavelength". It is also what
// makes the axis line up with the Design Editor's thickness column.
const REF_LAMBDA = 550;
const offReference = computeProfile(design, { lambda: 700, theta: 0, pol: 's', side: 'front' });
assert.equal(offReference.refLambda, REF_LAMBDA);

const nRef = offReference.validLayers.map(layer => layer.nRef);
assert.deepEqual(nRef, design.frontLayers.map(
    layer => legacyMaterial(layer.material).getNK(REF_LAMBDA)[0]));
assert.notDeepEqual(nRef, offReference.validLayers.map(layer => layer.n[0]),
    'the axis index is sampled at λ₀, not at the wavelength the field is computed at');

const opticalTotal = offReference.validLayers.reduce((sum, l) => sum + l.nRef * l.d, 0);
const axisFor = xUnit => efieldOption(offReference, 's', {}, {}, {
    tr: ef, display: { ...PERCENT, xUnit },
});

// Each unit ends the axis at the whole stack, measured in that unit.
for (const [xUnit, expected] of [
    ['nm', 190],
    ['OT', opticalTotal],
    ['QWOT', (4 * opticalTotal) / REF_LAMBDA],
    ['FWOT', opticalTotal / REF_LAMBDA],
]) {
    const { min, max, name } = axisFor(xUnit).xAxis;
    assert.equal(min, 0, `${xUnit} axis starts at the incident medium`);
    assert.ok(Math.abs(max - expected) < 1e-9, `${xUnit} axis ends at the whole stack`);
    assert.equal(name, xUnit === 'nm' ? ef.xAxisTitle
        : ef.xAxisOptical(ef.xUnits[xUnit], REF_LAMBDA),
    `${xUnit} axis names its own unit`);
}

// The boundary between the two layers sits at the first layer's own FWOT, the
// number the Design Editor's thickness column shows for that row.
const FWOT = { ...PERCENT, xUnit: 'FWOT' };
const fwotOption = axisFor('FWOT');
assert.ok(Math.abs(fwotOption.series[0].markLine.data[0].xAxis
    - (nRef[0] * 100) / REF_LAMBDA) < 1e-12, 'the boundary is drawn in the axis unit');
assert.deepEqual(fwotOption.series[0].markArea.data.map(pair => pair[0].xAxis),
    [0, (nRef[0] * 100) / REF_LAMBDA], 'the material bands follow the boundaries');

// Inside a layer the axis is linear in that layer's index, with the optical
// thickness of everything above it in front.
const depths = offReference.s.z;
const drawnX = efieldSeries(offReference, 's', undefined, ef, FWOT)[0].data.map(point => point[0]);
const inFirst = depths.findIndex(z => z > 0 && z < 100);
const inSecond = depths.findIndex(z => z > 100);
assert.ok(Math.abs(drawnX[inFirst] - (nRef[0] * depths[inFirst]) / REF_LAMBDA) < 1e-12);
assert.ok(Math.abs(drawnX[inSecond]
    - (nRef[0] * 100 + nRef[1] * (depths[inSecond] - 100)) / REF_LAMBDA) < 1e-12);

// The table reads the same coordinate as the plot, and its heading carries the
// unit so an exported file is not read back as nanometres.
const fwotTable = buildProfileTable(offReference, 's', ef, FWOT);
assert.equal(fwotTable.columns[0].label, ef.xColumns.FWOT);
assert.equal(fwotTable.columns[0].fmt(0.123456), '0.1235');
assert.deepEqual(fwotTable.rows.map(row => row.z), drawnX);

// An unknown unit, or a profile with no λ₀, falls back to physical depth
// rather than labelling the axis with a unit it is not in. Optical distance in
// nanometres needs λ₀ too: its indices were read there and its title says so.
const { depthScale } =
    await import('../src/components/windows/analysis/eFieldEvaluation/xScale.js');
assert.equal(depthScale(offReference, 'bogus').id, 'nm');
for (const unit of ['OT', 'QWOT', 'FWOT']) {
    assert.equal(depthScale({ ...offReference, refLambda: 0 }, unit).id, 'nm',
        `${unit} without a λ₀ falls back rather than titling the axis with one`);
}
assert.equal(depthScale(null, 'FWOT').total, 0);

// λ₀ typed in the window, for reading a stack against a wavelength it was not
// written in. The field is still computed at the plot wavelength; only the
// indices the axis accumulates move.
const typedRef = computeProfile(design, {
    lambda: 700, theta: 0, pol: 's', side: 'front', refLambda: 1064,
});
assert.equal(typedRef.refLambda, 1064);
assert.deepEqual(typedRef.s.e2, offReference.s.e2, 'the field does not depend on the axis λ₀');
assert.deepEqual(typedRef.validLayers.map(layer => layer.nRef),
    design.frontLayers.map(layer => legacyMaterial(layer.material).getNK(1064)[0]));
assert.equal(efieldOption(typedRef, 's', {}, {}, { tr: ef, display: FWOT }).xAxis.name,
    ef.xAxisOptical(ef.xUnits.FWOT, 1064));

// A design that carries no reference wavelength falls through to the
// wavelength the field is computed at, so there is always an index to read.
const noRef = computeProfile({ ...design, referenceWavelength: 0 },
    { lambda: 700, theta: 0, pol: 's', side: 'front' });
assert.equal(noRef.refLambda, 700);

console.log('PASS: e_field_evaluation_characterization');
