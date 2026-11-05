/**
 * A curve after an edit from its settings, kept to settings it can be drawn
 * with.
 *
 *   • A new sweep starts on that sweep's own range: a thickness range is set by
 *     the layer, and 400 to 800 means nothing as an angle.
 *   • An axis is read on a side its quantity has. Ψ and Δ belong to one surface,
 *     so a curve moved onto them from T of the whole part reads the front.
 *   • The merit function is one number for the whole design. It changes with a
 *     layer, not with λ or AOI, so a curve that reads it sweeps a layer.
 *   • A curve still under the name it was given for what it plots is renamed
 *     for what it plots after the edit. A name typed in is kept.
 */

import {
    LAMBDA_STEP_NM, defaultAxisRange, isLayerVar, parseAxisVar, quantitySides,
} from '../../../../utils/physics/plotQuantities.js';
import { niceTickInterval } from '../../../ui/chartOptions.js';

// Samples a new range other than λ starts with: a smooth line at the width the
// plot is drawn, and few enough that a merit function curve, which evaluates
// every operand at each sample, comes back in seconds.
const NEW_RANGE_SAMPLES = 200;

/** The range a curve run along `token` starts with. */
export function sweepRange(design, token) {
    const { from, to } = defaultAxisRange(design, token);
    const step = parseAxisVar(token).kind === 'lambda'
        ? LAMBDA_STEP_NM
        : niceTickInterval(to - from, { targetTicks: NEW_RANGE_SAMPLES });
    return { sweep: token, rangeFrom: from, rangeTo: to, rangeStep: step };
}

function onItsSide(axis) {
    const sides = quantitySides(axis.quantity);
    return sides.length && !sides.includes(axis.side) ? { ...axis, side: sides[0] } : axis;
}

/** Whether either axis of a curve reads the merit function. */
export const readsMerit = curve => curve.x.quantity === 'MF' || curve.y.quantity === 'MF';

function renamed(curve, next, patch, defaultName) {
    if (!defaultName || 'label' in patch || curve.label !== defaultName(curve)) return next;
    return { ...next, label: defaultName(next) };
}

/**
 * `curve` with `patch` applied. A patch to an axis is a whole axis,
 * `{ quantity, polarization, side }`. `defaultName(curve)`, when given, is the
 * name a curve is given for what it plots.
 */
export function editCurve(curve, patch, design, defaultName) {
    let next = { ...curve, ...patch };
    if (patch.x) next.x = onItsSide(next.x);
    if (patch.y) next.y = onItsSide(next.y);
    if (patch.sweep && patch.sweep !== curve.sweep) next = { ...next, ...sweepRange(design, patch.sweep) };
    if (readsMerit(next) && !isLayerVar(next.sweep)) next = { ...next, ...sweepRange(design, 'thk:0') };
    return renamed(curve, next, patch, defaultName);
}
