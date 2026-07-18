/**
 * Shared helpers for rendering merit-operand "target" markers and band-shaded
 * zones on a wavelength-axis Plotly chart, plus the interactive editing layer
 * (draw / drag targets directly on the spectrum).
 *
 * Used by Optical Evaluation (read-only AND interactive) and Variator
 * (read-only) so both windows draw identical target overlays for the design's
 * enabled operands.
 *
 * Conventions:
 *   - y axis is in % (target values are multiplied by 100 here)
 *   - x axis is wavelength in nm
 *   - Operand types TAV / RAV / AAV are band-averaged — drawn as a tinted
 *     zone spanning [lambdaStart, lambdaEnd] in x, full chart height in y,
 *     with the target level marked by a dotted line + X markers.
 *   - Continuous per-λ target types (TGT / RGT / AGT) draw a dotted target
 *     line (flat or linear ramp start→end) with X markers, plus a band zone.
 *   - Point operand types (T, TS, TP, R, RS, RP, A, AS, AP) are drawn as an
 *     X marker at the single λ = lambdaStart, at the target level.
 *
 * Interactive layer:
 *   - buildEditableTargetShapes() emits one editable Plotly *line* shape per
 *     band / point operand (the draggable "handle"), with a parallel `meta`
 *     array mapping shape index → operand id + kind.
 *   - applyHandleEdit() converts dragged shape coords back into an operand
 *     field patch.
 *   - operandOverridesFromDrawnLine() converts a freshly drawn line into the
 *     overrides for a brand-new operand (flat → band-average, sloped → ramp).
 */

export { CURVE_COLOR, FAMILY_COLOR, RANGE_AVG_TYPES, RANGE_TARGET_TYPES, OPTICAL_TYPES,
    operandCurveKey, operandFamily } from './spectrumTargets/style.js';
export { buildTargetTraces } from './spectrumTargets/traces.js';
export { buildTargetShapes } from './spectrumTargets/shapes.js';
export { buildEditableTargetShapes, applyHandleEdit } from './spectrumTargets/editing.js';
export { snapDrawnLine } from './spectrumTargets/snapping.js';
export { operandOverridesFromDrawnLine } from './spectrumTargets/drawing.js';
