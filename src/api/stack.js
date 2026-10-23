// Editing a design's layer stack. Layers are addressed by side ('front' or
// 'back') and index as the design stores them: on the front, index 0 is the
// outermost layer, next to the incident medium; on the back, index 0 is the
// layer on the substrate. Thickness is physical, in nm. Each call returns a new
// design and leaves its argument as it was.

import { buildStackFromFormula, parseStackFormula, stackFormulaResolvers, DEFAULT_SYMBOL_MAP } from '../utils/synthesis/stackFormula.js';
import { DEFAULT_START_FROM_SUBSTRATE, usedSymbolSet } from '../components/windows/design/stackFormula/model.js';
import { buildReplaceAppendPatch } from '../components/windows/design/stackFormula/designBuild.js';
import { mirrorLayers } from '../utils/physics/optimizer.js';
import { newLayerId, ensureLayerIds } from '../utils/io/newDesign.js';
import { requireMaterial } from './materials.js';
import { sideKey } from './designs.js';
import { checkOptions, requireValue, isPositive, isBoolean, refusal } from './check.js';
import en from '../constants/locales/en.js';

const thicknessOk = (call, thickness) => requireValue(call, 'thickness', thickness, isPositive, 'a physical thickness in nm above 0');

function checkIndex(call, layers, index, { insert = false } = {}) {
    const last = insert ? layers.length : layers.length - 1;
    if (!(Number.isInteger(index) && index >= 0 && index <= last)) {
        throw new Error(`${call}: index ${index} is outside 0..${last} on this side`);
    }
}

// The side the Design Editor does not let the user edit, and why: the back of
// a symmetric design mirrors the front, and a one-sided design scored on its
// side alone does not evaluate the other side.
function closedSide(design) {
    const mode = design.surfaceMode || 'front_only';
    const scoredAlone = (design.mfEvalMode || 'side') === 'side';
    const reopen = "; to edit it, make the design both_independent, or score it as the whole part (mfEvalMode 'total'), with setDesignSetup";
    if (mode === 'symmetric') return { side: 'back', why: 'in symmetric mode the back mirrors the front; edit the front' };
    if (scoredAlone && mode === 'front_only') return { side: 'back', why: `a front_only design scored on its side alone does not evaluate the back${reopen}` };
    if (scoredAlone && mode === 'back_only') return { side: 'front', why: `a back_only design scored on its side alone does not evaluate the front${reopen}` };
    return null;
}

function openSideKey(call, design, side) {
    const key = sideKey(side);
    const closed = closedSide(design);
    if (closed && closed.side === side) throw refusal('closedSide', { call, side, surfaceMode: design.surfaceMode || 'front_only' }, `${call}: ${closed.why}`);
    return key;
}

// The Stack Formula dialog's message for a formula that does not read, with
// where the reading stopped.
function formulaError({ errorKey, errorArgs = [], errorPos }) {
    const text = en.stackFormula.errors[errorKey];
    const message = typeof text === 'function' ? text(...errorArgs) : (text || errorKey);
    return `the formula does not read: ${message}${errorPos != null ? `, at character ${errorPos + 1}` : ''}`;
}

// Each letter of `symbols` must name a material the design resolves.
function checkSymbols(design, symbols) {
    if (!symbols || typeof symbols !== 'object' || Array.isArray(symbols)) {
        throw new Error('stackFromFormula: symbols is an object naming each letter\'s material, such as {"H": "Ta2O5", "L": "SiO2"}');
    }
    for (const id of Object.values(symbols)) {
        try { requireMaterial(design, id); } catch (err) { throw new Error(`stackFromFormula: ${err.message}`); }
    }
}

// In symmetric mode the back stack is the mirror of the front, as the app keeps it.
function withLayers(design, key, layers) {
    if (design.surfaceMode === 'symmetric') return { ...design, frontLayers: layers, backLayers: mirrorLayers(layers) };
    return { ...design, [key]: layers };
}

/**
 * A design with a new layer on one side.
 *
 * @param design The design.
 * @param options
 * @param [options.side='front'] `'front'` or `'back'`.
 * @param [options.index] Where the layer goes, counted from 0: on the front, 0 is the outermost layer, next to the incident medium; on the back, 0 is the layer on the substrate. Without it, after the last layer: next to the substrate on the front, outermost on the back.
 * @param options.material The layer's material, by id.
 * @param options.thickness The layer's physical thickness, nm.
 * @param [options.locked=false] Lock the layer, so that refinement and synthesis leave it as it is.
 * @returns The design with the layer.
 * @throws a side the Design Editor does not let you edit: the back of a symmetric design, which mirrors the front, or the side a one-sided design scored on its side alone does not evaluate
 * @throws an index outside the side's layers
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * tf.design = tf.insertLayer(tf.design, { material: 'SiO2', thickness: 95, index: 0 });
 * console.log(tf.design.frontLayers.map(l => `${l.material} ${l.thickness}`).join(', '));
 */
export function insertLayer(design, options) {
    const { side = 'front', index, material, thickness, locked = false } =
        checkOptions('insertLayer', options, ['side', 'index', 'material', 'thickness', 'locked']);
    const key = openSideKey('insertLayer', design, side);
    const layers = design[key] || [];
    const at = index ?? layers.length;
    checkIndex('insertLayer', layers, at, { insert: true });
    requireMaterial(design, material);
    thicknessOk('insertLayer', thickness);
    requireValue('insertLayer', 'locked', locked, isBoolean, 'true or false');
    const layer = { id: newLayerId(), material, thickness, locked };
    return withLayers(design, key, [...layers.slice(0, at), layer, ...layers.slice(at)]);
}

/**
 * A design without one of its layers.
 *
 * @param design The design.
 * @param options
 * @param [options.side='front'] `'front'` or `'back'`.
 * @param options.index The layer's index on its side, counted as `insertLayer` counts it.
 * @returns The design without the layer.
 * @throws a side the Design Editor does not let you edit, as for `insertLayer`
 * @throws an index outside the side's layers
 * @example
 * tf.design = tf.deleteLayer(tf.design, { index: 0 });
 * console.log(tf.design.frontLayers.length, 'layers on the front');
 */
export function deleteLayer(design, options) {
    const { side = 'front', index } = checkOptions('deleteLayer', options, ['side', 'index']);
    const key = openSideKey('deleteLayer', design, side);
    const layers = design[key] || [];
    checkIndex('deleteLayer', layers, index);
    return withLayers(design, key, layers.filter((_, i) => i !== index));
}

/**
 * A design with one layer's material, thickness or lock changed.
 *
 * @param design The design.
 * @param options
 * @param [options.side='front'] `'front'` or `'back'`.
 * @param options.index The layer's index on its side, counted as `insertLayer` counts it.
 * @param [options.material] The new material, by id.
 * @param [options.thickness] The new physical thickness, nm.
 * @param [options.locked] `true` locks the layer, `false` frees it.
 * @returns The design with the layer changed.
 * @throws a side the Design Editor does not let you edit, as for `insertLayer`
 * @throws an index outside the side's layers
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * tf.design = tf.setLayer(tf.design, { index: 0, thickness: 100, locked: true });
 * console.log(tf.design.frontLayers[0]);
 */
export function setLayer(design, options) {
    const { side = 'front', index, material, thickness, locked } =
        checkOptions('setLayer', options, ['side', 'index', 'material', 'thickness', 'locked']);
    const key = openSideKey('setLayer', design, side);
    const layers = design[key] || [];
    checkIndex('setLayer', layers, index);
    if (material !== undefined) requireMaterial(design, material);
    if (thickness !== undefined) thicknessOk('setLayer', thickness);
    if (locked !== undefined) requireValue('setLayer', 'locked', locked, isBoolean, 'true or false');
    const changed = {
        ...layers[index],
        ...(material !== undefined ? { material } : {}),
        ...(thickness !== undefined ? { thickness } : {}),
        ...(locked !== undefined ? { locked } : {}),
    };
    return withLayers(design, key, layers.map((layer, i) => (i === index ? changed : layer)));
}

/**
 * A design with the layers of one side replaced by those a
 * [stack formula](/design/stack-formula/) builds, as the Stack Formula
 * dialog's Replace builds them. Each letter is a quarter wave at the reference
 * wavelength, so `'(HL)^5 H'` is eleven quarter-wave layers. Filling a side a
 * one-sided design does not evaluate makes the design two-sided, as the dialog
 * does.
 *
 * @param design The design.
 * @param options
 * @param options.formula The layers alone, such as `'(HL)^5 H'`; the media stay the design's.
 * @param [options.side='front'] `'front'` or `'back'`; a symmetric design takes the front.
 * @param [options.symbols] The material of each letter, by id, such as `{ H: 'Ta2O5', L: 'SiO2' }`. A letter left out is H TiO2, L SiO2 or M Al2O3.
 * @param [options.referenceWavelength] The wavelength, nm, the quarter waves are counted at, which the design then keeps. Without it, the design's own.
 * @param [options.startFromSubstrate=true] The formula's first letter is the layer on the substrate; false makes it the layer next to the incident medium.
 * @returns The design with the new layers.
 * @throws a formula that does not read, saying where the reading stopped
 * @throws a formula that names media, such as `'Air | H L | BK7'`; `setDesignSetup` sets them
 * @throws a letter in `symbols` the formula does not use
 * @throws the back of a symmetric design
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * tf.design = tf.stackFromFormula(tf.design, { formula: '(HL)^3 H', symbols: { H: 'Ta2O5', L: 'SiO2' } });
 * console.log(tf.design.frontLayers.length, 'layers');
 */
export function stackFromFormula(design, options) {
    // As the dialog's Replace (stackFormula/designBuild.js), with the media
    // the dialog's media fields start from: the design's.
    const {
        side = 'front', formula, symbols = {}, referenceWavelength = design.referenceWavelength ?? 550,
        startFromSubstrate = DEFAULT_START_FROM_SUBSTRATE,
    } = checkOptions('stackFromFormula', options, ['side', 'formula', 'symbols', 'referenceWavelength', 'startFromSubstrate']);
    sideKey(side);
    const isSym = design.surfaceMode === 'symmetric';
    if (isSym && side === 'back') throw new Error('stackFromFormula: in symmetric mode the back mirrors the front; give the front');
    requireValue('stackFromFormula', 'referenceWavelength', referenceWavelength, isPositive, 'a wavelength in nm above 0');
    requireValue('stackFromFormula', 'startFromSubstrate', startFromSubstrate, isBoolean, 'true or false');
    checkSymbols(design, symbols);
    const compiled = buildStackFromFormula({
        text: formula, symbolMap: { ...DEFAULT_SYMBOL_MAP, ...symbols }, refLambda: referenceWavelength,
        startFromSubstrate, resolvers: stackFormulaResolvers(design),
    });
    if (!compiled.ok) throw new Error(`stackFromFormula: ${formulaError(compiled)}`);
    const used = usedSymbolSet(parseStackFormula(formula), { ...DEFAULT_SYMBOL_MAP, ...symbols });
    const unused = Object.keys(symbols).find(letter => !used.has(letter));
    if (unused) throw new Error(`stackFromFormula: the formula does not use the symbol '${unused}'; it uses ${[...used].join(', ')}`);
    if (compiled.incidentMaterial || compiled.substrateMaterial) {
        throw refusal('formulaMedia', { call: 'stackFromFormula' },
            'stackFromFormula: the formula names media; write the layers alone, such as \'(HL)^5 H\', and set the media with setDesignSetup');
    }
    const patch = buildReplaceAppendPatch({
        design, mode: 'replace', isSym, effSide: side, compiled, refLambda: referenceWavelength,
        substrateMat: design.substrate.material, incidentMat: design.incidentMedium, exitMat: design.exitMedium,
        text: formula, stamp: Date.now(),
    });
    const next = { ...design, ...patch };
    return { ...next, frontLayers: ensureLayerIds(next.frontLayers), backLayers: ensureLayerIds(next.backLayers) };
}
