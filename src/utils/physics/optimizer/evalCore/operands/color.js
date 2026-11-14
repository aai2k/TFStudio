/**
 * Colour rows, RCOL and TCOL: one quantity of the colour of R or T under the
 * row's illuminant and observer.
 *
 * R or T is read at every sample of the row's band grid, 380-780 nm at its
 * Step (sampling.js), through tmmProp, so a row under a cone reads the
 * cone-averaged spectrum the Color Evaluation window integrates. X, Y and Z are
 * the tristimulus integrals of that spectrum, Macleod, Thin-Film Optical
 * Filters 5th ed. Eqs. (12.1)-(12.3), and the quantity is computed from them
 * by the colorimetry module (colorimetry/quantities.js), so a row at the
 * window's step reads the number the window and tf.color() give.
 */

import {
    COLOR_QUANTITIES, ILLUMINANTS, OBSERVERS, tristimulus, whitePoint, colorQuantity, quantityObserver, HUE_CHROMA,
} from '../../../colorimetry.js';
import { charOf, operandSampleLambdas } from '../../sampling.js';
import { tmmProp } from '../tmmEval.js';
import { OperandEvaluationError } from './errors.js';

/**
 * What a colour row reads: its sample wavelengths (nm), polarization, channel
 * ('R' or 'T'), illuminant, and the observer ('2' or '10') its quantity is
 * computed with (quantityObserver).
 */
export function colorRowReads(op) {
    return {
        lambdas: operandSampleLambdas(op),
        pol: op.pol || 'avg',
        char: charOf(op.type),
        illuminant: op.illuminant,
        observer: quantityObserver(op.color, String(op.observer)),
    };
}

/**
 * The tristimulus values and white of `values`, R or T as a fraction at each
 * of `reads.lambdas`, as `{ XYZ, white, observer }`.
 */
export function colorOfSpectrum(reads, values) {
    const spectrum = { lambda: reads.lambdas, values };
    return {
        XYZ: tristimulus(spectrum, reads.observer, reads.illuminant),
        white: whitePoint(reads.lambdas, reads.observer, reads.illuminant),
        observer: reads.observer,
    };
}

// A row naming a quantity, illuminant or observer this version does not have
// is refused rather than read under D65 and the 2° observer, which the
// colorimetry tables fall back to. A CCT row's miss is taken in mired, 10⁶/T,
// which has no value at a target of 0 K or below.
function _assertColorRow(op) {
    if (!COLOR_QUANTITIES.includes(op.color)) {
        throw new OperandEvaluationError(`A colour row cannot read ${op.color}: it is not in the Color list.`);
    }
    if (!ILLUMINANTS.some(illuminant => illuminant.id === op.illuminant)
        || !OBSERVERS.some(observer => observer.id === String(op.observer))) {
        throw new OperandEvaluationError(`A colour row cannot be read under illuminant ${op.illuminant} with observer ${op.observer}.`);
    }
    if (op.color === 'CCT' && !(op.target > 0)) {
        throw new OperandEvaluationError('A CCT row needs a target above 0 K.');
    }
}

/**
 * The value of colour row `op`. A hue row also leaves the chroma beside its
 * hue (C*ab for hab, C*uv for huv) in ctx._colorChromas, which its residual
 * takes the hue miss at (evalCore/residualScale.js).
 */
export function _evalColor(op, ctx) {
    _assertColorRow(op);
    const reads = colorRowReads(op);
    const values = reads.lambdas.map(lambda =>
        tmmProp(lambda, op.aoi, reads.pol, reads.char, ctx, ctx.frontThicks, ctx.frontMats));
    const color = colorOfSpectrum(reads, values);
    const chroma = HUE_CHROMA[op.color];
    if (chroma) ctx._colorChromas?.set(op, colorQuantity(chroma, color).value);
    return colorQuantity(op.color, color).value;
}
