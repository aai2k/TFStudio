/**
 * Zemax AGF (ASCII Glass Format) parser.
 *
 * Reference: Zemax OpticStudio AGF format specification
 *
 * Format overview:
 *   CC <comment>         — catalog header comment
 *   NM <name> <formula> <MIL> <Nd> <Vd> <ExcludeSub> <status> <meltFreq>
 *   GC <glass comment>
 *   ED <TCE1> <TCE2> <density> <dPgF> <ignoreThermal>
 *   CD <c0> ... <c9>     — up to 10 dispersion coefficients
 *   TD <D0> <D1> <D2> <E0> <E1> <Ltk> <Temp>
 *   MD <E> <nu> <HK> <cp> <k>
 *   OD <relcost> <CR> <FR> <SR> <AR> <PR>
 *   LD <lam_min> <lam_max>   — micrometers
 *   IT <lam_um> <T> <thick_mm>  — repeating; lam=0 terminates block
 *   BD <lam_um> <K> <K11> <K12>  — repeating
 *
 * No END keyword — next NM line starts the next glass record.
 * Unknown mnemonics are silently skipped.
 */

/**
 * Derive extinction coefficient k from internal transmittance data (Beer–Lambert law).
 * T = exp(−4π k d / λ)  → k = −ln(T) λ / (4π d)
 *
 * @param {number} T          internal transmittance (0..1)
 * @param {number} lambda_um  wavelength in µm
 * @param {number} thick_mm   reference thickness in mm
 * @returns {number} extinction coefficient k (≥0)
 */
function kFromIT(T, lambda_um, thick_mm) {
    if (T <= 0 || thick_mm <= 0) return 0;
    if (T >= 1) return 0;
    // λ[mm] = lambda_um * 1e-3
    const lambda_mm = lambda_um * 1e-3;
    return -Math.log(T) * lambda_mm / (4 * Math.PI * thick_mm);
}

// Build a fresh glass record from an NM line.
// NM <name> <formula> <MIL> <Nd> <Vd> <ExcludeSub> <status> <meltFreq>
function parseNM(tokens) {
    return {
        id: tokens[1] || 'UNKNOWN',
        name: tokens[1] || 'UNKNOWN',
        formulaNum: parseInt(tokens[2], 10) || 1,
        nd: parseFloat(tokens[4]) || 0,       // tokens[3] = MIL# (ignore)
        vd: parseFloat(tokens[5]) || 0,
        excludeSub: (parseInt(tokens[6], 10) || 0) === 1,
        status: parseInt(tokens[7], 10) || 0,  // 0=Standard,1=Preferred,2=Obsolete,3=Special,4=Melt
        coefficients: [],
        lambdaMin: 0.3,
        lambdaMax: 2.5,
        kTable: [],
        density: null,
        comment: '',
    };
}

// Mnemonic handlers that mutate the current glass record `cur` from a line's
// tokens. Only invoked while a glass is open (after an NM line).
const GLASS_HANDLERS = {
    GC(cur, tokens) { cur.comment = tokens.slice(1).join(' ').trim(); },
    ED(cur, tokens) {
        cur.tce1 = parseFloat(tokens[1]) * 1e-6 || null;
        cur.tce2 = parseFloat(tokens[2]) * 1e-6 || null;
        cur.density = parseFloat(tokens[3]) || null;
        cur.dPgF = parseFloat(tokens[4]) || null;
    },
    CD(cur, tokens) {
        cur.coefficients = [];
        for (let i = 1; i <= 10 && i < tokens.length; i++) {
            cur.coefficients.push(parseFloat(tokens[i]) || 0);
        }
        while (cur.coefficients.length < 10) cur.coefficients.push(0);   // pad with zeros
    },
    LD(cur, tokens) {
        cur.lambdaMin = parseFloat(tokens[1]) || 0.3;
        cur.lambdaMax = parseFloat(tokens[2]) || 2.5;
    },
};

// Consume one IT row into the transmittance accumulator. Returns true when the
// block terminator (lam ≤ 0) is reached, after which further IT rows are ignored.
function accumulateIT(itData, tokens) {
    const lam = parseFloat(tokens[1]);
    if (!lam || lam <= 0) return true;
    const T = parseFloat(tokens[2]);
    const thick = parseFloat(tokens[3]);
    if (!isNaN(T) && !isNaN(thick) && thick > 0) {
        itData.push({ lam_um: lam, T: Math.min(1, Math.max(0, T)), thick_mm: thick });
    }
    return false;
}

// Finalize an open glass: derive its Beer–Lambert k-table from the accumulated
// IT rows (sorted by wavelength) and register it in the materials map.
function commitGlass(cur, itData, materials) {
    cur.kTable = itData
        .map(pt => ({ lam_um: pt.lam_um, k: kFromIT(pt.T, pt.lam_um, pt.thick_mm) }))
        .sort((a, b) => a.lam_um - b.lam_um);
    if (materials[cur.id]) {
        console.warn(`AGF: duplicate glass name "${cur.id}" — later definition overwrites the earlier one.`);
    }
    materials[cur.id] = cur;
}

// Apply one non-blank AGF line to the running parser state. `keepCatalogName`
// is true when the caller fixed the catalog id, so CC comments don't override it.
function consumeLine(state, tokens, keepCatalogName) {
    const mnem = tokens[0].toUpperCase();
    if (mnem === 'CC') {
        if (!keepCatalogName) state.catalogName = tokens.slice(1).join(' ').trim() || 'imported';
        return;
    }
    if (mnem === 'NM') {
        if (state.cur) commitGlass(state.cur, state.itData, state.materials);
        state.cur = parseNM(tokens);
        state.itData = [];
        state.itDone = false;
        return;
    }
    if (mnem === 'IT') {
        if (state.cur && !state.itDone) state.itDone = accumulateIT(state.itData, tokens);
        return;
    }
    // Glass-scoped fields (GC/ED/CD/LD); unknown/unused mnemonics skip silently.
    if (state.cur && GLASS_HANDLERS[mnem]) GLASS_HANDLERS[mnem](state.cur, tokens);
}

/**
 * Parse an AGF text string into a catalog object.
 *
 * @param {string} text         raw AGF file contents
 * @param {string} [catalogId]  suggested catalog id (falls back to CC comment or 'imported')
 * @returns {{ id: string, name: string, materials: Object.<string, AGFMaterial> }}
 */
export function parseAGF(text, catalogId) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const state = {
        catalogName: catalogId || 'imported',
        materials: {},
        cur: null,
        itData: [],       // [{lam_um, T, thick_mm}]
        itDone: false,
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('!')) continue;
        consumeLine(state, line.split(/\s+/), !!catalogId);
    }

    if (state.cur) commitGlass(state.cur, state.itData, state.materials);

    return {
        id: catalogId || slugify(state.catalogName),
        name: state.catalogName,
        materials: state.materials,
    };
}

function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'catalog';
}

/**
 * Validate that required fields are present and formula number is in range.
 * Returns an array of warning strings (empty = OK).
 */
export function validateAGFMaterial(mat) {
    const warnings = [];
    if (!mat.id) warnings.push('Missing glass name');
    if (mat.formulaNum < 1 || mat.formulaNum > 13) warnings.push(`Unknown formula number ${mat.formulaNum}`);
    if (!mat.coefficients || mat.coefficients.length === 0) warnings.push('No dispersion coefficients');
    return warnings;
}
