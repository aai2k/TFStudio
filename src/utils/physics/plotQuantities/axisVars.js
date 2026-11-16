/**
 * Surface axis-variable tokens: an axis variable is one of
 *   'wavelength'      λ in nm           (optical Z only)
 *   'aoi'             angle of incidence in °  (optical Z only)
 *   'thk:<i>'         thickness of layer i of the swept side (nm), as the
 *                     side stores its layers (sweptSide)
 */

import { designMaterialShortName } from '../../materials/designMaterials.js';
import { editorLayerNumber } from '../../misc/layerNumbers.js';

/**
 * The side a layer sweep moves: the back on a design coated on its back alone
 * (surface mode back_only), the front otherwise. Every quantity reads a layer
 * token on this side, so a menu, an axis title and the computation agree.
 */
export function sweptSide(design) {
    return (design?.surfaceMode || 'front_only') === 'back_only' ? 'back' : 'front';
}

/** The layers of the swept side, as the design stores them. */
export function sweptLayers(design) {
    return (sweptSide(design) === 'back' ? design?.backLayers : design?.frontLayers) || [];
}

/** The key of the swept side's layer list in a design or a stack: frontLayers or backLayers. */
export const sweptLayersKey = design => (sweptSide(design) === 'back' ? 'backLayers' : 'frontLayers');

/** Parse an axis-variable token → { kind, layer? }. */
export function parseAxisVar(v) {
    if (v === 'wavelength') return { kind: 'lambda' };
    if (v === 'aoi')        return { kind: 'aoi' };
    const m = /^thk:(\d+)$/.exec(v || '');
    if (m) return { kind: 'thk', layer: parseInt(m[1], 10) };
    return { kind: 'lambda' };
}

/** Is this axis variable a per-layer design parameter (vs λ/AOI)? */
export function isLayerVar(v) {
    return parseAxisVar(v).kind === 'thk';
}

/** Default unit/label suffix for an axis variable. */
export function axisVarUnit(v) {
    return parseAxisVar(v).kind === 'aoi' ? '°' : 'nm';
}

/**
 * The token list with labels, one per layer thickness, used to resolve a token
 * to an axis title. The menus use buildAxisTargetOptions, which lists the
 * layers L1 first.
 * @param {object} design
 * @param {boolean} opticalAllowed  include wavelength + AOI (false for MF Z)
 * @returns {{value:string, label:string}[]}
 */
export function buildAxisVarOptions(design, opticalAllowed) {
    const opts = [];
    if (opticalAllowed) {
        opts.push({ value: 'wavelength', label: 'λ (nm)' });
        opts.push({ value: 'aoi',        label: 'AOI (°)' });
    }
    // Symbols rather than words, so the titles read the same in every language.
    sweptLayers(design).forEach((l, i) => {
        opts.push({ value: `thk:${i}`, label: `${layerTag(design, i)} d (nm)` });
    });
    return opts;
}

/**
 * The number layer i of the swept side carries, as the Design Editor numbers
 * it: 1 on the substrate. Front layers are stored air side first and back
 * layers substrate first (layerNumbers.js editorLayerNumber).
 */
export function layerNumber(design, i) {
    return editorLayerNumber(sweptSide(design), sweptLayers(design).length, i);
}

/** Layer i of the swept side by its symbol: L3 for a front layer, B1 for a back one. */
export function layerSymbol(design, i) {
    return `${sweptSide(design) === 'back' ? 'B' : 'L'}${layerNumber(design, i)}`;
}

/** Display tag for layer i of the swept side, e.g. "L3 (SiO2)", with the material's short name. */
export function layerTag(design, i) {
    const material = sweptLayers(design)[i]?.material;
    const symbol = layerSymbol(design, i);
    const name = typeof material === 'string' ? designMaterialShortName(design, material) : material?.name;
    return name ? `${symbol} (${name})` : symbol;
}

/**
 * What an axis menu offers: Wavelength and AOI where the quantity takes them,
 * then the thickness of each layer of the swept side, listed from the
 * substrate out, L1 or B1 first, in Design Editor order. Each value is an
 * axis-variable token.
 */
export function buildAxisTargetOptions(design, opticalAllowed) {
    const opts = [];
    if (opticalAllowed) {
        opts.push({ value: 'wavelength', label: 'Wavelength (nm)' });
        opts.push({ value: 'aoi',        label: 'AOI (°)' });
    }
    const count = sweptLayers(design).length;
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => layerNumber(design, a) - layerNumber(design, b));
    for (const i of order) opts.push({ value: `thk:${i}`, label: layerTag(design, i) });
    return opts;
}

/** Sensible default {from, to} for an axis token (used when the variable changes). */
export function defaultAxisRange(design, token) {
    const p = parseAxisVar(token);
    let result;
    if (p.kind === 'lambda') {
        result = { from: 400, to: 800 };
    } else if (p.kind === 'aoi') {
        result = { from: 0, to: 60 };
    } else {
        const l = sweptLayers(design)[p.layer];
        const d = (l?.thickness) || 100;
        result = { from: Math.max(1, Math.round(d * 0.5)), to: Math.round(d * 1.5) };
    }
    return result;
}
