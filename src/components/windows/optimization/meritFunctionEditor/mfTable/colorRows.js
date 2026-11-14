/**
 * How a colour row (RCOL, TCOL) reads in the merit table: its λ Start cell is
 * the Color list, the quantity it scores, and its λ End cell the list of
 * illuminant and observer pairs; its Current and Target print in the unit and
 * to the places of that quantity.
 */
import { HUE_CHROMA, ILLUMINANTS, OBSERVERS } from '../../../../../utils/physics/colorimetry.js';
import { isColor } from '../../../../../utils/physics/optimizer.js';

/** Every illuminant with every observer, as the λ End cell lists them: D65 · 2°, D65 · 10°, D50 · 2° … */
export const ILLUMINANT_OBSERVER_PAIRS = ILLUMINANTS.flatMap(illuminant => OBSERVERS.map(observer => ({
    illuminant: illuminant.id,
    observer: Number(observer.id),
    label: `${illuminant.id} · ${observer.id}°`,
})));

/** The label of the pair a row holds. */
export const illuminantObserverLabel = op => `${op.illuminant} · ${op.observer}°`;

// The symbols the cell shows: the quantity's own, primed or with a subscript
// where its id spells that out in plain characters.
const SYMBOLS = { "u'": 'u′', "v'": 'v′', dominant: 'λd', complementary: 'λc' };

// What the list shows beside a symbol: the colour space of a chromaticity
// that two spaces share a letter for, a unit, or a word in the UI language.
const LIST_SUFFIXES = {
    "u'": () => ' (1976)', "v'": () => ' (1976)', u: () => ' (1960)', v: () => ' (1960)',
    hab: () => ' (°)', huv: () => ' (°)',
    dominant: t => ` (${t.units.nm})`, complementary: t => ` (${t.units.nm})`, CCT: t => ` (${t.units.K})`,
};

/**
 * The cell's text for `quantity` and its entry in the Color list. `t` is the
 * locale; the words, luminous and purity, come from t.meritFunctionEditor.
 */
export function colorQuantityLabels(quantity, t) {
    const mfe = t.meritFunctionEditor;
    if (quantity === 'Y') return { face: 'Y', entry: mfe.colorLuminous };
    if (quantity === 'purity') return { face: mfe.colorPurity, entry: mfe.colorPurity };
    const face = SYMBOLS[quantity] ?? quantity;
    return { face, entry: face + (LIST_SUFFIXES[quantity]?.(t) ?? '') };
}

// Places a colour row's Current and Target print to, and its unit: a key into
// t.units, or a symbol that is the same in every language.
const PLACES = [
    [['X', 'Y', 'Z'], { current: 3, target: 2, unit: '%' }],
    [['x', 'y', "u'", "v'", 'u', 'v'], { current: 4, target: 3 }],
    [['Duv'], { current: 4, target: 4 }],
    [['suv', 'purity'], { current: 3, target: 3 }],
    [['hab', 'huv'], { current: 2, target: 2, unit: '°' }],
    [['dominant', 'complementary'], { current: 2, target: 2, unitKey: 'nm' }],
    [['CCT'], { current: 0, target: 0, unitKey: 'K' }],
];

/**
 * How colour row `op` prints: `{ decimals, targetDecimals, unit }`, the unit
 * in the UI language (`units` is t.units), or null for a row of another type.
 * L*, a*, b*, C*, u*, v* and Hunter L, a, b print to two places with no unit.
 */
export function colorFormat(op, units = {}) {
    if (!isColor(op.type)) return null;
    const hit = PLACES.find(([quantities]) => quantities.includes(op.color))?.[1] ?? { current: 2, target: 2 };
    return { decimals: hit.current, targetDecimals: hit.target, unit: hit.unitKey ? units[hit.unitKey] : hit.unit };
}

/** Whether `op` is a colour row scoring a hue, hab or huv. */
export const isHueRow = op => isColor(op.type) && !!HUE_CHROMA[op.color];
