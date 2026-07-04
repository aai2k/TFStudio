/**
 * riiDatabase.js — RefractiveIndex.info database browser (JavaScript side).
 *
 * Fetches from github.com/polyanskiy/refractiveindex.info-database via HTTPS
 * (main process does the actual request via rii:fetch-yaml IPC).
 *
 * Public API:
 *   loadCatalog()                    → Promise<parsed catalog tree>
 *   fetchMaterial(dataPath)          → Promise<RiiMaterial>
 *   riiMaterialToCatalogEntry(m)     → catalog-manager compatible material entry
 *   searchCatalog(catalog, query)    → [{shelf,book,page,name,dataPath}, ...]
 */

const RII_RAW_BASE = 'https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/main/database';
const CATALOG_URL  = RII_RAW_BASE + '/catalog-nk.yml';

// In-memory cache for this session
let _catalogCache = null;
let _materialCache = {};

/**
 * Fetch a YAML document, preferring the offline mirror, then the network.
 * On a successful network fetch the raw text is written back into the mirror so
 * the same material is available offline next time.
 *
 * @param {string} localRel  path inside the mirror, e.g. 'catalog-nk.yml' or 'data/main/Ag/nk/Johnson.yml'
 * @param {string} url       network fallback URL
 */
async function fetchYamlCached(localRel, url) {
    const api = window.electronAPI;
    // 1. Offline mirror (bundled snapshot or a previously cached fetch).
    if (api?.riiReadLocal) {
        try {
            const local = await api.riiReadLocal(localRel);
            if (local?.success) return local.data;
        } catch (_) { /* fall through to network */ }
    }
    // 2. Network.
    const result = await api.riiFetchYaml(url);
    if (!result.success) throw new Error('RII fetch failed (' + localRel + '): ' + result.error);
    // 3. Best-effort cache for future offline use.
    if (api?.riiWriteLocal && typeof result.text === 'string') {
        try { await api.riiWriteLocal(localRel, result.text); } catch (_) {}
    }
    return result.data;
}

// ── Catalog loading ───────────────────────────────────────────────────────────

/**
 * Load and parse the catalog-nk.yml.
 * Returns an array of shelf objects:
 *   { shelf, name, books: [{ book, name, pages: [{ page, name, dataPath }] }] }
 */
export async function loadCatalog() {
    if (_catalogCache) return _catalogCache;

    const raw = await fetchYamlCached('catalog-nk.yml', CATALOG_URL);  // SHELF / DIVIDER items
    const shelves = [];

    for (const shelfItem of raw) {
        if (shelfItem.SHELF === undefined) continue;  // skip top-level DIVIDERs
        const shelf = {
            shelf: shelfItem.SHELF,
            name: _stripHtml(shelfItem.name || shelfItem.SHELF),
            books: [],
        };
        shelves.push(shelf);

        for (const bookItem of (shelfItem.content || [])) {
            if (bookItem.BOOK === undefined) continue;  // skip DIVIDERs within shelf
            const book = {
                book: bookItem.BOOK,
                name: _stripHtml(bookItem.name || bookItem.BOOK),
                pages: [],
            };
            shelf.books.push(book);

            for (const pageItem of (bookItem.content || [])) {
                if (pageItem.PAGE === undefined) continue;  // skip DIVIDERs within book
                book.pages.push({
                    page: pageItem.PAGE,
                    name: _stripHtml(pageItem.name || pageItem.PAGE),
                    dataPath: pageItem.data || '',
                });
            }
        }
    }

    _catalogCache = shelves;
    return shelves;
}

/** Clear cached catalog (force re-fetch on next call). */
export function clearCatalogCache() {
    _catalogCache = null;
    _materialCache = {};
}

/** Offline-mirror status: { hasLocal, lastUpdated, materialCount, source }. */
export async function getDatabaseStatus() {
    if (!window.electronAPI?.riiGetStatus) return { hasLocal: false, lastUpdated: null, materialCount: 0, source: 'none' };
    try { return await window.electronAPI.riiGetStatus(); }
    catch (e) { return { hasLocal: false, lastUpdated: null, materialCount: 0, source: 'none', error: e.message }; }
}

/**
 * Download the latest database from GitHub into the offline mirror, then drop
 * the in-session caches so subsequent reads use the refreshed data.
 * Returns { success, lastUpdated, materialCount }.
 */
export async function updateDatabase() {
    if (!window.electronAPI?.riiUpdate) return { success: false, error: 'Update not available' };
    const res = await window.electronAPI.riiUpdate();
    if (res.success) clearCatalogCache();
    return res;
}

// ── Material fetching ─────────────────────────────────────────────────────────

/**
 * Fetch and parse one material YAML by its dataPath (relative to /database/data/).
 * Example dataPath: "main/Ag/nk/Johnson.yml"
 *
 * Returns:
 * {
 *   dataPath,
 *   references: string,
 *   comments:   string,
 *   type:       'tabulated_nk' | 'tabulated_n' | 'formula' | 'mixed',
 *   riiFormulaNum: number | null,   // refractiveindex.info formula number (1-9); NOT Zemax AGF formula numbers
 *   formulaCoeffs: number[] | null,
 *   wavelengthRange: [lmin_nm, lmax_nm] | null,
 *   tableNK:    [[lam_nm, n, k], ...] | null,   // from tabulated block
 *   tableK:     [[lam_nm, k], ...]    | null,   // from separate k block
 * }
 */
export async function fetchMaterial(dataPath) {
    if (_materialCache[dataPath]) return _materialCache[dataPath];

    const doc = await fetchYamlCached('data/' + dataPath, RII_RAW_BASE + '/data/' + dataPath);
    const mat = _parseMaterialDoc(doc, dataPath);
    _materialCache[dataPath] = mat;
    return mat;
}

function _parseMaterialDoc(doc, dataPath) {
    const refs    = _stripHtml((doc.REFERENCES || '').replace(/\s+/g, ' ').trim());
    const comment = _stripHtml((doc.COMMENTS   || '').replace(/\s+/g, ' ').trim());
    const blocks  = doc.DATA || [];

    let tableNK   = null;
    let tableK    = null;
    let riiFormulaNum   = null;
    let formulaCoeffs = null;
    let wavelengthRange = null;
    let type = 'unknown';

    for (const block of blocks) {
        const btype = (block.type || '').toLowerCase();
        if (btype.includes('tabulated nk')) {
            tableNK = _parseTable2(block.data);
            type = 'tabulated_nk';
        } else if (btype.includes('tabulated n') && !btype.includes('nk')) {
            // only n, k=0
            tableNK = _parseTable2(block.data).map(([l,n]) => [l,n,0]);
            type = 'tabulated_n';
        } else if (btype.includes('tabulated k')) {
            tableK = _parseTable2(block.data);
        } else if (btype.startsWith('formula')) {
            const m = btype.match(/formula\s+(\d+)/);
            riiFormulaNum = m ? parseInt(m[1]) : null;
            formulaCoeffs = (block.coefficients || '').trim().split(/\s+/).map(Number);
            const wl = (block.wavelength_range || '').trim().split(/\s+/);
            wavelengthRange = wl.length === 2
                ? [parseFloat(wl[0]) * 1000, parseFloat(wl[1]) * 1000]
                : null;
            type = tableNK ? 'mixed' : 'formula';
        }
    }

    return { dataPath, references: refs, comments: comment,
             type, riiFormulaNum, formulaCoeffs, wavelengthRange,
             tableNK, tableK };
}

function _parseTable2(text) {
    if (!text) return [];
    const rows = [];
    for (const line of text.trim().split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 2) {
            const lam_nm = parseFloat(p[0]) * 1000;
            rows.push([lam_nm, parseFloat(p[1]), p[2] !== undefined ? parseFloat(p[2]) : 0]);
        }
    }
    return rows;
}

// ── Formula evaluation ────────────────────────────────────────────────────────

/** Evaluate n at lambda_nm from an RII parsed material. Returns null if not a formula type. */
export function evalFormulaN(mat, lambda_nm) {
    if (!mat.riiFormulaNum || !mat.formulaCoeffs) return null;
    const lum = lambda_nm / 1000;
    const c = mat.formulaCoeffs;
    switch (mat.riiFormulaNum) {
        case 1: return _sellmeier1(c, lum);
        case 2: return _sellmeier2(c, lum);
        case 3: return _formula3(c, lum);
        case 4: return _formula4(c, lum);
        case 5: return _formula5(c, lum);
        default:
            throw new Error(
                `RII formula ${mat.riiFormulaNum} is not supported (formulas 6–9 are gases / ` +
                `Herzberger). Import refused to avoid silently returning n=1 vacuum.`
            );
    }
}

// Formula 1 (Sellmeier-1): n²−1 = c[0] + Σ_{i=1,3,5,…} c[i]·λ²/(λ²−c[i+1]²)
// c[0] is the leading constant; resonances c[i+1] must be squared (λ₀, not λ₀²).
function _sellmeier1(c, lum) {
    const l2 = lum * lum;
    let n2 = 1 + (c[0] || 0);
    for (let i = 1; i + 1 < c.length; i += 2) {
        const res2 = c[i + 1] * c[i + 1];
        const d = l2 - res2;
        if (Math.abs(d) > 1e-15) n2 += c[i] * l2 / d;
    }
    return Math.sqrt(Math.max(n2, 1));
}

// Formula 2 (Sellmeier-2): n²-1 = A + Σ Bᵢλ²/(λ²-Cᵢ)
// Optional constant A when coefficient count is odd; Cᵢ are already λ₀² (NOT to be squared).
function _sellmeier2(c, lum) {
    const l2 = lum * lum;
    let n2 = 1;
    let start = 0;
    if (c.length % 2 === 1) { n2 += c[0]; start = 1; }
    for (let i = start; i + 1 < c.length; i += 2) {
        const d = l2 - c[i+1];
        if (Math.abs(d) > 1e-15) n2 += c[i] * l2 / d;
    }
    return Math.sqrt(Math.max(n2, 1));
}

// Formula 3 (Polynomial / Schott): n² = c[0] + c[1]·λ^c[2] + c[3]·λ^c[4] + ...
// refractiveindex.info coefficients: [A₀, A₁, e₁, A₂, e₂, ...]
function _formula3(c, lum) {
    let n2 = c[0] || 0;
    for (let i = 1; i + 1 < c.length; i += 2) {
        n2 += c[i] * Math.pow(lum, c[i+1]);
    }
    return Math.sqrt(Math.max(n2, 0.01));
}

// Formula 4 (RefractiveIndex.info):
//   n² = c[0]
//      + c[1]·λ^c[2]/(λ²−c[3]^c[4])   (1st resonance Sellmeier term)
//      + c[5]·λ^c[6]/(λ²−c[7]^c[8])   (2nd resonance Sellmeier term)
//      + c[9]·λ^c[10] + c[11]·λ^c[12] + …  (polynomial pairs from index 9)
// All exponents and bases are taken as given; resonances are raised to their
// respective exponent (c[4] and c[8]) before being subtracted from λ².
function _formula4(c, lum) {
    const l2 = lum * lum;
    let n2 = c[0] || 0;
    // Two Sellmeier-with-exponent terms (indices 1-8, in groups of 4)
    for (let g = 0; g < 2; g++) {
        const base = 1 + g * 4;   // 1, then 5
        if (base + 3 >= c.length) break;
        const A   = c[base],     eA  = c[base + 1];
        const res = c[base + 2], eR  = c[base + 3];
        const denom = l2 - Math.pow(Math.abs(res), eR);
        if (Math.abs(denom) > 1e-15) n2 += A * Math.pow(lum, eA) / denom;
    }
    // Polynomial pairs from index 9 onward: c[i]·λ^c[i+1]
    for (let i = 9; i + 1 < c.length; i += 2) {
        n2 += c[i] * Math.pow(lum, c[i + 1]);
    }
    return Math.sqrt(Math.max(n2, 0.01));
}

// Formula 5 (Cauchy): n = c[0] + c[1]·λ^c[2] + c[3]·λ^c[4] + ...
// Same coefficient format as Formula 3 but returns n directly (not n²).
function _formula5(c, lum) {
    let n = c[0] || 0;
    for (let i = 1; i + 1 < c.length; i += 2) {
        n += c[i] * Math.pow(lum, c[i+1]);
    }
    return Math.max(n, 1);
}

// ── Sampling ──────────────────────────────────────────────────────────────────

/**
 * Get n,k array at evenly-spaced wavelengths for display/import.
 * Returns [[lam_nm, n, k], ...] trimmed to [lmin, lmax].
 */
export function sampleMaterial(mat, lmin = 300, lmax = 2500, step = 10) {
    const pts = [];

    if (mat.tableNK) {
        // Subsample tabulated data
        const rows = mat.tableNK.filter(r => r[0] >= lmin && r[0] <= lmax);
        if (rows.length === 0) return pts;
        let last = -Infinity;
        for (const r of rows) {
            if (r[0] - last >= step) { pts.push(r); last = r[0]; }
        }
        if (pts[pts.length - 1] !== rows[rows.length - 1]) pts.push(rows[rows.length - 1]);
        // Merge k from separate table if present
        if (mat.tableK && mat.tableK.length > 0) {
            for (const pt of pts) {
                pt[2] = _interpK(mat.tableK, pt[0]);
            }
        }
        return pts;
    }

    if (mat.riiFormulaNum && mat.formulaCoeffs) {
        const [fl0, fl1] = mat.wavelengthRange || [lmin, lmax];
        const l0 = Math.max(lmin, fl0), l1 = Math.min(lmax, fl1);
        for (let lam = l0; lam <= l1 + 0.01; lam += step) {
            const n = evalFormulaN(mat, lam);
            if (n == null) throw new Error(`evalFormulaN returned null for formula ${mat.riiFormulaNum}`);
            const k = mat.tableK ? _interpK(mat.tableK, lam) : 0;
            pts.push([Math.round(lam * 10) / 10, n, k]);
        }
        return pts;
    }

    return pts;
}

function _interpK(table, lam_nm) {
    if (!table || table.length === 0) return 0;
    if (lam_nm <= table[0][0]) return table[0][1];
    if (lam_nm >= table[table.length - 1][0]) return table[table.length - 1][1];
    let lo = 0, hi = table.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid][0] <= lam_nm) lo = mid; else hi = mid;
    }
    const t = (lam_nm - table[lo][0]) / (table[hi][0] - table[lo][0]);
    return table[lo][1] + t * (table[hi][1] - table[lo][1]);
}

// ── Search ─────────────────────────────────────────────────────────────────────

/**
 * Search catalog for books/pages matching query string.
 * Returns array of { shelf, shelfName, book, bookName, page, pageName, dataPath }.
 */
export function searchCatalog(catalog, query) {
    if (!query || !catalog) return [];
    const q = query.toLowerCase().trim();
    const results = [];
    for (const shelf of catalog) {
        for (const book of shelf.books) {
            const bookMatch = book.name.toLowerCase().includes(q) || book.book.toLowerCase().includes(q);
            for (const page of book.pages) {
                if (bookMatch || page.name.toLowerCase().includes(q)) {
                    results.push({
                        shelf: shelf.shelf, shelfName: shelf.name,
                        book: book.book,   bookName: book.name,
                        page: page.page,   pageName: page.name,
                        dataPath: page.dataPath,
                    });
                }
            }
        }
    }
    return results.slice(0, 200);  // limit
}

// ── Conversion to catalog manager format ──────────────────────────────────────

/**
 * Convert a fetched RII material to a catalogManager-compatible entry.
 * The entry can be added to a catalog with source='refractiveindex'.
 *
 * Returns a material entry object (not a full catalog — caller adds it to a catalog).
 */
export function riiToMaterialEntry(mat, pageName, bookName) {
    // Wide range so IR-only materials aren't rejected and NIR/IR tails aren't
    // truncated; the material's wavelengthRange still bounds the actual samples.
    const samples = sampleMaterial(mat, 200, 20000, 10);
    if (samples.length === 0) throw new Error('No data in wavelength range 200-20000 nm');

    const lmin_um = samples[0][0] / 1000;
    const lmax_um = samples[samples.length - 1][0] / 1000;

    const id = (bookName + '_' + pageName).replace(/\s+/g, '_').replace(/[^\w-]/g, '');

    return {
        id,
        name: bookName + ' (' + pageName + ')',
        formulaNum: -1,       // tabulated in catalogManager convention
        coefficients: [],
        lambdaMin: lmin_um,
        lambdaMax: lmax_um,
        kTable: [],
        nd: null, vd: null, density: null,
        comment: (mat.comments ? mat.comments + '\n' : '') + mat.references.slice(0, 200),
        color: null,
        group: null,
        tabData: samples,     // [[lam_nm, n, k], ...]
        sourceUrl: RII_RAW_BASE + '/data/' + mat.dataPath,
        dataPath: mat.dataPath,
        fetchedDate: new Date().toISOString().slice(0, 10),
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}
