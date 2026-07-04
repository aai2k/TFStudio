/**
 * Zemax OpticStudio COATING.DAT reader / writer.
 *
 * Pure ESM, no app dependencies — every conversion takes the wavelength grid /
 * refractive-index resolver it needs as a parameter, so this module is unit-
 * testable in isolation (tests/zemax_coating_roundtrip.mjs).
 *
 * ── Format (authoritative: Zemax OpticStudio 2024 R1 Help, "Coating File Data
 *    Syntax", "The MATE Data Section", "The COAT Data Section") ────────────────
 *
 *   ! comment line
 *   MATE <name>
 *   <wavelength_µm> <real_index> <imaginary>      ← ascending λ, linear interp
 *   ...
 *   COAT <name>
 *   <material> <thickness> [is_absolute] [loop_index] [tapername]
 *   ...
 *   COAT I.<transmission>                          ← ideal: T given, R = 1−T
 *   IDEAL <name> <T_intensity> <R_intensity>
 *   IDEAL2 <name> s_rr s_ri s_tr s_ti p_rr p_ri p_tr p_ti no_pi_flag
 *   TABLE <name> / ANGL <deg> / WAVE <µm> Rs Rp Ts Tp Ars Arp Ats Atp
 *   TAPR <name> / DX/DY/AN/RT/CT/PT ...
 *   ENCRYPTED <filename>
 *
 * ── Conventions (and how they map to TFStudio) ──────────────────────────────
 *
 *  • Wavelength: Zemax µm  ↔  TFStudio nm   (×1000 / ÷1000).
 *
 *  • Extinction sign: Zemax stores the imaginary part as a NEGATIVE number for
 *    absorbing media (e.g. AG: "0.5876  0.15016  -3.4727"); TFStudio uses
 *    ñ = n + ik with k > 0 (thinFilmMath.js). So:
 *        import:  k_TF      = −imag_Zemax     (≥ 0 for absorbers)
 *        export:  imag_Zemax = −k_TF
 *
 *  • Layer thickness (Help, "The COAT Data Section"): if is_absolute = 0 the
 *    thickness T is RELATIVE — an optical thickness in waves of the lens primary
 *    wavelength λ₀ — and the physical thickness in that medium is
 *
 *         d = T · λ₀ / n₀          (n₀ = real index of the layer at λ₀)
 *
 *    (Help worked example: n₀ = 1.4, T = 0.25, λ₀ = 0.550 µm → d = 0.0982 µm.)
 *    If is_absolute = 1 the thickness is already a physical value in micrometres.
 *    λ₀ is a property of the *lens*, not of the coating file, so importing a
 *    relative-thickness coating requires the user to supply λ₀ (default 0.55 µm);
 *    exporting in absolute micrometres needs no λ₀ and is the lossless default.
 *
 *  loop_index / tapername / IDEAL / IDEAL2 / TABLE / TAPR / ENCRYPTED are parsed
 *  and surfaced for browsing but are not (yet) converted to TFStudio designs —
 *  only plain COAT layer stacks import to a layer stack. Replicated groups
 *  (loop_index ≠ 0) are flagged with a warning.
 */

// Keyword tokens that begin a record or a sub-line (case-insensitive).
const RECORD_KW = new Set(['MATE', 'COAT', 'IDEAL', 'IDEAL2', 'TABLE', 'TAPR', 'ENCRYPTED']);
const SUBLINE_KW = new Set(['ANGL', 'WAVE', 'DX', 'DY', 'AN', 'RT', 'CT', 'PT']);

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse the text of a COATING.DAT file.
 * @param {string} text  raw file text (caller has already decoded UTF-16/UTF-8).
 * @returns {{
 *   materials: Array<{name:string, points:Array<[number,number,number]>}>,
 *   coatings:  Array<object>,   // see record `type` discriminator below
 *   tapers:    Array<{name:string, lines:string[]}>,
 *   warnings:  string[]
 * }}
 *   Coating record types:
 *     {type:'layers',    name, layers:[{material,thickness,isAbsolute,loopIndex,taper}]}
 *     {type:'idealI',    name, transmission}
 *     {type:'ideal',     name, T, R}
 *     {type:'ideal2',    name, values:number[9]}
 *     {type:'table',     name, lines:string[]}        // raw ANGL/WAVE lines
 *     {type:'encrypted', name}
 */
export function parseZemaxCoating(text) {
    const materials = [];
    const coatings = [];
    const tapers = [];
    const warnings = [];

    const rawLines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    let cur = null;        // current open record
    let lineNo = 0;

    const closeImpliesGroup = (rec) => {
        if (rec && rec.type === 'layers') {
            if (rec.layers.some(l => l.loopIndex && l.loopIndex !== 0))
                warnings.push(`Coating "${rec.name}" uses replicated groups (loop_index) — imported as a flat stack.`);
        }
    };

    for (let raw of rawLines) {
        lineNo++;
        const line = raw.trim();
        if (line === '' || line[0] === '!') continue;       // blank / comment

        const tok = line.split(/\s+/);
        const kw = tok[0].toUpperCase();

        if (RECORD_KW.has(kw)) {
            closeImpliesGroup(cur);
            cur = null;

            if (kw === 'MATE') {
                cur = { type: 'material', name: tok.slice(1).join(' ').trim(), points: [] };
                materials.push(cur);
            } else if (kw === 'TAPR') {
                cur = { type: 'taper', name: tok.slice(1).join(' ').trim(), lines: [] };
                tapers.push(cur);
            } else if (kw === 'TABLE') {
                cur = { type: 'table', name: tok.slice(1).join(' ').trim(), lines: [] };
                coatings.push(cur);
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
                    // format spec at the top of this file and the round-trip test).
                    // slice(2) strips the "I." prefix; slice(1) would leave a
                    // stray dot (".0.5" → parseFloat → 0).
                    coatings.push({ type: 'idealI', name: second, transmission: num(second.slice(2)) });
                    // 'cur' stays null: an I. coating has no following layer lines.
                } else {
                    cur = { type: 'layers', name: tok.slice(1).join(' ').trim(), layers: [] };
                    coatings.push(cur);
                }
            }
            continue;
        }

        // Continuation line — belongs to the current open record.
        if (!cur) {
            warnings.push(`Line ${lineNo}: data outside any record, ignored: "${line}"`);
            continue;
        }

        if (cur.type === 'material') {
            // <λ_µm> <n> <imag>
            const lam = num(tok[0]), n = num(tok[1]), imag = num(tok[2]);
            if (Number.isFinite(lam) && Number.isFinite(n))
                cur.points.push([lam, n, Number.isFinite(imag) ? imag : 0]);
            else
                warnings.push(`Line ${lineNo}: bad MATE row in "${cur.name}": "${line}"`);
        } else if (cur.type === 'layers') {
            // <material> <thickness> [is_absolute] [loop_index] [tapername]
            cur.layers.push({
                material:   tok[0],
                thickness:  num(tok[1]),
                isAbsolute: tok.length > 2 ? (parseInt(tok[2], 10) || 0) : 0,
                loopIndex:  tok.length > 3 ? (parseInt(tok[3], 10) || 0) : 0,
                taper:      tok.length > 4 ? tok[4] : '',
            });
        } else if (cur.type === 'table' || cur.type === 'taper') {
            if (SUBLINE_KW.has(kw) || cur.type === 'table') cur.lines.push(line);
            else cur.lines.push(line);
        }
    }
    closeImpliesGroup(cur);

    // Drop the internal `type:'material'` tag detail but keep name/points.
    return {
        materials: materials.map(m => ({ name: m.name, points: m.points })),
        coatings,
        tapers: tapers.map(t => ({ name: t.name, lines: t.lines })),
        warnings,
    };
}

function num(s) {
    if (s == null) return NaN;
    // Zemax writes plain decimals and scientific notation (e.g. -1.56E-04).
    return parseFloat(String(s));
}

// ── Material name sanitising ───────────────────────────────────────────────────

/**
 * Zemax material/coating names: ≤ 32 chars, no spaces, no special characters.
 * Map anything illegal to '_' and upper-case (Zemax names are case-insensitive
 * and conventionally upper-case).
 */
export function sanitizeZemaxName(name, fallback = 'MAT') {
    let s = String(name == null ? '' : name).trim().toUpperCase();
    s = s.replace(/[^A-Z0-9_.]/g, '_');
    if (s === '') s = fallback;
    if (s.length > 32) s = s.slice(0, 32);
    return s;
}

// ── MATE  ↔  TFStudio material ─────────────────────────────────────────────────

/**
 * Build a TFStudio tabular catalog material from a parsed MATE entry.
 * Flips the extinction sign (Zemax imag ≤ 0  →  TFStudio k ≥ 0).
 * @returns {object} material object (formulaNum −1, tabData [[λ_nm,n,k],…]).
 */
export function mateToTfMaterial(mate, opts = {}) {
    const pts = (mate.points || []).slice().sort((a, b) => a[0] - b[0]);
    const tabData = (pts.length ? pts : [[0.55, 1.5, 0]]).map(([lamUm, n, imag]) => [
        lamUm * 1000,                 // µm → nm
        n,
        Math.max(0, -imag),           // Zemax imag is −k; clamp tiny positive noise to 0
    ]);
    const lamMinUm = tabData[0][0] / 1000;
    const lamMaxUm = tabData[tabData.length - 1][0] / 1000;
    const name = String(mate.name || 'material').trim();
    return {
        id: sanitizeZemaxName(name).toLowerCase() || 'material',
        name,
        formulaNum: -1,
        coefficients: [],
        kTable: [],
        tabData,
        lambdaMin: lamMinUm,
        lambdaMax: lamMaxUm,
        nd: nIndexFromTab(tabData, 587.5618),
        vd: null, density: null,
        comment: opts.comment || `Imported from Zemax COATING.DAT`,
        color: null,
        group: 'Imported',
    };
}

/** Linear-interpolate n from a [[λ_nm,n,k],…] table (clamped at ends). */
function nIndexFromTab(tab, lamNm) {
    if (!tab || !tab.length) return null;
    if (lamNm <= tab[0][0]) return tab[0][1];
    const last = tab[tab.length - 1];
    if (lamNm >= last[0]) return last[1];
    let lo = 0, hi = tab.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m][0] <= lamNm) lo = m; else hi = m; }
    const f = (lamNm - tab[lo][0]) / (tab[hi][0] - tab[lo][0]);
    return tab[lo][1] + f * (tab[hi][1] - tab[lo][1]);
}

/**
 * Sample a TFStudio material into a MATE record over a wavelength grid.
 * @param {string} name       Zemax material name (already sanitised by caller, or not)
 * @param {(lamNm:number)=>[number,number]} getNK  resolver → [n, k≥0]
 * @param {number[]} gridNm   ascending wavelengths in nm
 * @returns {{name:string, points:Array<[number,number,number]>}}
 */
export function tfMaterialToMate(name, getNK, gridNm) {
    const points = gridNm.map(lamNm => {
        const [n, k] = getNK(lamNm);
        return [lamNm / 1000, n, -Math.abs(k || 0)];   // nm → µm, k → −k (Zemax sign)
    });
    return { name: sanitizeZemaxName(name), points };
}

// ── COAT  ↔  TFStudio design ───────────────────────────────────────────────────

/**
 * Convert a parsed COAT layer stack to TFStudio layers (physical nm thickness).
 *
 * @param {object} coat   {type:'layers', name, layers:[…]}
 * @param {object} resolve
 *   @param {(zemaxName:string)=>(string|null)} resolve.materialId  Zemax name → TFStudio material id
 *   @param {(zemaxName:string, lamNm:number)=>number} resolve.realIndex  real n of a Zemax material at λ
 *   @param {number} resolve.refWavelengthUm   λ₀ for relative thicknesses (default 0.55)
 *   @param {(zemaxName:string)=>boolean} [resolve.isMedium]  treat as ambient/medium (skip as a layer)
 * @returns {{layers:Array<{material:string,thickness:number,locked:boolean}>, warnings:string[]}}
 *   thickness in nm.  Layer order is preserved as written in the file
 *   (Zemax COAT order = incident-medium-side → substrate-side).
 */
export function coatToTfLayers(coat, resolve) {
    const refUm = resolve.refWavelengthUm > 0 ? resolve.refWavelengthUm : 0.55;
    const refNm = refUm * 1000;
    const warnings = [];
    const layers = [];

    for (const L of (coat.layers || [])) {
        const id = resolve.materialId(L.material);
        if (!id) {
            warnings.push(`Coating "${coat.name}": material "${L.material}" not found — layer skipped.`);
            continue;
        }
        let dNm;
        if (L.isAbsolute) {
            dNm = L.thickness * 1000;                 // µm → nm
        } else {
            // d = T · λ₀ / n₀   (Help: "The COAT Data Section")
            const n0 = resolve.realIndex(L.material, refNm);
            if (!(n0 > 0)) {
                warnings.push(`Coating "${coat.name}": no real index for "${L.material}" at λ₀ — layer skipped.`);
                continue;
            }
            dNm = (L.thickness * refUm / n0) * 1000;
        }
        layers.push({ material: id, thickness: dNm, locked: false });
    }
    return { layers, warnings };
}

/**
 * Build a COAT record from a TFStudio layer stack.
 *
 * @param {string} name       coating name
 * @param {Array<{material:string, thickness:number}>} layers  thickness in nm,
 *        order = incident-side → substrate-side (TFStudio frontLayers order)
 * @param {object} opts
 *   @param {(materialId:string)=>string} opts.zemaxName        TFStudio id → MATE name
 *   @param {'absolute'|'relative'} [opts.mode='absolute']
 *   @param {number} [opts.refWavelengthUm=0.55]                λ₀ for relative mode
 *   @param {(materialId:string, lamNm:number)=>number} [opts.realIndex]  needed for relative mode
 * @returns {{name:string, layers:Array<{material:string,thickness:number,isAbsolute:number}>}}
 */
export function tfLayersToCoat(name, layers, opts) {
    const mode = opts.mode === 'relative' ? 'relative' : 'absolute';
    const refUm = opts.refWavelengthUm > 0 ? opts.refWavelengthUm : 0.55;
    const refNm = refUm * 1000;
    const out = [];
    for (const L of (layers || [])) {
        const mat = opts.zemaxName(L.material);
        const dNm = L.thickness;
        if (mode === 'absolute') {
            out.push({ material: mat, thickness: dNm / 1000, isAbsolute: 1 });   // nm → µm
        } else {
            const n0 = opts.realIndex(L.material, refNm);
            // T = n₀ · d / λ₀   (inverse of d = T·λ₀/n₀)
            const T = (n0 > 0) ? (n0 * (dNm / 1000)) / refUm : 0;
            out.push({ material: mat, thickness: T, isAbsolute: 0 });
        }
    }
    return { name: sanitizeZemaxName(name), layers: out };
}

// ── Serialisation ──────────────────────────────────────────────────────────────

/** Format a number for the .dat file: trim, keep up to `sig` significant digits. */
function fmt(x, sig = 8) {
    if (!Number.isFinite(x)) return '0';
    if (x === 0) return '0';
    // Use a fixed-but-trimmed representation; fall back to exponential for tiny |x|.
    let s = Number(x.toPrecision(sig)).toString();
    return s;
}

/**
 * Generate COATING.DAT text from materials + coatings.
 * @param {object} doc
 *   @param {Array<{name:string, points:Array<[number,number,number]>}>} doc.materials
 *   @param {Array<{name:string, layers:Array<{material,thickness,isAbsolute}>}>} doc.coatings
 *   @param {string[]} [doc.headerComments]
 * @returns {string}
 */
export function generateZemaxCoating(doc) {
    const lines = [];
    const header = doc.headerComments || [
        'Generated by TFStudio — Zemax OpticStudio COATING.DAT export',
        'Wavelengths in micrometres; imaginary index stored as -k (Zemax convention).',
        'Coating layer order: incident-medium side -> substrate side.',
    ];
    for (const h of header) lines.push('! ' + h);
    lines.push('');

    // Build a collision-free Zemax name per ORIGINAL material name. Two distinct
    // materials whose names sanitize/truncate to the same 32-char string (e.g.
    // "SiO2-A"/"SiO2.A", or two long names sharing a prefix) would otherwise emit
    // duplicate MATE blocks AND make their coating-layer references ambiguous.
    // Keying by original name means the MATE block and every layer reference
    // resolve to the SAME unique name.
    const matNames = new Map();      // original material name → unique Zemax name
    const usedMat  = new Set();
    const uniqueMatName = (orig) => {
        if (matNames.has(orig)) return matNames.get(orig);
        const base = sanitizeZemaxName(orig);
        let s = base, k = 2;
        while (usedMat.has(s)) {
            const sfx = '_' + (k++);
            s = (base.length + sfx.length > 32 ? base.slice(0, 32 - sfx.length) : base) + sfx;
        }
        usedMat.add(s); matNames.set(orig, s);
        return s;
    };

    // Materials first — Zemax verifies every coating material is defined.
    for (const m of (doc.materials || [])) {
        lines.push(`MATE ${uniqueMatName(m.name)}`);
        const pts = (m.points || []).slice().sort((a, b) => a[0] - b[0]);
        for (const [lamUm, n, imag] of pts)
            lines.push(`${fmt(lamUm)} ${fmt(n)} ${fmt(imag)}`);
        lines.push('');
    }

    // Coatings (their names live in a separate namespace; dedupe those too).
    const usedCoat = new Set();
    const uniqueCoatName = (orig) => {
        const base = sanitizeZemaxName(orig);
        let s = base, k = 2;
        while (usedCoat.has(s)) {
            const sfx = '_' + (k++);
            s = (base.length + sfx.length > 32 ? base.slice(0, 32 - sfx.length) : base) + sfx;
        }
        usedCoat.add(s);
        return s;
    };
    for (const c of (doc.coatings || [])) {
        lines.push(`COAT ${uniqueCoatName(c.name)}`);
        for (const L of (c.layers || []))
            lines.push(`${uniqueMatName(L.material)} ${fmt(L.thickness)} ${L.isAbsolute ? 1 : 0}`);
        lines.push('');
    }

    return lines.join('\r\n');
}

// ── Convenience: default export wavelength grid ────────────────────────────────

/** Build an ascending nm grid [start..end] with `step` nm spacing (inclusive). */
export function buildGrid(startNm, endNm, stepNm) {
    const a = Math.min(startNm, endNm), b = Math.max(startNm, endNm);
    const s = stepNm > 0 ? stepNm : 10;
    const g = [];
    for (let x = a; x <= b + 1e-6; x += s) g.push(Math.round(x * 1e6) / 1e6);
    if (g.length === 0) g.push(a);
    return g;
}
