// CSV export helpers for measured curves and computed spectra (see
// spectrumTable.js for the public API this backs).

import { nmToX } from './conversions.js';
import { X_UNITS } from './constants.js';
import { measuredCurveData } from './measuredCurve.js';

const Q_LABEL = { T: '%T', R: '%R', A: '%A', PSI: 'Psi (deg)', DEL: 'Delta (deg)' };
const X_LABEL = {
    [X_UNITS.NM]: 'Wavelength (nm)',
    [X_UNITS.UM]: 'Wavelength (µm)',
    [X_UNITS.CM1]: 'Wavenumber (cm-1)',
    [X_UNITS.EV]: 'Photon energy (eV)',
};

function csvRow(fields, delimiter) {
    return fields.map(value => {
        const text = String(value ?? '');
        if (!text.includes(delimiter) && !/["\r\n]/.test(text)) return text;
        return `"${text.replace(/"/g, '""')}"`;
    }).join(delimiter);
}

// Do all curves share one X grid (equal length + matching λ within 1e-9)?
function curvesShareGrid(list) {
    return list.every(cv =>
        cv.x.length === list[0].x.length &&
        cv.x.every((v, i) => Math.abs(v - list[0].x[i]) < 1e-9));
}

// Shared grid → single λ column followed by one value column per curve.
function sharedGridLines(list, format) {
    const { delimiter: d, xLabel, xOut, yHdr, yOut } = format;
    const lines = [csvRow([xLabel, ...list.map(cv => `${cv.name} ${yHdr(cv)}`)], d)];
    for (let i = 0; i < list[0].x.length; i++) {
        lines.push(csvRow([
            fmt(xOut(list[0].x[i])),
            ...list.map(cv => fmt(yOut(cv, cv.y[i]))),
        ], d));
    }
    return lines;
}

// Independent grids: a (λ, value) column pair per curve, padded to the longest.
function independentGridLines(list, format) {
    const { delimiter: d, xLabel, xOut, yHdr, yOut } = format;
    const maxLen = Math.max(...list.map(cv => cv.x.length));
    const header = [];
    list.forEach(cv => header.push(xLabel, `${cv.name} ${yHdr(cv)}`));
    const lines = [csvRow(header, d)];
    for (let i = 0; i < maxLen; i++) {
        const row = [];
        list.forEach(cv => {
            if (i < cv.x.length) row.push(fmt(xOut(cv.x[i])), fmt(yOut(cv, cv.y[i])));
            else row.push('', '');
        });
        lines.push(csvRow(row, d));
    }
    return lines;
}

/**
 * Export one or more measured curves to CSV text. Curves that share an
 * identical X grid are written as a single multi-column table; otherwise each
 * curve is written as its own (Wavelength, value) pair of columns padded to the
 * longest curve. The caller chooses whether Y is written as a fraction or a
 * percentage; T, R, and absorptance A all use the same scale.
 *
 * @param {measuredCurve[]} curves
 * @param {object} [opts] opts.delimiter (default ','), opts.asPercent (default true),
 *   opts.xUnit ('nm' | 'um' | 'cm-1', default 'nm')
 * @returns {string} CSV text with CRLF endings.
 */
export function curvesToCsv(curves, opts = {}) {
    const d = opts.delimiter || ',';
    const asPercent = opts.asPercent !== false;
    const xUnit = opts.xUnit || X_UNITS.NM;
    const list = (curves || []).filter(cv => cv && cv.x && cv.x.length).map(curve => ({
        ...curve,
        ...measuredCurveData(curve),
    })).filter(curve => curve.x.length);
    if (!list.length) return '';

    const xOut = value => nmToX(value, xUnit);
    const angular = curve => curve.quantity === 'PSI' || curve.quantity === 'DEL';
    const yOut = (curve, value) => asPercent && !angular(curve) ? value * 100 : value;
    const yHdr = curve => angular(curve)
        ? Q_LABEL[curve.quantity]
        : (asPercent ? Q_LABEL[curve.quantity] : curve.quantity);

    const format = { delimiter: d, xLabel: X_LABEL[xUnit], xOut, yHdr, yOut };
    const lines = curvesShareGrid(list)
        ? sharedGridLines(list, format)
        : independentGridLines(list, format);
    return lines.join('\r\n') + '\r\n';
}

function fmt(v) {
    if (!Number.isFinite(v)) return '';
    // Twelve decimal places keep export → import error below 1e-12 while
    // Number(...).toString() removes insignificant trailing zeroes.
    return Number(v.toFixed(12)).toString();
}

/**
 * Build a CSV from an arbitrary X grid + named Y columns (used to export the
 * design's COMPUTED spectrum: T/R/A vs λ). Values are written verbatim.
 */
export function tableToCsv({ x, columns, xLabel = 'Wavelength (nm)' }, opts = {}) {
    const d = opts.delimiter || ',';
    const cols = columns || [];
    const lines = [csvRow([xLabel, ...cols.map(c => c.name)], d)];
    for (let i = 0; i < x.length; i++) {
        lines.push(csvRow([fmt(x[i]), ...cols.map(c => fmt(c.values[i]))], d));
    }
    return lines.join('\r\n') + '\r\n';
}
