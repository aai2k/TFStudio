// Normalized measured-curve overlay model (see spectrumTable.js for the
// public API this backs).

import { X_UNITS, QUANTITIES } from './constants.js';
import { xToNm, absorbanceToT } from './conversions.js';

let _curveSeq = 0;
function curveId() { return `meas-${++_curveSeq}-${Math.round((typeof performance !== 'undefined' ? performance.now() : 0))}`; }

const FAMILY_COLOR = { R: '#ef5350', T: '#2196f3', A: '#66bb6a' };

/**
 * Build a normalized measured-curve overlay from one X array + one Y column.
 *
 * @param {object} p
 *   p.name        display label
 *   p.x           number[] in unit p.xUnit (source order)
 *   p.xUnit       X_UNITS.*
 *   p.y           number[] Y values (source scale)
 *   p.quantity    'T' | 'R' | 'A'
 *   p.isPercent   Y is 0..100 (divide by 100)
 *   p.isAbsorbance Y is absorbance → convert to T = 10^-A (quantity forced to 'T')
 *   p.color       optional override
 * @returns measuredCurve { id, name, quantity, source, x:nm[] (asc), y:frac[], color, visible, xUnit, yWasPercent }
 */
export function makeMeasuredCurve(p) {
    const xUnit = p.xUnit || X_UNITS.NM;
    let quantity = QUANTITIES.includes(p.quantity) ? p.quantity : 'T';
    const isAbs = !!p.isAbsorbance;

    // Pair (x_nm, y_fraction), dropping non-finite pairs.
    const pairs = [];
    const n = Math.min(p.x.length, p.y.length);
    for (let i = 0; i < n; i++) {
        const xn = xToNm(p.x[i], xUnit);
        let yv = p.y[i];
        if (!Number.isFinite(xn) || !Number.isFinite(yv)) continue;
        if (isAbs) { yv = absorbanceToT(yv); quantity = 'T'; }
        else if (p.isPercent) yv = yv / 100;
        pairs.push([xn, yv]);
    }
    pairs.sort((a, b) => a[0] - b[0]);   // ascending nm

    return {
        id: p.id || curveId(),
        name: p.name || 'Measured',
        quantity,
        source: p.source || 'import',
        x: pairs.map(pr => pr[0]),
        y: pairs.map(pr => pr[1]),
        color: p.color || FAMILY_COLOR[quantity] || '#ffb300',
        visible: p.visible !== false,
        xUnit,
        yWasPercent: isAbs ? false : !!p.isPercent,
    };
}
