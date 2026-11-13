/**
 * The Plot Engine's quantities read what their own windows show, on a 2D curve
 * and over a Heatmap or 3D surface.
 *
 *   1. Phase, GD, GDD and TOD along wavelength, along AOI and over a layer
 *      thickness match the GD/GDD window (tf.groupDelay), on one side and on
 *      the whole part.
 *   2. Ψ and Δ along wavelength, along AOI and over a layer thickness match the
 *      Ellipsometry window (tf.ellipsometry, tf.ellipsometryVsAngle).
 *   3. MF over a layer thickness is the MF surface over that thickness, and
 *      the Merit Function Editor's MF at the design's own thickness.
 *   4. T over a layer thickness is the optical surface over that thickness.
 *   5. One quantity against another: Ψ on x and Δ on y over a thickness are
 *      the two curves against that thickness.
 *   6. MF has no value along wavelength or AOI, nor without merit operands.
 *   7. A surface of GD, GDD or TOD, of Ψ or Δ, is the window's value at each
 *      point's wavelength, angle and layer thicknesses, two layers' included.
 *   8. The surface workers give the GD surface the main thread gives.
 *   9. A Ψ-Δ path is drawn with a gap where Δ wraps.
 *
 * Run: node tests/plot_engine_quantities.mjs
 */
import assert from 'node:assert/strict';
import { fixtureFile } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const { computeSurface, makeDefaultCurve } = await import('../src/utils/physics/plotQuantities.js');
const { computeCurveResults } = await import('../src/components/windows/analysis/plotEngine/curveResults.js');
const { runSurfaceSweep } = await import('../src/components/windows/analysis/plotEngine/surfaceRunner.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { standInSurfaceWorker } = await import('./_surfaceWorker.mjs');

await api.init();

const clone = value => JSON.parse(JSON.stringify(value));
const axis = (quantity, side = 'front', polarization = 'avg') => ({ quantity, side, polarization });
const sweepAxis = axis('sweep');

// One curve computed as the analysis worker computes it.
function curveOf(design, fields) {
    const curve = makeDefaultCurve({ x: sweepAxis, ...fields });
    const result = computeCurveResults([curve], design)[curve.id];
    assert.ok(result, `a result for ${JSON.stringify(fields)}`);
    return result;
}

// The curve's value at sweep value `at`.
function valueAt(result, at) {
    const i = result.x.findIndex(x => Math.abs(x - at) < 1e-9);
    assert.ok(i >= 0, `the curve has a point at ${at}`);
    return result.y[i];
}

const close = (a, b, what, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)),
    `${what}: ${a} against ${b}`);

// ── 1. Phase, GD, GDD and TOD ────────────────────────────────────────────────
{
    const design = api.openDesign(fixtureFile('builtin-bare-ids-qw-mirror'));
    const window = api.groupDelay(design, { from: 480, to: 640, step: 1, response: 'R', pol: 'avg', angle: 10 });
    const along = { sweep: 'wavelength', rangeFrom: 480, rangeTo: 640, rangeStep: 1, aoiFixed_deg: 10 };
    for (const [quantity, key] of [['phaseR', 'phase'], ['gdR', 'gd'], ['gddR', 'gdd'], ['todR', 'tod']]) {
        const curve = curveOf(design, { ...along, y: axis(quantity) });
        assert.deepEqual(curve.x, window.wavelength, `${quantity} is read on the window's wavelengths`);
        for (const at of [480, 533, 590, 640]) {
            close(valueAt(curve, at), window[key][window.wavelength.indexOf(at)], `${quantity} at ${at} nm`);
        }
    }

    const angles = curveOf(design, { sweep: 'aoi', rangeFrom: 0, rangeTo: 60, rangeStep: 15, lambdaFixed_nm: 550,
        y: axis('gddR', 'front', 's') });
    for (const at of [0, 30, 60]) {
        const point = api.groupDelay(design, { from: 550, to: 551, step: 1, response: 'R', pol: 's', angle: at });
        close(valueAt(angles, at), point.gdd[0], `GDD at ${at} degrees`);
    }

    const d0 = design.frontLayers[0].thickness;
    const layer = curveOf(design, { sweep: 'thk:0', rangeFrom: d0 - 20, rangeTo: d0 + 20, rangeStep: 10,
        lambdaFixed_nm: 560, y: axis('gdR') });
    for (const at of [d0 - 20, d0, d0 + 10]) {
        const copy = clone(design);
        copy.frontLayers[0].thickness = at;
        close(valueAt(layer, at), api.groupDelay(copy, { from: 560, to: 561, step: 1 }).gd[0], `GD at d = ${at} nm`);
    }

    const whole = api.groupDelay(design, { from: 500, to: 600, step: 2, response: 'T', side: 'total' });
    const total = curveOf(design, { sweep: 'wavelength', rangeFrom: 500, rangeTo: 600, rangeStep: 2,
        y: axis('gddT', 'total') });
    for (const at of [500, 550, 600]) {
        close(valueAt(total, at), whole.gdd[whole.wavelength.indexOf(at)], `GDD of the whole part at ${at} nm`);
    }
}

// ── 2. Ψ and Δ ───────────────────────────────────────────────────────────────
{
    const design = api.openDesign(fixtureFile('measured-ellipsometry-psi-delta'));
    const spectral = api.ellipsometry(design, { from: 400, to: 800, step: 5, angles: [70], side: 'front' });
    for (const quantity of ['psi', 'delta']) {
        const curve = curveOf(design, { sweep: 'wavelength', rangeFrom: 400, rangeTo: 800, rangeStep: 5,
            aoiFixed_deg: 70, y: axis(quantity) });
        for (const at of [400, 635, 800]) {
            close(valueAt(curve, at), spectral.angles[0][quantity][spectral.wavelength.indexOf(at)], `${quantity} at ${at} nm`);
        }
    }

    const angular = api.ellipsometryVsAngle(design, { wavelength: 633, angleStart: 45, angleEnd: 80, angleStep: 0.5 });
    const delta = curveOf(design, { sweep: 'aoi', rangeFrom: 45, rangeTo: 80, rangeStep: 0.5, lambdaFixed_nm: 633,
        y: axis('delta') });
    for (const at of [45, 62.5, 80]) {
        close(valueAt(delta, at), angular.delta[angular.angle.indexOf(at)], `Δ at ${at} degrees`);
    }

    const psi = curveOf(design, { sweep: 'thk:0', rangeFrom: 0, rangeTo: 300, rangeStep: 50, lambdaFixed_nm: 633,
        aoiFixed_deg: 70, y: axis('psi') });
    for (const at of [50, 150, 300]) {
        const copy = clone(design);
        copy.frontLayers[0].thickness = at;
        const point = api.ellipsometry(copy, { from: 633, to: 634, step: 1, angles: [70], side: 'front' });
        close(valueAt(psi, at), point.angles[0].psi[0], `Ψ at d = ${at} nm`);
    }
}

// A design whose first layer is a whole number of nm thick, so a curve over it
// and a surface over it sample the same thicknesses.
function wholeFirstLayer(name) {
    const design = api.openDesign(fixtureFile(name));
    design.frontLayers[0].thickness = Math.round(design.frontLayers[0].thickness);
    return design;
}

// ── 3. MF over a layer thickness ─────────────────────────────────────────────
{
    const design = wholeFirstLayer('operand-families');
    const [first, second] = design.frontLayers;
    const curve = curveOf(design, { sweep: 'thk:0', rangeFrom: first.thickness - 30, rangeTo: first.thickness + 30,
        rangeStep: 15, y: axis('MF') });
    const surface = computeSurface({ z: 'MF', xVar: 'thk:0', xFrom: first.thickness - 30, xTo: first.thickness + 30,
        xSteps: 5, yVar: 'thk:1', yFrom: second.thickness, yTo: second.thickness, ySteps: 2 },
    design, designMaterialLookup(design));
    assert.ok(surface.ok, 'the MF surface');
    surface.x.forEach((at, i) => close(valueAt(curve, at), surface.z[0][i], `MF at d = ${at} nm`));
    assert.equal(valueAt(curve, first.thickness), meritTable(design, design.meritOperands).mf,
        'the curve at the design is the editor MF');
}

// ── 4. T over a layer thickness ──────────────────────────────────────────────
{
    const design = wholeFirstLayer('builtin-bare-ids-qw-mirror');
    const d0 = design.frontLayers[0].thickness;
    const curve = curveOf(design, { sweep: 'thk:0', rangeFrom: d0 - 40, rangeTo: d0 + 40, rangeStep: 20,
        lambdaFixed_nm: 600, aoiFixed_deg: 20, y: axis('T', 'front', 'p') });
    const surface = computeSurface({ z: 'T', polarization: 'p', surfaceMode: 'front', fixedLambda_nm: 600,
        xVar: 'thk:0', xFrom: d0 - 40, xTo: d0 + 40, xSteps: 5, yVar: 'aoi', yFrom: 20, yTo: 20, ySteps: 2 },
    design, designMaterialLookup(design));
    surface.x.forEach((at, i) => close(valueAt(curve, at), surface.z[0][i], `T at d = ${at} nm`));
}

// ── 5. Ψ against Δ ───────────────────────────────────────────────────────────
{
    const design = api.openDesign(fixtureFile('measured-ellipsometry-psi-delta'));
    const along = { sweep: 'thk:0', rangeFrom: 0, rangeTo: 400, rangeStep: 20, lambdaFixed_nm: 633, aoiFixed_deg: 70 };
    const trajectory = curveOf(design, { ...along, x: axis('psi'), y: axis('delta') });
    assert.deepEqual(trajectory.x, curveOf(design, { ...along, y: axis('psi') }).y, 'x is Ψ over the thickness');
    assert.deepEqual(trajectory.y, curveOf(design, { ...along, y: axis('delta') }).y, 'y is Δ over the thickness');
}

// ── 6. Where MF has no value ─────────────────────────────────────────────────
{
    const design = api.openDesign(fixtureFile('operand-families'));
    assert.equal(curveOf(design, { sweep: 'wavelength', y: axis('MF') }).errorKey, 'errMfSweep');
    const bare = { ...design, meritOperands: [] };
    assert.equal(curveOf(bare, { sweep: 'thk:0', rangeFrom: 50, rangeTo: 60, rangeStep: 5, y: axis('MF') }).errorKey,
        'errNoOperands');
}

// A surface over `spec`, at 560 nm and 10 degrees where an axis does not set them.
function surfaceOf(design, spec) {
    const surface = computeSurface({ polarization: 'avg', surfaceMode: 'front', fixedLambda_nm: 560,
        fixedAOI_deg: 10, ...spec }, design, designMaterialLookup(design));
    assert.ok(surface.ok, `the ${spec.z} surface`);
    return surface;
}

// `check(value, x, y)` on every point of a surface.
const eachPoint = (surface, check) => surface.y.forEach((y, j) => surface.x.forEach((x, i) => check(surface.z[j][i], x, y)));

// The design with its first two layers `thicknesses` nm thick.
function withThicknesses(design, thicknesses) {
    const copy = clone(design);
    thicknesses.forEach((thickness, index) => { copy.frontLayers[index].thickness = thickness; });
    return copy;
}

// ── 7. Surfaces of GD, GDD, TOD, Ψ and Δ ─────────────────────────────────────
{
    const design = api.openDesign(fixtureFile('builtin-bare-ids-qw-mirror'));
    const [first, second] = design.frontLayers;

    const gd = surfaceOf(design, { z: 'gdR', xVar: 'wavelength', xFrom: 500, xTo: 600, xSteps: 3,
        yVar: 'aoi', yFrom: 0, yTo: 40, ySteps: 3 });
    eachPoint(gd, (value, lambda, angle) => close(value,
        api.groupDelay(design, { from: lambda, to: lambda + 1, step: 1, response: 'R', angle }).gd[0],
        `GD (R) at ${lambda} nm, ${angle} degrees`));

    const whole = surfaceOf(design, { z: 'gddT', surfaceMode: 'total', xVar: 'wavelength', xFrom: 520, xTo: 580,
        xSteps: 3, yVar: 'thk:0', yFrom: first.thickness - 10, yTo: first.thickness + 10, ySteps: 3 });
    eachPoint(whole, (value, lambda, d) => close(value,
        api.groupDelay(withThicknesses(design, [d]),
            { from: lambda, to: lambda + 1, step: 1, response: 'T', side: 'total', angle: 10 }).gdd[0],
        `GDD of the whole part at ${lambda} nm, d = ${d} nm`));

    const tod = surfaceOf(design, { z: 'todR', polarization: 's', xVar: 'thk:0', xFrom: first.thickness - 5,
        xTo: first.thickness + 5, xSteps: 2, yVar: 'thk:1', yFrom: second.thickness - 5, yTo: second.thickness + 5,
        ySteps: 2 });
    eachPoint(tod, (value, d1, d2) => close(value,
        api.groupDelay(withThicknesses(design, [d1, d2]),
            { from: 560, to: 561, step: 1, response: 'R', pol: 's', angle: 10 }).tod[0],
        `TOD at d1 = ${d1} nm, d2 = ${d2} nm`));

    for (const quantity of ['psi', 'delta']) {
        const surface = surfaceOf(design, { z: quantity, xVar: 'wavelength', xFrom: 500, xTo: 700, xSteps: 3,
            yVar: 'aoi', yFrom: 50, yTo: 70, ySteps: 3 });
        eachPoint(surface, (value, lambda, angle) => close(value,
            api.ellipsometry(design, { from: lambda, to: lambda + 1, step: 1, angles: [angle], side: 'front' })
                .angles[0][quantity][0],
            `${quantity} at ${lambda} nm, ${angle} degrees`));
    }
}

// ── 8. The GD surface from the workers ───────────────────────────────────────
//
// A worker reads its materials from a table built before the sweep, the
// dispersion GD needs included. Each stand-in worker here runs what
// plotSurfaceWorker.js runs on what it was sent.
{
    const design = api.openDesign(fixtureFile('builtin-bare-ids-qw-mirror'));
    const d1 = design.frontLayers[0].thickness;
    const spec = { z: 'gddR', polarization: 'avg', surfaceMode: 'front', fixedLambda_nm: 560, fixedAOI_deg: 0,
        xVar: 'wavelength', xFrom: 500, xTo: 620, xSteps: 7, yVar: 'thk:0', yFrom: d1 - 10, yTo: d1 + 10, ySteps: 5,
        colorscale: 'Turbo' };
    const warnings = [];
    globalThis.Worker = standInSurfaceWorker(warnings);
    let published = null;
    await runSurfaceSweep({
        surfaceSpec: spec, design, poolRef: { current: null },
        setProgress() {}, setSurfaceResult: (result) => { published = result; }, setComputing() {},
        computeMainThread: () => ({ ok: false, error: 'the workers failed' }),
    });
    assert.ok(published?.ok, `the workers' surface: ${published?.error}`);
    const here = computeSurface(spec, design, designMaterialLookup(design));
    eachPoint(published, (value, lambda, d) => {
        const at = (list, v) => list.indexOf(v);
        close(value, here.z[at(here.y, d)][at(here.x, lambda)], `GDD from a worker at ${lambda} nm, d = ${d} nm`);
    });
    assert.deepEqual(warnings, [], 'every value a worker read was in its table');
}

// ── 9. A Ψ-Δ path is drawn with a gap where Δ wraps ──────────────────────────
// Ta2O5 growing on Si, read at 632.8 nm and 70°: Δ passes 0° near 80 nm and
// comes back at the top of its range. Drawn as one line, that step would cross
// the whole plot.
{
    // The chart module reads React from the page, as the app's renderer does.
    globalThis.React ??= (await import('react')).default;
    const { buildCurveSeries } = await import('../src/components/windows/analysis/plotEngine/charts/CurveChart.js');
    let film = api.newDesign({ name: 'film', substrate: 'Si', referenceWavelength: 632.8 });
    film = api.stackFromFormula(film, { formula: 'L', symbols: { L: 'Ta2O5' } });
    const curve = makeDefaultCurve({
        sweep: 'thk:0', rangeFrom: 0, rangeTo: 300, rangeStep: 1, lambdaFixed_nm: 632.8, aoiFixed_deg: 70,
        x: axis('psi'), y: axis('delta'),
    });
    const result = computeCurveResults([curve], film)[curve.id];
    const steps = result.y.slice(1).map((delta, i) => Math.abs(delta - result.y[i]));
    const wraps = steps.filter(step => step > 180).length;
    assert.ok(wraps >= 1, 'the path wraps at least once');

    const [series] = buildCurveSeries([curve], { [curve.id]: result });
    const gaps = series.data.filter(([, delta]) => delta === null).length;
    assert.equal(gaps, wraps, 'one gap at each wrap');
    series.data.forEach(([psi, delta], i) => {
        if (delta !== null) return;
        const [before, after] = [series.data[i - 1][0], series.data[i + 1][0]];
        assert.ok(psi >= Math.min(before, after) && psi <= Math.max(before, after), 'a gap sits between its neighbours in Ψ');
    });

    // Δ against the thickness: the gap keeps the thickness axis in order, which
    // the reading at the pointer searches.
    const alongD = { ...curve, x: axis('sweep') };
    const [dSeries] = buildCurveSeries([alongD], { [alongD.id]: { x: computeCurveResults([alongD], film)[alongD.id].x, y: result.y } });
    const thicknesses = dSeries.data.map(([d]) => d);
    assert.ok(thicknesses.every((d, i) => i === 0 || d > thicknesses[i - 1]), 'thicknesses still rise point by point');
    assert.equal(dSeries.data.filter(([, delta]) => delta === null).length, wraps);
    series.data.forEach(([, delta], i) => {
        const before = series.data[i - 1]?.[1];
        if (delta !== null && before != null) {
            assert.ok(Math.abs(delta - before) <= 180, `no line drawn across a wrap at point ${i}`);
        }
    });
    assert.equal(series.data.length, result.y.length + gaps, 'every point is still drawn');

    // A step as large in any other quantity is the curve itself, not a wrap.
    const delay = { ...curve, x: axis('sweep'), y: axis('gdR') };
    const [steep] = buildCurveSeries([delay], { [delay.id]: { x: [0, 1, 2], y: [0, 500, 1000] } });
    assert.equal(steep.data.length, 3, 'a steep GD curve is not broken');
}

console.log('PASS: plot_engine_quantities');
