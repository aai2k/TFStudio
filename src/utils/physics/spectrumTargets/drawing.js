/**
 * Convert a freshly drawn line into a new merit-operand's overrides. See
 * ../spectrumTargets.js for the overlay conventions this implements.
 *
 * A line is `{ x0, y0, x1, y1 }` with x in nm and y in the plot's axis unit.
 * Which operand type it becomes is the plot's decision; what is shared is how
 * the line's span and height turn into wavelengths and a target, read through
 * a level from ./levels.js.
 */

import { PERCENT_LEVEL } from './levels.js';

/** The wavelengths a drawn line spans, in order, and the level at each end. */
export function drawnLineSpan(line) {
    const leftIsStart = line.x0 <= line.x1;
    return {
        lambdaStart: Math.max(0.01, Math.min(line.x0, line.x1)),
        lambdaEnd: Math.max(0.01, Math.max(line.x0, line.x1)),
        yStart: leftIsStart ? line.y0 : line.y1,
        yEnd: leftIsStart ? line.y1 : line.y0,
    };
}

/**
 * Overrides for an operand that holds one level across its span: the line's
 * mean height, so a slope is ignored. `fields` carries the type, polarization
 * and angle the caller has decided on.
 */
export function levelOperandOverrides(line, fields, level = PERCENT_LEVEL) {
    const span = drawnLineSpan(line);
    return {
        ...fields,
        lambdaStart: span.lambdaStart, lambdaEnd: span.lambdaEnd,
        target: level.fromAxis((span.yStart + span.yEnd) / 2),
        targetEnd: null,
    };
}

/**
 * Overrides for a per-wavelength operand: a level at each end, so a tilted
 * line is a linear ramp and a flat one stays flat.
 */
export function rampOperandOverrides(line, fields, level = PERCENT_LEVEL) {
    const span = drawnLineSpan(line);
    return {
        ...fields,
        lambdaStart: span.lambdaStart, lambdaEnd: span.lambdaEnd,
        target: level.fromAxis(span.yStart),
        targetEnd: level.fromAxis(span.yEnd),
    };
}

const AVERAGE_TYPE = { R: 'RAV', T: 'TAV', A: 'AAV' };
const RAMP_TYPE = { R: 'RGT', T: 'TGT', A: 'AGT' };

/**
 * The R/T/A plot's reading of a drawn line. `curve` is R, T or A, `pol` is
 * avg, s or p, `aoi` is in degrees. In 'average' mode the line becomes a
 * band-average operand (TAV/RAV/AAV) at its mean height; in 'continuous' mode
 * it becomes a per-wavelength operand (TGT/RGT/AGT), a ramp when tilted.
 */
export function operandOverridesFromDrawnLine(line, curve, pol, mode = 'average', aoi = 0) {
    const family = (curve === 'T' || curve === 'A') ? curve : 'R';
    const fields = { pol: pol || 'avg', aoi: Number(aoi) || 0 };
    return mode === 'continuous'
        ? rampOperandOverrides(line, { type: RAMP_TYPE[family], ...fields })
        : levelOperandOverrides(line, { type: AVERAGE_TYPE[family], ...fields });
}
