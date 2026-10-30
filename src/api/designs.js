// Designs as files and as new objects. A design is the plain object the app
// stores and a .tfs file holds; every call that changes one returns a new one.

import fs from 'node:fs';
import path from 'node:path';
import { withFollowedCopies } from '../utils/materials/catalogStamps.js';
import { embedDesignMaterials } from '../utils/materials/designMaterials.js';
import { makeDefaultDesign, ensureLayerIds } from '../utils/io/newDesign.js';
import { mirrorLayers } from '../utils/physics/optimizer.js';
import { rescaleLayersPreserveQWOT } from '../components/windows/design/designEditor/units.js';
import { stressBlockWith } from '../components/windows/analysis/stressAnalysis/model.js';
import designFile from '../main/designFile.js';
import mainPaths from '../main/paths.js';
import { requireMaterial } from './materials.js';
import { checkOptions, requireValue, isPositive, refusal } from './check.js';

const { readDesignFile, serializeDesign } = designFile;
const { writeFileAtomic } = mainPaths;

/**
 * Reads a design from a .tfs file as File > Open reads it, with the same
 * checks and repairs. A design with no name of its own takes its file's name.
 *
 * @param filePath The .tfs file, by its full path.
 * @returns The design: the fields `newDesign` returns, and what the file holds besides, such as its merit function in `meritOperands`.
 * @throws a file that cannot be read or does not hold a usable design
 * @example
 * const file = require('path').join(require('os').homedir(), `example-${Date.now()}.tfs`);
 * tf.saveDesign(tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' }), file);
 * const design = tf.openDesign(file);
 * console.log(design.name, design.frontLayers.length, 'layers, from', file);
 */
export function openDesign(filePath) {
    // The file's checks and fixups (src/main/designFile.js), then the material
    // copies the catalogs here follow (catalogStamps.js).
    const read = readDesignFile(fs, filePath);
    if (read.error) throw new Error(`${filePath}: ${read.error}`);
    const design = withFollowedCopies(read.design);
    const name = (design.name && String(design.name).trim()) || path.basename(filePath, path.extname(filePath));
    return { ...design, name, frontLayers: ensureLayerIds(design.frontLayers), backLayers: ensureLayerIds(design.backLayers) };
}

/**
 * Writes a design to a .tfs file as the app saves it, with the materials it
 * uses that are not built in carried inside the file.
 *
 * @param design The design.
 * @param filePath The file to write, by its full path.
 * @param [options]
 * @param [options.overwrite=false] Write over a file that is already there.
 * @throws a file that is already there, without `overwrite`
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const file = require('path').join(require('os').homedir(), 'saved.tfs');
 * try {
 *     tf.saveDesign(design, file);
 *     console.log('Saved', file);
 * } catch (err) {
 *     console.log(err.message);
 * }
 */
export function saveDesign(design, filePath, options) {
    // The app's own format and atomic write (src/main/designFile.js, paths.js).
    const { overwrite = false } = checkOptions('saveDesign', options, ['overwrite']);
    if (!overwrite && fs.existsSync(filePath)) {
        throw refusal('fileExists', { call: 'saveDesign', path: filePath }, `${filePath} exists; pass { overwrite: true } to write over it`);
    }
    writeFileAtomic(filePath, serializeDesign(embedDesignMaterials(design)), 'utf-8');
}

const SIDES = { front: 'frontLayers', back: 'backLayers' };
const SURFACE_MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];

const EVAL_MODES = ['side', 'total'];
const SETUP = [
    'name', 'incidentMedium', 'exitMedium', 'substrate', 'substrateThicknessMm', 'surfaceMode', 'mfEvalMode', 'referenceWavelength',
    'stressTemperatureC', 'depositionTemperatureC', 'substrateDiameterMm',
];
// The Stress window's temperature fields by setDesignSetup's names, each a
// field of the design's `stress` block.
const TEMPERATURES = { stressTemperatureC: 'temperatureC', depositionTemperatureC: 'depositionTemperatureC' };
const isTemperatureOrNull = v => v === null || (Number.isFinite(v) && v > -273.15);
const isDiameterOrNull = v => v === null || isPositive(v);

// `next` with the stress run and the substrate's diameter `setup` gives, as
// the Stress window's fields write them: null unsets a value, and unsetting
// the last temperature removes the design's stress block (stressBlockWith).
function applyStressSetup(call, next, setup) {
    const changes = {};
    for (const [option, field] of Object.entries(TEMPERATURES)) {
        if (setup[option] === undefined) continue;
        requireValue(call, option, setup[option], isTemperatureOrNull, 'a temperature in °C above -273.15, or null to unset it');
        changes[field] = setup[option];
    }
    if (setup.substrateDiameterMm !== undefined) {
        requireValue(call, 'substrateDiameterMm', setup.substrateDiameterMm, isDiameterOrNull, 'a diameter in mm above 0, or null to unset it');
        next.substrate.diameterMm = setup.substrateDiameterMm;
    }
    if (!Object.keys(changes).length) return;
    const stress = stressBlockWith(next.stress, changes);
    if (stress) next.stress = stress;
    else delete next.stress;
}

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
    applyStressSetup(call, next, setup);
    for (const id of [next.incidentMedium, next.exitMedium, next.substrate.material]) requireMaterial(next, id);
    const was = design.referenceWavelength;
    if (was > 0 && next.referenceWavelength !== was) {
        next.frontLayers = rescaleLayersPreserveQWOT(design.frontLayers || [], was, next.referenceWavelength, design.materials);
        next.backLayers = rescaleLayersPreserveQWOT(design.backLayers || [], was, next.referenceWavelength, design.materials);
    }
    return next.surfaceMode === 'symmetric' ? { ...next, backLayers: mirrorLayers(next.frontLayers || []) } : next;
}

/**
 * A new design as the app makes one, a bare substrate with no layers, with
 * any of these settings changed.
 *
 * @param [options]
 * @param [options.name='New Design'] The design's name.
 * @param [options.incidentMedium='Air'] The medium the light comes from, by material id.
 * @param [options.exitMedium='Air'] The medium behind the substrate, by material id.
 * @param [options.substrate='BK7'] The substrate material, by id.
 * @param [options.substrateThicknessMm=1] The substrate thickness, mm.
 * @param [options.surfaceMode='front_only'] Which sides carry layers: `'front_only'`, `'back_only'`, `'both_independent'`, or `'symmetric'`, whose back mirrors its front. The [evaluation modes](/design/evaluation-modes/) page explains them.
 * @param [options.mfEvalMode='side'] How a one-sided design is scored: `'side'`, its coated side alone, or `'total'`, the whole part.
 * @param [options.referenceWavelength=550] The reference wavelength, nm, at which stack formulas count quarter waves.
 * @param [options.stressTemperatureC=null] The temperature the [Stress](/analysis/stress/) window evaluates the part at, °C, above -273.15, or null to leave it unset. While only the deposition temperature is set, it reads 20 °C.
 * @param [options.depositionTemperatureC=null] The temperature the films were deposited at, °C, above -273.15, or null to leave it unset. While only the other temperature is set, it reads 20 °C. With neither set, each film carries its intrinsic stress alone.
 * @param [options.substrateDiameterMm=null] The substrate's diameter, mm, above 0, which only the Stress window's centre deflection needs, or null to leave it unset.
 * @returns The design.
 * @property id The design's own id.
 * @property name Its name.
 * @property incidentMedium The medium the light comes from, by material id.
 * @property exitMedium The medium behind the substrate, by material id.
 * @property substrate `{ material, thickness }`, the thickness in mm, and `diameterMm` once `substrateDiameterMm` is given, null when that unsets it.
 * @property stress `{ temperatureC, depositionTemperatureC }`, each there when set, in °C; a design with neither set has no `stress`.
 * @property surfaceMode Which sides carry layers.
 * @property mfEvalMode How a one-sided design is scored.
 * @property referenceWavelength The reference wavelength, nm.
 * @property frontLayers The front's layers, the outermost first, each `{ id, material, thickness, locked }` with the thickness in nm.
 * @property backLayers The back's layers, the one on the substrate first.
 * @property notes The design's notes, text.
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * const design = tf.newDesign({ name: 'AR', substrate: 'SiO2', referenceWavelength: 600 });
 * console.log(design.name, 'on', design.substrate.material, design.substrate.thickness, 'mm');
 */
export function newDesign(options) {
    const setup = checkOptions('newDesign', options, SETUP);
    return withSetup('newDesign', makeDefaultDesign(setup.name ?? 'New Design'), setup);
}

/**
 * A design with any of the settings `newDesign` takes changed. A new
 * reference wavelength rescales every layer to keep its count of quarter
 * waves, as the Design Editor's λ0 field does, and a design made symmetric
 * takes the mirror of its front as its back. A stress temperature or the
 * diameter given as null is unset, as clearing the Stress window's field
 * unsets it, and unsetting the last temperature removes `stress`.
 *
 * @param design The design.
 * @param options Any of the options of `newDesign`.
 * @returns The design with the changes.
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * const design = tf.setDesignSetup(tf.newDesign({ name: 'Plate' }), { substrateThicknessMm: 3, mfEvalMode: 'total' });
 * console.log(design.substrate.thickness, 'mm,', design.mfEvalMode);
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
