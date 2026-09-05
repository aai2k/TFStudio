/**
 * buildDesign.js: an imported-design description plus a material mapping
 * becomes a TFStudio design object.
 *
 * The mapping gives a TFStudio material id for each source name. When the
 * mapping has nothing for a name, a definition that came with the file's
 * folder is embedded, and so is a constant index the source uses as a
 * material. Layers given as optical thickness get their physical thickness
 * from the resolved material's index at the reference wavelength, at the
 * match angle the file defines them at. Names still unresolved come back in
 * `unresolved`, and the design carries them as `missing:<name>` ids: they
 * resolve nowhere, so the Design Editor reports them as missing rather than
 * computing them as air, and a bare name that happens to be a built-in id is
 * not taken for it.
 *
 * The design's notes and the warnings are worded through the import
 * strings of the active locale (`di` = t.designImport).
 */

import { getMaterialById } from '../../materials/catalogManager.js';
import { sanitizeId } from '../../materials/optilayerParser/idUtils.js';
import { constantIndexRecord, EMBEDDED_PREFIX, getNKOf } from './materialResolution.js';
import { constantIndexOf, embeddedDefinition } from './designFileImport.js';
import { qwotToNm } from './optilayerDesign.js';

export const MISSING_PREFIX = 'missing:';

function stamp() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Wording of a reader note ({ code, … }) in the active locale. */
export function importNoteText(note, di) {
    switch (note.code) {
        case 'targets':             return di.noteTargets(note.count);
        case 'environments':        return di.noteEnvironments(note.count);
        case 'unitDetected':        return di.noteUnitDetected;
        case 'unitMismatch':        return di.noteUnitMismatch(di.unitName[note.chosen], di.unitName[note.detected]);
        case 'unitAssumed':         return di.noteUnitAssumed;
        case 'linkedLayers':        return di.noteLinkedLayers(note.count);
        case 'matchAngle':          return di.noteMatchAngle(note.angleDeg, note.medium);
        case 'obliqueNotApplied':   return di.noteObliqueNotApplied(note.count);
        case 'unindexed':           return di.noteUnindexed(note.count);
        case 'noMedium':            return di.noteNoMedium(note.which === 'exit' ? di.mediumExit : di.mediumIncident, note.assumed);
        case 'substrateFromFolder': return di.noteSubstrateFromFolder(note.name);
        case 'noSubstrate':         return di.noteNoSubstrate;
        case 'materialsFromDatabase': return di.noteMaterialsFromDatabase(note.count, note.dir);
        case 'noDatabase':          return di.noteNoDatabase;
        case 'databaseUnused':      return di.noteDatabaseUnused(note.dir);
        default:                    return String(note.code);
    }
}

/** Wording of a build warning ({ code, side, index, material, … }) in the active locale. */
export function importWarningText(warning, di) {
    const side = warning.side === 'back' ? di.sideBack : di.sideFront;
    switch (warning.code) {
        case 'noIndex':           return di.warnNoIndex(side, warning.index, warning.material, warning.lambdaNm);
        case 'obliqueNotApplied': return di.warnObliqueNotApplied(side, warning.index, warning.material);
        default:                  return String(warning.code);
    }
}

function notesText(item, di) {
    const lines = [];
    if (item.comments.length) lines.push(...item.comments, '');
    lines.push(di.noteImportedFrom(item.file, di.programName[item.program] || item.program));
    if (item.formula) lines.push(di.noteFormula(item.formula));
    const symbols = Object.entries(item.symbols || {});
    if (symbols.length) lines.push(di.noteSymbols(symbols.map(([s, m]) => `${s} = ${m}`).join(', ')));
    if (item.angleDeg) lines.push(di.noteAngle(item.angleDeg));
    lines.push(...item.notes.map(note => importNoteText(note, di)));
    return lines.join('\n');
}

/**
 * @param {object} item     imported-design description (designFileImport.js)
 * @param {(name: string) => string|null} resolve  source name → TFStudio id, or null
 * @param {object} di       t.designImport of the active locale
 * @returns {{ design: object, unresolved: string[], warnings: object[] }}
 */
export function buildImportedDesign(item, resolve, di) {
    const materials = {};
    const unresolved = new Set();
    const warnings = [];
    const lam0 = item.referenceWavelengthNm;

    // Id of an embedded record for a source name. Two names can sanitize to
    // the same id ("Ag (Silver)" and "Ag Silver"), so an id already taken by
    // another name gets a suffix.
    const embeddedIds = new Map();
    const embeddedIdFor = (name) => {
        if (embeddedIds.has(name)) return embeddedIds.get(name);
        const base = EMBEDDED_PREFIX + sanitizeId(name);
        let id = base;
        for (let k = 2; Object.hasOwn(materials, id); k++) id = `${base}_${k}`;
        embeddedIds.set(name, id);
        return id;
    };

    // Id for a source name: the mapping, else a definition from the file's
    // folder, else a constant, else a placeholder reported as unresolved.
    const idFor = (name) => {
        const mapped = resolve(name);
        if (mapped) return mapped;
        const definition = embeddedDefinition(item, name);
        if (definition) {
            const id = embeddedIdFor(name);
            // eslint-disable-next-line no-unused-vars
            const { getNK, ...record } = definition;
            materials[id] = record;
            return id;
        }
        const constant = constantIndexOf(item, name);
        if (constant) {
            const record = constantIndexRecord(constant.n, constant.k);
            materials[record.id] = record;
            return record.id;
        }
        unresolved.add(name);
        return MISSING_PREFIX + name;
    };
    const materialOf = (id) => materials[id] || getMaterialById(id);

    const convert = (layers, side, s) => layers.map((layer, i) => {
        const material = idFor(layer.material);
        let thickness = layer.thicknessNm;
        if (thickness == null) {
            const nk = materialOf(material) ? getNKOf(materialOf(material)) : null;
            const n = nk ? nk(lam0)[0] : NaN;
            const optical = layer.optical;
            if (optical && n > 0) {
                if (optical.kind === 'qwot') {
                    thickness = qwotToNm(optical.value, lam0, n, optical.angleDeg, optical.matchMedium);
                    if (thickness == null) {
                        thickness = qwotToNm(optical.value, lam0, n);
                        warnings.push({ code: 'obliqueNotApplied', side, index: i + 1, material: layer.material });
                    }
                } else {
                    thickness = optical.value * lam0 / n;
                }
            } else {
                thickness = 0;
                warnings.push({ code: 'noIndex', side, index: i + 1, material: layer.material, lambdaNm: lam0 });
            }
        }
        return { id: `imp-${s}-${side[0]}${i}`, material, thickness, locked: !!layer.locked };
    });

    const s = stamp();
    const frontLayers = convert(item.front, 'front', s);
    const backLayers = convert(item.back, 'back', s);
    const substrateId = idFor(item.substrate);
    const surfaceMode = frontLayers.length === 0 ? 'back_only' : backLayers.length > 0 ? 'both_independent' : 'front_only';
    const design = {
        id: `design-${s}`,
        name: item.name,
        incidentMedium: idFor(item.incidentMedium),
        substrate: { material: substrateId, thickness: item.substrateThicknessMm ?? 1.0 },
        exitMedium: item.exitMedium ? idFor(item.exitMedium) : substrateId,
        surfaceMode,
        // A program that evaluated both surfaces of the substrate for this
        // design gets the same evaluation here; a semi-infinite substrate
        // keeps the single-surface mode.
        mfEvalMode: item.backSurface ? 'total' : 'side',
        frontLayers,
        backLayers,
        referenceWavelength: lam0,
        notes: notesText(item, di),
    };
    if (Object.keys(materials).length) design.materials = materials;
    return { design, unresolved: [...unresolved], warnings };
}
