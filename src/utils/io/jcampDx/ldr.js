/**
 * JCAMP-DX Labelled-Data-Record (LDR) parsing and the running block context
 * (units, factors, x-grid descriptors) they populate.
 */

import { X_UNITS } from '../spectrumTable.js';

// Normalize a label for matching: uppercase, strip spaces/-/_/ (spec §4.2).
export function normLabel(raw) {
    return raw.replace(/[\s\-_/]/g, '').toUpperCase();
}

export function stripComment(line) {
    const i = line.indexOf('$$');
    return i >= 0 ? line.slice(0, i) : line;
}

export function unitToX(xunits) {
    const s = (xunits || '').toUpperCase();
    if (/NANOMET|^NM$/.test(s)) return X_UNITS.NM;
    if (/1\/CM|CM-1|PERCM|WAVENUM/.test(s)) return X_UNITS.CM1;
    if (/MICROMET|MICRON|^UM$/.test(s)) return X_UNITS.UM;
    return X_UNITS.UNKNOWN;
}
export function unitsToQuantity(yunits) {
    const s = (yunits || '').toUpperCase();
    if (/TRANSMIT/.test(s)) return { quantity: 'T', isAbsorbance: false };
    if (/REFLECT/.test(s))  return { quantity: 'R', isAbsorbance: false };
    if (/ABSORB/.test(s))   return { quantity: 'A', isAbsorbance: true };
    return { quantity: null, isAbsorbance: false };
}

const num = (v, d) => { const f = parseFloat(v); return Number.isFinite(f) ? f : d; };

/**
 * Start-of-block reset for the x-grid descriptors. FIRSTX/LASTX/DELTAX/NPOINTS
 * describe ONE spectrum and must not leak from a previous SIBLING block in a
 * compound (LINK) file — otherwise block 2 silently inherits block 1's x-axis.
 * Units and factors legitimately cascade from a parent per the LINK convention.
 */
function resetXGrid(ctx) {
    ctx.firstx = undefined; ctx.lastx = undefined;
    ctx.deltax = undefined; ctx.npoints = undefined;
}

// LDR handlers that update the running context. TITLE marks a new block.
export const CTX_SETTERS = {
    TITLE:    (ctx, v) => { resetXGrid(ctx); ctx.title = v; },
    DATATYPE: (ctx, v) => { ctx.dataType = v; },
    XUNITS:   (ctx, v) => { ctx.xunits = v; },
    YUNITS:   (ctx, v) => { ctx.yunits = v; },
    XFACTOR:  (ctx, v) => { ctx.xfactor = num(v, 1); },
    YFACTOR:  (ctx, v) => { ctx.yfactor = num(v, 1); },
    FIRSTX:   (ctx, v) => { ctx.firstx = num(v, 0); },
    LASTX:    (ctx, v) => { ctx.lastx = num(v, 0); },
    DELTAX:   (ctx, v) => { ctx.deltax = num(v, undefined); },
    NPOINTS:  (ctx, v) => { ctx.npoints = Math.round(num(v, 0)); },
};

/**
 * Split JCAMP-DX text into LDRs: a record begins at "##label=" and its value
 * spans until the next "##". Data records (XYDATA/XYPOINTS) keep their body
 * lines separately.
 */
export function parseRecords(rawLines) {
    const records = [];
    let cur = null;
    for (const rawLine of rawLines) {
        const line = stripComment(rawLine);
        const m = /^\s*##\s*([^=]+?)\s*=(.*)$/.exec(line);
        if (m) {
            cur = { label: normLabel(m[1]), rawLabel: m[1].trim(), value: m[2].trim(), body: [] };
            records.push(cur);
        } else if (cur && line.trim() !== '') {
            cur.body.push(line);
        }
    }
    return records;
}
