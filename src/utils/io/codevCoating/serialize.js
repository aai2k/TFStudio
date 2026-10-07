import { fmtNum, quote, wrapValues } from './format.js';
import { makeLabeler } from './labels.js';
import { pickMicRows } from './micPoints.js';

/**
 * Limits of the CODE V MUL option, from the MDA sub-option page of the
 * Multilayer Design Reference Manual: COA up to 1000 layers, WL and WLG
 * together up to 100 wavelengths, ANG up to 5 angles, MWL up to 21 points,
 * TIT up to 80 characters. One WL, MWL, 'label' n or EXT command reads at
 * most 21 values: CODE V 11.2 ignores the rest with "Extra data ...
 * ignored", so a longer wavelength list is written as several WL commands.
 */
export const CODEV_LIMITS = { layers: 1000, wavelengths: 100, angles: 5, micPoints: 21, title: 80, valuesPerCommand: 21 };

/** A stack the MUL option cannot hold. `detail` carries the count and limit, or the material. */
export class CodevExportError extends Error {
    constructor(kind, detail) {
        super(`CODE V export: ${kind}`);
        this.name = 'CodevExportError';
        this.kind = kind;
        this.detail = detail;
    }
}

// Decimals written: wavelength and angle, n and k, thickness in nm.
const WL = 4, NK = 6, THICK = 4;

function checkLimits(counts) {
    for (const [kind, count] of Object.entries(counts)) {
        const limit = CODEV_LIMITS[kind];
        if (count > limit || (kind === 'wavelengths' && count === 0)) {
            throw new CodevExportError(kind, { count, limit });
        }
    }
}

const written = (x) => fmtNum(x, NK);
const isConstant = (rows) => rows.every(r => written(r[1]) === written(rows[0][1]) && written(r[2]) === written(rows[0][2]));
const absorbs = (rows) => rows.some(r => written(r[2]) !== '0');

// n and k of one material at the analysis wavelengths, as [λ_nm, n, k] rows.
// A wavelength with no index (a formula at a pole) is left out.
function sampleRows(getNK, wavelengthsNm) {
    return wavelengthsNm
        .map((lam) => { const [n, k] = getNK(lam); return [lam, n, Math.abs(k || 0)]; })
        .filter(([, n]) => Number.isFinite(n));
}

// The Multilayer Index Catalog of the export: one entry per dispersive
// material, keyed by material id, and the warnings raised while filling it.
function newCatalog(opts) {
    return { opts, labelFor: makeLabeler(), entries: new Map(), warnings: [] };
}

function addEntry(catalog, key, name, rows) {
    const picked = pickMicRows(rows, CODEV_LIMITS.micPoints);
    if (picked.length < rows.length) catalog.warnings.push({ kind: 'resampled', material: name, from: rows.length, to: picked.length });
    catalog.entries.set(key, { label: catalog.labelFor(name), rows: picked });
}

// The rows of material `id` at the analysis wavelengths. INC and SUB
// (`medium` 'incident' or 'substrate') take n only, so an absorbing medium
// loses its k with a warning.
function mediumRows(catalog, id, name, medium) {
    const { getNK, wavelengthsNm } = catalog.opts;
    const rows = sampleRows((lam) => getNK(id, lam), wavelengthsNm);
    if (!rows.length) throw new CodevExportError('noIndex', { material: name });
    if (!medium || !absorbs(rows)) return { rows, dropK: false };
    catalog.warnings.push({ kind: 'mediumAbsorbs', role: medium, material: name });
    return { rows: rows.map(([lam, n]) => [lam, n, 0]), dropK: true };
}

// The index text a COA, INC or SUB line refers to material `id` by: its n
// (and k on a COA line) when constant, else its quoted MIC label.
function refer(catalog, id, medium) {
    const name = catalog.opts.materialName(id);
    const { rows, dropK } = mediumRows(catalog, id, name, medium);
    if (isConstant(rows)) {
        const [, n, k] = rows[0];
        return absorbs(rows) ? `${written(n)} ${written(k)}` : written(n);
    }
    const key = dropK ? `${id}\u0000n` : id;
    if (!catalog.entries.has(key)) addEntry(catalog, key, name, rows);
    return quote(catalog.entries.get(key).label);
}

// MIC ... END, with an MWL line wherever the wavelengths change.
function micLines(catalog) {
    if (!catalog.entries.size) return [];
    const lines = ['MIC'];
    let lastMwl = '';
    for (const { label, rows } of catalog.entries.values()) {
        const mwl = rows.map(r => fmtNum(r[0], WL));
        if (mwl.join(' ') !== lastMwl) lines.push(...wrapValues('  MWL', mwl));
        lastMwl = mwl.join(' ');
        lines.push(...wrapValues(`  ${quote(label)}`, rows.map(r => written(r[1]))));
        if (absorbs(rows)) lines.push(...wrapValues(`  EXT ${quote(label)}`, rows.map(r => written(r[2]))));
    }
    lines.push('END');
    return lines;
}

// The analysis wavelengths as WL commands of at most 21 values each.
function wlLines(wavelengthsNm) {
    const lines = [];
    for (let i = 0; i < wavelengthsNm.length; i += CODEV_LIMITS.valuesPerCommand) {
        const chunk = wavelengthsNm.slice(i, i + CODEV_LIMITS.valuesPerCommand).map(w => fmtNum(w, WL));
        lines.push(...wrapValues('WL', chunk));
    }
    return lines;
}

/**
 * Write a coating as a CODE V MUL command file (.seq).
 *
 * Running the file in CODE V enters the stack in MDA and ends with SAV, which
 * writes the .mul that MLT attaches to a lens surface. Thicknesses are
 * physical, in nm (PHT Y). A material whose n and k do not change over the
 * analysis wavelengths is written on its COA line; any other goes into the
 * Multilayer Index Catalog (MIC) sampled at those wavelengths, cut to 21
 * points by pickMicRows when there are more. INC and SUB take a real index
 * only, so the k of an absorbing medium is dropped with a warning.
 *
 * @param {object} opts
 *   @param {string} opts.title                TIT, up to 80 characters
 *   @param {string} opts.saveName             .mul file name for SAV
 *   @param {Array<{material:string, thickness:number, locked?:boolean}>} opts.layers
 *          incident side first, thickness in nm; a locked layer is frozen (code 100),
 *          any other varies on its own (code 0)
 *   @param {string} opts.incident             material id of the incident medium
 *   @param {string} opts.substrate            material id of the substrate
 *   @param {number[]} opts.wavelengthsNm      analysis wavelengths, ascending, nm
 *   @param {number[]} [opts.anglesDeg=[0]]    angles of incidence in the incident medium, degrees
 *   @param {number} opts.refNm                REF, nm
 *   @param {(id:string)=>string} opts.materialName
 *   @param {(id:string, lamNm:number)=>[number,number]} opts.getNK   n and k ≥ 0
 * @returns {{text:string, warnings:Array<object>}}
 * @throws {CodevExportError} past a MUL limit, or for a material with no index
 */
export function buildCodevSeq(opts) {
    const layers = (opts.layers || []).filter(L => L.thickness > 0);
    const anglesDeg = opts.anglesDeg?.length ? opts.anglesDeg : [0];
    checkLimits({ layers: layers.length, wavelengths: opts.wavelengthsNm.length, angles: anglesDeg.length });

    const catalog = newCatalog(opts);
    const inc = refer(catalog, opts.incident, 'incident');
    const coa = layers.map(L => `COA ${fmtNum(L.thickness, THICK)} ${L.locked ? 100 : 0} ${refer(catalog, L.material, null)}`);
    const sub = refer(catalog, opts.substrate, 'substrate');
    const title = String(opts.title || '').replace(/'/g, '').slice(0, CODEV_LIMITS.title) || 'TFStudio coating';
    const saveName = String(opts.saveName || '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'coating';

    const lines = [
        `! ${title}`,
        '! Written by TFStudio. Layers run from the incident medium to the substrate,',
        '! thicknesses are physical, in nm. SAV at the end writes the .mul file.',
        'MUL',
        'MDA',
        'PHT Y',
        `TIT ${quote(title)}`,
        ...micLines(catalog),
        `INC ${inc}`,
        ...coa,
        `SUB ${sub}`,
        ...wlLines(opts.wavelengthsNm),
        `REF ${fmtNum(opts.refNm, WL)}`,
        `ANG ${anglesDeg.map(a => fmtNum(a, WL)).join(' ')}`,
        `SAV ${saveName}`,
        'MEX',
    ];
    return { text: lines.join('\r\n') + '\r\n', warnings: catalog.warnings };
}
