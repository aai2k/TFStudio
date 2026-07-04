// Number parsing utilities
// Handles commas, dots, and scientific notation (both 'e' and 'E')

/**
 * Parse a number string that may contain:
 * - Comma or dot as decimal separator
 * - Scientific notation with 'e' or 'E' (1.2e-3, 1.2E-3)
 * - Leading/trailing whitespace
 *
 * Examples:
 * - "1.5" → 1.5
 * - "1,5" → 1.5
 * - "1.2e-3" → 0.0012
 * - "1.2E-3" → 0.0012
 * - "1,2e-3" → 0.0012
 * - "-3.14" → -3.14
 * - "-3,14" → -3.14
 *
 * @param {string|number} value - The value to parse
 * @returns {number} Parsed number, or 0 if invalid
 */
export const parseNumber = (value) => {
    // If already a number, return it
    if (typeof value === 'number') {
        return isNaN(value) || !isFinite(value) ? 0 : value;
    }

    // If not a string, try to convert
    if (typeof value !== 'string') {
        const num = Number(value);
        return isNaN(num) || !isFinite(num) ? 0 : num;
    }

    // Trim whitespace
    let str = value.trim();

    // If empty, return 0
    if (!str) return 0;

    // Replace comma with dot (European decimal separator)
    // But only if there's no dot present and only one comma
    // This handles "1,5" → "1.5" but not "1,000.5" (which should stay as is)
    const dotCount = (str.match(/\./g) || []).length;
    const commaCount = (str.match(/,/g) || []).length;

    if (commaCount === 1 && dotCount === 0) {
        // Single comma, no dots - treat comma as decimal separator ("1,5" → 1.5)
        str = str.replace(',', '.');
    } else if (commaCount > 1 && dotCount === 0) {
        // Multiple commas, no dots - US thousands separators ("1,000,000")
        str = str.replace(/,/g, '');
    } else if (dotCount > 1 && commaCount === 0) {
        // Multiple dots, no commas - EU thousands separators ("1.000.000").
        // A real decimal has at most one dot, so these can only be grouping.
        str = str.replace(/\./g, '');
    } else if (commaCount > 0 && dotCount > 0) {
        // Both present: the separator that appears LAST is the decimal one, the
        // other is thousands grouping. Handles BOTH US "1,000.5" and EU
        // "1.000,5" → 1000.5 (the latter was previously parsed 1000× too small).
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            str = str.replace(/\./g, '').replace(/,/g, '.');   // EU: dot=thousands, comma=decimal
        } else {
            str = str.replace(/,/g, '');                       // US: comma=thousands, dot=decimal
        }
    }

    // Handle scientific notation with capital E (JavaScript parseFloat handles lowercase 'e')
    // Convert 1.2E-3 to 1.2e-3
    str = str.replace(/E/g, 'e');

    // Parse the number
    const num = parseFloat(str);

    // Return 0 if invalid
    return isNaN(num) || !isFinite(num) ? 0 : num;
};

/**
 * Format a number for display in input fields
 * Preserves the user's input format (comma vs dot) when possible
 *
 * @param {number|string} value - The value to format
 * @returns {string} Formatted string
 */
export const formatNumberForInput = (value) => {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number') {
        if (!isFinite(value)) return '0';
        return String(value);
    }

    return String(value);
};

/**
 * Validate if a string is a valid number input
 * Returns true if the input can be parsed as a valid number
 * Allows partial inputs during typing (e.g., "-", "1.", "1.2e-")
 *
 * @param {string} value - The value to validate
 * @returns {boolean} True if valid or partial valid input
 */
export const isValidNumberInput = (value) => {
    if (!value || typeof value !== 'string') return false;

    const trimmed = value.trim();
    if (!trimmed) return false;

    // Allow partial inputs during typing
    // These are valid intermediate states:
    // "-" (typing negative number)
    // "." or "," (typing decimal)
    // "1." or "1," (decimal point entered)
    // "1e" or "1E" (starting exponent)
    // "1e-" or "1E-" (negative exponent started)
    // "1.2e" or "1,2E" (exponent started)

    // Check for obviously invalid characters
    // Valid: digits, one decimal separator (. or ,), minus sign, e/E for exponent
    const validChars = /^[-+]?[\d.,]*[eE]?[-+]?\d*$/;
    if (!validChars.test(trimmed)) return false;

    // Allow intermediate states
    if (trimmed === '-' || trimmed === '+') return true;
    if (trimmed === '.' || trimmed === ',') return true;
    if (trimmed.endsWith('.') || trimmed.endsWith(',')) return true;
    if (/[eE][-+]?$/.test(trimmed)) return true; // Ends with e, E, e-, E+, etc.

    // Try to parse - if it results in a valid number, it's valid
    const parsed = parseNumber(trimmed);
    return isFinite(parsed);
};

/**
 * Check if input contains invalid/restricted symbols for number entry
 * @param {string} value - The value to check
 * @returns {boolean} True if contains invalid symbols
 */
export const hasInvalidSymbols = (value) => {
    if (!value || typeof value !== 'string') return false;

    // Allow: digits (0-9), decimal separators (. or ,), minus/plus signs, e/E for scientific notation, whitespace
    const validPattern = /^[\d.,\s+\-eE]*$/;
    return !validPattern.test(value);
};
