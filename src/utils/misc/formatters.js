// Utility functions for formatting values for display

/**
 * Format numeric values for display
 * Returns '0' for NaN/Infinity
 * Scientific notation for |value| < 1e-7
 * 7 decimal places otherwise
 * Treats |value| < 1e-10 as zero (floating-point threshold)
 */
export const formatValue = (value) => {
    if (!isFinite(value) || isNaN(value)) return '0';
    const absValue = Math.abs(value);
    // Treat very small values as zero (floating-point precision threshold)
    if (absValue < 1e-10) return '0';
    if (absValue >= 0.0000001) {
        return value.toFixed(7);
    } else {
        return value.toExponential(5);
    }
};

/**
 * Convert degrees to DMS (Degrees, Minutes, Seconds) format
 * @param {number} angle - Angle in degrees
 * @returns {string} Formatted string in DMS format (e.g., "45° 30' 15.000\"")
 */
export const degreesToDMS = (angle) => {
    const sign = angle < 0 ? -1 : 1;
    angle = Math.abs(angle);

    const degrees = Math.floor(angle);
    const fraction = angle - degrees;
    const minutes = Math.floor(fraction * 60);
    const seconds = (fraction * 60 - minutes) * 60;

    const signStr = sign < 0 ? "-" : "";
    return `${signStr}${degrees}° ${minutes}' ${seconds.toFixed(3)}"`;
};
