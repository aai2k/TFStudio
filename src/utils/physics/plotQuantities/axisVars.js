/**
 * Surface axis-variable tokens: an axis variable is one of
 *   'wavelength'      λ in nm           (optical Z only)
 *   'aoi'             angle of incidence in °  (optical Z only)
 *   'thk:<i>'         thickness of front layer i (nm)
 *   'n:<i>'           refractive index n of front layer i (constant-index what-if)
 *   'k:<i>'           extinction k of front layer i (constant-index what-if)
 */

/** Parse an axis-variable token → { kind, layer? }. */
export function parseAxisVar(v) {
    if (v === 'wavelength') return { kind: 'lambda' };
    if (v === 'aoi')        return { kind: 'aoi' };
    const m = /^(thk|n|k):(\d+)$/.exec(v || '');
    if (m) return { kind: m[1], layer: parseInt(m[2], 10) };
    return { kind: 'lambda' };
}

/** Is this axis variable a per-layer design parameter (vs λ/AOI)? */
export function isLayerVar(v) {
    const p = parseAxisVar(v);
    return p.kind === 'thk' || p.kind === 'n' || p.kind === 'k';
}

/** Default unit/label suffix for an axis variable. */
export function axisVarUnit(v) {
    const p = parseAxisVar(v);
    if (p.kind === 'lambda') return 'nm';
    if (p.kind === 'aoi')    return '°';
    if (p.kind === 'thk')    return 'nm';
    return '';   // n, k are dimensionless
}

/**
 * Build the FULL token list with labels (one per thk/n/k per layer) — used to
 * resolve a token → axis title. The UI uses the layer-first picker below
 * (buildAxisTargetOptions + AXIS_PROPS) instead, which scales to many layers.
 * @param {object} design
 * @param {boolean} opticalAllowed  include wavelength + AOI (false for MF Z)
 * @returns {{value:string, label:string}[]}
 */
export function buildAxisVarOptions(design, opticalAllowed) {
    const opts = [];
    if (opticalAllowed) {
        opts.push({ value: 'wavelength', label: 'Wavelength (nm)' });
        opts.push({ value: 'aoi',        label: 'AOI (°)' });
    }
    const front = (design?.frontLayers || []);
    front.forEach((l, i) => {
        const tag = layerTag(design, i);
        opts.push({ value: `thk:${i}`, label: `${tag} thickness (nm)` });
        opts.push({ value: `n:${i}`,   label: `${tag} index n` });
        opts.push({ value: `k:${i}`,   label: `${tag} index k` });
    });
    return opts;
}

/** Display tag for front layer i, e.g. "L3 (SiO2)". */
export function layerTag(design, i) {
    const l = (design?.frontLayers || [])[i];
    const mat = l && (typeof l.material === 'string' ? l.material : l.material?.name);
    return mat ? `L${i + 1} (${mat})` : `L${i + 1}`;
}

// Per-axis layer property choices (shown after a layer is picked).
export const AXIS_PROPS = [
    { value: 'thk', label: 'Thickness (nm)' },
    { value: 'n',   label: 'Index n' },
    { value: 'k',   label: 'Index k' },
];

/**
 * Layer-first axis "target" options: Wavelength / AOI (optical) then one entry
 * PER LAYER (not per property) — so hundreds of layers stay a single dropdown.
 * Property (thickness/n/k) is chosen separately via AXIS_PROPS.
 */
export function buildAxisTargetOptions(design, opticalAllowed) {
    const opts = [];
    if (opticalAllowed) {
        opts.push({ value: 'wavelength', label: 'Wavelength (nm)' });
        opts.push({ value: 'aoi',        label: 'AOI (°)' });
    }
    (design?.frontLayers || []).forEach((l, i) => {
        opts.push({ value: `layer:${i}`, label: layerTag(design, i) });
    });
    return opts;
}

/** Token → axis "target" select value ('wavelength' | 'aoi' | 'layer:<i>'). */
export function axisTarget(token) {
    const p = parseAxisVar(token);
    if (p.kind === 'lambda') return 'wavelength';
    if (p.kind === 'aoi')    return 'aoi';
    return `layer:${p.layer}`;
}

/** Token → property select value ('thk' | 'n' | 'k'), or null for λ/AOI. */
export function axisProp(token) {
    const p = parseAxisVar(token);
    return (p.kind === 'thk' || p.kind === 'n' || p.kind === 'k') ? p.kind : null;
}

/** Compose a token from a target + property. */
export function composeAxisVar(target, prop) {
    if (target === 'wavelength') return 'wavelength';
    if (target === 'aoi')        return 'aoi';
    const m = /^layer:(\d+)$/.exec(target || '');
    if (m) return `${prop || 'thk'}:${m[1]}`;
    return 'wavelength';
}

/** Sensible default {from, to} for an axis token (used when the variable changes). */
export function defaultAxisRange(design, token) {
    const p = parseAxisVar(token);
    let result;
    if (p.kind === 'lambda') {
        result = { from: 400, to: 800 };
    } else if (p.kind === 'aoi') {
        result = { from: 0, to: 60 };
    } else if (p.kind === 'thk') {
        const l = (design?.frontLayers || [])[p.layer];
        const d = (l?.thickness) || 100;
        result = { from: Math.max(1, Math.round(d * 0.5)), to: Math.round(d * 1.5) };
    } else if (p.kind === 'n') {
        result = { from: 1.3, to: 2.6 };
    } else if (p.kind === 'k') {
        result = { from: 0, to: 0.1 };
    } else {
        result = { from: 0, to: 1 };
    }
    return result;
}
