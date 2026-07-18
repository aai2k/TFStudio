/**
 * Zemax material/coating names: ≤ 32 chars, no spaces, no special characters.
 * Map anything illegal to '_' and upper-case (Zemax names are case-insensitive
 * and conventionally upper-case).
 */
export function sanitizeZemaxName(name, fallback = 'MAT') {
    let s = String(name == null ? '' : name).trim().toUpperCase();
    s = s.replace(/[^A-Z0-9_.]/g, '_');
    if (s === '') s = fallback;
    if (s.length > 32) s = s.slice(0, 32);
    return s;
}
