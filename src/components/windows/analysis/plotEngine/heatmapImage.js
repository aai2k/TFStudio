/**
 * A computed grid, rasterised once into an image.
 *
 * ECharts draws a heat map as one hit-testable rectangle per cell and rebuilds
 * all of them on every repaint, so a 12,000 cell map costs about 50 ms to
 * redraw. A resize repaints, and a docking splitter asks for a repaint on every
 * frame of a drag, so the map falls three frames behind and never catches up.
 *
 * Measured on that same 12,000 cell map: drawing the cells as one image takes
 * 1.8 ms once, and each later repaint is a single scaled blit at under 1 ms.
 * The 3D surface never had the problem because it is one mesh rather than
 * twelve thousand objects; this gives the flat map the same shape.
 *
 * The image is at the resolution of the grid, one pixel per cell, and the chart
 * scales it over the plot area.
 */

/**
 * Colour a fraction of the way along a list of hex stops, as [r, g, b].
 *
 * A cell the sweep could not evaluate has no fraction. It is drawn transparent
 * either way, so it takes the bottom of the scale rather than indexing the
 * stops with NaN, which would read past the end of them.
 */
function sampleStops(stops, fraction) {
    const safe = Number.isFinite(fraction) ? fraction : 0;
    const clamped = Math.min(Math.max(safe, 0), 1) * (stops.length - 1);
    const index = Math.min(Math.floor(clamped), stops.length - 2);
    const weight = clamped - index;
    const from = stops[index];
    const to = stops[index + 1];
    return [
        from[0] + (to[0] - from[0]) * weight,
        from[1] + (to[1] - from[1]) * weight,
        from[2] + (to[2] - from[2]) * weight,
    ];
}

function parseHex(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

/**
 * The grid as RGBA pixels, one per cell. Split out from the canvas work so the
 * colour mapping and the row order can be checked without a canvas to draw on.
 *
 * @param {{x:number[], y:number[], z:number[][]}} result  the computed grid
 * @param {string[]} colors  colorscale stops, low to high, as `#rrggbb`
 * @param {object} options
 * @param {{min:number, max:number}} options.extent  the value range the scale
 *        spans. Must be finite: an extent that took an unevaluated cell in
 *        would be NaN at both ends, and every cell would fall to the bottom of
 *        the scale while still looking like a plausible map.
 * @param {number} [options.scale]  applied to each value before mapping, so a
 *        fraction can be shown as a percentage without a second copy of the grid
 * @param {[number, number]|null} [options.range]  the band selected on the
 *        colour bar, in the same units; cells outside it are left clear
 * @param {Uint8ClampedArray} [options.into]  buffer to fill instead of
 *        allocating one, so the canvas path writes straight into its image data
 * @returns {Uint8ClampedArray}  RGBA, one pixel per cell, top row first
 */
export function heatmapPixels(result, colors, { extent, scale = 1, range = null, into = null }) {
    const width = result.x.length;
    const height = result.y.length;
    const pixels = into || new Uint8ClampedArray(width * height * 4);
    const stops = colors.map(parseHex);
    const span = extent.max - extent.min;

    for (let row = 0; row < height; row++) {
        const values = result.z[row];
        if (!values) continue;
        // An image runs top down and the Y axis runs bottom up, so the last row
        // of the grid is the first row of the image.
        const offset = (height - 1 - row) * width * 4;
        for (let column = 0; column < width; column++) {
            const value = values[column] * scale;
            const rgb = sampleStops(stops, span > 0 ? (value - extent.min) / span : 0);
            const at = offset + column * 4;
            pixels[at] = rgb[0];
            pixels[at + 1] = rgb[1];
            pixels[at + 2] = rgb[2];
            // A cell the sweep could not evaluate, or one the colour bar has
            // been narrowed past, is left clear rather than painted.
            const shown = Number.isFinite(value)
                && (!range || (value >= range[0] && value <= range[1]));
            pixels[at + 3] = shown ? 255 : 0;
        }
    }
    return pixels;
}

// Every rasterised canvas is numbered. The chart carries the number in its
// option, because the canvas itself only ever reaches a chart inside a
// `renderItem` closure, and the option comparison that makes a resize cheap
// cannot see into one. Without it a new image reads as no change at all.
let imageSeq = 0;

export function rasteriseHeatmap(result, colors, extent, scale = 1, range = null) {
    if (!result?.ok || !result.x?.length || !result.y?.length) return null;
    const width = result.x.length;
    const height = result.y.length;

    let context;
    let canvas;
    try {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        context = canvas.getContext('2d');
    } catch (_) {
        return null;
    }
    if (!context || typeof context.createImageData !== 'function') return null;

    const image = context.createImageData(width, height);
    heatmapPixels(result, colors, { extent, scale, range, into: image.data });
    context.putImageData(image, 0, 0);
    canvas.imageId = ++imageSeq;
    return canvas;
}
