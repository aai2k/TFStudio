/**
 * Math operands: how each kind computes its value from the value(s) of the
 * operand(s) it references, and how that value becomes the residual the
 * optimizer sees. Both are declarative tables, so adding a Zemax math operand
 * (ABSO, RECI, LOGE, SQRT, …) is a one-line addition to each.
 */

// Each math operand kind declares how to compute its *value* given the
// resolved value(s) of its referenced operand(s), and `partials`, the
// derivative of that value in each referenced value at those values, which
// the analytic Jacobian chains through (jacobianAssembly/mathRows.js). |x|
// takes slope 0 at x = 0, the smallest of its subgradients there. Residual
// semantics are declared by `MATH_RESIDUAL_KIND` below and consumed by
// calcMF / _residuals.
const SAME = () => [1];
const SIGN = (refs) => [Math.sign(refs[0])];
export const MATH_REGISTRY = {
    OPGT: { refs: 'single', value: (refs) => refs[0],           partials: SAME },
    OPLT: { refs: 'single', value: (refs) => refs[0],           partials: SAME },
    OPVA: { refs: 'single', value: (refs) => refs[0],           partials: SAME },
    ABSO: { refs: 'single', value: (refs) => Math.abs(refs[0]), partials: SIGN },
    ABGT: { refs: 'single', value: (refs) => Math.abs(refs[0]), partials: SIGN },
    ABLT: { refs: 'single', value: (refs) => Math.abs(refs[0]), partials: SIGN },
    DIFF: { refs: 'pair',   value: (refs) => refs[0] - refs[1], partials: () => [1, -1] },
    SUMM: { refs: 'pair',   value: (refs) => refs[0] + refs[1], partials: () => [1, 1] },
    PROD: { refs: 'pair',   value: (refs) => refs[0] * refs[1], partials: (refs) => [refs[1], refs[0]] },
};

// Residual = how the operand contributes to the merit function.
//   'one-sided-min' — residual = max(0, target − value)  (ref ≥ target)
//   'one-sided-max' — residual = max(0, value − target)  (ref ≤ target)
//   'equality'      — residual = value − target
const MATH_RESIDUAL_KIND = {
    OPGT: 'one-sided-min',
    OPLT: 'one-sided-max',
    ABGT: 'one-sided-min',
    ABLT: 'one-sided-max',
    OPVA: 'equality',
    ABSO: 'equality',
    DIFF: 'equality',
    SUMM: 'equality',
    PROD: 'equality',
};

// The ids of the rows a math operand reads, in the order its value takes them.
export function mathReferenceIds(op) {
    const reg = MATH_REGISTRY[op.type];
    if (!reg) return [];
    return reg.refs === 'single' ? [op.refId] : [op.refId1, op.refId2];
}

// Compute the *value* (not the residual) of a math operand.
export function computeMathValue(op, resolve) {
    if (!MATH_REGISTRY[op.type]) return NaN;
    return MATH_REGISTRY[op.type].value(mathReferenceIds(op).map(id => resolve(id)));
}

// ∂value/∂(referenced value) of a math operand, one per id of mathReferenceIds.
export function mathValuePartials(op, refValues) {
    return MATH_REGISTRY[op.type].partials(refValues);
}

// Translate a math operand's computed value + target into the residual the
// optimizer sees. Returns 0 when an inequality is satisfied and NaN when its
// referenced value is invalid, so the merit accumulator cannot count its weight.
export function mathResidual(op, value) {
    if (value == null || !Number.isFinite(value)) return NaN;
    const kind = MATH_RESIDUAL_KIND[op.type] || 'equality';
    switch (kind) {
        case 'one-sided-min': return Math.max(0, op.target - value);
        case 'one-sided-max': return Math.max(0, value - op.target);
        case 'equality':      return value - op.target;
        default:              return 0;
    }
}

export function mathResidualKind(type) { return MATH_RESIDUAL_KIND[type] || 'equality'; }

// ∂residual/∂value of a math operand at its value, the slope of mathResidual:
// −1 while an at-least row is under its target, +1 while an at-most row is
// over it, 0 while either holds, 1 for an equality.
export function mathResidualSlope(op, value) {
    switch (mathResidualKind(op.type)) {
        case 'one-sided-min': return op.target - value > 0 ? -1 : 0;
        case 'one-sided-max': return value - op.target > 0 ? 1 : 0;
        default:              return 1;
    }
}
