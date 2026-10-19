// Designs as files and as new objects. A design is the plain object the app
// stores and a .tfs file holds; every call that changes one returns a new one.

import fs from 'node:fs';
import path from 'node:path';
import { withFollowedCopies } from '../utils/materials/catalogStamps.js';
import { embedDesignMaterials } from '../utils/materials/designMaterials.js';
import { makeDefaultDesign, ensureLayerIds } from '../utils/io/newDesign.js';
import { mirrorLayers } from '../utils/physics/optimizer.js';
import { rescaleLayersPreserveQWOT } from '../components/windows/design/designEditor/units.js';
import designFile from '../main/designFile.js';
import mainPaths from '../main/paths.js';
import { requireMaterial } from './materials.js';
import { checkOptions, requireValue, isPositive } from './check.js';

const { readDesignFile, serializeDesign } = designFile;
const { writeFileAtomic } = mainPaths;

/**
 * The design in the .tfs at `filePath`, as File > Open reads it: the file's
 * checks and fixups (src/main/designFile.js), then the material copies the
 * catalogs here follow (catalogStamps.js). A design without a name of its own
 * is named after its file. Throws when the file cannot be read or is not a
 * usable design.
 */
export function openDesign(filePath) {
    const read = readDesignFile(fs, filePath);
    if (read.error) throw new Error(`${filePath}: ${read.error}`);
    const design = withFollowedCopies(read.design);
    const name = (design.name && String(design.name).trim()) || path.basename(filePath, path.extname(filePath));
    return { ...design, name, frontLayers: ensureLayerIds(design.frontLayers), backLayers: ensureLayerIds(design.backLayers) };
}

/**
 * Writes `design` to `filePath` as the app saves it: the non-built-in
 * materials it uses embedded, in this build's format, through the same atomic
 * write. A file already there is written over only with { overwrite: true }.
 */
export function saveDesign(design, filePath, options) {
    const { overwrite = false } = checkOptions('saveDesign', options, ['overwrite']);
    if (!overwrite && fs.existsSync(filePath)) throw new Error(`${filePath} exists; pass { overwrite: true } to write over it`);
    writeFileAtomic(filePath, serializeDesign(embedDesignMaterials(design)), 'utf-8');
}

const SIDES = { front: 'frontLayers', back: 'backLayers' };
const SURFACE_MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];

const EVAL_MODES = ['side', 'total'];
const SETUP = ['name', 'incidentMedium', 'exitMedium', 'substrate', 'substrateThicknessMm', 'surfaceMode', 'mfEvalMode', 'referenceWavelength'];

function checkSetup(call, { name, surfaceMode, mfEvalMode, substrate, referenceWavelength }) {
    requireValue(call, 'name', name, v => typeof v === 'string' && v.trim() !== '', 'a name');
    requireValue(call, 'surfaceMode', surfaceMode, v => SURFACE_MODES.includes(v), `one of ${SURFACE_MODES.join(', ')}`);
    requireValue(call, 'mfEvalMode', mfEvalMode, v => EVAL_MODES.includes(v), "'side' (a one-sided design scored on its coated side alone) or 'total' (as the whole part)");
    requireValue(call, 'substrateThicknessMm', substrate.thickness, isPositive, 'a thickness in mm above 0');
    requireValue(call, 'referenceWavelength', referenceWavelength, isPositive, 'a wavelength in nm above 0');
}

// `design` with `setup` applied, as the Design Editor applies it: a new
// reference wavelength rescales every layer to keep its quarter-wave count
// (designEditor/units.js), and a symmetric design's back is the mirror of its
// front.
function withSetup(call, design, setup) {
    const next = {
        ...design,
        ...(setup.name !== undefined ? { name: setup.name } : {}),
        incidentMedium: setup.incidentMedium ?? design.incidentMedium,
        exitMedium: setup.exitMedium ?? design.exitMedium,
        substrate: {
            ...design.substrate,
            material: setup.substrate ?? design.substrate.material,
            thickness: setup.substrateThicknessMm ?? design.substrate.thickness,
        },
        surfaceMode: setup.surfaceMode ?? design.surfaceMode ?? 'front_only',
        mfEvalMode: setup.mfEvalMode ?? design.mfEvalMode ?? 'side',
        referenceWavelength: setup.referenceWavelength ?? design.referenceWavelength ?? 550,
    };
    checkSetup(call, next);
    for (const id of [next.incidentMedium, next.exitMedium, next.substrate.material]) requireMaterial(next, id);
    const was = design.referenceWavelength;
    if (was > 0 && next.referenceWavelength !== was) {
        next.frontLayers = rescaleLayersPreserveQWOT(design.frontLayers || [], was, next.referenceWavelength, design.materials);
        next.backLayers = rescaleLayersPreserveQWOT(design.backLayers || [], was, next.referenceWavelength, design.materials);
    }
    return next.surfaceMode === 'symmetric' ? { ...next, backLayers: mirrorLayers(next.frontLayers || []) } : next;
}

/**
 * A new design as the app makes one (a bare BK7 substrate, 1 mm, in air),
 * with any of `name`, `incidentMedium`, `exitMedium`, `substrate` (material
 * ids), `substrateThicknessMm`, `surfaceMode`, `mfEvalMode` and
 * `referenceWavelength` (nm) changed. Every material named must resolve.
 */
export function newDesign(options) {
    const setup = checkOptions('newDesign', options, SETUP);
    return withSetup('newDesign', makeDefaultDesign(setup.name ?? 'New Design'), setup);
}

/**
 * `design` with any of the settings newDesign takes changed: its name, media,
 * substrate and its thickness, which sides it has (surfaceMode: 'front_only',
 * 'back_only', 'both_independent' or 'symmetric', whose back then mirrors the
 * front), how a one-sided design is scored (mfEvalMode 'side' or 'total') and
 * its reference wavelength in nm, which rescales every layer to keep its
 * quarter-wave count, as the Design Editor's λ0 field does.
 */
export function setDesignSetup(design, options) {
    return withSetup('setDesignSetup', design, checkOptions('setDesignSetup', options, SETUP));
}

/** The layer list key of `side` ('front' or 'back'). */
export function sideKey(side) {
    const key = SIDES[side];
    if (!key) throw new Error(`side is 'front' or 'back', not '${side}'`);
    return key;
}
