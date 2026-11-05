/**
 * A Plot Engine curve after an edit, and the results the window keeps for it.
 *
 *   1. An axis moved onto a quantity is read on a side that quantity has: Ψ
 *      and Δ on one surface, a reflected delay on one side, a transmitted one
 *      through the whole part as well.
 *   2. A new sweep starts on that sweep's own range; choosing the sweep it
 *      already has leaves its range alone.
 *   3. A curve that reads the merit function sweeps a layer.
 *   4. Renaming, recolouring or hiding a curve computes nothing again; any
 *      setting that changes its numbers does, and two curves with the same
 *      settings are computed once.
 *   5. While a curve's new line is computed it keeps the line it drew, as
 *      long as it plots the same quantities; a result for another design, or
 *      for a curve since deleted, is dropped.
 *   6. A curve changes the wavelength, the angle or one layer's thickness,
 *      never a layer's n or k; a curve of MF only a thickness.
 *
 * Run: node tests/plot_engine_curve_edits.mjs
 */
import assert from 'node:assert/strict';

const { makeDefaultCurve } = await import('../src/utils/physics/plotQuantities.js');
const { editCurve } = await import('../src/components/windows/analysis/plotEngine/curveEdits.js');
const { curveKey, curvesToCompute, mergeCurveResults, shownCurveResults } = await import(
    '../src/components/windows/analysis/plotEngine/curveResults.js');

const design = {
    id: 'edits', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'a', material: 'builtin:TiO2', thickness: 100 },
        { id: 'b', material: 'builtin:SiO2', thickness: 90 },
    ],
    backLayers: [],
};
const axis = (quantity, side = 'front', polarization = 'avg') => ({ quantity, polarization, side });

// ── 1. The side follows the quantity ─────────────────────────────────────────
{
    const whole = makeDefaultCurve({ y: axis('T', 'total') });
    assert.deepEqual([whole.x.quantity, whole.y], ['sweep', axis('T', 'total')], 'a new curve keeps the axis it is given');
    assert.equal(editCurve(whole, { y: axis('psi', 'total') }, design).y.side, 'front', 'Ψ is one surface');
    assert.equal(editCurve(whole, { y: axis('gdR', 'total') }, design).y.side, 'front',
        'a reflected delay is one side');
    assert.equal(editCurve(whole, { y: axis('gdT', 'total') }, design).y.side, 'total',
        'a transmitted delay is also the whole part');
    assert.equal(editCurve(whole, { x: axis('delta', 'back') }, design).x.side, 'back', 'a side it has is kept');
}

// ── 2. A new sweep, a new range ──────────────────────────────────────────────
{
    const spectral = makeDefaultCurve({ rangeFrom: 450, rangeTo: 650, rangeStep: 1 });
    const angles = editCurve(spectral, { sweep: 'aoi' }, design);
    assert.deepEqual([angles.rangeFrom, angles.rangeTo], [0, 60], 'an angle sweep runs over angles');
    const samples = (angles.rangeTo - angles.rangeFrom) / angles.rangeStep + 1;
    assert.ok(samples >= 100 && samples <= 400, `a smooth line in a few hundred samples, not ${samples}`);

    const layer = editCurve(spectral, { sweep: 'thk:0' }, design);
    assert.deepEqual([layer.rangeFrom, layer.rangeTo], [50, 150], 'a thickness sweep runs around the layer');

    const same = editCurve(spectral, { sweep: 'wavelength' }, design);
    assert.deepEqual([same.rangeFrom, same.rangeTo, same.rangeStep], [450, 650, 1], 'the same sweep keeps its range');
}

// ── 3. The merit function sweeps a layer ─────────────────────────────────────
{
    const spectral = makeDefaultCurve();
    const merit = editCurve(spectral, { y: axis('MF') }, design);
    assert.equal(merit.sweep, 'thk:0');
    assert.deepEqual([merit.rangeFrom, merit.rangeTo], [50, 150]);
    const second = makeDefaultCurve({ sweep: 'thk:1', rangeFrom: 60, rangeTo: 120, rangeStep: 1 });
    const kept = editCurve(second, { y: axis('MF') }, design);
    assert.deepEqual([kept.sweep, kept.rangeFrom, kept.rangeTo], ['thk:1', 60, 120], 'a layer sweep is kept');
}

// ── 4. What computes again ───────────────────────────────────────────────────
{
    const curve = makeDefaultCurve();
    const restyled = { ...curve, label: 'renamed', color: '#000000', dash: 'dot', width: 4 };
    assert.equal(curveKey(restyled), curveKey(curve), 'how a curve is drawn is not what it computes');
    assert.notEqual(curveKey({ ...curve, rangeStep: 1 }), curveKey(curve));
    assert.notEqual(curveKey({ ...curve, y: axis('T', 'front', 's') }), curveKey(curve));

    const twin = { ...curve, id: 'twin', label: 'twin' };
    const hidden = { ...makeDefaultCurve({ y: axis('R') }), visible: false };
    const pending = curvesToCompute([curve, twin, hidden], null);
    assert.deepEqual([...pending.values()], [curve], 'twins are computed once, a hidden curve not at all');
    assert.equal(curvesToCompute([restyled], { [curveKey(curve)]: { x: [1], y: [2] } }).size, 0,
        'a restyled curve is drawn from the result it has');
}

// ── 5. What stays on screen ──────────────────────────────────────────────────
{
    const first = makeDefaultCurve();
    const second = makeDefaultCurve({ y: axis('R') });
    const line = { x: [400, 800], y: [0.9, 0.8] };
    const other = { x: [400, 800], y: [0.1, 0.2] };
    const kept = mergeCurveResults(null, design, [first, second], { [first.id]: line, [second.id]: other },
        [first, second]);

    const edited = { ...first, rangeStep: 2 };
    assert.deepEqual([...curvesToCompute([edited, second], kept.byKey).values()], [edited],
        'only the edited curve computes again');
    assert.deepEqual(shownCurveResults([edited, second], kept, design, true), { [first.id]: line, [second.id]: other },
        'and keeps its line until the new one comes back');
    assert.deepEqual(shownCurveResults([edited, second], kept, design, false), { [second.id]: other });

    // A line is only kept on the axes it was drawn on: T fractions under a
    // GDD axis, or a wavelength line under an angle axis, would read as numbers
    // they are not.
    const waitingFor = curve => shownCurveResults([curve, second], kept, design, true);
    for (const [moved, why] of [
        [{ ...first, y: axis('gddR') }, 'another quantity'],
        [{ ...first, y: axis('T', 'front', 's') }, 'another polarization'],
        [{ ...first, y: axis('T', 'back') }, 'another side'],
        [{ ...first, sweep: 'aoi' }, 'another swept value on x'],
        [{ ...first, x: axis('R'), y: axis('T') }, 'a quantity on x'],
    ]) {
        assert.deepEqual(waitingFor(moved), { [second.id]: other }, `no old line under ${why}`);
    }
    assert.deepEqual(waitingFor({ ...first, lambdaFixed_nm: 600, rangeTo: 700 }), { [first.id]: line, [second.id]: other },
        'a new range or fixed value keeps it');

    const moved = { ...design, frontLayers: [{ ...design.frontLayers[0], thickness: 101 }, design.frontLayers[1]] };
    assert.equal(curvesToCompute([first, second], mergeCurveResults(kept, moved, [], {}, [first, second]).byKey).size, 2,
        'a result for another design is not this one\'s');
    const after = mergeCurveResults(kept, design, [], {}, [second]);
    assert.deepEqual([Object.keys(after.byKey), Object.keys(after.byId)], [[curveKey(second)], [second.id]],
        'a deleted curve leaves nothing behind');
}

// ── 6. What a curve can change ───────────────────────────────────────────────
{
    // The settings module reads React from the page, as the app's renderer does.
    globalThis.React ??= (await import('react')).default;
    const { sweepOptions } = await import('../src/components/windows/analysis/plotEngine/CurveRow.js');
    const { getLocale } = await import('../src/constants/locales/index.js');
    const offered = (curve, code = 'en') => sweepOptions(curve, design, getLocale(code));
    const ids = curve => offered(curve).map(option => option.id);
    assert.deepEqual(ids(makeDefaultCurve()), ['wavelength', 'aoi', 'thk:1', 'thk:0'],
        'wavelength, angle and each layer\'s thickness, L1 first, and no n or k');
    assert.deepEqual(ids(makeDefaultCurve({ sweep: 'thk:0', y: axis('MF') })), ['thk:1', 'thk:0'],
        'a curve of MF changes a thickness');
    assert.deepEqual(offered(makeDefaultCurve(), 'ru').map(option => option.label).slice(2),
        ['L1 (SiO2) d (нм)', 'L2 (TiO2) d (нм)'], 'a layer is named with its thickness, in the unit\'s own script');
}

console.log('PASS: plot_engine_curve_edits');
