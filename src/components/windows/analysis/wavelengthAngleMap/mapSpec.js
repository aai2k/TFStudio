/**
 * The window's controls as a Plot Engine surface specification.
 *
 * The map is the Plot Engine's wavelength x AOI surface with the axis pickers
 * already settled: X is always wavelength, Y is always angle of incidence. The
 * sweep, the chart and the results grid downstream are the Plot Engine's own,
 * so the two windows cannot disagree about what T at 45 degrees is.
 *
 * Ranges are entered as a step size, the way every other spectral window in the
 * app takes them, and converted here to the sample counts a surface spec wants.
 */

import { MAX_AXIS_STEPS } from '../../../../utils/physics/plotQuantities.js';

/**
 * Samples spanning [from, to] at `step`, inclusive of both ends.
 *
 * Capped at the surface grid limit: past it the endpoints are kept and the
 * spacing widens, so the readout in the settings panel reports the grid that
 * was actually computed rather than the one that was asked for.
 */
export function axisSteps(from, to, step) {
    const span = Math.abs(to - from);
    // A step of zero divides the range into nothing. It cannot be entered (both
    // the fields and the settings registry bound it away from zero); a stored
    // value that reaches here anyway falls back to one sample per unit.
    const size = Math.abs(step) > 0 ? Math.abs(step) : 1;
    return Math.max(2, Math.min(MAX_AXIS_STEPS, Math.round(span / size) + 1));
}

/**
 * The part of the specification a sweep depends on.
 *
 * The render style and the colorscale are how a finished grid is drawn, not
 * what is in it, so they are added by the window and left out here: switching
 * between the heatmap and the 3D surface redraws without recomputing.
 */
export function buildMapSpec(values, evalMode) {
    return {
        z: values.channel,
        polarization: values.pol,
        surfaceMode: evalMode || 'front',
        // Both axes are swept, so neither fixed value is read. They are part of
        // a surface spec's shape and are kept valid rather than left undefined.
        fixedLambda_nm: values.lambdaStart,
        fixedAOI_deg: values.angleStart,
        xVar: 'wavelength',
        xFrom: values.lambdaStart,
        xTo: values.lambdaEnd,
        xSteps: axisSteps(values.lambdaStart, values.lambdaEnd, values.lambdaStep),
        yVar: 'aoi',
        yFrom: values.angleStart,
        yTo: values.angleEnd,
        ySteps: axisSteps(values.angleStart, values.angleEnd, values.angleStep),
    };
}
