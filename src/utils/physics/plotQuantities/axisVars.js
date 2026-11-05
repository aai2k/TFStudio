/**
 * Surface axis-variable tokens: an axis variable is one of
 *   'wavelength'      λ in nm           (optical Z only)
 *   'aoi'             angle of incidence in °  (optical Z only)
 *   'thk:<i>'         thickness of front layer i (nm)
 */

import { designMaterialShortName } from '../../materials/designMaterials.js';
import { editorLayerNumber } from '../../misc/layerNumbers.js';

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
    const front = (design?.frontLayers || []);
    front.forEach((l, i) => {
        opts.push({ value: `thk:${i}`, label: `${layerTag(design, i)} d (nm)` });
    });
    return opts;
}

/**
 * The number front layer i carries. Front layers are stored air side first,
 * but numbered from the substrate as the Design Editor numbers them, so L1 is
 * the layer on the substrate.
 */
export function layerNumber(design, i) {
    return editorLayerNumber('front', design?.frontLayers?.length || 0, i);
}

/** Display tag for front layer i, e.g. "L3 (SiO2)", with the material's short name. */
export function layerTag(design, i) {
    const material = (design?.frontLayers || [])[i]?.material;
    const number = layerNumber(design, i);
    const name = typeof material === 'string' ? designMaterialShortName(design, material) : material?.name;
    return name ? `L${number} (${name})` : `L${number}`;
}

/**
 * What an axis menu offers: Wavelength and AOI where the quantity takes them,
 * then each front layer's thickness, the layers listed from the substrate out,
 * L1 first, in Design Editor order. Each value is an axis-variable token.
 */
export function buildAxisTargetOptions(design, opticalAllowed) {
    const opts = [];
    if (opticalAllowed) {
        opts.push({ value: 'wavelength', label: 'Wavelength (nm)' });
        opts.push({ value: 'aoi',        label: 'AOI (°)' });
    }
    const count = (design?.frontLayers || []).length;
    for (let i = count - 1; i >= 0; i--) {
        opts.push({ value: `thk:${i}`, label: layerTag(design, i) });
    }
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
        const l = (design?.frontLayers || [])[p.layer];
        const d = (l?.thickness) || 100;
        result = { from: Math.max(1, Math.round(d * 0.5)), to: Math.round(d * 1.5) };
    }
    return result;
}
