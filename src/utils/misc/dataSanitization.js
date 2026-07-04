// Data sanitization utilities
// Validates and sanitizes numeric data to prevent WebGL/Plotly crashes

/**
 * Maximum safe value for WebGL rendering
 * Values beyond this range can cause WebGL matrix operations to fail
 */
const MAX_SAFE_VALUE = 1e6;
const MIN_SAFE_VALUE = -1e6;

/**
 * Check if a value is safe for WebGL rendering
 * @param {number} value - Value to check
 * @returns {boolean} True if value is finite and within safe bounds
 */
export const isSafeValue = (value) => {
    return isFinite(value) &&
           value >= MIN_SAFE_VALUE &&
           value <= MAX_SAFE_VALUE;
};

/**
 * Sanitize a single numeric value for rendering
 * - Converts NaN to 0
 * - Converts Infinity/-Infinity to max/min safe values
 * - Clamps extreme values to safe bounds
 * - Treats very small values as zero (eliminates floating-point noise)
 *
 * @param {number} value - Value to sanitize
 * @returns {number} Sanitized value safe for WebGL
 */
export const sanitizeValue = (value) => {
    // Handle NaN
    if (isNaN(value)) {
        return 0;
    }

    // Handle Infinity
    if (!isFinite(value)) {
        return value > 0 ? MAX_SAFE_VALUE : MIN_SAFE_VALUE;
    }

    // Treat very small values as zero to eliminate floating-point noise
    // This prevents visual artifacts in plots that should be flat (e.g., aberration for spheres)
    if (Math.abs(value) < 1e-10) {
        return 0;
    }

    // Clamp to safe range
    if (value > MAX_SAFE_VALUE) {
        return MAX_SAFE_VALUE;
    }
    if (value < MIN_SAFE_VALUE) {
        return MIN_SAFE_VALUE;
    }

    return value;
};

/**
 * Sanitize a 1D array of values
 * @param {Array<number|null>} array - Array to sanitize
 * @returns {Array<number|null>} Sanitized array
 */
export const sanitizeArray1D = (array) => {
    return array.map(value => {
        if (value === null || value === undefined) {
            return null;
        }
        return sanitizeValue(value);
    });
};

/**
 * Sanitize a 2D array of values (for surface plots)
 * @param {Array<Array<number|null>>} array - 2D array to sanitize
 * @returns {Array<Array<number|null>>} Sanitized 2D array
 */
export const sanitizeArray2D = (array) => {
    return array.map(row => sanitizeArray1D(row));
};

/**
 * Calculate safe min/max bounds from an array of values
 * Ignores null, NaN, and Infinity values
 * Returns reasonable defaults if no valid values found
 *
 * @param {Array<number|null>} values - Array of values
 * @returns {Object} {min, max} Safe min/max values
 */
export const getSafeBounds = (values) => {
    let min = Infinity;
    let max = -Infinity;
    let hasValidValues = false;

    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (val !== null && val !== undefined && isSafeValue(val)) {
            if (val < min) min = val;
            if (val > max) max = val;
            hasValidValues = true;
        }
    }

    // Return reasonable defaults if no valid values
    if (!hasValidValues) {
        return { min: 0, max: 1 };
    }

    // Ensure min and max are different (avoid zero-height plots)
    if (min === max) {
        const epsilon = Math.abs(min) * 0.01 || 0.01;
        min -= epsilon;
        max += epsilon;
    }

    return { min, max };
};

/**
 * Wrap Plotly.newPlot with error handling
 * Catches WebGL errors and provides user-friendly feedback
 *
 * @param {HTMLElement} element - Container element
 * @param {Array} data - Plotly data array
 * @param {Object} layout - Plotly layout object
 * @param {Object} config - Plotly config object
 * @returns {Promise} Promise resolving to plot element or error
 */
export const safePlotlyNewPlot = async (element, data, layout, config) => {
    try {
        return await window.Plotly.newPlot(element, data, layout, config);
    } catch (error) {
        console.error('Plotly rendering error:', error);

        // Clear the container and show error message
        element.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: #ff6b6b;
                font-family: monospace;
                padding: 20px;
                text-align: center;
            ">
                <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px;">
                    Unable to Render Plot
                </div>
                <div style="font-size: 12px; color: #ccc; max-width: 400px;">
                    The surface parameters produce extreme values that cannot be visualized.
                    Please adjust the parameters to more reasonable values.
                </div>
                <div style="font-size: 11px; color: #888; margin-top: 15px; font-family: monospace;">
                    Error: ${error.message || 'WebGL rendering failed'}
                </div>
            </div>
        `;

        throw error; // Re-throw to allow further error handling if needed
    }
};
