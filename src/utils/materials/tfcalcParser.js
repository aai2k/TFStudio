/**
 * tfcalcParser.js: TFCalc material / substrate (.MAT) importer.
 *
 * TFCalc stores every material as a stream of star-delimited records:
 *   VERSION*1*
 *   FORMAT*1*                        table of points
 *   POINTS*N*
 *   DATA1*i*wavelength*n*k*          one record per point
 *   COMMENT*text*                    optional, may repeat
 *   EOF*
 * or, for a dispersion formula,
 *   FORMAT*2*nCode*kCode*min*max*    formula codes and the valid range
 *   DATA2*row*a*b*c*                 three records: nine coefficient slots
 * Records may share a line, so the parser reads the star-separated token
 * stream and ignores line breaks.
 *
 * Wavelengths (table rows and the formula range) are in the unit the TFCalc
 * installation is configured for, nm by default; the file does not record it,
 * so the caller passes opts.wavelengthUnit ('nm' | 'um'). Formula coefficients
 * take λ in µm regardless of that setting: the shipped Schott substrates carry
 * Schott's own µm-based Sellmeier coefficients next to an nm range.
 *
 * Formula codes follow the order of the manual's formula table (TFCalc manual,
 * Guide to TFCalc p. 33), with the coefficients A stored in the order the
 * formula lists them:
 *   n  1 Sellmeier 1    n² = A0 + A1λ²/(λ²−A2)
 *      2 Sellmeier 2    n² = A0 + A1λ²/(λ²−A2) + A3λ²/(λ²−A4)
 *      3 Sellmeier 2′   n² = A0 + A1λ²/(λ²−A2) + A3λ²
 *      4 Sellmeier 3    n² = 1 + A1λ²/(λ²−A2) + A3λ²/(λ²−A4) + A5λ²/(λ²−A6)
 *      5 Cauchy         n  = A0 + A1/λ² + A2/λ⁴
 *      6 Hartmann 1     n  = A0 + A1/(λ−A2)
 *      7 Hartmann 2     n  = A0 + A1/(λ−A2)²
 *      8 Schott         n² = A0 + A1λ² + A2/λ² + A3/λ⁴ + A4/λ⁶ + A5/λ⁸
 *      9 Drude          n²−k² = A0 − A1A2²λ²/(λ²+A2²),  2nk = A1A2λ³/(λ²+A2²)
 *   k  1 Zero           k = 0
 *      2 Sellmeier      k = [n(λ)·(B1λ + B2/λ + B3/λ³)]⁻¹
 *      3 Exponential    k = B1·exp(B2/λ)
 *      4 Drude          paired with n code 9
 * The nine DATA2 slots hold the six A coefficients followed by B1..B3.
 *
 * Output is a catalogManager material entry (λ conventions: tabData in nm,
 * coefficients / lambdaMin / lambdaMax / kTable in µm). Families with an exact
 * TFStudio evaluator keep their formula; Hartmann and Drude are sampled onto a
 * table over the declared range, and every k formula is sampled onto a k table.
 */

import { sanitizeId } from './optilayerParser/idUtils.js';
import { computeNd } from './optilayerParser/nd.js';
import { LINEAR_INTERPOLATION, TABULATED_INTERPOLATION } from './pchip.js';

export const TFCALC_N_FORMULAS = {
    1: 'Sellmeier 1', 2: 'Sellmeier 2', 3: 'Sellmeier 2′', 4: 'Sellmeier 3', 5: 'Cauchy',
    6: 'Hartmann 1', 7: 'Hartmann 2', 8: 'Schott', 9: 'Drude',
};
export const TFCALC_K_FORMULAS = { 1: 'Zero', 2: 'Sellmeier', 3: 'Exponential', 4: 'Drude' };

// Sample count for formulas that have no exact evaluator in TFStudio.
const SAMPLE_POINTS = 200;

// ── Record stream ─────────────────────────────────────────────────────────────

const RECORD_KEYS = new Set(['VERSION', 'FORMAT', 'POINTS', 'DATA1', 'DATA2', 'COMMENT', 'EOF']);

function parseRecords(text, fileName) {
    const tok = String(text).split('*').map(s => s.trim());
    const rec = { format: 0, nCode: 0, kCode: 0, min: NaN, max: NaN, points: [], slots: [], comments: [] };
    let i = 0;
    let inComment = false;
    const next = () => tok[i++];
    while (i < tok.length) {
        const key = next();
        if (key === '') continue;
        if (!RECORD_KEYS.has(key)) {
            // Comment text may contain the delimiter itself; its fragments arrive
            // here as unknown records and are joined back onto the comment.
            if (inComment) { rec.comments[rec.comments.length - 1] += '*' + key; continue; }
            throw new Error(`"${fileName}" is not a TFCalc material file (unexpected record "${key}")`);
        }
        inComment = key === 'COMMENT';
        switch (key) {
            case 'VERSION': next(); break;
            case 'FORMAT':
                rec.format = Number(next());
                if (rec.format === 2) {
                    rec.nCode = Number(next()); rec.kCode = Number(next());
                    rec.min = Number(next()); rec.max = Number(next());
                }
                break;
            case 'POINTS': next(); break;
            case 'DATA1': {
                next();
                rec.points.push([Number(next()), Number(next()), Number(next())]);
                break;
            }
            case 'DATA2': {
                next();
                rec.slots.push(Number(next()), Number(next()), Number(next()));
                break;
            }
            case 'COMMENT': rec.comments.push(next() ?? ''); break;
            case 'EOF': i = tok.length; break;
        }
    }
    return rec;
}

// ── Formula evaluators (λ in µm) ──────────────────────────────────────────────

function nEvaluator(code, s) {
    switch (code) {
        case 1: return lam => { const l2 = lam * lam; return Math.sqrt(s[0] + s[1] * l2 / (l2 - s[2])); };
        case 2: return lam => { const l2 = lam * lam; return Math.sqrt(s[0] + s[1] * l2 / (l2 - s[2]) + s[3] * l2 / (l2 - s[4])); };
        case 3: return lam => { const l2 = lam * lam; return Math.sqrt(s[0] + s[1] * l2 / (l2 - s[2]) + s[3] * l2); };
        case 4: return lam => {
            const l2 = lam * lam;
            return Math.sqrt(1 + s[0] * l2 / (l2 - s[1]) + s[2] * l2 / (l2 - s[3]) + s[4] * l2 / (l2 - s[5]));
        };
        case 5: return lam => { const l2 = lam * lam; return s[0] + s[1] / l2 + s[2] / (l2 * l2); };
        case 6: return lam => s[0] + s[1] / (lam - s[2]);
        case 7: return lam => s[0] + s[1] / ((lam - s[2]) * (lam - s[2]));
        case 8: return lam => {
            const l2 = lam * lam;
            return Math.sqrt(s[0] + s[1] * l2 + s[2] / l2 + s[3] / (l2 * l2)
                + s[4] / (l2 * l2 * l2) + s[5] / (l2 * l2 * l2 * l2));
        };
        default: return null;
    }
}

// Drude: the two equations give n² − k² and 2nk; solve for n, then k.
function drudeNK(s, lam) {
    const l2 = lam * lam, a2 = s[2] * s[2], den = l2 + a2;
    const re = s[0] - s[1] * a2 * l2 / den;
    const im = s[1] * s[2] * l2 * lam / den;
    const n = Math.sqrt((re + Math.hypot(re, im)) / 2);
    return [n, n > 0 ? im / (2 * n) : 0];
}

function kEvaluator(kCode, s, nAt) {
    const B = s.slice(6, 9);
    switch (kCode) {
        case 1: return null;
        case 2: return lam => 1 / (nAt(lam) * (B[0] * lam + B[1] / lam + B[2] / (lam * lam * lam)));
        case 3: return lam => B[0] * Math.exp(B[1] / lam);
        default: return undefined;
    }
}

// TFStudio formula numbers and coefficient order for the families that have an
// exact evaluator. Sellmeier 2′ maps onto Zemax "Handbook of Optics 2", whose
// last term is subtracted, hence the sign flip.
function exactFormula(code, s) {
    switch (code) {
        case 1: return { formulaNum: 101, coefficients: s.slice(0, 3) };
        case 2: return { formulaNum: 101, coefficients: s.slice(0, 5) };
        case 3: return { formulaNum: 8, coefficients: [s[0], s[1], s[2], -s[3]] };
        case 4: return { formulaNum: 2, coefficients: s.slice(0, 6) };
        case 5: return { formulaNum: 102, coefficients: s.slice(0, 3) };
        case 8: return { formulaNum: 1, coefficients: s.slice(0, 6) };
        default: return null;
    }
}

function sampleGrid(lmin, lmax) {
    const grid = [];
    for (let i = 0; i < SAMPLE_POINTS; i++) grid.push(lmin + (lmax - lmin) * i / (SAMPLE_POINTS - 1));
    return grid;
}

function sampleKTable(kAt, lmin, lmax) {
    const rows = [];
    for (const lam of sampleGrid(lmin, lmax)) {
        const k = kAt(lam);
        if (Number.isFinite(k)) rows.push({ lam_um: lam, k });
    }
    return rows.some(r => r.k !== 0) ? rows : [];
}

// ── Entry builders ────────────────────────────────────────────────────────────

function buildTable(rec, base, wlScale) {
    const rows = rec.points
        .filter(p => p.every(Number.isFinite))
        .map(([w, n, k]) => [w * wlScale, n, k])
        .sort((a, b) => a[0] - b[0]);
    if (!rows.length) throw new Error(`TFCalc table "${base.name}" has no data points`);
    base.formulaNum = -1;
    base.tabData = rows;
    // TFCalc evaluates a table linearly between its points; the same rule
    // here reproduces what it computed. A formula sampled below stays PCHIP,
    // since a sampled smooth function is better rebuilt by a cubic.
    base.interp = LINEAR_INTERPOLATION;
    base.lambdaMin = rows[0][0] / 1000;
    base.lambdaMax = rows[rows.length - 1][0] / 1000;
    return base;
}

function buildFormula(rec, base, wlScale) {
    const s = rec.slots.slice();
    while (s.length < 9) s.push(0);
    const lmin = rec.min * wlScale / 1000, lmax = rec.max * wlScale / 1000;
    if (!(lmin > 0 && lmax > lmin)) throw new Error(`TFCalc formula "${base.name}" has no valid wavelength range`);
    base.lambdaMin = lmin;
    base.lambdaMax = lmax;

    const drude = rec.nCode === 9;
    const nAt = drude ? null : nEvaluator(rec.nCode, s);
    if (!drude && !nAt) throw new Error(`Unsupported TFCalc n formula code ${rec.nCode} in "${base.name}"`);
    if (!drude && rec.kCode === 4) throw new Error(`TFCalc Drude k formula without Drude n in "${base.name}"`);
    const kAt = drude ? null : kEvaluator(rec.kCode, s, nAt);
    if (kAt === undefined) throw new Error(`Unsupported TFCalc k formula code ${rec.kCode} in "${base.name}"`);

    const exact = drude ? null : exactFormula(rec.nCode, s);
    if (exact) {
        base.formulaNum = exact.formulaNum;
        base.coefficients = exact.coefficients;
        if (kAt) {
            base.kTable = sampleKTable(kAt, lmin, lmax);
            if (base.kTable.length) base.interp = TABULATED_INTERPOLATION;
        }
        return base;
    }

    // A k formula that cannot be evaluated at a point (a zero divisor) leaves
    // that point without absorption rather than without the material.
    const rows = [];
    for (const lam of sampleGrid(lmin, lmax)) {
        const [n, k] = drude ? drudeNK(s, lam) : [nAt(lam), kAt ? kAt(lam) : 0];
        if (Number.isFinite(n)) rows.push([lam * 1000, n, Number.isFinite(k) ? k : 0]);
    }
    if (!rows.length) throw new Error(`TFCalc formula "${base.name}" gives no finite values over its range`);
    base.formulaNum = -1;
    base.tabData = rows;
    base.interp = TABULATED_INTERPOLATION;
    base.tfcalc.sampledFrom = TFCALC_N_FORMULAS[rec.nCode];
    return base;
}

/**
 * Parse one TFCalc .MAT file.
 *
 * @param {string} text       file contents
 * @param {string} fileName   material name source (extension stripped)
 * @param {Object} [opts]
 * @param {'nm'|'um'} [opts.wavelengthUnit]  unit of the wavelengths in the file (default nm)
 * @param {string} [opts.group]              catalog group label (e.g. 'Substrate')
 * @returns {Object} catalogManager material entry
 * @throws {Error} on a malformed file or an unsupported formula code
 */
export function parseTFCalcFile(text, fileName, opts = {}) {
    const name = String(fileName || '').replace(/\.mat$/i, '').trim() || 'material';
    const rec = parseRecords(text, fileName);
    const wlScale = opts.wavelengthUnit === 'um' ? 1000 : 1;
    const base = {
        id: sanitizeId(name),
        name,
        formulaNum: -1,
        coefficients: [],
        lambdaMin: 0.3, lambdaMax: 2.5, rangeDeclared: true,
        kTable: [],
        tabData: undefined,
        nd: null, vd: null, density: null,
        comment: rec.comments.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
        color: null,
        group: opts.group || 'Imported',
        tfcalc: { format: rec.format, nCode: rec.nCode, kCode: rec.kCode },
    };
    if (rec.format === 1) buildTable(rec, base, wlScale);
    else if (rec.format === 2) buildFormula(rec, base, wlScale);
    else throw new Error(`"${fileName}" is not a TFCalc material file (no FORMAT record)`);
    base.nd = computeNd(base);
    return base;
}
