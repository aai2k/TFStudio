// ── CSV parser for user weighting import ──────────────────────────────────────

/**
 * Parse a CSV of "λ_nm, weight" rows.  Tolerant of:
 *   - whitespace, tabs, commas, semicolons as separators
 *   - header rows (skipped if first column isn't a number)
 *   - blank lines and # comment lines
 *
 * @returns {[number, number][]} sorted by λ
 */
export function parseWeightingCSV(text) {
    if (!text) return [];
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
        // Split on any of comma, semicolon, tab, or multi-space
        const parts = trimmed.split(/[,;\t]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const lam = parseFloat(parts[0]);
        const w   = parseFloat(parts[1]);
        if (Number.isFinite(lam) && Number.isFinite(w)) rows.push([lam, w]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return rows;
}
