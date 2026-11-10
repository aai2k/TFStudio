/**
 * Save a chart as a PNG drawn in the Light theme, whatever theme the app is in.
 * A picture goes into reports and slides, where a dark plot reads as a black
 * box. Both the save icon on every chart (chartOptions.js chartToolbox) and a
 * window's Export come here, so they save the same file.
 *
 * The chart on screen is left alone: the picture is drawn by a copy of it,
 * with every theme colour in its option swapped for the Light theme's colour
 * of the same role. Curve colours are not theme colours and stay as they are.
 */

import { getPalette } from '../../constants/colorPalettes.js';
import { currentPalette } from '../../utils/theme/appearance.js';
import { drawPicture } from './plotSurface.js';

// The palette roles a chart option takes its colours from. Where two roles of
// the app's theme share a colour, the earlier one decides what it becomes.
const ROLES = [
    'bg', 'panel', 'text', 'textDim', 'border', 'borderStrong', 'field', 'accent',
    'accentHover', 'hover', 'selected', 'success', 'warning', 'error', 'info',
];

const isPlainObject = value => value !== null && typeof value === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** A function that gives a colour of `from` as the colour of the same role in `to`. */
function recolorer(from, to) {
    const swap = new Map();
    for (const role of ROLES) {
        const color = from[role]?.toLowerCase?.();
        if (color && to[role] && !swap.has(color)) swap.set(color, to[role]);
    }
    return value => {
        const color = value.toLowerCase();
        if (swap.has(color)) return swap.get(color);
        // A theme colour with an alpha byte, as in `${c.panel}dd`.
        const base = color.length === 9 ? swap.get(color.slice(0, 7)) : null;
        return base ? base + color.slice(7) : value;
    };
}

function recolored(value, recolor) {
    if (typeof value === 'string') return recolor(value);
    if (Array.isArray(value)) return value.map(item => recolored(item, recolor));
    if (!isPlainObject(value)) return value;
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = recolored(item, recolor);
    return copy;
}

/**
 * The option `option` is drawn with in the Light theme, given the palette
 * `from` it was built in. Series draw in one pass (`progressive: 0`), so the
 * copy is complete the moment it is read.
 */
export function lightOption(option, from) {
    const light = getPalette('Light');
    const copy = recolored(option, recolorer(from || light, light));
    return {
        ...copy,
        animation: false,
        series: [].concat(copy.series || []).map(series => ({ ...series, progressive: 0 })),
    };
}

/**
 * Save the chart's picture under the file name and scale its save icon carries.
 * Returns false when the chart is not drawn or has no save icon.
 */
export function saveChartPicture(chart) {
    if (!chart || chart.isDisposed?.()) return false;
    const option = chart.getOption();
    const save = [].concat(option?.toolbox || [])[0]?.feature?.mySaveAsImage;
    if (!save) return false;
    const link = document.createElement('a');
    link.href = drawPicture(lightOption(option, currentPalette()), {
        width: chart.getWidth(), height: chart.getHeight(), pixelRatio: save.pixelRatio,
        backgroundColor: getPalette('Light').panel, excludeComponents: ['toolbox'],
    });
    link.download = `${save.name}.png`;
    link.click();
    return true;
}
