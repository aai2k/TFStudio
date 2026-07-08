/**
 * JCAMP-DX import / export.
 *
 * JCAMP-DX is the IUPAC standard text format for spectral data exchange
 * (McDonald & Wilks, Appl. Spectrosc. 42, 151 (1988); spec at jcamp-dx.org).
 * It is an open interchange format, so TFStudio both reads and writes it.
 *
 * Supported on IMPORT:
 *   - Labelled-Data-Records (`##LABEL= value`), `$$` comments, `##END=`.
 *   - `##XYDATA= (X++(Y..Y))` (uniform abscissa) with ASDF ordinate compression:
 *     AFFN, PAC, SQZ, DIF, DUP — incl. the DIF line-leading Y check-value.
 *   - `##XYPOINTS= (XY..XY)` (explicit x,y pairs, any spacing).
 *   - Compound LINK files: every XYDATA/XYPOINTS record becomes one spectrum.
 * Supported on EXPORT:
 *   - AFFN `##XYDATA= (X++(Y..Y))` for a uniform grid (design spectra always are),
 *     else AFFN `##XYPOINTS= (XY..XY)`. Single block, or a `LINK` of N blocks.
 *
 * X is carried in the file's XUNITS (nm / cm⁻¹ / µm); the caller converts to nm
 * via makeMeasuredCurve. Pure module (no DOM/Node) — unit-tested in
 * tests/jcamp_dx.mjs.
 */

import { X_UNITS } from './spectrumTable.js';

// ── ASDF pseudo-digit tables (JCAMP-DX §5) ──────────────────────────────────────
// SQZ: squeezed absolute — leading char encodes sign + first digit.
//   @=+0 A..I=+1..+9   a..i=-1..-9
// DIF: difference from previous ordinate.
//   %=0  J..R=+1..+9   j..r=-1..-9
// DUP: duplicate count (repeat previous value/difference).
//   S..Z=1..8  s=9

function sqzLead(ch) {
    if (ch >= '@' && ch <= 'I') return { sign: 1,  d: ch.charCodeAt(0) - 64 }; // '@'→0
    if (ch >= 'a' && ch <= 'i') return { sign: -1, d: ch.charCodeAt(0) - 96 }; // 'a'→1
    return null;
}
function difLead(ch) {
    if (ch === '%') return 0;
    if (ch >= 'J' && ch <= 'R') return ch.charCodeAt(0) - 73;     // 'J'→1
    if (ch >= 'j' && ch <= 'r') return -(ch.charCodeAt(0) - 105); // 'j'→-1
    return null;
}
function dupLead(ch) {
    if (ch >= 'S' && ch <= 'Z') return ch.charCodeAt(0) - 82;     // 'S'→1 … 'Z'→8
    if (ch === 's') return 9;
    return null;
}
const isDigit = (ch) => ch >= '0' && ch <= '9';

// Consume a run of digits and decimal points starting at `start`.
function readTrailingDigits(s, start) {
    let j = start, str = '';
    while (j < s.length && (isDigit(s[j]) || s[j] === '.')) { str += s[j]; j++; }
    return { str, end: j };
}

// Read a PAC / AFFN number (optional sign, digits, optional E-exponent).
function readAffnNumber(s, start) {
    const n = s.length;
    let j = start, str = '';
    if (s[j] === '+' || s[j] === '-') { str += s[j]; j++; }
    const t = readTrailingDigits(s, j); str += t.str; j = t.end;
    if (j < n && (s[j] === 'E' || s[j] === 'e')) {
        str += 'E'; j++;
        if (j < n && (s[j] === '+' || s[j] === '-')) { str += s[j]; j++; }
        const e = readTrailingDigits(s, j); str += e.str; j = e.end;
    }
    return { str, end: j };
}

// Decode one SQZ / DIF / DUP pseudo-digit token given its leading char and the
// trailing digit run. Returns null when `ch` is not a pseudo-digit.
function pseudoToken(ch, trailing) {
    const sq = sqzLead(ch);
    if (sq) return { type: 'abs', val: sq.sign * parseFloat(`${sq.d}${trailing}`) };
    const df = difLead(ch);
    if (df !== null) {
        const mag = parseFloat(`${Math.abs(df)}${trailing}`);
        return { type: 'dif', val: df < 0 ? -mag : mag };
    }
    const dp = dupLead(ch);
    if (dp !== null) return { type: 'dup', val: parseInt(`${dp}${trailing}`, 10) };
    return null;
}

/**
 * Tokenize one ASDF ordinate stream (the part of a line AFTER the abscissa).
 * Returns [{ type:'abs'|'dif'|'dup', val:number }, …].
 */
function tokenizeAsdf(s) {
    const tokens = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
        const ch = s[i];
        if (ch === ' ' || ch === '\t' || ch === ',') { i++; continue; }
        // PAC / AFFN signed or bare number (absolute).
        if (ch === '+' || ch === '-' || isDigit(ch) || ch === '.') {
            const { str, end } = readAffnNumber(s, i);
            tokens.push({ type: 'abs', val: parseFloat(str) });
            i = end;
            continue;
        }
        // SQZ / DIF / DUP pseudo-digit.
        const { str: trailing, end } = readTrailingDigits(s, i + 1);
        const tok = pseudoToken(ch, trailing);
        if (tok) { tokens.push(tok); i = end; continue; }
        i++; // skip unknown char
    }
    return tokens;
}

/**
 * Decode a sequence of ASDF tokens (one line's ordinates) into Y values.
 * Carries prevY / lastDiff across lines via `state`.
 * Returns { ys, endedDif } where endedDif marks the line finished in DIF mode
 * (so the NEXT line's leading value is a check duplicate to drop).
 */
function decodeAsdfTokens(tokens, state) {
    const ys = [];
    for (const t of tokens) {
        if (t.type === 'abs') {
            ys.push(t.val); state.prevY = t.val; state.lastWasDif = false; state.lastDiff = null;
        } else if (t.type === 'dif') {
            const y = state.prevY + t.val; ys.push(y);
            state.prevY = y; state.lastDiff = t.val; state.lastWasDif = true;
        } else if (t.type === 'dup') {
            const extra = t.val - 1;
            for (let k = 0; k < extra; k++) {
                if (state.lastWasDif && state.lastDiff != null) state.prevY = state.prevY + state.lastDiff;
                ys.push(state.prevY);
            }
        }
    }
    return { ys, endedDif: state.lastWasDif };
}

// ── LDR helpers ─────────────────────────────────────────────────────────────────

// Normalize a label for matching: uppercase, strip spaces/-/_/ (spec §4.2).
function normLabel(raw) {
    return raw.replace(/[\s\-_/]/g, '').toUpperCase();
}

function stripComment(line) {
    const i = line.indexOf('$$');
    return i >= 0 ? line.slice(0, i) : line;
}

function unitToX(xunits) {
    const s = (xunits || '').toUpperCase();
    if (/NANOMET|^NM$/.test(s)) return X_UNITS.NM;
    if (/1\/CM|CM-1|PERCM|WAVENUM/.test(s)) return X_UNITS.CM1;
    if (/MICROMET|MICRON|^UM$/.test(s)) return X_UNITS.UM;
    return X_UNITS.UNKNOWN;
}
function unitsToQuantity(yunits) {
    const s = (yunits || '').toUpperCase();
    if (/TRANSMIT/.test(s)) return { quantity: 'T', isAbsorbance: false };
    if (/REFLECT/.test(s))  return { quantity: 'R', isAbsorbance: false };
    if (/ABSORB/.test(s))   return { quantity: 'A', isAbsorbance: true };
    return { quantity: null, isAbsorbance: false };
}

// ── Parser ──────────────────────────────────────────────────────────────────────

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
const CTX_SETTERS = {
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
function parseRecords(rawLines) {
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

/**
 * Parse JCAMP-DX text into one or more spectra.
 * @returns {{ ok:boolean, error?:string, spectra: Array<{
 *   title:string, dataType:string, xUnit:string,
 *   quantity:(string|null), isAbsorbance:boolean, isPercent:boolean,
 *   x:number[], y:number[]
 * }> }}
 */
export function parseJcampDx(text) {
    if (typeof text !== 'string' || !/##\s*(TITLE|JCAMP)/i.test(text)) {
        return { ok: false, error: 'Not a JCAMP-DX file', spectra: [] };
    }
    const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
    const records = parseRecords(rawLines);

    const spectra = [];
    const ctx = {};   // running LDR context (child blocks inherit parent units/factors)

    for (const r of records) {
        const setter = CTX_SETTERS[r.label];
        if (setter) { setter(ctx, r.value); continue; }
        if (r.label === 'XYDATA') {
            spectra.push(buildSpectrum(decodeXYDATA(r.body, ctx), ctx));
        } else if (r.label === 'XYPOINTS' || r.label === 'PEAKTABLE') {
            spectra.push(buildSpectrum(decodeXYPOINTS(r.body, ctx), ctx));
        }
    }

    const valid = spectra.filter(s => s && s.x.length);
    if (!valid.length) return { ok: false, error: 'No XYDATA/XYPOINTS found', spectra: [] };
    return { ok: true, spectra: valid };
}

/**
 * Decode all XYDATA ordinate lines into a flat Y array, honoring the DIF
 * check-value duplicate at line starts. Each line's FIRST token is the abscissa
 * (a plain AFFN number — SQZ/DIF ordinates carry no delimiter from it) and is
 * dropped; the rest are ordinates.
 */
function decodeXydataOrdinates(body) {
    const state = { prevY: 0, lastDiff: null, lastWasDif: false };
    const allY = [];
    let prevLineEndedDif = false;
    let firstLine = true;
    for (const line of body) {
        if (line.trim() === '') continue;
        const allTok = tokenizeAsdf(line.trim());
        if (!allTok.length) continue;
        const { ys, endedDif } = decodeAsdfTokens(allTok.slice(1), state);
        // If the previous line ended in DIF mode, this line's first decoded
        // ordinate repeats the previous line's last value → drop it.
        if (!firstLine && prevLineEndedDif && ys.length) ys.shift();
        for (const y of ys) allY.push(y);
        prevLineEndedDif = endedDif;
        firstLine = false;
    }
    return allY;
}

/**
 * Abscissa step from FIRSTX + i*DELTAX (authoritative; per-line X are only
 * checks). Prefer an explicit ##DELTAX; else derive from FIRSTX/LASTX and the
 * actual point count (NPOINTS may be absent or wrong).
 */
function xydataStep(ctx, firstx, count) {
    let deltax = ctx.deltax;
    if (deltax == null) {
        const npts = (ctx.npoints && ctx.npoints > 1) ? ctx.npoints : count;
        if (npts > 1 && ctx.lastx != null) deltax = (ctx.lastx - firstx) / (npts - 1);
    }
    return deltax != null ? deltax : 1;
}

function decodeXYDATA(body, ctx) {
    const yfactor = ctx.yfactor ?? 1;
    const firstx = ctx.firstx ?? 0;
    const allY = decodeXydataOrdinates(body).map(y => y * yfactor);
    const step = xydataStep(ctx, firstx, allY.length);
    const x = [];
    for (let i = 0; i < allY.length; i++) x.push(firstx + i * step);
    return { x, y: allY };
}

/**
 * Extract all finite numbers from XYPOINTS/PEAKTABLE body lines, in order.
 * Pairs are separated by ';' or whitespace; x,y within a pair by ',' or
 * whitespace.
 */
function parseXyNumbers(body) {
    const nums = [];
    for (const line of body) {
        const tr = stripComment(line).trim();
        if (!tr) continue;
        for (const tok of tr.split(/[;\s]+/)) {
            if (!tok) continue;
            for (const v of tok.split(',')) {
                const f = parseFloat(v);
                if (Number.isFinite(f)) nums.push(f);
            }
        }
    }
    return nums;
}

function decodeXYPOINTS(body, ctx) {
    const xfactor = ctx.xfactor ?? 1;
    const yfactor = ctx.yfactor ?? 1;
    const nums = parseXyNumbers(body);
    const x = [], y = [];
    for (let i = 0; i + 1 < nums.length; i += 2) { x.push(nums[i] * xfactor); y.push(nums[i + 1] * yfactor); }
    return { x, y };
}

function buildSpectrum(data, ctx) {
    const { quantity, isAbsorbance } = unitsToQuantity(ctx.yunits);
    const finiteY = data.y.filter(Number.isFinite);
    const maxY = finiteY.length ? Math.max(...finiteY) : 0;
    return {
        title: ctx.title || 'JCAMP-DX',
        dataType: ctx.dataType || '',
        xUnit: unitToX(ctx.xunits),
        quantity,
        isAbsorbance,
        isPercent: !isAbsorbance && maxY > 1.5,
        x: data.x,
        y: data.y,
    };
}

// ── Writer ──────────────────────────────────────────────────────────────────────

const X_UNIT_LABEL = { [X_UNITS.NM]: 'NANOMETERS', [X_UNITS.CM1]: '1/CM', [X_UNITS.UM]: 'MICROMETERS' };
const Y_UNIT_LABEL = { T: 'TRANSMITTANCE', R: 'REFLECTANCE', A: 'ABSORBANCE' };

function fmtNum(v) {
    if (!Number.isFinite(v)) return '0';
    return Number(v.toFixed(6)).toString();
}

function isUniform(x) {
    if (x.length < 3) return true;
    const d = x[1] - x[0];
    if (!(Math.abs(d) > 0)) return false;
    const tol = Math.abs(d) * 1e-4;
    for (let i = 2; i < x.length; i++) {
        if (Math.abs((x[i] - x[i - 1]) - d) > tol) return false;
    }
    return true;
}

// `(X++(Y..Y))` rows: leading abscissa then up to 6 ordinates per line.
function xydataLines(x, y, n, deltax) {
    const PER_LINE = 6;
    const out = [];
    for (let i = 0; i < n; i += PER_LINE) {
        const row = [fmtNum(x[0] + i * deltax)];
        for (let k = i; k < Math.min(i + PER_LINE, n); k++) row.push(fmtNum(y[k]));
        out.push(row.join(' '));
    }
    return out;
}

// `(XY..XY)` rows: up to 4 explicit "x,y" pairs per line.
function xypointsLines(x, y, n) {
    const PER_LINE = 4;
    const out = [];
    for (let i = 0; i < n; i += PER_LINE) {
        const row = [];
        for (let k = i; k < Math.min(i + PER_LINE, n); k++) row.push(`${fmtNum(x[k])},${fmtNum(y[k])}`);
        out.push(row.join(' '));
    }
    return out;
}

/**
 * Build ONE JCAMP-DX block (LDRs + data) for a spectrum, WITHOUT the final
 * `##END=` (so it can be embedded in a LINK).  AFFN encoding.
 * @param s { title, x (nm), y (fraction or absorbance), quantity, isAbsorbance }
 */
function buildBlock(s, { version = '4.24', dataType = 'UV/VIS SPECTRUM' } = {}) {
    const x = s.x, y = s.y, n = x.length;
    const xUnitLabel = X_UNIT_LABEL[s.xUnit || X_UNITS.NM] || 'NANOMETERS';
    const yUnitLabel = Y_UNIT_LABEL[s.quantity] || (s.isAbsorbance ? 'ABSORBANCE' : 'ARBITRARY UNITS');

    const lines = [
        `##TITLE=${s.title || 'Spectrum'}`,
        `##JCAMP-DX=${version}`,
        `##DATA TYPE=${dataType}`,
        `##XUNITS=${xUnitLabel}`,
        `##YUNITS=${yUnitLabel}`,
        `##XFACTOR=1.0`,
        `##YFACTOR=1.0`,
    ];
    if (n) {
        lines.push(`##FIRSTX=${fmtNum(x[0])}`);
        lines.push(`##LASTX=${fmtNum(x[n - 1])}`);
        lines.push(`##FIRSTY=${fmtNum(y[0])}`);
        lines.push(`##NPOINTS=${n}`);
    }

    if (n && isUniform(x)) {
        const deltax = n > 1 ? (x[n - 1] - x[0]) / (n - 1) : 1;
        lines.push(`##DELTAX=${fmtNum(deltax)}`);
        lines.push(`##XYDATA=(X++(Y..Y))`);
        lines.push(...xydataLines(x, y, n, deltax));
    } else if (n) {
        lines.push(`##XYPOINTS=(XY..XY)`);
        lines.push(...xypointsLines(x, y, n));
    }
    return lines.join('\r\n');
}

/**
 * Serialize one or more spectra to JCAMP-DX text.
 * Single spectrum → one block. Multiple → a compound `LINK` file.
 * @param specs Array<{ title, x (nm), y, quantity, isAbsorbance, xUnit? }>
 * @param opts  { title?, dataType? }
 */
export function buildJcampDx(specs, opts = {}) {
    const list = (specs || []).filter(s => s && s.x && s.x.length);
    if (!list.length) return '';
    const dataType = opts.dataType || 'UV/VIS SPECTRUM';

    if (list.length === 1) {
        return buildBlock(list[0], { dataType }) + '\r\n##END=\r\n';
    }
    // LINK wrapper.
    const out = [];
    out.push(`##TITLE=${opts.title || 'TFStudio spectra'}`);
    out.push(`##JCAMP-DX=4.24`);
    out.push(`##DATA TYPE=LINK`);
    out.push(`##BLOCKS=${list.length}`);
    for (const s of list) out.push(buildBlock(s, { dataType }) + '\r\n##END=');
    out.push(`##END=`);
    return out.join('\r\n') + '\r\n';
}
