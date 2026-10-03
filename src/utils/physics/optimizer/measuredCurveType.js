/**
 * What a measured-curve merit row is, and how a fresh one is seeded.
 *
 * A leaf: the operand model imports it, so it may import nothing back.
 */

// Snapshot of one sampled measured curve. It occupies one row in the merit
// table and evaluates directly as an RMS deviation, but is expanded into
// ordinary single-wavelength operands before an optimizer run so least-squares
// retains one independent residual/Jacobian row per measured point.
export const MEASURED_CURVE_OPERAND_TYPES = ['MCURVE'];

// The channels a block can hold: a photometric R, T or A, T in dB (TDB, its
// points in dB), or one half of an ellipsometric Ψ/Δ pair. The channel is a
// field on the block rather than part of its type code, so the table treats
// every block alike.
export const MEASURED_CURVE_QUANTITIES = ['T', 'R', 'A', 'TDB', 'PSI', 'DEL'];

// Types the merit table never offers: they carry data no hand-typed row can.
export const GENERATED_ONLY_OPERAND_TYPES = [...MEASURED_CURVE_OPERAND_TYPES];

export function isMeasuredCurve(type) { return type === 'MCURVE'; }

// The channel a block is scored on, or null for a channel this build does not
// know, which a newer TFStudio may have written. A block with no channel
// recorded is R.
export function measuredCurveChannel(op) {
    const quantity = op?.quantity ?? 'R';
    return MEASURED_CURVE_QUANTITIES.includes(quantity) ? quantity : null;
}

export function isEllipsometricQuantity(quantity) {
    return quantity === 'PSI' || quantity === 'DEL';
}

/** A block holding measured Ψ or Δ rather than a photometric spectrum. */
export function isEllipsometricMeasuredCurve(op) {
    return isMeasuredCurve(op?.type) && isEllipsometricQuantity(op.quantity);
}

/**
 * A block scored with its level free (`levelFree: true`): the constant, in the
 * block's own unit, that best fits the design's departure from the points is
 * taken out before the deviation is scored, so the block scores the shape of
 * the curve and not where it sits. A gain-flattening target is written this
 * way, its level left to an insertion-loss row. Ψ and Δ blocks have no free
 * level.
 */
export function hasFreeLevel(op) {
    return isMeasuredCurve(op?.type) && op.levelFree === true && !isEllipsometricQuantity(op.quantity);
}

// A measured block scores an RMS deviation from its stored points, so its target
// is fixed at zero and its band is whatever the snapshot covers.
export function seedMeasuredCurve(base) {
    if (!isMeasuredCurve(base.type)) return;
    base.target = 0;
    base.targetEnd = null;
    if (!Array.isArray(base.sampleLambdas)) base.sampleLambdas = [];
    if (!Array.isArray(base.sampleTargets)) base.sampleTargets = [];
    // A channel this build does not know is kept as written, so saving the
    // design here does not turn the block into an R block for good.
    if (base.quantity == null) base.quantity = 'R';
    // A measured Δ is in whichever sign its instrument wrote, and the block has
    // to say which. Azzam-Bashara is what measurement files carry.
    if (base.quantity === 'DEL' && !base.deltaConvention) base.deltaConvention = 'azzam';
    if (!base.sampleLambdas.length) return;
    base.lambdaStart = base.sampleLambdas[0];
    base.lambdaEnd = base.sampleLambdas[base.sampleLambdas.length - 1];
}
