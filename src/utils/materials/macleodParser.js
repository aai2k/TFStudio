/**
 * macleodParser.js: Essential Macleod material importer.
 *
 * Reads the database files (`M<n>.tfx` inside a materials database folder)
 * and the files written by File → Export → Material (`.mtx`). Both are XML
 * with the root <EssentialMacleodMaterial Name NType KType …>:
 *   NType   1 table, 2 Sellmeier, 3 Cauchy
 *   KType   1 table
 *   TType / TintType   1 internal-transmittance table, -1 undefined
 *
 * Database file:
 *   <NKPoints><NKPoint W n k/></NKPoints>
 *   <Sellmeier Max Min><Parameter N A B/></Sellmeier>
 *   <Cauchy Max Min><Parameter N A/></Cauchy>
 *   <KPoints><KPoint W k/></KPoints>  <KCauchy><Parameter N A/></KCauchy>
 *   <KExp><Parameter A B/></KExp>     <TintPoints Thickness><TintPoint W T/></TintPoints>
 *   <Notes>
 * Exported file: same root and codes, but the formula terms are
 *   <SellmeierPoints Max Min><SellmeierPoint A B/></SellmeierPoints>
 *   <CauchyPoints Max Min><CauchyPoint A/></CauchyPoints>   (document order = q)
 * with TintType instead of TType and no KCauchy / KExp blocks.
 *
 * Formulas (Essential Macleod manual, Materials Management, p. 177):
 *   Sellmeier   n² = 1 + Σ A_q λ² / (λ² − B_q)
 *   Cauchy      n  = Σ A_q / λ^2q
 *   k           table (linear), Cauchy series, or A·exp(B/λ)
 * Wavelengths and coefficients are written in the wavelength unit of the
 * database the material belongs to: in a nanometre database B is in nm² and
 * A_q in nm^2q. The file does not record that unit, so the caller passes
 * opts.wavelengthUnit ('nm' | 'um', default nm) and the parser converts to
 * TFStudio's µm-based coefficients. With that conversion the documented
 * Sellmeier formula reproduces the program's own n to five decimals.
 *
 * The shipped materials library (MaterialsLibrary\*.mtx) is a compressed
 * binary format under the same extension; it is refused with a clear error.
 *
 * Internal transmittance has no equivalent in TFStudio: the k column is
 * imported as it is and the TintPoints block is dropped. The entry records
 * that in `macleod.internalTransmittance` so the import dialog can say so.
 *
 * Output is a catalogManager material entry (tabData in nm; coefficients,
 * lambdaMin / lambdaMax and kTable in µm).
 */

import { sanitizeId } from './optilayerParser/idUtils.js';
import { computeNd } from './optilayerParser/nd.js';
import { TABULATED_INTERPOLATION } from './pchip.js';

export const MACLEOD_N_MODELS = { 1: 'Table', 2: 'Sellmeier', 3: 'Cauchy' };

// Sample count for the k models that have no table of their own.
const SAMPLE_POINTS = 200;
// Essential Macleod writes doubles with 15 significant digits; rounding a
// converted value back to that keeps the digits the file holds instead of the
// last-bit noise a unit conversion leaves behind.
const FILE_DIGITS = 15;

// ── Minimal XML access (the schema is flat: attributes on self-closing tags) ──

function unescapeXml(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (m, e, d) =>
        e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCharCode(+d));
}

function attrs(s) {
    const o = {};
    for (const m of s.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g)) o[m[1]] = unescapeXml(m[2]).trim();
    return o;
}

// First element named by any of `names`; `inner` is empty for a self-closing tag.
function block(text, names) {
    for (const nm of names) {
        const m = new RegExp(`<${nm}\\b([^>]*?)(/>|>([\\s\\S]*?)</${nm}>)`).exec(text);
        if (m) return { attrs: attrs(m[1]), inner: m[3] || '' };
    }
    return null;
}

function rows(inner, name) {
    return [...inner.matchAll(new RegExp(`<${name}\\b([^>]*?)/>`, 'g'))].map(m => attrs(m[1]));
}

const num = v => (v == null || v === '') ? NaN : Number(v);

// ── Unit conversion ───────────────────────────────────────────────────────────

// `toUm(value, power)` converts a quantity in (database unit)^power to µm^power;
// `toNm(w)` converts a wavelength to nm. A nanometre database divides by an
// exact power of 1000, then rounds to the file's own precision.
function converter(wavelengthUnit) {
    if (wavelengthUnit === 'um') return { toUm: v => v, toNm: w => w * 1000 };
    return {
        toUm: (v, power = 1) => Number((v / Math.pow(1000, power)).toPrecision(FILE_DIGITS)),
        toNm: w => w,
    };
}

// ── Model readers ─────────────────────────────────────────────────────────────

// Formula terms as { q, a }: q is the term index, taken from the numbered
// <Parameter N …/> rows of the database variant and from document order in
// the exported variant.
function formulaTerms(text, dbName, exportName, exportRow) {
    const db = block(text, [dbName]);
    if (db && db.inner) {
        const terms = rows(db.inner, 'Parameter').map((a, i) => ({ q: Number.isFinite(num(a.N)) ? num(a.N) : i, a }));
        terms.sort((x, y) => x.q - y.q);
        return { range: db.attrs, terms };
    }
    const ex = block(text, [exportName]);
    if (ex) return { range: ex.attrs, terms: rows(ex.inner, exportRow).map((a, i) => ({ q: i, a })) };
    return null;
}

function declaredRange(range, conv, name) {
    const lmin = conv.toUm(num(range.Min)), lmax = conv.toUm(num(range.Max));
    if (!(lmin > 0 && lmax > lmin)) throw new Error(`Essential Macleod material "${name}" has no valid formula wavelength range`);
    return [lmin, lmax];
}

function sampleGrid(lmin, lmax) {
    const grid = [];
    for (let i = 0; i < SAMPLE_POINTS; i++) grid.push(lmin + (lmax - lmin) * i / (SAMPLE_POINTS - 1));
    return grid;
}

// Extinction model for a formula material. KType 1 is the table; the codes of
// the Cauchy and exponential k models are not confirmed, so for any other code
// the populated block decides.
function kModel(text, kType, conv) {
    const points = block(text, ['KPoints']);
    const table = points ? rows(points.inner, 'KPoint')
        .map(a => ({ lam_um: conv.toUm(num(a.W)), k: num(a.k) }))
        .filter(r => Number.isFinite(r.lam_um) && Number.isFinite(r.k))
        .sort((a, b) => a.lam_um - b.lam_um) : [];
    if (kType !== 1) {
        const exp = block(text, ['KExp']);
        const expRow = exp ? rows(exp.inner, 'Parameter')[0] : null;
        if (expRow && num(expRow.A) !== 0) {
            const A = num(expRow.A), B = conv.toUm(num(expRow.B));
            return { kind: 'exp', kAt: lam => A * Math.exp(B / lam) };
        }
        const cauchy = block(text, ['KCauchy']);
        const coef = cauchy ? rows(cauchy.inner, 'Parameter')
            .map(a => ({ q: num(a.N), A: num(a.A) })).sort((x, y) => x.q - y.q) : [];
        if (coef.some(c => c.A !== 0)) {
            const scaled = coef.map(c => ({ q: c.q, A: conv.toUm(c.A, 2 * c.q) }));
            return { kind: 'cauchy', kAt: lam => scaled.reduce((sum, c) => sum + c.A / Math.pow(lam, 2 * c.q), 0) };
        }
    }
    return { kind: 'table', table: table.some(r => r.k !== 0) ? table : [] };
}

function kTableFor(model, lmin, lmax) {
    if (model.kind === 'table') return model.table;
    const rowsOut = [];
    for (const lam of sampleGrid(lmin, lmax)) {
        const k = model.kAt(lam);
        if (Number.isFinite(k)) rowsOut.push({ lam_um: lam, k });
    }
    return rowsOut.some(r => r.k !== 0) ? rowsOut : [];
}

// ── Entry builders ────────────────────────────────────────────────────────────

function buildTableEntry(base, text, conv) {
    const points = block(text, ['NKPoints']);
    const data = points ? rows(points.inner, 'NKPoint')
        .map(a => [conv.toNm(num(a.W)), num(a.n), num(a.k)])
        .filter(r => r.every(Number.isFinite))
        .sort((a, b) => a[0] - b[0]) : [];
    if (!data.length) throw new Error(`Essential Macleod material "${base.name}" has no n,k table`);
    base.formulaNum = -1;
    base.tabData = data;
    base.interp = TABULATED_INTERPOLATION;
    base.lambdaMin = data[0][0] / 1000;
    base.lambdaMax = data[data.length - 1][0] / 1000;
    return base;
}

function buildSellmeierEntry(base, text, conv, kType) {
    const f = formulaTerms(text, 'Sellmeier', 'SellmeierPoints', 'SellmeierPoint');
    const terms = f ? f.terms.map(({ a }) => [num(a.A), conv.toUm(num(a.B), 2)]).filter(t => t.every(Number.isFinite)) : [];
    if (!terms.length) throw new Error(`Essential Macleod material "${base.name}" has no Sellmeier terms`);
    const [lmin, lmax] = declaredRange(f.range, conv, base.name);
    base.formulaNum = 101;
    base.coefficients = [1, ...terms.flat()];
    base.lambdaMin = lmin;
    base.lambdaMax = lmax;
    base.macleod.terms = terms.length;
    base.kTable = kTableFor(kModel(text, kType, conv), lmin, lmax);
    if (base.kTable.length) base.interp = TABULATED_INTERPOLATION;
    return base;
}

function buildCauchyEntry(base, text, conv, kType) {
    const f = formulaTerms(text, 'Cauchy', 'CauchyPoints', 'CauchyPoint');
    // Each A_q sits at the power its own index says; a gap in the numbering is a zero term.
    const terms = [];
    for (const { q, a } of f ? f.terms : []) {
        const value = conv.toUm(num(a.A), 2 * q);
        if (Number.isFinite(value) && q >= 0) terms[q] = value;
    }
    for (let q = 0; q < terms.length; q++) if (terms[q] === undefined) terms[q] = 0;
    if (!terms.length) throw new Error(`Essential Macleod material "${base.name}" has no Cauchy terms`);
    const [lmin, lmax] = declaredRange(f.range, conv, base.name);
    base.formulaNum = 102;
    base.coefficients = terms;
    base.lambdaMin = lmin;
    base.lambdaMax = lmax;
    base.macleod.terms = terms.length;
    base.kTable = kTableFor(kModel(text, kType, conv), lmin, lmax);
    if (base.kTable.length) base.interp = TABULATED_INTERPOLATION;
    return base;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wavelength unit of an Essential Macleod materials database, from its
 * `units.tfp` control file. Returns 'nm' or 'um'; null when the file is absent
 * or has no wavelength line; 'unsupported' when it names another unit (an eV
 * or GHz database), which the caller must not silently read as nanometres.
 */
export function parseMacleodUnits(unitsText) {
    if (!unitsText) return null;
    const m = /"Wavelength"\s*,\s*([-+0-9.eE]+)/.exec(String(unitsText));
    if (!m) return null;
    const scale = Number(m[1]);
    if (Math.abs(scale - 1e-9) < 1e-15) return 'nm';
    if (Math.abs(scale - 1e-6) < 1e-12) return 'um';
    return 'unsupported';
}

/**
 * Parse one Essential Macleod material file (.tfx from a database folder, or
 * an exported .mtx).
 *
 * @param {string} text       file contents
 * @param {string} fileName   name fallback when the file has no Name attribute
 * @param {Object} [opts]
 * @param {'nm'|'um'} [opts.wavelengthUnit]  unit of the database the file belongs to (default nm)
 * @param {string} [opts.group]              catalog group label
 * @returns {Object} catalogManager material entry
 * @throws {Error} on a compressed library file, a malformed file, or an unusable model
 */
export function parseMacleodFile(text, fileName, opts = {}) {
    const src = String(text || '');
    if (/^(MT1|SB1)/.test(src.slice(0, 4))) {
        throw new Error(`"${fileName}" is a compressed Essential Macleod library file. Open the material in Essential Macleod, save it into your materials database, and import the .tfx file from the database folder.`);
    }
    const rootTag = /<EssentialMacleodMaterial\b([^>]*)>/.exec(src);
    if (!rootTag) throw new Error(`"${fileName}" is not an Essential Macleod material file`);
    const root = attrs(rootTag[1]);

    const name = root.Name || String(fileName || '').replace(/\.(tfx|mtx)$/i, '').trim() || 'material';
    const conv = converter(opts.wavelengthUnit);
    const nType = num(root.NType);
    const kType = num(root.KType);
    const tType = num(root.TType ?? root.TintType);
    const notes = block(src, ['Notes']);

    const base = {
        id: sanitizeId(name),
        name,
        formulaNum: -1,
        coefficients: [],
        lambdaMin: 0.3, lambdaMax: 2.5, rangeDeclared: true,
        kTable: [],
        tabData: undefined,
        nd: null, vd: null, density: null,
        comment: notes ? unescapeXml(notes.inner).replace(/\s+/g, ' ').trim() : '',
        color: null,
        group: opts.group || 'Imported',
        macleod: { nType, kType, internalTransmittance: tType === 1 },
    };

    if (nType === 2) buildSellmeierEntry(base, src, conv, kType);
    else if (nType === 3) buildCauchyEntry(base, src, conv, kType);
    else if (nType === 1 || !Number.isFinite(nType)) buildTableEntry(base, src, conv);
    else throw new Error(`Essential Macleod material "${name}" uses refractive index model ${nType}, which this reader does not know`);
    base.nd = computeNd(base);
    return base;
}
