/**
 * JCAMP-DX block serialization (AFFN encoding) for the writer.
 */

import { X_UNITS } from '../spectrumTable.js';

const X_UNIT_LABEL = { [X_UNITS.NM]: 'NANOMETERS', [X_UNITS.CM1]: '1/CM', [X_UNITS.UM]: 'MICROMETERS' };
const Y_UNIT_LABEL = { T: 'TRANSMITTANCE', R: 'REFLECTANCE', A: 'ABSORBANCE' };

function fmtNum(v) {
    if (!Number.isFinite(v)) return '0';
    return Number(v.toFixed(6)).toString();
}

function isUniform(x) {
    if (x.length < 3) return true;
    const d = x[1] - x[0];
    if (!(Math.abs(d) > 0)) return false;
    const tol = Math.abs(d) * 1e-4;
    for (let i = 2; i < x.length; i++) {
        if (Math.abs((x[i] - x[i - 1]) - d) > tol) return false;
    }
    return true;
}

// `(X++(Y..Y))` rows: leading abscissa then up to 6 ordinates per line.
function xydataLines(x, y, n, deltax) {
    const PER_LINE = 6;
    const out = [];
    for (let i = 0; i < n; i += PER_LINE) {
        const row = [fmtNum(x[0] + i * deltax)];
        for (let k = i; k < Math.min(i + PER_LINE, n); k++) row.push(fmtNum(y[k]));
        out.push(row.join(' '));
    }
    return out;
}

// `(XY..XY)` rows: up to 4 explicit "x,y" pairs per line.
function xypointsLines(x, y, n) {
    const PER_LINE = 4;
    const out = [];
    for (let i = 0; i < n; i += PER_LINE) {
        const row = [];
        for (let k = i; k < Math.min(i + PER_LINE, n); k++) row.push(`${fmtNum(x[k])},${fmtNum(y[k])}`);
        out.push(row.join(' '));
    }
    return out;
}

/**
 * Build ONE JCAMP-DX block (LDRs + data) for a spectrum, WITHOUT the final
 * `##END=` (so it can be embedded in a LINK).  AFFN encoding.
 * @param s { title, x (nm), y (fraction or absorbance), quantity, isAbsorbance }
 */
export function buildBlock(s, { version = '4.24', dataType = 'UV/VIS SPECTRUM' } = {}) {
    const x = s.x, y = s.y, n = x.length;
    const xUnitLabel = X_UNIT_LABEL[s.xUnit || X_UNITS.NM] || 'NANOMETERS';
    const yUnitLabel = Y_UNIT_LABEL[s.quantity] || (s.isAbsorbance ? 'ABSORBANCE' : 'ARBITRARY UNITS');

    const lines = [
        `##TITLE=${s.title || 'Spectrum'}`,
        `##JCAMP-DX=${version}`,
        `##DATA TYPE=${dataType}`,
        `##XUNITS=${xUnitLabel}`,
        `##YUNITS=${yUnitLabel}`,
        `##XFACTOR=1.0`,
        `##YFACTOR=1.0`,
    ];
    if (n) {
        lines.push(`##FIRSTX=${fmtNum(x[0])}`);
        lines.push(`##LASTX=${fmtNum(x[n - 1])}`);
        lines.push(`##FIRSTY=${fmtNum(y[0])}`);
        lines.push(`##NPOINTS=${n}`);
    }

    if (n && isUniform(x)) {
        const deltax = n > 1 ? (x[n - 1] - x[0]) / (n - 1) : 1;
        lines.push(`##DELTAX=${fmtNum(deltax)}`);
        lines.push(`##XYDATA=(X++(Y..Y))`);
        lines.push(...xydataLines(x, y, n, deltax));
    } else if (n) {
        lines.push(`##XYPOINTS=(XY..XY)`);
        lines.push(...xypointsLines(x, y, n));
    }
    return lines.join('\r\n');
}
