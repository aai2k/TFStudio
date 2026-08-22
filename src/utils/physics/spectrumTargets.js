/** Renderer-neutral optical merit-target geometry and editing semantics. */
export {
    CURVE_COLOR, FAMILY_COLOR, RANGE_AVG_TYPES, RANGE_TARGET_TYPES, OPTICAL_TYPES,
    operandCurveKey, operandFamily,
} from './spectrumTargets/style.js';
export { buildTargetGeometry } from './spectrumTargets/geometry.js';
export { buildTargetBands } from './spectrumTargets/bands.js';
export { buildEditableTargetGeometry, applyHandleEdit } from './spectrumTargets/editing.js';
export { snapDrawnLine } from './spectrumTargets/snapping.js';
export { operandOverridesFromDrawnLine } from './spectrumTargets/drawing.js';
