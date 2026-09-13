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

// The channels a block can hold: a photometric R, T or A, or one half of an
// ellipsometric Ψ/Δ pair. The channel is a field on the block rather than part
// of its type code, so the table treats every block alike.
export const MEASURED_CURVE_QUANTITIES = ['T', 'R', 'A', 'PSI', 'DEL'];

// Types the merit table never offers: they carry data no hand-typed row can.
export const GENERATED_ONLY_OPERAND_TYPES = [...MEASURED_CURVE_OPERAND_TYPES];

export function isMeasuredCurve(type) { return type === 'MCURVE'; }

export function isEllipsometricQuantity(quantity) {
    return quantity === 'PSI' || quantity === 'DEL';
}

/** A block holding measured Ψ or Δ rather than a photometric spectrum. */
export function isEllipsometricMeasuredCurve(op) {
    return isMeasuredCurve(op?.type) && isEllipsometricQuantity(op.quantity);
}

// A measured block scores an RMS deviation from its stored points, so its target
// is fixed at zero and its band is whatever the snapshot covers.
export function seedMeasuredCurve(base) {
    if (!isMeasuredCurve(base.type)) return;
    base.target = 0;
    base.targetEnd = null;
    if (!Array.isArray(base.sampleLambdas)) base.sampleLambdas = [];
    if (!Array.isArray(base.sampleTargets)) base.sampleTargets = [];
    if (!MEASURED_CURVE_QUANTITIES.includes(base.quantity)) base.quantity = 'R';
    // A measured Δ is in whichever sign its instrument wrote, and the block has
    // to say which. Azzam-Bashara is what measurement files carry.
    if (base.quantity === 'DEL' && !base.deltaConvention) base.deltaConvention = 'azzam';
    if (!base.sampleLambdas.length) return;
    base.lambdaStart = base.sampleLambdas[0];
    base.lambdaEnd = base.sampleLambdas[base.sampleLambdas.length - 1];
}
