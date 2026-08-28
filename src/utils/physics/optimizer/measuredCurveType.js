/**
 * What a measured-curve merit row is, and how a fresh one is seeded.
 *
 * A leaf: the operand model imports it, so it may import nothing back.
 */

// Snapshot of one sampled measured R/T/A curve. It occupies one row in the
// merit table and evaluates directly as an RMS deviation, but is expanded into
// ordinary single-wavelength operands before an optimizer run so least-squares
// retains one independent residual/Jacobian row per measured point.
export const MEASURED_CURVE_OPERAND_TYPES = ['MCURVE'];

// Types the merit table never offers: they carry data no hand-typed row can.
export const GENERATED_ONLY_OPERAND_TYPES = [...MEASURED_CURVE_OPERAND_TYPES];

export function isMeasuredCurve(type) { return type === 'MCURVE'; }

// A measured block scores an RMS deviation from its stored points, so its target
// is fixed at zero and its band is whatever the snapshot covers.
export function seedMeasuredCurve(base) {
    if (!isMeasuredCurve(base.type)) return;
    base.target = 0;
    base.targetEnd = null;
    if (!Array.isArray(base.sampleLambdas)) base.sampleLambdas = [];
    if (!Array.isArray(base.sampleTargets)) base.sampleTargets = [];
    if (!['T', 'R', 'A'].includes(base.quantity)) base.quantity = 'R';
    if (!base.sampleLambdas.length) return;
    base.lambdaStart = base.sampleLambdas[0];
    base.lambdaEnd = base.sampleLambdas[base.sampleLambdas.length - 1];
}
