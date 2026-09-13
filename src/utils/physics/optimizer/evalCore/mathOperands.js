/**
 * Math operands: how each kind computes its value from the value(s) of the
 * operand(s) it references, and how that value becomes the residual the
 * optimizer sees. Both are declarative tables, so adding a Zemax math operand
 * (ABSO, RECI, LOGE, SQRT, …) is a one-line addition to each.
 */

// Each math operand kind declares how to compute its *value* given the
// resolved value(s) of its referenced operand(s).  Residual semantics are
// declared by `MATH_RESIDUAL_KIND` below and consumed by calcMF / _residuals.
export const MATH_REGISTRY = {
    OPGT: { refs: 'single', value: (refs) => refs[0] },
    OPLT: { refs: 'single', value: (refs) => refs[0] },
    OPVA: { refs: 'single', value: (refs) => refs[0] },
    ABSO: { refs: 'single', value: (refs) => Math.abs(refs[0]) },
    ABGT: { refs: 'single', value: (refs) => Math.abs(refs[0]) },
    ABLT: { refs: 'single', value: (refs) => Math.abs(refs[0]) },
    DIFF: { refs: 'pair',   value: (refs) => refs[0] - refs[1] },
    SUMM: { refs: 'pair',   value: (refs) => refs[0] + refs[1] },
    PROD: { refs: 'pair',   value: (refs) => refs[0] * refs[1] },
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

// Compute the *value* (not the residual) of a math operand.
export function computeMathValue(op, resolve) {
    const reg = MATH_REGISTRY[op.type];
    if (!reg) return NaN;
    if (reg.refs === 'single') {
        const v = resolve(op.refId);
        return reg.value([v]);
    }
    if (reg.refs === 'pair') {
        const v1 = resolve(op.refId1);
        const v2 = resolve(op.refId2);
        return reg.value([v1, v2]);
    }
    return NaN;
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
