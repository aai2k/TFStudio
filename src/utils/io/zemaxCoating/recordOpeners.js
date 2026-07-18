import { num } from './format.js';

// Keyword tokens that begin a record or a sub-line (case-insensitive).
export const RECORD_KW = new Set(['MATE', 'COAT', 'IDEAL', 'IDEAL2', 'TABLE', 'TAPR', 'ENCRYPTED']);
export const SUBLINE_KW = new Set(['ANGL', 'WAVE', 'DX', 'DY', 'AN', 'RT', 'CT', 'PT']);

/**
 * Open a new record for a RECORD_KW line, pushing it onto the appropriate
 * output array. Returns the new "current" record to attach following
 * continuation lines to, or null if the keyword has no continuation lines
 * (IDEAL, IDEAL2, ENCRYPTED, and the "COAT I.<T>" ideal-coating shorthand).
 */
export function openRecord(kw, tok, materials, coatings, tapers) {
    let rec = null;
    if (kw === 'MATE') {
        rec = { type: 'material', name: tok.slice(1).join(' ').trim(), points: [] };
        materials.push(rec);
    } else if (kw === 'TAPR') {
        rec = { type: 'taper', name: tok.slice(1).join(' ').trim(), lines: [] };
        tapers.push(rec);
    } else if (kw === 'TABLE') {
        rec = { type: 'table', name: tok.slice(1).join(' ').trim(), lines: [] };
        coatings.push(rec);
    } else if (kw === 'ENCRYPTED') {
        coatings.push({ type: 'encrypted', name: tok.slice(1).join(' ').trim() });
    } else if (kw === 'IDEAL') {
        coatings.push({
            type: 'ideal', name: tok[1] || '',
            T: num(tok[2]), R: num(tok[3]),
        });
    } else if (kw === 'IDEAL2') {
        coatings.push({
            type: 'ideal2', name: tok[1] || '',
            values: tok.slice(2, 11).map(num),
        });
    } else if (kw === 'COAT') {
        const second = tok[1] || '';
        if (/^I\./i.test(second)) {
            // Ideal coating: the literal prefix is "I." followed by the
            // full transmission value, e.g. "COAT I.0.5" → T=0.5 (see the
            // format spec at the top of zemaxCoatingFile.js and the round-trip test).
            // slice(2) strips the "I." prefix; slice(1) would leave a
            // stray dot (".0.5" → parseFloat → 0).
            coatings.push({ type: 'idealI', name: second, transmission: num(second.slice(2)) });
        } else {
            rec = { type: 'layers', name: tok.slice(1).join(' ').trim(), layers: [] };
            coatings.push(rec);
        }
    }
    return rec;
}

/** Parse a MATE continuation row "<λ_µm> <n> <imag>" into `cur.points`. */
function appendMaterialPoint(cur, tok, lineNo, line, warnings) {
    const lam = num(tok[0]), n = num(tok[1]), imag = num(tok[2]);
    if (Number.isFinite(lam) && Number.isFinite(n))
        cur.points.push([lam, n, Number.isFinite(imag) ? imag : 0]);
    else
        warnings.push(`Line ${lineNo}: bad MATE row in "${cur.name}": "${line}"`);
}

/** Parse a COAT continuation row "<material> <thickness> [is_absolute] [loop_index] [tapername]". */
function appendLayerLine(cur, tok) {
    cur.layers.push({
        material:   tok[0],
        thickness:  num(tok[1]),
        isAbsolute: tok.length > 2 ? (parseInt(tok[2], 10) || 0) : 0,
        loopIndex:  tok.length > 3 ? (parseInt(tok[3], 10) || 0) : 0,
        taper:      tok.length > 4 ? tok[4] : '',
    });
}

/** Store a raw TABLE/TAPR continuation line verbatim for later browsing. */
function appendTableOrTaperLine(cur, kw, line) {
    if (SUBLINE_KW.has(kw) || cur.type === 'table') cur.lines.push(line);
    else cur.lines.push(line);
}

/** Append a continuation line's tokens to the currently open record. */
export function appendContinuationLine(cur, tok, kw, ctx) {
    const { line, lineNo, warnings } = ctx;
    if (cur.type === 'material') appendMaterialPoint(cur, tok, lineNo, line, warnings);
    else if (cur.type === 'layers') appendLayerLine(cur, tok);
    else if (cur.type === 'table' || cur.type === 'taper') appendTableOrTaperLine(cur, kw, line);
}

/** Flag a just-closed layer-stack record that used replicated groups (loop_index). */
export function warnIfReplicatedGroup(rec, warnings) {
    if (rec && rec.type === 'layers') {
        if (rec.layers.some(l => l.loopIndex && l.loopIndex !== 0))
            warnings.push(`Coating "${rec.name}" uses replicated groups (loop_index) — imported as a flat stack.`);
    }
}
