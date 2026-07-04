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

/**
 * Parse an AGF text string into a catalog object.
 *
 * @param {string} text         raw AGF file contents
 * @param {string} [catalogId]  suggested catalog id (falls back to CC comment or 'imported')
 * @returns {{ id: string, name: string, materials: Object.<string, AGFMaterial> }}
 */
export function parseAGF(text, catalogId) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let catalogName = catalogId || 'imported';
    const materials = {};

    let cur = null;
    let itData = [];       // [{lam_um, T, thick_mm}]
    let itDone = false;

    function finishGlass() {
        if (!cur) return;
        // Build k table from IT data
        const kTable = [];
        for (const pt of itData) {
            const k = kFromIT(pt.T, pt.lam_um, pt.thick_mm);
            kTable.push({ lam_um: pt.lam_um, k });
        }
        kTable.sort((a, b) => a.lam_um - b.lam_um);
        cur.kTable = kTable;
        if (materials[cur.id]) {
            console.warn(`AGF: duplicate glass name "${cur.id}" — later definition overwrites the earlier one.`);
        }
        materials[cur.id] = cur;
        cur = null;
        itData = [];
        itDone = false;
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('!')) continue;

        const tokens = line.split(/\s+/);
        const mnem = tokens[0].toUpperCase();

        switch (mnem) {
            case 'CC': {
                if (!catalogId) {
                    catalogName = tokens.slice(1).join(' ').trim() || 'imported';
                }
                break;
            }
            case 'NM': {
                finishGlass();
                const name = tokens[1] || 'UNKNOWN';
                const formulaNum = parseInt(tokens[2], 10) || 1;
                // tokens[3] = MIL# (ignore)
                const nd = parseFloat(tokens[4]) || 0;
                const vd = parseFloat(tokens[5]) || 0;
                const excludeSub = parseInt(tokens[6], 10) || 0;
                const status = parseInt(tokens[7], 10) || 0;
                cur = {
                    id: name,
                    name,
                    formulaNum,
                    nd,
                    vd,
                    excludeSub: excludeSub === 1,
                    status,        // 0=Standard,1=Preferred,2=Obsolete,3=Special,4=Melt
                    coefficients: [],
                    lambdaMin: 0.3,
                    lambdaMax: 2.5,
                    kTable: [],
                    density: null,
                    comment: '',
                };
                itData = [];
                itDone = false;
                break;
            }
            case 'GC': {
                if (cur) cur.comment = tokens.slice(1).join(' ').trim();
                break;
            }
            case 'ED': {
                if (cur) {
                    cur.tce1 = parseFloat(tokens[1]) * 1e-6 || null;
                    cur.tce2 = parseFloat(tokens[2]) * 1e-6 || null;
                    cur.density = parseFloat(tokens[3]) || null;
                    cur.dPgF = parseFloat(tokens[4]) || null;
                }
                break;
            }
            case 'CD': {
                if (cur) {
                    cur.coefficients = [];
                    for (let i = 1; i <= 10 && i < tokens.length; i++) {
                        cur.coefficients.push(parseFloat(tokens[i]) || 0);
                    }
                    // Pad to full requested length with zeros
                    while (cur.coefficients.length < 10) cur.coefficients.push(0);
                }
                break;
            }
            case 'LD': {
                if (cur) {
                    cur.lambdaMin = parseFloat(tokens[1]) || 0.3;
                    cur.lambdaMax = parseFloat(tokens[2]) || 2.5;
                }
                break;
            }
            case 'IT': {
                if (cur && !itDone) {
                    const lam = parseFloat(tokens[1]);
                    if (!lam || lam <= 0) { itDone = true; break; }
                    const T = parseFloat(tokens[2]);
                    const thick = parseFloat(tokens[3]);
                    if (!isNaN(T) && !isNaN(thick) && thick > 0) {
                        itData.push({ lam_um: lam, T: Math.min(1, Math.max(0, T)), thick_mm: thick });
                    }
                }
                break;
            }
            case 'TD':
            case 'MD':
            case 'OD':
            case 'BD':
                // Parse but currently not used beyond storage
                break;
            default:
                // Unknown mnemonic — skip silently for forward compatibility
                break;
        }
    }

    finishGlass();

    return {
        id: catalogId || slugify(catalogName),
        name: catalogName,
        materials,
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
