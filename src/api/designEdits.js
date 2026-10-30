// Edits of a whole side's stack, as the Design Editor makes them: its Round /
// quantize and Perturb dialogs (designEditor/layerTools.js) and its Invert,
// Copy to back and Copy to front buttons (designEditor/layerActions.js); a
// thickness scale; and what differs between two designs.

import {
    MAX_DECIMALS, PERTURB_DEFAULT_PERCENT, QUANTIZE_DEFAULTS,
    makePerturbationMap, perturbDesignSide, quantizeDesignSide, withSideLayers,
} from '../components/windows/design/designEditor/layerTools.js';
import { copiedToOtherSide, flippedSide } from '../components/windows/design/designEditor/layerActions.js';
import { mulberry32 } from '../utils/monitoring/monitoringSim/rng.js';
import { randomSeed } from '../utils/physics/errorAnalysis/mcConfig.js';
import { openSideKey } from './stack.js';
import { isSeed } from './tolerance.js';
import { checkOptions, requireValue, isPositive, isSide, refusal } from './check.js';

const QUANTIZE_MODES = Object.keys(QUANTIZE_DEFAULTS.value);
const QUANTIZE_TAKES = {
    decimals: `a whole number of decimal places from 0 to ${MAX_DECIMALS}`,
    step: 'a step in nm above 0',
    qwot: 'a number of quarter waves above 0',
};
const quantizeValueOk = mode => (mode === 'decimals'
    ? v => Number.isInteger(v) && v >= 0 && v <= MAX_DECIMALS
    : isPositive);

// The side an edit changes: `side`, or without it the front, or the back of a
// design coated on the back alone, the side the one-side results take; a side
// the Design Editor does not let you edit is refused. Returns the side and
// the design's key of it.
function editedSide(call, design, side) {
    const chosen = side ?? (design.surfaceMode === 'back_only' ? 'back' : 'front');
    requireValue(call, 'side', chosen, isSide, "'front' or 'back'");
    return { side: chosen, key: openSideKey(call, design, chosen) };
}

/**
 * A design with every unlocked layer of one side made thicker or thinner by
 * one factor. Locked layers stay as they are, as the Design Editor's Round
 * and Perturb dialogs leave them. On a symmetric design the back is made the
 * mirror of the new front.
 *
 * @param design The design.
 * @param options
 * @param options.factor What each thickness is multiplied by, above 0: 1.02 makes every unlocked layer 2% thicker.
 * @param [options.side] `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone.
 * @returns The design with the side scaled.
 * @throws an option it does not take, a factor that is not a number above 0, or a side other than `'front'` or `'back'`
 * @throws a side the Design Editor does not let you edit: the back of a symmetric design, which mirrors the front, or the side a one-sided design scored on its side alone does not evaluate
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const shifted = tf.scaleThicknesses(design, { factor: 1.05 });
 * console.log(design.frontLayers[0].thickness.toFixed(2), 'nm becomes', shifted.frontLayers[0].thickness.toFixed(2), 'nm');
 */
export function scaleThicknesses(design, options) {
    const { factor, side } = checkOptions('scaleThicknesses', options, ['factor', 'side']);
    requireValue('scaleThicknesses', 'factor', factor, isPositive, 'a number above 0');
    const edited = editedSide('scaleThicknesses', design, side);
    const layers = (design[edited.key] || []).map(layer => (layer.locked ? layer : { ...layer, thickness: layer.thickness * factor }));
    return withSideLayers(design, edited.side, layers);
}

/**
 * A design with the unlocked layers of one side rounded as the Design
 * Editor's Round / quantize dialog rounds them: to a number of decimal places
 * of a nm, to the nearest whole number of controller steps, or to the nearest
 * whole number of a QWOT increment at the design's reference wavelength.
 * Locked layers stay as they are. A layer thinner than half a step rounds to
 * 0 nm, as in the dialog. In `'qwot'` mode a layer whose material resolves to
 * nothing, or has n of 0 or less at the reference wavelength, stays as it is.
 * On a symmetric design the back is made the mirror of the new front.
 *
 * @param design The design.
 * @param [options]
 * @param [options.mode='step'] `'decimals'`, `'step'` (a controller step in nm) or `'qwot'` (a QWOT increment).
 * @param [options.value] The number of decimal places, from 0 to 8, the step in nm, or the QWOT increment, as the mode takes. Without it, what the dialog opens with: 2 places, 0.1 nm or 1 QWOT.
 * @param [options.side] `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone.
 * @returns The design with the side rounded.
 * @throws an option it does not take, a mode other than `'decimals'`, `'step'` or `'qwot'`, a value the mode does not take, or a side other than `'front'` or `'back'`
 * @throws a side the Design Editor does not let you edit, as for `scaleThicknesses`
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const rounded = tf.quantize(design, { mode: 'step', value: 0.5 });
 * console.log(rounded.frontLayers.map(l => l.thickness).join(', '), 'nm');
 */
export function quantize(design, options) {
    const { mode = QUANTIZE_DEFAULTS.mode, value, side } = checkOptions('quantize', options, ['mode', 'value', 'side']);
    requireValue('quantize', 'mode', mode, m => QUANTIZE_MODES.includes(m), "'decimals', 'step' or 'qwot'");
    const amount = value ?? QUANTIZE_DEFAULTS.value[mode];
    requireValue('quantize', 'value', amount, quantizeValueOk(mode), QUANTIZE_TAKES[mode]);
    const edited = editedSide('quantize', design, side);
    return quantizeDesignSide(design, edited.side, { mode, value: amount, referenceWavelength: design.referenceWavelength || 550 });
}

/**
 * A design with the unlocked layers of one side given random thickness
 * errors, as the Design Editor's Perturb dialog gives them: each layer's
 * thickness is multiplied by 1 + k · percent / 100, with k drawn for each
 * layer uniformly from -1 to 1. Locked layers stay as they are. The same
 * seed, design and percent give the same errors. On a symmetric design the
 * back is made the mirror of the new front.
 *
 * @param design The design.
 * @param [options]
 * @param [options.percent=2] The largest error, ± % of each thickness, above 0 and up to 100.
 * @param [options.side] `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone.
 * @param [options.seed] The number the draws start from, a whole number from 1 to 2^32 - 1. Without it, or with null, a fresh one, which the result reports.
 * @returns The changed design and the seed.
 * @property design The design with the errors.
 * @property seed The seed the draws started from.
 * @throws an option it does not take, a percent that is not above 0 and up to 100, a seed that is not a whole number from 1 to 2^32 - 1, or a side other than `'front'` or `'back'`
 * @throws a side the Design Editor does not let you edit, as for `scaleThicknesses`
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const { design: kicked, seed } = tf.perturb(design, { percent: 3, seed: 7 });
 * console.log('seed', seed, kicked.frontLayers.map(l => l.thickness.toFixed(2)).join(', '), 'nm');
 */
export function perturb(design, options) {
    const { percent = PERTURB_DEFAULT_PERCENT, side, seed } = checkOptions('perturb', options, ['percent', 'side', 'seed']);
    requireValue('perturb', 'percent', percent, v => Number.isFinite(v) && v > 0 && v <= 100, 'a percentage above 0 and up to 100');
    requireValue('perturb', 'seed', seed, isSeed, 'a whole number from 1 to 2^32 - 1, or null for a fresh one');
    const edited = editedSide('perturb', design, side);
    const drawn = seed ?? randomSeed();
    const kicks = makePerturbationMap(design[edited.key] || [], mulberry32(drawn));
    return { design: perturbDesignSide(design, edited.side, percent, kicks), seed: drawn };
}

/**
 * A design with the layer order of one side reversed, as the Design Editor's
 * Invert button flips the coating on the substrate: the layer next to the
 * substrate becomes the outermost. On a symmetric design the back is made the
 * mirror of the new front.
 *
 * @param design The design.
 * @param [options]
 * @param [options.side] `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone.
 * @returns The design with the side flipped.
 * @throws an option it does not take, or a side other than `'front'` or `'back'`
 * @throws a side the Design Editor does not let you edit, as for `scaleThicknesses`
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Graded' }), { formula: 'H 2L M' });
 * const flipped = tf.flipLayers(design);
 * console.log(design.frontLayers.map(l => l.material).join(' '), 'becomes', flipped.frontLayers.map(l => l.material).join(' '));
 */
export function flipLayers(design, options) {
    const { side } = checkOptions('flipLayers', options, ['side']);
    return flippedSide(design, editedSide('flipLayers', design, side).side);
}

/**
 * A design with the layers of one side copied onto the other, as the Design
 * Editor's Copy to back and Copy to front buttons copy them: the other side
 * gets the same stack outward from the substrate, each layer with a new id,
 * and its own layers are replaced. Which sides the design coats stays as it
 * was, so a design coated on the front alone keeps scoring its front; make it
 * `'both_independent'` with setDesignSetup to coat both.
 *
 * @param design The design.
 * @param options
 * @param options.from The side copied, `'front'` or `'back'`.
 * @returns The design with the copy.
 * @throws an option it does not take, or a from other than `'front'` or `'back'`
 * @throws a side the Design Editor does not let you edit, as for `scaleThicknesses`, as the side copied from
 * @example
 * const front = tf.stackFromFormula(tf.newDesign({ name: 'Two-sided AR' }), { formula: 'H L' });
 * const both = tf.copySide(tf.setDesignSetup(front, { surfaceMode: 'both_independent' }), { from: 'front' });
 * console.log(both.backLayers.map(l => l.material).join(' '), 'on the back, from the substrate out');
 */
export function copySide(design, options) {
    const { from } = checkOptions('copySide', options, ['from']);
    requireValue('copySide', 'from', from, isSide, "'front' or 'back'");
    openSideKey('copySide', design, from);
    return copiedToOtherSide(design, from);
}

// The setup designDifferences compares, by setDesignSetup's names, each as
// the Design Editor reads a design that leaves it out.
const SETUP = {
    incidentMedium: d => d.incidentMedium,
    exitMedium: d => d.exitMedium,
    substrate: d => d.substrate?.material,
    substrateThicknessMm: d => d.substrate?.thickness,
    referenceWavelength: d => d.referenceWavelength || 550,
    surfaceMode: d => d.surfaceMode || 'front_only',
    mfEvalMode: d => d.mfEvalMode || 'side',
    stressTemperatureC: d => d.stress?.temperatureC ?? null,
    depositionTemperatureC: d => d.stress?.depositionTemperatureC ?? null,
    substrateDiameterMm: d => d.substrate?.diameterMm ?? null,
};

const layerState = layer => ({ material: layer.material, thickness: layer.thickness, locked: !!layer.locked });
const sameLayer = (a, b) => a.material === b.material && a.thickness === b.thickness && a.locked === b.locked;

// The layers of `side` that differ between `design` and `other`, numbered
// from 1 next to the substrate.
function sideDifferences(side, design, other) {
    const fromSubstrate = d => {
        const stored = (side === 'front' ? d.frontLayers : d.backLayers) || [];
        return side === 'front' ? [...stored].reverse() : stored;
    };
    const before = fromSubstrate(design), after = fromSubstrate(other);
    const out = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
        const was = before[i] ? layerState(before[i]) : null;
        const now = after[i] ? layerState(after[i]) : null;
        if (was && now && sameLayer(was, now)) continue;
        out.push({ side, number: i + 1, before: was, after: now, change: was && now ? now.thickness - was.thickness : null });
    }
    return out;
}

/**
 * What differs between two designs: their setup, as setDesignSetup sets it
 * but for the name, and their layers, compared side by side by number from
 * the substrate, so a layer added near the substrate shows every layer
 * outside it as changed. Values are compared exactly. Merit rows,
 * specification checks, the cone of incidence and the materials a design
 * carries are not compared.
 *
 * @param design The design compared from.
 * @param other The design compared with it.
 * @returns What differs.
 * @property same True when nothing compared differs.
 * @property setup Each setting that differs, `{ setting, before, after }`: setting by setDesignSetup's name (`'incidentMedium'`, `'exitMedium'`, `'substrate'`, `'substrateThicknessMm'`, `'referenceWavelength'`, `'surfaceMode'`, `'mfEvalMode'`, `'stressTemperatureC'`, `'depositionTemperatureC'` or `'substrateDiameterMm'`), before its value in `design` and after in `other`.
 * @property layers Each layer that differs, the front's first: `{ side, number, before, after, change }`, number from 1 next to the substrate, before and after the layer in each design as `{ material, thickness, locked }` (thickness in nm), or null where that design has no layer of the number; change is after's thickness less before's, nm, or null when one design has no such layer.
 * @throws a design or an other that is not a design
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const kicked = tf.perturb(design, { percent: 2, seed: 3 }).design;
 * const found = tf.designDifferences(design, kicked);
 * for (const l of found.layers) console.log(l.side, 'layer', l.number, l.change.toFixed(3), 'nm');
 */
export function designDifferences(design, other) {
    for (const [option, given] of [['design', design], ['other', other]]) {
        if (!Array.isArray(given?.frontLayers)) {
            throw refusal('badValue', { call: 'designDifferences', option, takes: 'a design', value: given === null ? 'null' : typeof given },
                `designDifferences: ${option} is a design, as openDesign or newDesign give one`);
        }
    }
    const setup = Object.entries(SETUP)
        .map(([setting, read]) => ({ setting, before: read(design), after: read(other) }))
        .filter(({ before, after }) => before !== after);
    const layers = [...sideDifferences('front', design, other), ...sideDifferences('back', design, other)];
    return { same: !setup.length && !layers.length, setup, layers };
}
