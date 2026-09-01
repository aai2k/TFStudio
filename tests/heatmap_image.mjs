/**
 * The flat map is rasterised, not drawn cell by cell.
 *
 * ECharts draws a heat map as one hit-testable rectangle per cell and rebuilds
 * them all on every repaint: measured at 52 ms for a 12,261 cell map, against a
 * 16.7 ms frame. A resize repaints, and a docking splitter asks for one on every
 * frame of a drag, so the map fell behind and never caught up. Drawing the grid
 * as a single image took the same map to 3 ms.
 *
 * The image is what the user reads the coating off, so what is checked here is
 * that it says the same thing the grid does: the colour a value maps to, and
 * above all the row order. An image runs top down and the angle axis runs
 * bottom up, so a flipped image would mirror the map about the angle axis and
 * look entirely plausible while being wrong.
 *
 * Run: node tests/heatmap_image.mjs
 */

import assert from 'node:assert/strict';
import {
    heatmapPixels, rasteriseHeatmap,
} from '../src/components/windows/analysis/plotEngine/heatmapImage.js';

// Black to white, so a value maps to a grey level that is trivial to read back.
const GREYS = ['#000000', '#ffffff'];

// Two columns, three rows. z[row][column], row 0 being the bottom of the plot.
const result = {
    ok: true,
    x: [400, 500],
    y: [0, 30, 60],
    z: [
        [0.0, 0.1],   // bottom row: 0 deg
        [0.5, 0.5],   // 30 deg
        [1.0, 0.9],   // top row: 60 deg
    ],
    zLabel: 'Transmittance',
};
const extent = { min: 0, max: 100 };

const px = (pixels, width, imageRow, column) => {
    const at = (imageRow * width + column) * 4;
    return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
};

// ── The row order, which is the one that could be wrong and look right ───────
{
    const pixels = heatmapPixels(result, GREYS, { extent, scale: 100 });
    // The grid's last row (60 deg, value 1.0 -> white) is the image's first row.
    assert.deepEqual(px(pixels, 2, 0, 0), [255, 255, 255, 255],
        'the top of the plot is the first row of the image');
    // The grid's first row (0 deg, value 0.0 -> black) is the image's last row.
    assert.deepEqual(px(pixels, 2, 2, 0), [0, 0, 0, 255],
        'the bottom of the plot is the last row of the image');
    // And the columns are not transposed with it.
    assert.deepEqual(px(pixels, 2, 2, 1), [26, 26, 26, 255],
        'column order follows wavelength, low to high');
}

// ── The colour a value maps to ───────────────────────────────────────────────
{
    const pixels = heatmapPixels(result, GREYS, { extent, scale: 100 });
    // 0.5 scaled to 50 %, half way along a black-to-white scale.
    assert.deepEqual(px(pixels, 2, 1, 0), [128, 128, 128, 255],
        'a mid-range value lands mid-scale');

    // The scale spans the extent it is given, not the data's own range.
    const half = heatmapPixels(result, GREYS, { extent: { min: 0, max: 200 }, scale: 100 });
    assert.deepEqual(px(half, 2, 0, 0), [128, 128, 128, 255],
        'the extent sets the mapping, so the same value moves when it widens');
}

// ── A cell with nothing in it is left clear, not painted as zero ─────────────
{
    const holed = { ...result, z: [[0, 0.1], [Number.NaN, 0.5], [1, 0.9]] };
    const pixels = heatmapPixels(holed, GREYS, { extent, scale: 100 });
    assert.equal(px(pixels, 2, 1, 0)[3], 0, 'an unevaluated cell is transparent');
    assert.equal(px(pixels, 2, 1, 1)[3], 255, 'its neighbours are unaffected');
    // The hole is skipped, so the cells around it still span the whole scale.
    assert.deepEqual(px(pixels, 2, 0, 0), [255, 255, 255, 255], 'the top is still white');
    assert.deepEqual(px(pixels, 2, 2, 0), [0, 0, 0, 255], 'and the bottom still black');
}

// ── Why the caller has to hand in an extent that skips the holes ─────────────
//
// The extent is the caller's, and charts.js scans the grid for it. An extent
// that took a hole in would be NaN at both ends, which is not a range: every
// cell falls back to the bottom of the scale and the map reads as uniform while
// looking entirely plausible. Pinned from this side so the cost of getting the
// extent wrong stays written down next to the code that suffers it; that the
// chart computes a finite one is asserted in plot_engine_figure_characterization.
{
    const pixels = heatmapPixels(result, GREYS, { extent: { min: Number.NaN, max: Number.NaN }, scale: 100 });
    assert.deepEqual(px(pixels, 2, 0, 0), [0, 0, 0, 255],
        'a NaN extent flattens a cell that should be white');
    assert.deepEqual(px(pixels, 2, 1, 0), [0, 0, 0, 255],
        'and one that should be mid-scale');
}

// ── Narrowing the colour bar clears what falls outside the band ──────────────
{
    const pixels = heatmapPixels(result, GREYS, { extent, scale: 100, range: [40, 60] });
    assert.equal(px(pixels, 2, 1, 0)[3], 255, '50 % is inside a 40-60 band');
    assert.equal(px(pixels, 2, 0, 0)[3], 0, '100 % is outside it');
    assert.equal(px(pixels, 2, 2, 0)[3], 0, 'and so is 0 %');
}

// ── Without a canvas there is no image, and the caller must cope ─────────────
{
    assert.equal(rasteriseHeatmap(result, GREYS, extent, 100), null,
        'a server render has no canvas, so the chart falls back to drawing cells');
    assert.equal(rasteriseHeatmap(null, GREYS, extent, 100), null, 'no grid, no image');
    assert.equal(rasteriseHeatmap({ ok: false }, GREYS, extent, 100), null,
        'a failed sweep is not rasterised');
}

console.log('heatmap_image: passed');
