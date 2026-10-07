/**
 * Read the tables of a CODE V 11.2 text listing (OUT T): the MAN transmission
 * table and the MPR index tables of one MUL run.
 *
 * Used by gen_codev_coating.mjs, which freezes the owner's listings into
 * codev/codev_11_2.json, and by tests/codev_coating_samples.mjs, which reads
 * the listing of CODE V's own sample coatings where it is present.
 */

/**
 * The lines of one run: from the line that reads `start` (trailing blanks
 * aside) up to the next "MUL> MEX".
 */
export function listingRun(text, start) {
    const lines = text.split(/\r?\n/);
    const from = lines.findIndex(line => line.trimEnd() === start);
    if (from < 0) throw new Error(`the listing has no line "${start}"`);
    const to = lines.findIndex((line, i) => i > from && line.startsWith('MUL> MEX'));
    return lines.slice(from, to < 0 ? lines.length : to);
}

const words = (line) => line.trim().split(/\s+/).filter(Boolean);

/** MAN: [angle°, λ_nm, Rs, Rp, Ts, Tp] per printed row. */
export function manRows(lines) {
    const at = lines.findIndex(line => line.includes('T R A N S M I S S I O N'));
    if (at < 0) throw new Error('no MAN table in the run');
    const rows = [];
    let angle = null;
    for (let i = at + 1; i < lines.length && !lines[i].includes('Phase table'); i++) {
        const v = words(lines[i]).map(Number);
        if (!v.length || !v.every(Number.isFinite)) continue;
        if (v.length === 1) angle = v[0];
        else if (v.length === 7) rows.push([angle, v[0], v[1], v[2], v[4], v[5]]);
    }
    return rows;
}

const SECTION = /^\s*(REFRACTIVE INDICES|EXTINCTION COEFFICIENTS|MULTILAYER CATALOG|MAN\s)/;

/**
 * One MPR section by its title, as {label: {wl, values}}: "REFRACTIVE INDICES
 * - DISPERSIVE MATERIALS" and "EXTINCTION COEFFICIENTS - DISPERSIVE
 * MATERIALS" at the analysis wavelengths, "MULTILAYER CATALOG: INDEX DATA"
 * and "MULTILAYER CATALOG: EXTINCTION COEFFICIENTS" at each table's MWL.
 * MPR leaves out both extinction sections when no MIC entry has an EXT, so a
 * section that is not there reads as no entries.
 */
export function mprSection(lines, title) {
    const at = lines.findIndex(line => line.trim() === title);
    const table = {};
    if (at < 0) return table;
    let wl = [], current = null;
    for (let i = at + 1; i < lines.length && !SECTION.test(lines[i]); i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('WL ')) {
            wl = [];
            current = wl;
            current.push(...words(line.slice(3)).map(Number));
        } else if (line.startsWith("'")) {
            const label = line.slice(1, line.indexOf("'", 1));
            table[label] = { wl, values: [] };
            current = table[label].values;
            current.push(...words(line.slice(label.length + 2)).map(Number));
        } else if (current) {
            current.push(...words(line).map(Number));
        }
    }
    return table;
}
