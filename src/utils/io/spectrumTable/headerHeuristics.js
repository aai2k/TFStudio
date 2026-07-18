// Header-text heuristics: X-axis unit, R/T/A quantity, and percent/absorbance
// detection for the spectrum-table parser (see spectrumTable.js).

import { X_UNITS } from './constants.js';

export function detectXUnit(headerText) {
    const s = (headerText || '').toLowerCase();
    if (/\bcm-?1\b|1\s*\/\s*cm|cm\^?-?1|wavenumber|cm⁻/.test(s)) return X_UNITS.CM1;
    if (/nanomet|\bnm\b/.test(s)) return X_UNITS.NM;
    if (/microm|micron|µm|μm|\bum\b/.test(s)) return X_UNITS.UM;
    return X_UNITS.UNKNOWN;
}

/**
 * Guess the X unit from the numeric range when the header is silent.
 * UV/Vis/NIR thin-film work is overwhelmingly nm (≈ 190–25000); µm spectra are
 * small (≈ 0.2–50); IR wavenumber is large (≈ 400–50000 cm⁻¹). We bias toward
 * nm because that is what coating spectrophotometers emit.
 */
export function guessXUnitFromRange(xs) {
    const finite = xs.filter(Number.isFinite);
    if (!finite.length) return X_UNITS.UNKNOWN;
    const max = Math.max(...finite);
    const med = finite.slice().sort((a, b) => a - b)[Math.floor(finite.length / 2)];
    if (med < 60) return X_UNITS.UM;
    if (max > 30000) return X_UNITS.CM1;   // beyond any optical-coating nm range
    return X_UNITS.NM;
}

// Ordered header→quantity rules: the word-based patterns take precedence over
// the bare single-letter token fallback (e.g. a column named exactly "T").
const QUANTITY_PATTERNS = [
    { q: 'T', re: /transmit|trans\b|%\s*t\b|\btau\b|\bt\s*\[|\bt\(/ },
    { q: 'R', re: /reflect|refl\b|%\s*r\b|\br\s*\[|\br\(/ },
    { q: 'A', re: /absorb|absorpt|\babs\b|\ba\s*\[|\ba\(|optical\s*density|\bod\b/ },
    { q: 'T', re: /(^|[\s,;])t([\s,;]|$)/ },
    { q: 'R', re: /(^|[\s,;])r([\s,;]|$)/ },
    { q: 'A', re: /(^|[\s,;])a([\s,;]|$)/ },
];

export function detectQuantity(headerText) {
    const s = (headerText || '').toLowerCase();
    const hit = QUANTITY_PATTERNS.find(p => p.re.test(s));
    return hit ? hit.q : null;
}

/** Header says percent (has a '%'), or values exceed the 0..1 fractional band. */
export function detectIsPercent(headerText, values) {
    if (/%/.test(headerText || '')) return true;
    const finite = (values || []).filter(Number.isFinite);
    if (!finite.length) return false;
    const max = Math.max(...finite);
    // R/T/A as a fraction never exceeds ~1; > 1.5 ⇒ stored as percent.
    return max > 1.5;
}

/** Is this header text actually an absorbance axis (so Y is NOT 0..1 / 0..100)? */
export function isAbsorbanceHeader(headerText) {
    return /absorb|absorpt|\babs\b|optical\s*density|\bod\b/i.test(headerText || '');
}
