/**
 * Angle arithmetic shared by the operand evaluators and the residual layer.
 */

// Fold a degree value into (-180, 180], so a difference between two angles is
// taken the short way round the circle.
export function _normalizeDegrees(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
}
