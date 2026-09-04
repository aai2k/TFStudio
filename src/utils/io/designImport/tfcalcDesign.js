/**
 * tfcalcDesign.js: TFCalc coating design (.tfd) reader.
 *
 * A .tfd file is a stream of star-delimited records, one per line. The
 * records that describe the coating:
 *   ENVIRON*λmin*λmax*step*λ0*angle*INCIDENT*SUBSTRATE*
 *   ENVIRON3*thickness_mm*EXIT*illuminant*detector*…
 *   LAYERS*N*  then  LAYER*i*MATERIAL*qwot*physical_nm*min*group*optimize*constrain*max*…
 *   LAYERS2*N* then  LAYER2*i*…                 the back side of the substrate
 *   FORMULA2*row*text*  SYMBOL*i*symbol*MATERIAL*…   the stack formula, if any
 *   VARMAT*i*NAME*n*nMin*nMax*…                  a variable-index material
 *   COMMENT*i*text*                              '~' marks a line break
 * Everything else (targets, plots, tables, sensitivity settings) describes
 * the TFCalc session, not the coating, and is skipped.
 *
 * A variable material is TFCalc's way of building rugate and graded-index
 * coatings (manual p. 28: thin layers, each with its own variable index).
 * TFStudio has no graded layer, so a design whose layers use one is refused.
 *
 * Conventions (TFCalc manual, Guide to TFCalc, p. 3 and 11):
 *   layer 1 is next to the substrate, on both sides;
 *   physical thickness is in nanometres; wavelengths are in the unit the
 *   installation is configured for (nm by default) and the file does not
 *   record it. Each LAYER record carries both the quarter waves and the
 *   physical thickness, and qwot λ0 / (4 d) is the layer's index only when
 *   λ0 is read in the right unit, so the unit is pinned by the layers unless
 *   the caller forces one (opts.wavelengthUnit 'nm' | 'um'; 'auto' or
 *   nothing lets the file decide);
 *   the substrate thickness is in millimetres;
 *   when the exit medium is the substrate material the substrate is
 *   semi-infinite; any other exit medium means TFCalc evaluates both
 *   surfaces of the substrate.
 *
 * Output is the neutral imported-design description shared with the
 * Essential Macleod reader: layers in TFStudio storage order (front stack
 * incident-medium first, back stack substrate first) with physical
 * thicknesses in nm and material names as the file spells them.
 */

// Record keys TFCalc 3.5 writes.
const RECORD_KEYS = new Set([
    'VERSION', 'ENVIRON', 'ENVIRON2', 'ENVIRON3', 'FORMULA', 'FORMULA2', 'SYMBOL', 'GROUPS', 'GROUP',
    'LAYERS', 'LAYER', 'LAYERS2', 'LAYER2', 'TARGETS', 'TARGET', 'TARGET2', 'TARGET3', 'TARGET4', 'TARGET5',
    'AUTOTARG', 'VARMATS', 'VARMAT', 'MIXMATS', 'MIXMAT', 'ENVIRNS', 'ENVIRN', 'PLOT', 'PLOT2', 'PLOT3', 'PLOT4',
    'OVERPLT', 'OVERPLT2', 'OVERPLT3', 'OVERPLT4', 'TABLE', 'TABLE2', 'TABLE3', 'EFI-COMP', 'EFIPLOT', 'EFIPLOT2',
    'TGDATA', 'TGDATA2', 'TGDATA3', 'TGDATA4', 'TGDATA5', 'TGDATA6', 'TRDATA', 'TRDATA2', 'TRDATA3', 'TRDATA4',
    'TRDATA5', 'TRDATA6', 'TDDATA', 'TDDATA2', 'TDDATA3', 'TDDATA4', 'TDDATA5', 'TDDATA6', 'SSDATA', 'CCDATA',
    'EIDATA', 'ESDATA', 'CTDATA', 'CADATA', 'GSDATA', 'STDATA', 'MNDATA', 'MNDATA2', 'COMMENTS', 'COMMENT', 'EOF',
]);

// One record per line: the line's first star-delimited token is the key, the
// rest are its fields. A line starting with anything else is a record this
// reader does not know and is skipped, and a key word inside a comment stays
// text, since only the first token of a line can open a record.
function records(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
        const tokens = line.split('*');
        const key = tokens[0].trim();
        if (!RECORD_KEYS.has(key)) continue;
        // The star that closes the record leaves an empty last token.
        if (tokens.length > 1 && tokens[tokens.length - 1].trim() === '') tokens.pop();
        out.push({ key, fields: tokens.slice(1).map(s => s.trim()) });
        if (key === 'EOF') break;
    }
    return out;
}

const num = v => (v == null || v === '') ? NaN : Number(v);

// Index range a layer's qwot λ0 / (4 d) falls in when λ0 is read in the
// right unit. Wide enough for metals and semiconductors; a wrong unit puts
// the value a thousand times off.
const INDEX_RANGE = [0.3, 20];

// Wavelength unit the layers pin: 'nm', 'um', or null when no layer carries
// both a quarter-wave value and a thickness, or the values fit neither.
function unitFromLayers(layerFields, lambda0) {
    const implied = layerFields
        .map(f => [num(f[2]), num(f[3])])
        .filter(([qwot, d]) => qwot > 0 && d > 0)
        .map(([qwot, d]) => qwot * lambda0 / (4 * d))
        .sort((a, b) => a - b);
    if (!implied.length || !(lambda0 > 0)) return null;
    const median = implied[Math.floor(implied.length / 2)];
    const fits = n => n >= INDEX_RANGE[0] && n <= INDEX_RANGE[1];
    if (fits(median)) return 'nm';
    if (fits(median * 1000)) return 'um';
    return null;
}

function layerFromRecord(fields, fileName, side) {
    const material = fields[1];
    const thicknessNm = num(fields[3]);
    if (!material || !Number.isFinite(thicknessNm)) {
        throw new Error(`"${fileName}": ${side} layer ${fields[0]} has no material or thickness`);
    }
    return {
        material,
        thicknessNm,
        optical: Number.isFinite(num(fields[2])) ? { kind: 'qwot', value: num(fields[2]) } : null,
        locked: fields[6] === 'N',
    };
}

/**
 * @param {string} text      file content
 * @param {string} fileName  used for the design name and messages
 * @param {{ wavelengthUnit?: 'auto'|'nm'|'um' }} [opts]
 * @returns {object} imported-design description (see designFileImport.js)
 */
export function parseTFCalcDesign(text, fileName, opts = {}) {
    const recs = records(text);
    const has = key => recs.some(r => r.key === key);
    if (!has('VERSION') || !has('ENVIRON') || !has('LAYERS')) {
        throw new Error(`"${fileName}" is not a TFCalc design file`);
    }
    const one = key => recs.find(r => r.key === key)?.fields || [];
    const all = key => recs.filter(r => r.key === key).map(r => r.fields);
    // The file numbers layers from the substrate; records are taken in that
    // order whatever order they were written in.
    const layerRecords = key => all(key)
        .map(f => ({ n: num(f[0]), f }))
        .sort((a, b) => a.n - b.n)
        .map(x => x.f);

    const env = one('ENVIRON');
    const env3 = one('ENVIRON3');
    const notes = [];
    const detected = unitFromLayers([...layerRecords('LAYER'), ...layerRecords('LAYER2')], num(env[3]));
    const chosen = opts.wavelengthUnit === 'nm' || opts.wavelengthUnit === 'um' ? opts.wavelengthUnit : null;
    const unit = chosen || detected || 'nm';
    if (chosen && detected && detected !== chosen) notes.push({ code: 'unitMismatch', chosen, detected });
    else if (!chosen && detected === 'um') notes.push({ code: 'unitDetected', unit: 'um' });
    const toNm = unit === 'um' ? w => w * 1000 : w => w;

    const referenceWavelengthNm = toNm(num(env[3]));
    if (!(referenceWavelengthNm > 0)) throw new Error(`"${fileName}" has no reference wavelength`);
    const incidentMedium = env[5] || 'AIR';
    const substrate = env[6];
    if (!substrate) throw new Error(`"${fileName}" names no substrate`);
    const exitMedium = env3[1] || substrate;
    const substrateThicknessMm = Number.isFinite(num(env3[0])) ? num(env3[0]) : null;

    // The front stack is stored the other way round, the back stack as it is.
    const frontFile = layerRecords('LAYER').map(f => layerFromRecord(f, fileName, 'front'));
    const back = layerRecords('LAYER2').map(f => layerFromRecord(f, fileName, 'back'));
    const front = frontFile.slice().reverse();
    if (front.length === 0 && back.length === 0) throw new Error(`"${fileName}" has no layers`);

    const symbols = {};
    for (const f of all('SYMBOL')) if (f[1] && f[2]) symbols[f[1]] = f[2];
    const formulaRows = all('FORMULA2').sort((a, b) => num(a[0]) - num(b[0])).map(f => f.slice(1).join('*'));
    const formula = (formulaRows.length ? formulaRows.join('') : one('FORMULA').join('*')).trim() || null;

    const variable = new Set(all('VARMAT').map(f => f[1]).filter(Boolean));
    const graded = [...front, ...back].find(l => variable.has(l.material));
    if (graded) {
        throw new Error(`"${fileName}" uses the variable material ${graded.material}, TFCalc's rugate and graded-index mechanism, which TFStudio does not model`);
    }
    const comments = all('COMMENT').map(f => f.slice(1).join('*').replace(/~/g, '\n').trim()).filter(Boolean);
    const targetCount = all('TARGET5').length + all('TARGET4').length + all('TARGET3').length
        + all('TARGET2').length + all('TARGET').length + all('AUTOTARG').length;
    if (targetCount > 0) notes.push({ code: 'targets', count: targetCount });
    const environments = num(one('ENVIRNS')[0]);
    if (environments > 1) notes.push({ code: 'environments', count: environments });
    const angleDeg = Number.isFinite(num(env[4])) ? num(env[4]) : 0;

    const lo = toNm(num(env[0])), hi = toNm(num(env[1]));
    return {
        name: fileName.replace(/\.[^.]*$/, ''),
        program: 'tfcalc',
        file: fileName,
        referenceWavelengthNm,
        wavelengthUnit: unit,
        incidentMedium,
        substrate,
        substrateThicknessMm,
        exitMedium,
        // TFCalc evaluates the back surface of the substrate whenever the
        // exit medium is not the substrate itself (manual p. 11).
        backSurface: exitMedium !== substrate,
        front,
        back,
        angleDeg,
        matchAngleDeg: 0,
        matchMedium: 1,
        formula,
        symbols,
        constants: Object.create(null),
        embedded: Object.create(null),
        comments,
        notes,
        spectrum: lo > 0 && hi > lo ? { fromNm: lo, toNm: hi } : null,
    };
}
