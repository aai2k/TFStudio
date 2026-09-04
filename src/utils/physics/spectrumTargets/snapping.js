/**
 * CAD-style snapping for freshly drawn/dragged target lines. See
 * ../spectrumTargets.js for the overlay conventions this implements.
 */

import { OPTICAL_TYPES } from './style.js';

// Nearest value in `arr` within `tol`, or null. Used to snap a freshly
// drawn/dragged endpoint onto an existing target end so consecutive segments
// connect (ramp → flat) like object-snap in CAD.
function nearestWithin(arr, v, tol) {
    let best = null, bestD = tol;
    for (const a of arr) {
        const d = Math.abs(a - v);
        if (d <= bestD) { bestD = d; best = a; }
    }
    return best;
}
function snapToStep(v, step) { return step > 0 ? Math.round(v / step) * step : v; }

// Snap a drawn/dragged line ({x0,y0,x1,y1}; x = nm, y = %) to:
//   1. existing target endpoints (object-snap, so segments connect), else
//   2. the grid (nearest snapNm in x, snapPct in y), and
//   3. ortho — if the two ends are within snapPct in y, force them equal (a
//      perfectly flat line, e.g. a level at 50 %).
// `excludeId` omits one operand's own endpoints (when snapping a drag of it).
//
// Levels are snapped in the space the axis is ruled in. That is percentage
// points unless `levelScale` is given: `{ toUnit, fromUnit, step }` maps a
// percentage into another unit's numbers and back, and the grid, the object-snap
// tolerance and the ortho test are all taken in that unit, so on a logarithmic
// axis a level lands on a round decibel or density value. A level the unit has
// no reading for, zero on such an axis, is left where it is.
export function snapDrawnLine(line, opts = {}) {
    const {
        operands = [], snapNm = 10, snapPct = 5, ortho = true, excludeId = null, levelScale = null,
    } = opts;
    const toUnit = levelScale ? levelScale.toUnit : y => y;
    const fromUnit = levelScale ? levelScale.fromUnit : y => y;
    const step = levelScale ? levelScale.step : snapPct;
    const xs = [], ys = [];
    for (const op of operands) {
        if (op.id === excludeId || !OPTICAL_TYPES.has(op.type)) continue;
        if (op.lambdaStart != null) xs.push(op.lambdaStart);
        if (op.lambdaEnd   != null) xs.push(op.lambdaEnd);
        if (op.target      != null) ys.push(toUnit(op.target * 100));
        if (op.targetEnd   != null) ys.push(toUnit(op.targetEnd * 100));
    }
    const snapX = (x) => {
        const near = nearestWithin(xs, x, Math.max(snapNm, 1e-9));
        return near != null ? near : snapToStep(x, snapNm);
    };
    const snapY = (y) => {
        const level = toUnit(y);
        if (!Number.isFinite(level)) return y;
        const near = nearestWithin(ys.filter(Number.isFinite), level, Math.max(step, 1e-9));
        return fromUnit(near != null ? near : snapToStep(level, step));
    };
    let x0 = snapX(line.x0), x1 = snapX(line.x1);
    let y0 = snapY(line.y0), y1 = snapY(line.y1);
    const drawn = [toUnit(line.y0), toUnit(line.y1)];
    if (ortho && drawn.every(Number.isFinite) && Math.abs(drawn[0] - drawn[1]) <= step) {
        const m = snapY(fromUnit((toUnit(y0) + toUnit(y1)) / 2));
        y0 = y1 = m;
    }
    return { x0, y0, x1, y1 };
}
