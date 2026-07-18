// CSV export helpers for measured curves and computed spectra (see
// spectrumTable.js for the public API this backs).

const Q_LABEL = { T: '%T', R: '%R', A: 'Absorbance' };

// Do all curves share one X grid (equal length + matching λ within 1e-9)?
function curvesShareGrid(list) {
    return list.every(cv =>
        cv.x.length === list[0].x.length &&
        cv.x.every((v, i) => Math.abs(v - list[0].x[i]) < 1e-9));
}

// Shared grid → single λ column followed by one value column per curve.
function sharedGridLines(list, d, yHdr, yOut) {
    const lines = [['Wavelength (nm)', ...list.map(cv => `${cv.name} ${yHdr(cv)}`)].join(d)];
    for (let i = 0; i < list[0].x.length; i++) {
        lines.push([
            fmt(list[0].x[i]),
            ...list.map(cv => fmt(yOut(cv, cv.y[i]))),
        ].join(d));
    }
    return lines;
}

// Independent grids: a (λ, value) column pair per curve, padded to the longest.
function independentGridLines(list, d, yHdr, yOut) {
    const maxLen = Math.max(...list.map(cv => cv.x.length));
    const header = [];
    list.forEach(cv => header.push('Wavelength (nm)', `${cv.name} ${yHdr(cv)}`));
    const lines = [header.join(d)];
    for (let i = 0; i < maxLen; i++) {
        const row = [];
        list.forEach(cv => {
            if (i < cv.x.length) row.push(fmt(cv.x[i]), fmt(yOut(cv, cv.y[i])));
            else row.push('', '');
        });
        lines.push(row.join(d));
    }
    return lines;
}

/**
 * Export one or more measured curves to CSV text. Curves that share an
 * identical X grid are written as a single multi-column table; otherwise each
 * curve is written as its own (Wavelength, value) pair of columns padded to the
 * longest curve. Y is written back in PERCENT for T/R (matching how instruments
 * emit), absorbance left as-is.
 *
 * @param {measuredCurve[]} curves
 * @param {object} [opts] opts.delimiter (default ','), opts.asPercent (default true)
 * @returns {string} CSV text with CRLF endings.
 */
export function curvesToCsv(curves, opts = {}) {
    const d = opts.delimiter || ',';
    const asPercent = opts.asPercent !== false;
    const list = (curves || []).filter(cv => cv && cv.x && cv.x.length);
    if (!list.length) return '';

    const yOut = (cv, v) => (cv.quantity === 'A' ? v : (asPercent ? v * 100 : v));
    const yHdr = (cv) => cv.quantity === 'A' ? 'Absorbance' : (asPercent ? Q_LABEL[cv.quantity] : cv.quantity);

    const lines = curvesShareGrid(list)
        ? sharedGridLines(list, d, yHdr, yOut)
        : independentGridLines(list, d, yHdr, yOut);
    return lines.join('\r\n') + '\r\n';
}

function fmt(v) {
    if (!Number.isFinite(v)) return '';
    // Trim trailing zeros but keep meaningful precision.
    return Number(v.toFixed(6)).toString();
}

/**
 * Build a CSV from an arbitrary X grid + named Y columns (used to export the
 * design's COMPUTED spectrum: T/R/A vs λ). Values are written verbatim.
 */
export function tableToCsv({ x, columns, xLabel = 'Wavelength (nm)' }, opts = {}) {
    const d = opts.delimiter || ',';
    const cols = columns || [];
    const lines = [[xLabel, ...cols.map(c => c.name)].join(d)];
    for (let i = 0; i < x.length; i++) {
        lines.push([fmt(x[i]), ...cols.map(c => fmt(c.values[i]))].join(d));
    }
    return lines.join('\r\n') + '\r\n';
}
