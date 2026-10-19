/**
 * The error a merit-function row raises when it cannot be scored, and the
 * incidence-side checks that raise it. A row that cannot be evaluated is
 * reported on that row instead of contributing a number to the merit.
 */

import { isMeasuredCurve } from '../../operandModel.js';

export class OperandEvaluationError extends RangeError {
    constructor(message) {
        super(message);
        this.name = 'OperandEvaluationError';
    }
}

export function _assertMeasurementSide(op, ctx) {
    const requested = isMeasuredCurve(op.type) ? op.side : op.measurementSide;
    if (!requested) return;
    // The existing full-system model is illuminated from the front. A back
    // measurement therefore requires the design's back-only evaluation mode;
    // refusing a mismatch is safer than silently fitting a different spectrum.
    const evaluated = !ctx.evalFullSystem && ctx.surfaceMode === 'back_only' ? 'back' : 'front';
    if (requested !== evaluated) {
        throw new OperandEvaluationError(
            `Measured curve expects ${requested}-side incidence, but the design merit function evaluates ${evaluated}-side incidence.`,
        );
    }
}

// Ψ and Δ are evaluated on the front stack alone, so a back-side measurement
// has nothing to be scored against, and a design evaluated on its back side
// cannot take a front-side one.
export function _assertFrontEllipsometry(op, ctx) {
    const side = op.side || op.measurementSide || 'front';
    if (side === 'back') {
        throw new OperandEvaluationError('An ellipsometric fit target is evaluated on the front side only.');
    }
    // A block or point that names no side is still a front-side measurement,
    // so a design evaluated from its back refuses it in either form.
    _assertMeasurementSide({ measurementSide: side }, ctx);
}
