/**
 * The colour a diagram is filled with, rasterised once into an image that the
 * chart scales over the plot, as plotEngine/heatmapImage.js does for a map: one
 * image costs a single blit per repaint, where a shape per cell would be
 * rebuilt on every frame of a resize.
 *
 * Each pixel inside the spectral locus is the colour of the chromaticity it
 * stands for (colorimetry/srgb.js, chromaticityDisplayRgb). Outside the locus
 * no real colour exists and the pixel is left clear.
 */

import { chromaticityDisplayRgb } from '../../../../utils/physics/colorimetry.js';

// Pixels on the longer side of the image. The fill changes smoothly across the
// plane, so scaling it to the plot does not show.
const LONG_SIDE = 640;

// Where a horizontal line at `q` crosses the closed outline, ascending.
function rowCrossings(outline, q) {
    const crossings = [];
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const [pa, qa] = outline[j];
        const [pb, qb] = outline[i];
        if ((qa > q) !== (qb > q)) crossings.push(pa + (q - qa) / (qb - qa) * (pb - pa));
    }
    return crossings.sort((a, b) => a - b);
}

// Plot coordinates of the centre of a pixel row or column.
const rowCentre = (view, height, row) => view.y[1] - (row + 0.5) / height * (view.y[1] - view.y[0]);
const columnCentre = (view, width, column) => view.x[0] + (column + 0.5) / width * (view.x[1] - view.x[0]);

// The colour shown at plot point p, q, or null where there is none.
function colourAt({ plane, discRadius = null }, p, q) {
    if (discRadius != null && Math.hypot(p, q) > discRadius) return null;
    const xy = plane.fromPlane(p, q);
    return xy && chromaticityDisplayRgb(xy.x, xy.y);
}

// Paint the pixels of `row` whose centres lie between two crossings of the
// outline, `span` = [from, to] in plot units.
function fillSpan(pixels, spec, row, span) {
    const { view, width, height } = spec;
    const toColumn = p => (p - view.x[0]) / (view.x[1] - view.x[0]) * width - 0.5;
    const q = rowCentre(view, height, row);
    const last = Math.min(width - 1, Math.floor(toColumn(span[1])));
    for (let column = Math.max(0, Math.ceil(toColumn(span[0]))); column <= last; column++) {
        const rgb = colourAt(spec, columnCentre(view, width, column), q);
        if (!rgb) continue;
        pixels.set([rgb[0], rgb[1], rgb[2], 255], (row * width + column) * 4);
    }
}

/**
 * The fill as RGBA pixels, top row first. Split from the canvas work so the
 * colours can be checked without a canvas.
 *
 * @param {object} spec
 * @param {object} spec.plane  a plane from colorimetry/diagram.js
 * @param {number[][]} spec.outline  the spectral locus closed by the purple
 *        line on that plane, as [p, q] pairs
 * @param {{x: number[], y: number[]}} spec.view  the plot's extent, [low, high]
 * @param {number} spec.width
 * @param {number} spec.height
 * @param {number|null} [spec.discRadius]  on a hue and chroma plane, the
 *        chroma the fill stops at
 * @returns {Uint8ClampedArray}
 */
export function diagramFillPixels(spec) {
    const { outline, view, width, height } = spec;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
        const crossings = rowCrossings(outline, rowCentre(view, height, row));
        for (let k = 0; k + 1 < crossings.length; k += 2) fillSpan(pixels, spec, row, [crossings[k], crossings[k + 1]]);
    }
    return pixels;
}

/** Image size for a view with equal data units on both axes. */
export function fillImageSize(view) {
    const aspect = (view.x[1] - view.x[0]) / (view.y[1] - view.y[0]);
    return aspect >= 1
        ? { width: LONG_SIDE, height: Math.max(1, Math.round(LONG_SIDE / aspect)) }
        : { width: Math.max(1, Math.round(LONG_SIDE * aspect)), height: LONG_SIDE };
}

// Each image is numbered: the chart carries the number in its option, since
// the option comparison in plotSurface.js reads the closure holding the image
// as unchanged.
let imageSeq = 0;
// The last few fills, so switching between tabs does not rasterise again: eight
// hold the five tabs and three more lightnesses or observers, at up to 1.6 MB
// each.
const CACHE_SIZE = 8;
const cache = new Map();

/**
 * The fill as a canvas, or null where no canvas can be made (a server render,
 * a test in Node). `key` names everything the fill depends on; a fill already
 * made for it is reused.
 */
export function rasteriseDiagramFill(key, spec) {
    if (cache.has(key)) return cache.get(key);
    const { width, height } = fillImageSize(spec.view);
    let canvas;
    let context;
    try {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        context = canvas.getContext('2d');
        if (!context || typeof context.createImageData !== 'function') return null;
    } catch (_) {
        return null;
    }
    const image = context.createImageData(width, height);
    image.data.set(diagramFillPixels({ ...spec, width, height }));
    context.putImageData(image, 0, 0);
    canvas.imageId = ++imageSeq;
    cache.set(key, canvas);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return canvas;
}
