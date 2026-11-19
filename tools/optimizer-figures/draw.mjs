/**
 * SVG drawing of a merit-function landscape with an optimizer's path on it.
 *
 * The merit is drawn as filled contour bands in the ColorBrewer YlGnBu scale,
 * pale yellow where the merit is low and deep blue where it is high, and the
 * path in red with a light ring under it so it stays readable on every band.
 * The same SVG is published as the still and rasterized for every frame of
 * the animation.
 */
import sharp from 'sharp';

export const INK = { primary: '#0b0b0b', secondary: '#52514e', axis: '#c3c2b7', surface: '#fcfcfb' };
export const PATH_COLOR = '#d7301f';

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Arial, sans-serif';
export const LAYOUT = { width: 760, height: 540, left: 72, top: 24, size: 440, legendX: 544 };

// ColorBrewer YlGnBu (C. A. Brewer, colorbrewer2.org), the nine-class scale
// without its darkest class, from low merit to high.
const YLGNBU = ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494']
    .map(hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)));
function bandColor(t) {
    const x = t * (YLGNBU.length - 1), k = Math.min(Math.floor(x), YLGNBU.length - 2), f = x - k;
    return YLGNBU[k].map((c, n) => Math.round(c + (YLGNBU[k + 1][n] - c) * f));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = v => (Math.round(v * 10) / 10).toString();

/** `count` equal bands of log10(merit) from its lowest to its highest value on the grid. */
export function logBands(grid, count) {
    let lo = Infinity, hi = -Infinity;
    for (const col of grid) for (const v of col) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return { lo, step: (hi - lo) / count, count };
}

/** Maps thickness (nm) to plot pixels and back. */
export function makeScale(range) {
    const { left, top, size } = LAYOUT;
    const [lo, hi] = range;
    return {
        x: d => left + (d - lo) / (hi - lo) * size,
        y: d => top + size - (d - lo) / (hi - lo) * size,
        lo, hi,
    };
}

// The value at fractional grid position (x, y), bilinear between grid nodes.
function sampleBilinear(grid, x, y) {
    const n = grid.length - 1, m = grid[0].length - 1;
    const i = Math.min(Math.max(Math.floor(x), 0), n - 1), j = Math.min(Math.max(Math.floor(y), 0), m - 1);
    const fx = Math.min(Math.max(x - i, 0), 1), fy = Math.min(Math.max(y - j, 0), 1);
    const a = grid[i][j] * (1 - fx) + grid[i + 1][j] * fx;
    const b = grid[i][j + 1] * (1 - fx) + grid[i + 1][j + 1] * fx;
    return a * (1 - fy) + b * fy;
}

/**
 * The merit of `land` (meritGrid) as `count` bands of equal width in
 * log10(merit): a PNG data URI covering the plot, `scale` pixels per layout
 * pixel.
 */
export async function bandImage(land, { count = 16, scale = 2 } = {}) {
    const logGrid = land.grid.map(col => col.map(Math.log10));
    const bands = logBands(logGrid, count);
    const px = LAYOUT.size * scale, n = logGrid.length - 1;
    const raw = Buffer.alloc(px * px * 3);
    for (let r = 0; r < px; r++) {
        const gy = (1 - (r + 0.5) / px) * n;
        for (let c = 0; c < px; c++) {
            const v = sampleBilinear(logGrid, (c + 0.5) / px * n, gy);
            const band = Math.min(bands.count - 1, Math.max(0, Math.floor((v - bands.lo) / bands.step)));
            const rgb = bandColor(band / (bands.count - 1));
            raw.set(rgb, (r * px + c) * 3);
        }
    }
    const png = await sharp(raw, { raw: { width: px, height: px, channels: 3 } }).png({ palette: true, colours: bands.count + 1, dither: 0, effort: 10 }).toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
}

/** The plot frame, ticks every 50 nm and the axis titles `labels.x` and `labels.y`. */
export function axes(sc, labels) {
    const { left, top, size } = LAYOUT;
    const out = [`<rect x="${left}" y="${top}" width="${size}" height="${size}" fill="none" stroke="${INK.axis}"/>`];
    for (let d = Math.ceil(sc.lo / 50) * 50; d <= sc.hi; d += 50) {
        out.push(`<path d="M${fmt(sc.x(d))} ${top + size}v5M${left} ${fmt(sc.y(d))}h-5" stroke="${INK.axis}"/>`);
        out.push(`<text x="${fmt(sc.x(d))}" y="${top + size + 20}" font-size="13" text-anchor="middle" fill="${INK.secondary}">${d}</text>`);
        out.push(`<text x="${left - 9}" y="${fmt(sc.y(d) + 4.5)}" font-size="13" text-anchor="end" fill="${INK.secondary}">${d}</text>`);
    }
    out.push(`<text x="${left + size / 2}" y="${top + size + 44}" font-size="14" text-anchor="middle" fill="${INK.primary}">${esc(labels.x)}</text>`);
    out.push(`<text transform="translate(${left - 46} ${top + size / 2}) rotate(-90)" font-size="14" text-anchor="middle" fill="${INK.primary}">${esc(labels.y)}</text>`);
    return out.join('');
}

const pts = (points, sc) => points.map(p => `${fmt(sc.x(p[0]))} ${fmt(sc.y(p[1]))}`).join('L');

/** A path through `points` in `color`, with a light ring under it and a dot at each point. */
export function pathMark(points, color, sc, { dots = true, width = 2.5, opacity = 1 } = {}) {
    if (points.length < 2) return '';
    const d = `M${pts(points, sc)}`;
    const ring = `<path d="${d}" fill="none" stroke="${INK.surface}" stroke-width="${width + 2.5}" stroke-linejoin="round" stroke-linecap="round" opacity="${0.85 * opacity}"/>`;
    const line = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"/>`;
    const marks = dots ? points.slice(1).map(p => `<circle cx="${fmt(sc.x(p[0]))}" cy="${fmt(sc.y(p[1]))}" r="3" fill="${color}" stroke="${INK.surface}" stroke-width="1"/>`).join('') : '';
    return ring + line + marks;
}

/** Population members as small rings; `faint` for a population the figure has moved past. */
export function populationMark(points, color, sc, { faint = false } = {}) {
    const style = faint ? 'fill-opacity="0.3" stroke-opacity="0.6" stroke-width="1.2"' : 'fill-opacity="0.75" stroke-width="1.6"';
    return points.map(p => `<circle cx="${fmt(sc.x(p[0]))}" cy="${fmt(sc.y(p[1]))}" r="4" fill="${INK.surface}" stroke="${color}" ${style}/>`).join('');
}

export function endMark(p, color, sc) {
    return `<circle cx="${fmt(sc.x(p[0]))}" cy="${fmt(sc.y(p[1]))}" r="5.5" fill="${color}" stroke="${INK.surface}" stroke-width="2"/>`;
}

/** A multi-start restart's start (a ring) or end (`filled`, a dot). */
export function restartMark(p, sc, { filled = false } = {}) {
    const fill = filled ? PATH_COLOR : INK.surface;
    return `<circle cx="${fmt(sc.x(p[0]))}" cy="${fmt(sc.y(p[1]))}" r="3" fill="${fill}" stroke="${PATH_COLOR}" stroke-width="1.2"/>`;
}

export function startMark(p, sc) {
    return `<circle cx="${fmt(sc.x(p[0]))}" cy="${fmt(sc.y(p[1]))}" r="6" fill="${INK.surface}" stroke="${INK.primary}" stroke-width="2"/>`;
}

export function lowestMark(p, sc) {
    const x = sc.x(p[0]), y = sc.y(p[1]), r = 5;
    return `<path d="M${fmt(x - r)} ${fmt(y - r)}L${fmt(x + r)} ${fmt(y + r)}M${fmt(x - r)} ${fmt(y + r)}L${fmt(x + r)} ${fmt(y - r)}" stroke="${INK.primary}" stroke-width="2"/>`;
}

// One legend row: a swatch drawn by `swatch(x, y)` and its label.
function legend(rows) {
    const { legendX, top } = LAYOUT;
    return rows.map((row, k) => {
        const y = top + 14 + k * 28;
        return row.swatch(legendX + 12, y) + `<text x="${legendX + 32}" y="${y + 4.5}" font-size="13.5" fill="${INK.primary}">${esc(row.label)}</text>`;
    }).join('');
}

export const swatches = {
    line: color => (x, y) => `<path d="M${x - 12} ${y}h24" stroke="${color}" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="2.6" fill="${color}"/>`,
    population: color => (x, y) => `<circle cx="${x}" cy="${y}" r="4" fill="${INK.surface}" stroke="${color}" stroke-width="1.6"/>`,
    restart: () => (x, y) => `<circle cx="${x}" cy="${y}" r="3" fill="${INK.surface}" stroke="${PATH_COLOR}" stroke-width="1.2"/>`,
    start: () => (x, y) => `<circle cx="${x}" cy="${y}" r="6" fill="${INK.surface}" stroke="${INK.primary}" stroke-width="2"/>`,
    lowest: () => (x, y) => `<path d="M${x - 5} ${y - 5}l10 10m-10 0l10 -10" stroke="${INK.primary}" stroke-width="2"/>`,
};

/**
 * The whole figure. `base` holds the parts every frame shares (band image and
 * axes); `marks` is the SVG of the paths and markers;
 * `legendRows` the legend; `note` an optional line under the legend.
 */
export function figureSvg({ base, marks, legendRows, note, title, desc }) {
    const { width, height, left, top, size, legendX } = LAYOUT;
    const noteY = top + 14 + legendRows.length * 28 + 14;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d" font-family="${FONT}">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<rect width="${width}" height="${height}" fill="${INK.surface}"/>
<clipPath id="plot"><rect x="${left}" y="${top}" width="${size}" height="${size}"/></clipPath>
<image x="${left}" y="${top}" width="${size}" height="${size}" preserveAspectRatio="none" href="${base.bands}"/>
${base.axes}
<g clip-path="url(#plot)">${marks}</g>
${legend(legendRows)}
${note ? `<text x="${legendX}" y="${noteY}" font-size="13" fill="${INK.secondary}">${esc(note)}</text>` : ''}
</svg>
`;
}
