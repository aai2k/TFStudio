/**
 * Monitor Worksheet window: the table is the window, the monitoring chart is a
 * strip below it, and the two cells that carry the plan are editable.
 *
 * Run: node tests/monitor_worksheet_window.mjs
 */

import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildWorksheetOption } = await import(
    '../src/components/windows/simulation/monitorWorksheet/figure.js'
);
const { worksheetColumns, worksheetRows } = await import(
    '../src/components/windows/simulation/monitorWorksheet/tableModel.js'
);
const { monitorWorksheetSession } = await import(
    '../src/components/windows/simulation/monitorWorksheet/sessionState.js'
);
const { MonitorWorksheet } = await import(
    '../src/components/windows/simulation/monitorWorksheet/MonitorWorksheet.js'
);
const { WINDOW_REGISTRY } = await import('../src/components/docking/windowRegistry.js');
const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');

const c = makeTheme();
const t = makeLocale();

// ── Registration ─────────────────────────────────────────────────────────────
const entry = WINDOW_REGISTRY['monitor-worksheet'];
assert.ok(entry?.component, 'the window is in the registry');
assert.equal(entry.help, 'simulation/monitor-worksheet', 'and points at its help page');
assert.ok(entry.requiresResolvedMaterials,
    'it reads material data, so it waits for the design materials to resolve');

// ── Session store ────────────────────────────────────────────────────────────
{
    monitorWorksheetSession.reset();
    const a = { id: 'a', frontLayers: [{ material: 'H', thickness: 100 }] };
    const b = { id: 'b', frontLayers: [{ material: 'L', thickness: 100 }] };

    monitorWorksheetSession.write(a, { chipByStep: [2], layersPerChip: 4 });
    assert.deepEqual(monitorWorksheetSession.read(b).chipByStep, null,
        'a chip plan belongs to the design it was made for');
    assert.deepEqual(monitorWorksheetSession.read(a).chipByStep, [2],
        'and comes back when that design does');
    assert.ok(!monitorWorksheetSession.savableKeys.includes('chipByStep'),
        'the plan is not something Save writes as a default');
    assert.ok(monitorWorksheetSession.savableKeys.includes('signalErrorPct'),
        'the monitor is');
    assert.equal(monitorWorksheetSession.read(a).chipMaterial, null,
        'the chip glass follows the design substrate until overridden');
    assert.ok(!monitorWorksheetSession.savableKeys.includes('chipMaterial'),
        'and belongs to the design, like the plan');
    monitorWorksheetSession.reset();
}

// ── Table model ──────────────────────────────────────────────────────────────
{
    const raw = [{
        step: 1, chip: 1, onChip: 1, material: 'H', lambda: 520,
        signal: 0.6935, turningPoints: 1, amplitude: 0.2639, swingIn: 0.2639,
        swingOut: 0.0004, cutoffRatio: 0.0015, terminationErrNm: 0.42,
        crystalNm: null, initialLevel: 0.9574, poor: false, strategy: 'turning',
    }];
    const [row] = worksheetRows(raw);
    assert.equal(row.signal.toFixed(2), '69.35', 'signals are shown as percentages');
    assert.equal(row.initialLevel.toFixed(2), '95.74');
    assert.equal(row.crystal, null, 'an unflagged layer leaves the crystal column empty');
    assert.equal(worksheetRows([{ ...raw[0], crystalNm: 203, poor: true }])[0].crystal, 2.03,
        'a flagged layer reports its thickness in kilo-angstroms');

    const named = worksheetRows(raw, { H: 'Titanium oxide (anatase)' })[0];
    assert.equal(named.material, 'Titanium oxide (anatase)',
        'the material column shows the display name, not the catalog id');
    assert.equal(named.materialId, 'H', 'the id stays on the row for the colour swatch');

    const columns = worksheetColumns({ t, c, matColorMap: {}, onChip: () => {}, onLambda: () => {} });
    assert.deepEqual(columns.map(column => column.key), [
        'step', 'chip', 'material', 'lambda', 'signal', 'turningPoints', 'amplitude',
        'swingIn', 'swingOut', 'cutoffRatio', 'terminationErrNm', 'crystal', 'initialLevel',
    ], 'the columns are the worksheet, in reading order');
}

// ── Chart ────────────────────────────────────────────────────────────────────
{
    const rows = [
        {
            step: 1, chip: 1, xStart: 0, xCut: 1, xEnd: 2, signal: 0.5, poor: false,
            curve: { x: [0, 0.5, 1, 1.5, 2], y: [0.95, 0.7, 0.5, 0.7, 0.95] },
        },
        {
            step: 2, chip: 2, xStart: 1, xCut: 2, xEnd: 3, signal: 0.8, poor: true,
            curve: { x: [1, 1.5, 2, 2.5, 3], y: [0.5, 0.65, 0.8, 0.9, 0.95] },
        },
    ];
    const colors = ANALYSIS_DEFAULTS.monitorWorksheet.colors;
    const option = buildWorksheetOption({ rows, c, t });

    // The overview the scrollbar draws from, then the chip bands, then one
    // series per style (continuations, in-budget layers, flagged layers) with
    // a NaN break between layers, then the numbered cuts. The count stays flat
    // however long the run is; per-series cost is what made 200 layers lag.
    // The style buckets are found by their colour rather than their position,
    // because a bucket with nothing in it is not emitted at all.
    assert.equal(option.series.length, 6);
    const signalSeries = option.series.find(s => s.lineStyle?.color === colors.signal);
    const poorSeries = option.series.find(s => s.lineStyle?.color === colors.poor);
    const continuation = option.series.find(s => s.lineStyle?.type === 'dashed');
    assert.ok(signalSeries, 'a layer in budget draws normally');
    assert.ok(poorSeries, 'a flagged layer draws in the flag colour');
    assert.ok(continuation, 'the continuation is dashed');

    // The scrollbar's overview strip comes from the first series on the axis,
    // so that has to be the whole run rather than whichever layer draws first.
    const overview = option.series[0];
    assert.equal(overview.lineStyle.width, 0, 'the overview is not drawn in the plot itself');
    assert.deepEqual(overview.data.at(0), [0, 95]);
    assert.deepEqual(overview.data.at(-1), [2, 80], 'it spans the run to the last cut');

    const deposited = signalSeries.data;
    assert.deepEqual(deposited[deposited.length - 1], [1, 50],
        'the traversed curve ends exactly on the cut');
    assert.deepEqual(continuation.data[0], [1, 50],
        'and the continuation starts there, so the two meet');

    const marks = option.series.find(s => s.type === 'scatter');
    assert.deepEqual(marks.data.map(item => item.name), ['1', '2'], 'every cut is numbered');
    assert.equal(option.yAxis.max, 100, 'the signal axis is the full scale');
    assert.deepEqual(buildWorksheetOption({ rows: [], c, t }), { series: [] });

    // The native axis tooltip lists whichever series own the sample the pointer
    // snapped to, which is not reliably the layer under the pointer. The
    // formatter reads the rows instead.
    const tip = option.tooltip.formatter;
    const atHalf = tip([{ axisValue: 0.5 }]);
    assert.ok(atHalf.includes('Layer 1') && atHalf.includes('70'),
        'the layer under the pointer always reports its deposited signal');
    assert.ok(!atHalf.includes('past cut'), 'no continuation crosses the first half of layer 1');
    const atMid = tip([{ axisValue: 1.5 }]);
    assert.ok(atMid.includes('Layer 2') && atMid.includes('65'),
        "inside layer 2 the deposited signal is layer 2's");
    assert.ok(atMid.includes('Layer 1 past cut') && atMid.includes('70'),
        'a curve continued past its cut is read where it crosses the pointer');
    assert.ok(atMid.indexOf('Layer 2') < atMid.indexOf('Layer 1 past cut'),
        'the deposited layer leads, the continuations follow');
    assert.ok(atMid.includes(colors.poor), 'a flagged layer keeps its flag colour in the tooltip');
    assert.equal(tip([{ axisValue: 99 }]), '', 'past the run there is nothing to read');

    // A chip can be returned to later in the run, so the bands follow the
    // stretches spent on a chip rather than the chip number. Keyed on the number
    // they would run from a chip's first layer to its last and cover everything
    // between, twice.
    const revisited = [
        { ...rows[0], chip: 1 },
        { ...rows[1], chip: 2 },
        { ...rows[1], step: 3, chip: 1, xStart: 2, xCut: 3, xEnd: 4 },
    ];
    const bands = buildWorksheetOption({ rows: revisited, c, t }).series[1].markArea.data;
    assert.equal(bands.length, 3, 'one band per stretch on a chip, not per chip');
    assert.deepEqual(bands.map(band => [band[0].xAxis, band[1].xAxis]),
        [[0, 1], [1, 2], [2, 3]], "and no band covers another chip's region");

    // A whole run drawn end to end is unreadable, so the chart opens on a window
    // over it and scrolls. The window runs to the end of the last layer shown,
    // continuation included, so its turning point is inside the view.
    const [slider, inside] = buildWorksheetOption({ rows, c, t, layersInView: 1 }).dataZoom;
    assert.equal(slider.type, 'slider', 'the chart carries a horizontal scrollbar');
    assert.equal(slider.showDataShadow, true, 'showing the whole run behind the window');
    assert.equal(inside.type, 'inside', 'and zooms in place');
    assert.equal(slider.startValue, 0);
    assert.equal(slider.endValue, rows[0].xEnd,
        'one layer in view ends at the end of that layer, continuation included');
    assert.equal(slider.filterMode, 'none', 'scrolling hides points, it does not drop them');
    assert.equal(
        buildWorksheetOption({ rows, c, t, layersInView: 50 }).dataZoom[0].endValue,
        rows[1].xEnd,
        'a window wider than the run stops at the last layer');
}

// ── Render ───────────────────────────────────────────────────────────────────
{
    const html = renderToStaticMarkup(withDesign(
        React.createElement(MonitorWorksheet, { c, theme: c, t }),
        makeSampleDesign(),
    ));
    for (const header of ['Chip', 'Amplitude (%)', 'Swing in (%)', 'Cutoff ratio', 'Crystal (kÅ)']) {
        assert.ok(html.includes(`>${header}</th>`), `the table shows the ${header} column`);
    }
    assert.ok(html.includes('TiO2 (anatase)') && !html.includes('builtin:TiO2'),
        'materials are shown by display name, never by catalog id');
    assert.ok(html.includes('text-overflow:ellipsis'),
        'a long material name is cut to the column instead of widening it');
    assert.ok(html.includes('row-resize'),
        'the table and the chart share the window across a divider the user drags');
    assert.ok(html.includes('Layers per chip'), 'the chip size is on the control row');
    assert.ok(html.includes('Set all'), 'and one wavelength can be put on the whole run');
    assert.equal((html.match(/<input/g) || []).length, 2 * 2 + 2,
        'chip and wavelength are editable on every row, beside the chip-size and set-all fields');

    const bare = renderToStaticMarkup(withDesign(
        React.createElement(MonitorWorksheet, { c, theme: c, t }),
        { ...makeSampleDesign(), frontLayers: [] },
    ));
    assert.ok(bare.includes('No layers in design.'), 'a bare substrate says so');
}
// ── Chip sizes above the old 50 cap survive the settings load gate ───────────
// resolveAnalysisSettings discards a stored number outside the registry bounds,
// so a registry max at the old control cap silently reset a saved whole-run
// chip size to the factory default on the next start.
{
    const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');
    const resolved = resolveAnalysisSettings('monitorWorksheet',
        { monitorWorksheet: { numbers: { layersPerChip: 200 } } });
    assert.equal(resolved.numbers.layersPerChip, 200,
        'a saved 200-layer single-chip plan survives a reload');
}

console.log('PASS: monitor_worksheet_window');
