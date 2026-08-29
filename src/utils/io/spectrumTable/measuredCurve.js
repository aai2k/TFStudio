// Normalized measured-curve overlay model (see spectrumTable.js for the
// public API this backs).

import { X_UNITS, QUANTITIES } from './constants.js';
import { xToNm, absorbanceToT } from './conversions.js';

let _curveSeq = 0;

/**
 * A fresh curve id.
 *
 * Every curve on a design must carry its own: the list keys React by id, and
 * removing or toggling a curve matches on it, so two curves sharing one id act
 * as a single curve that cannot be told apart. Anything that adds a curve built
 * earlier, rather than one built on the spot, has to stamp a new id here.
 */
export function measuredCurveId() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return `meas-${++_curveSeq}-${Math.round(now)}-${Math.random().toString(36).slice(2, 8)}`;
}

const FAMILY_COLOR = {
    R: '#ef5350', T: '#2196f3', A: '#66bb6a', PSI: '#4fc3f7', DEL: '#ff8a65',
};
const POLARIZATIONS = ['avg', 's', 'p'];
const SIDES = ['front', 'back'];

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
 *   p.aoi         angle of incidence in degrees (default 0)
 *   p.pol         'avg' | 's' | 'p' (default 'avg')
 *   p.side        'front' | 'back' (default 'front')
 *   p.color       optional override
 * @returns measuredCurve { id, name, quantity, source, x:nm[] (asc), y:frac[], color, visible, xUnit, yWasPercent, aoi, pol, side }
 */
export function makeMeasuredCurve(p) {
    const xUnit = p.xUnit || X_UNITS.NM;
    let quantity = QUANTITIES.includes(p.quantity) ? p.quantity : 'T';
    const angular = quantity === 'PSI' || quantity === 'DEL';
    const isAbs = !angular && !!p.isAbsorbance;
    const parsedAoi = Number(p.aoi);
    const aoi = Number.isFinite(parsedAoi) ? parsedAoi : 0;
    const pol = POLARIZATIONS.includes(p.pol) ? p.pol : 'avg';
    const side = SIDES.includes(p.side) ? p.side : 'front';

    // Pair (x_nm, y_fraction), dropping non-finite pairs.
    const pairs = [];
    const n = Math.min(p.x.length, p.y.length);
    for (let i = 0; i < n; i++) {
        const xn = xToNm(p.x[i], xUnit);
        let yv = p.y[i];
        if (!Number.isFinite(xn) || !Number.isFinite(yv)) continue;
        if (isAbs) { yv = absorbanceToT(yv); quantity = 'T'; }
        else if (!angular && p.isPercent) yv = yv / 100;
        pairs.push([xn, yv]);
    }
    pairs.sort((a, b) => a[0] - b[0]);   // ascending nm

    return {
        id: p.id || measuredCurveId(),
        name: p.name || 'Measured',
        quantity,
        source: p.source || 'import',
        x: pairs.map(pr => pr[0]),
        y: pairs.map(pr => pr[1]),
        color: p.color || FAMILY_COLOR[quantity] || '#ffb300',
        visible: p.visible !== false,
        xUnit,
        yWasPercent: angular || isAbs ? false : !!p.isPercent,
        aoi,
        pol,
        side,
        ...(quantity === 'DEL' ? { deltaConvention: p.deltaConvention || 'azzam' } : {}),
    };
}

/**
 * The same list, with a fresh id on any curve that repeats one.
 *
 * Returns the input array unchanged when every id is already unique, so a
 * caller can compare by reference to see whether a repair was needed. Designs
 * written before ids were stamped per curve can hold duplicates, and a
 * duplicate makes two curves act as one.
 */
export function withUniqueCurveIds(curves) {
    const list = Array.isArray(curves) ? curves : [];
    const seen = new Set();
    let repaired = false;
    const output = list.map((curve) => {
        const id = curve?.id;
        if (id && !seen.has(id)) { seen.add(id); return curve; }
        repaired = true;
        const fresh = measuredCurveId();
        seen.add(fresh);
        return { ...curve, id: fresh };
    });
    return repaired ? output : curves;
}

/** Return the portion of a curve inside its non-destructive trim bounds. */
export function measuredCurveData(curve) {
    const x = curve?.x || [];
    const y = curve?.y || [];
    const min = Number.isFinite(curve?.trimMin) ? curve.trimMin : -Infinity;
    const max = Number.isFinite(curve?.trimMax) ? curve.trimMax : Infinity;
    const outputX = [], outputY = [];
    const count = Math.min(x.length, y.length);
    for (let index = 0; index < count; index++) {
        if (x[index] < min || x[index] > max) continue;
        outputX.push(x[index]);
        outputY.push(y[index]);
    }
    return { x: outputX, y: outputY };
}
