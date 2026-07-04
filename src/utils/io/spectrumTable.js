/**
 * Spectrophotometer text-spectrum import/export — shared numeric-table core.
 *
 * This is the reusable backbone for every *text* instrument importer (generic
 * CSV/TXT, PerkinElmer ASCII, EssentOptics Photon RT .txt, Shimadzu UVProbe
 * .asc, …). The research catalog (docs/spectrophotometer-formats-research.md)
 * identified that all of these are "λ value [value …]" tables wrapped in some
 * header text, differing only in delimiter, header, units and axis direction —
 * so the parser is written ONCE here and the per-format wrappers (later steps)
 * just pre-strip their format-specific header before calling parseSpectrumTable.
 *
 * Everything in this file is pure (no DOM, no Node, no Electron) so it is unit-
 * testable directly and usable from a worker.
 *
 * Conventions (CLAUDE.md): X is resolved to NANOMETERS, Y is resolved to a
 * fraction (0..1) internally; the source's original unit / percent-ness is
 * remembered on the curve for display + round-trip export.
 */

// ── Public constants ───────────────────────────────────────────────────────────

export const X_UNITS = Object.freeze({
    NM: 'nm',
    UM: 'um',          // micrometers
    CM1: 'cm-1',       // wavenumber (IR instruments, e.g. PerkinElmer FT-IR)
    UNKNOWN: 'unknown',
});

export const QUANTITIES = Object.freeze(['T', 'R', 'A']);

// ── Number parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a single numeric field, tolerating a trailing '%' and a decimal-comma
 * locale. `decimal` is ',' or '.'.
 * Returns a finite number, or NaN if the field is not numeric.
 */
export function parseNumber(field, decimal = '.') {
    if (field == null) return NaN;
    let s = String(field).trim();
    if (s === '') return NaN;
    if (s.endsWith('%')) s = s.slice(0, -1).trim();
    if (decimal === ',') {
        // decimal-comma locale: comma is the radix point, dot (if any) is a
        // thousands separator → drop dots, swap comma → dot.
        s = s.replace(/\./g, '').replace(',', '.');
    }
    // Accept leading +, scientific notation, etc. Reject anything with letters
    // other than a single E/e exponent.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
}

const DELIMITERS = [
    { id: ',',  re: /,/g },
    { id: ';',  re: /;/g },
    { id: '\t', re: /\t/g },
    { id: ' ',  re: /\s+/ },   // whitespace-delimited (split, not count)
];

function splitFields(line, delimiter) {
    if (delimiter === ' ') return line.trim().split(/\s+/);
    return line.split(delimiter).map(f => f.trim());
}

/**
 * Decide the column delimiter by scanning candidate data lines and picking the
 * delimiter that yields the most consistent (>=2)-numeric-column split.
 */
export function sniffDelimiter(lines, decimal = '.') {
    let best = { id: ' ', score: -1 };
    for (const cand of DELIMITERS) {
        let good = 0, fieldCount = null, consistent = true;
        for (const line of lines) {
            if (!line.trim()) continue;
            const fields = splitFields(line, cand.id);
            const nums = fields.filter(f => Number.isFinite(parseNumber(f, decimal)));
            if (nums.length >= 2) {
                good++;
                if (fieldCount == null) fieldCount = fields.length;
                else if (fields.length !== fieldCount) consistent = false;
            }
        }
        // Reward many good rows + consistent column count. A delimiter that never
        // produces 2 numeric columns scores 0.
        const score = good === 0 ? 0 : good + (consistent ? 0.5 : 0);
        if (score > best.score) best = { id: cand.id, score };
    }
    return best.id;
}

/**
 * Detect a decimal-comma locale: only meaningful when the delimiter is NOT a
 * comma. If any field looks like `\d+,\d+`, treat comma as the radix point.
 */
export function detectDecimal(text) {
    // If commas are clearly column delimiters (multiple per line with no
    // following space pattern), '.' is the radix. Heuristic: a number like
    // "1,5" with nothing else comma-ish on simple lines → decimal comma.
    const hasDecimalComma = /(^|[\s;\t])[+-]?\d+,\d+([\s;\t]|$)/m.test(text);
    const hasDotNumber    = /(^|[\s;,\t])[+-]?\d+\.\d+/m.test(text);
    if (hasDecimalComma && !hasDotNumber) return ',';
    return '.';
}

// ── Header heuristics ───────────────────────────────────────────────────────────

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

export function detectQuantity(headerText) {
    const s = (headerText || '').toLowerCase();
    if (/transmit|trans\b|%\s*t\b|\btau\b|\bt\s*\[|\bt\(/.test(s)) return 'T';
    if (/reflect|refl\b|%\s*r\b|\br\s*\[|\br\(/.test(s)) return 'R';
    if (/absorb|absorpt|\babs\b|\ba\s*\[|\ba\(|optical\s*density|\bod\b/.test(s)) return 'A';
    // Bare single-letter token fallback (e.g. a column named exactly "T").
    if (/(^|[\s,;])t([\s,;]|$)/.test(s)) return 'T';
    if (/(^|[\s,;])r([\s,;]|$)/.test(s)) return 'R';
    if (/(^|[\s,;])a([\s,;]|$)/.test(s)) return 'A';
    return null;
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

// ── Conversions ─────────────────────────────────────────────────────────────────

/** Convert one X value in the given unit to nanometers. */
export function xToNm(value, unit) {
    if (!Number.isFinite(value)) return NaN;
    switch (unit) {
        case X_UNITS.UM:  return value * 1000;
        case X_UNITS.CM1: return value > 0 ? 1e7 / value : NaN;   // λ[nm] = 1e7 / ν[cm⁻¹]
        case X_UNITS.NM:
        default:          return value;
    }
}

/** Absorbance → transmittance fraction: T = 10^(−A). */
export function absorbanceToT(a) { return Math.pow(10, -a); }

// ── Table parser ────────────────────────────────────────────────────────────────

/**
 * Parse a delimited spectrum table.
 *
 * @param {string} text  raw file text
 * @param {object} [opts]
 *   opts.delimiter  force ',' | ';' | '\t' | ' '  (default: sniff)
 *   opts.decimal    force '.' | ','               (default: detect)
 * @returns {{
 *   ok: boolean, error?: string,
 *   delimiter: string, decimal: string,
 *   headerText: string, headerLines: string[], nRows: number,
 *   xUnit: string, x: number[],
 *   columns: Array<{ index:number, name:string, values:number[], quantity:(string|null), isPercent:boolean, isAbsorbance:boolean }>
 * }}
 *
 * The first numeric column is X; every remaining numeric column is a Y
 * candidate. X is returned in the SOURCE unit (not yet converted) so callers
 * can show/override the detected unit; makeMeasuredCurve does the nm conversion.
 */
export function parseSpectrumTable(text, opts = {}) {
    if (typeof text !== 'string' || text.trim() === '') {
        return { ok: false, error: 'Empty file', delimiter: ',', decimal: '.', headerText: '', headerLines: [], nRows: 0, xUnit: X_UNITS.UNKNOWN, x: [], columns: [] };
    }

    const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
    const decimal = opts.decimal || detectDecimal(text);

    // Sample non-empty lines for delimiter sniffing.
    const sample = rawLines.filter(l => l.trim()).slice(0, 200);
    const delimiter = opts.delimiter || sniffDelimiter(sample, decimal);

    // A line is "data" if its first two fields parse as numbers.
    const isDataLine = (line) => {
        if (!line.trim()) return false;
        const f = splitFields(line, delimiter);
        return f.length >= 2 &&
               Number.isFinite(parseNumber(f[0], decimal)) &&
               Number.isFinite(parseNumber(f[1], decimal));
    };

    // Leading non-data lines = header. Find first data line.
    let firstData = rawLines.findIndex(isDataLine);
    if (firstData < 0) {
        return { ok: false, error: 'No numeric data rows found', delimiter, decimal, headerText: '', headerLines: rawLines, nRows: 0, xUnit: X_UNITS.UNKNOWN, x: [], columns: [] };
    }
    const headerLines = rawLines.slice(0, firstData).filter(l => l.trim() !== '');

    // Collect contiguous-ish data rows (skip the occasional blank/comment line
    // interspersed, but stop nothing — instruments sometimes append a stats
    // footer of non-numeric lines, which simply won't match isDataLine).
    const dataRows = [];
    for (let i = firstData; i < rawLines.length; i++) {
        if (isDataLine(rawLines[i])) dataRows.push(splitFields(rawLines[i], delimiter));
    }

    // Column count = the modal field count among data rows (robust to a stray
    // ragged row).
    const counts = {};
    for (const r of dataRows) counts[r.length] = (counts[r.length] || 0) + 1;
    const nCols = +Object.keys(counts).reduce((a, b) => counts[b] > counts[a] ? b : a);

    // Column names: the last header line, IF it splits into ~nCols fields and is
    // non-numeric (a real header row like "Wavelength (nm),%T").
    let columnNames = [];
    if (headerLines.length) {
        const cand = splitFields(headerLines[headerLines.length - 1], delimiter);
        const nonNumeric = cand.filter(f => !Number.isFinite(parseNumber(f, decimal))).length;
        if (cand.length >= 2 && Math.abs(cand.length - nCols) <= 1 && nonNumeric >= 1) {
            columnNames = cand;
        }
    }
    const headerText = headerLines.join('\n');

    // Build X (col 0) + Y columns (cols 1..nCols-1).
    const x = [];
    const colValues = Array.from({ length: nCols - 1 }, () => []);
    for (const r of dataRows) {
        if (r.length < nCols) continue;        // skip ragged short rows
        x.push(parseNumber(r[0], decimal));
        for (let c = 1; c < nCols; c++) colValues[c - 1].push(parseNumber(r[c], decimal));
    }

    let xUnit = detectXUnit(headerText + ' ' + (columnNames[0] || ''));
    if (xUnit === X_UNITS.UNKNOWN) xUnit = guessXUnitFromRange(x);

    const columns = colValues.map((values, k) => {
        const name = columnNames[k + 1] || `Column ${k + 2}`;
        const hdr = `${headerText}\n${name}`;
        const isAbsorbance = isAbsorbanceHeader(name) || (columnNames.length === 0 && isAbsorbanceHeader(headerText));
        return {
            index: k + 1,
            name,
            values,
            quantity: detectQuantity(name) || detectQuantity(headerText),
            isPercent: isAbsorbance ? false : detectIsPercent(hdr, values),
            isAbsorbance,
        };
    });

    return { ok: true, delimiter, decimal, headerText, headerLines, nRows: x.length, xUnit, x, columns };
}

// ── measuredCurve model ─────────────────────────────────────────────────────────

let _curveSeq = 0;
function curveId() { return `meas-${++_curveSeq}-${Math.round((typeof performance !== 'undefined' ? performance.now() : 0))}`; }

const FAMILY_COLOR = { R: '#ef5350', T: '#2196f3', A: '#66bb6a' };

/**
 * Build a normalized measured-curve overlay from one X array + one Y column.
 *
 * @param {object} p
 *   p.name        display label
 *   p.x           number[] in unit p.xUnit (source order)
 *   p.xUnit       X_UNITS.*
 *   p.y           number[] Y values (source scale)
 *   p.quantity    'T' | 'R' | 'A'
 *   p.isPercent   Y is 0..100 (divide by 100)
 *   p.isAbsorbance Y is absorbance → convert to T = 10^-A (quantity forced to 'T')
 *   p.color       optional override
 * @returns measuredCurve { id, name, quantity, source, x:nm[] (asc), y:frac[], color, visible, xUnit, yWasPercent }
 */
export function makeMeasuredCurve(p) {
    const xUnit = p.xUnit || X_UNITS.NM;
    let quantity = QUANTITIES.includes(p.quantity) ? p.quantity : 'T';
    const isAbs = !!p.isAbsorbance;

    // Pair (x_nm, y_fraction), dropping non-finite pairs.
    const pairs = [];
    const n = Math.min(p.x.length, p.y.length);
    for (let i = 0; i < n; i++) {
        const xn = xToNm(p.x[i], xUnit);
        let yv = p.y[i];
        if (!Number.isFinite(xn) || !Number.isFinite(yv)) continue;
        if (isAbs) { yv = absorbanceToT(yv); quantity = 'T'; }
        else if (p.isPercent) yv = yv / 100;
        pairs.push([xn, yv]);
    }
    pairs.sort((a, b) => a[0] - b[0]);   // ascending nm

    return {
        id: p.id || curveId(),
        name: p.name || 'Measured',
        quantity,
        source: p.source || 'import',
        x: pairs.map(pr => pr[0]),
        y: pairs.map(pr => pr[1]),
        color: p.color || FAMILY_COLOR[quantity] || '#ffb300',
        visible: p.visible !== false,
        xUnit,
        yWasPercent: isAbs ? false : !!p.isPercent,
    };
}

// ── CSV export ──────────────────────────────────────────────────────────────────

const Q_LABEL = { T: '%T', R: '%R', A: 'Absorbance' };

/**
 * Export one or more measured curves to CSV text. Curves that share an
 * identical X grid are written as a single multi-column table; otherwise each
 * curve is written as its own (Wavelength, value) pair of columns padded to the
 * longest curve. Y is written back in PERCENT for T/R (matching how instruments
 * emit), absorbance left as-is.
 *
 * @param {measuredCurve[]} curves
 * @param {object} [opts] opts.delimiter (default ','), opts.asPercent (default true)
 * @returns {string} CSV text with CRLF endings.
 */
export function curvesToCsv(curves, opts = {}) {
    const d = opts.delimiter || ',';
    const asPercent = opts.asPercent !== false;
    const list = (curves || []).filter(cv => cv && cv.x && cv.x.length);
    if (!list.length) return '';

    const yOut = (cv, v) => (cv.quantity === 'A' ? v : (asPercent ? v * 100 : v));
    const yHdr = (cv) => cv.quantity === 'A' ? 'Absorbance' : (asPercent ? Q_LABEL[cv.quantity] : cv.quantity);

    // Shared grid → single λ column.
    const sameGrid = list.every(cv =>
        cv.x.length === list[0].x.length &&
        cv.x.every((v, i) => Math.abs(v - list[0].x[i]) < 1e-9));

    const lines = [];
    if (sameGrid) {
        lines.push(['Wavelength (nm)', ...list.map(cv => `${cv.name} ${yHdr(cv)}`)].join(d));
        for (let i = 0; i < list[0].x.length; i++) {
            lines.push([
                fmt(list[0].x[i]),
                ...list.map(cv => fmt(yOut(cv, cv.y[i]))),
            ].join(d));
        }
    } else {
        // Independent grids: pad to the longest curve, two columns each.
        const maxLen = Math.max(...list.map(cv => cv.x.length));
        const header = [];
        list.forEach(cv => header.push('Wavelength (nm)', `${cv.name} ${yHdr(cv)}`));
        lines.push(header.join(d));
        for (let i = 0; i < maxLen; i++) {
            const row = [];
            list.forEach(cv => {
                if (i < cv.x.length) row.push(fmt(cv.x[i]), fmt(yOut(cv, cv.y[i])));
                else row.push('', '');
            });
            lines.push(row.join(d));
        }
    }
    return lines.join('\r\n') + '\r\n';
}

function fmt(v) {
    if (!Number.isFinite(v)) return '';
    // Trim trailing zeros but keep meaningful precision.
    return Number(v.toFixed(6)).toString();
}

/**
 * Build a CSV from an arbitrary X grid + named Y columns (used to export the
 * design's COMPUTED spectrum: T/R/A vs λ). Values are written verbatim.
 */
export function tableToCsv({ x, columns, xLabel = 'Wavelength (nm)' }, opts = {}) {
    const d = opts.delimiter || ',';
    const cols = columns || [];
    const lines = [[xLabel, ...cols.map(c => c.name)].join(d)];
    for (let i = 0; i < x.length; i++) {
        lines.push([fmt(x[i]), ...cols.map(c => fmt(c.values[i]))].join(d));
    }
    return lines.join('\r\n') + '\r\n';
}
