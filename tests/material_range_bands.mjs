/**
 * No-data bands on the spectrum plot.
 *
 * The band series is decoration: it must shade the uncovered span and name the
 * materials, without appearing in the legend or the axis readout, and without
 * disturbing the wavelength axis, whose coordinates stay in nanometres for
 * every display unit.
 */
import assert from 'node:assert/strict';
import { dimmedBandSeries } from '../src/components/ui/chartOptions.js';
import { buildChartOption } from '../src/components/windows/analysis/opticalEvaluation/model.js';

// ── dimmedBandSeries shape ───────────────────────────────────────────────────
{
    assert.deepEqual(dimmedBandSeries(undefined, {}), [], 'no bands, no series');
    assert.deepEqual(dimmedBandSeries([], {}), [], 'empty bands, no series');

    const [host] = dimmedBandSeries(
        [{ x0: 700, x1: 900, label: 'no data: TiO2' }, { x0: 380, x1: 400 }],
        { text: '#cccccc' });
    assert.equal(host.name, '', 'the host series is unnamed, so legend and readout skip it');
    assert.equal(host.silent, true, 'the host series takes no pointer events');
    assert.equal(host.data.length, 0, 'the host series carries no data points');

    const [labelled, bare] = host.markArea.data;
    assert.equal(labelled[0].xAxis, 700);
    assert.equal(labelled[1].xAxis, 900);
    assert.equal(labelled[0].name, 'no data: TiO2', 'the band carries its label');
    assert.equal(labelled[0].label.show, true);
    assert.equal(labelled[0].itemStyle.color, '#cccccc', 'the shade is the theme text colour');
    assert.equal(bare[0].label.show, false, 'a band without a label shows none');
}

// ── The spectrum plot includes the bands it is given ─────────────────────────
{
    const base = {
        data: null, showCurves: {}, targets: [], targetsVisible: false, overlays: [],
        paperColor: '#252526', bgColor: '#1e1e1e', gridColor: '#3a3a3a', textColor: '#cccccc',
        editMode: false, editTool: 'draw', yRange: { auto: false, min: 0, max: 100 },
        yScale: 'percent', spectralUnit: 'nm', lamRange: { min: 380, max: 900 },
    };

    const bands = [{ x0: 700, x1: 900, label: 'no data: TiO2' }];
    const withBands = buildChartOption({ ...base, materialBands: bands });
    const hosts = withBands.series.filter(entry => entry.markArea);
    assert.equal(hosts.length, 1, 'one decoration series for the bands');
    assert.equal(hosts[0].markArea.data[0][0].xAxis, 700, 'band coordinates are nanometres');

    const without = buildChartOption(base);
    assert.equal(without.series.filter(entry => entry.markArea).length, 0,
        'a design whose materials cover the range draws no bands');
}

console.log('material_range_bands passed.');
