/**
 * 3D surface spec — default spec construction, axis sampling, and the
 * exact-λ set the surface compute will query (for worker pre-sampling).
 */

import { requiredLambdas, withDesignSampleCounts } from '../optimizer.js';
import { buildLambdaGrid } from '../thinFilmMath.js';
import { designMaterialLookup } from '../../materials/designMaterials.js';
import { overrideReference } from './materialOverride.js';
import { buildAxisVarOptions, parseAxisVar } from './axisVars.js';

export const Z_QUANTITIES = ['T', 'R', 'A', 'MF'];
export const SURFACE_RENDERS = ['surface', 'heatmap'];
export const COLORSCALES = ['Turbo', 'Jet', 'Viridis', 'Cividis', 'Hot', 'Portland', 'Electric', 'Greys'];

/**
 * The samples an axis asked for `steps` gets: that many, rounded, and at least
 * the two a grid axis needs. A count that is not finite gives two, so a step
 * typed fine enough to overflow cannot reach an array length.
 */
export function axisSampleCount(steps) {
    const count = Math.round(steps);
    return Number.isFinite(count) ? Math.max(2, count) : 2;
}

/** Linearly spaced sample array (inclusive), `axisSampleCount(steps)` long. */
export function linspace(from, to, steps) {
    const n = axisSampleCount(steps);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = from + (to - from) * (i / (n - 1));
    return out;
}

/**
 * Build a default 3D surface spec for a design.
 *   X = first front layer thickness, Y = second (or AOI if <2 layers),
 *   Z = T. Sensible ranges around the nominal values.
 */
export function makeDefaultSurfaceSpec(design, defaults = {}) {
    const front = design?.frontLayers || [];
    const d0 = front[0]?.thickness ?? 100;
    const hasL0 = front.length >= 1;
    const hasL1 = front.length >= 2;
    const d1 = front[1]?.thickness ?? 100;
    const compact = value => Math.round(value * 1000) / 1000;
    return {
        z: 'T',
        polarization: 'avg',
        surfaceMode: defaults.surfaceMode || 'front',
        fixedLambda_nm: 550,
        fixedAOI_deg: 0,
        xVar: hasL0 ? 'thk:0' : 'wavelength',
        xFrom: hasL0 ? compact(Math.max(1, d0 * 0.5)) : 400,
        xTo:   hasL0 ? compact(d0 * 1.5) : 800,
        xSteps: 40,
        yVar: hasL1 ? 'thk:1' : 'aoi',
        yFrom: hasL1 ? compact(Math.max(1, d1 * 0.5)) : 0,
        yTo:   hasL1 ? compact(d1 * 1.5) : 60,
        ySteps: 40,
        render: 'surface',
        colorscale: 'Turbo',
        ...defaults,
    };
}

/**
 * Exact λ set the surface compute will query getNK at — for Approach-A worker
 * pre-sampling (so the worker's table-lookup getNK is byte-identical to the
 * main thread). MF: the operands' sample λ and the n/k override reference
 * (overrideReference).
 * Optical: the wavelength-axis samples (or the fixed λ), both as they stand (an
 * n/k override samples its reference there) and on the grid the spectrum
 * evaluates them at (buildLambdaGrid): one wavelength at a time, and a whole
 * wavelength axis as the single spectrum opticalSurface.js batches it into.
 */
export function requiredSurfaceLambdas(spec, design) {
    const set = new Set();
    const addGrid = (from, to, step) => { for (const l of buildLambdaGrid(from, to, step)) set.add(l); };
    const add = v => { if (Number.isFinite(v)) { set.add(v); addGrid(v, v, 1); } };
    if (spec.z === 'MF') {
        // The surface samples its bands for the design's fringes
        // (meritSurface.js). The count is set by each material's group index
        // just around a band's short end, so those reads go in the table too.
        const lookup = designMaterialLookup(design);
        const noting = id => {
            const mat = lookup(id);
            return mat && { ...mat, getNK: lam => { set.add(lam); return mat.getNK(lam); } };
        };
        const enabled = (design.meritOperands || []).filter(op => op && op.enabled);
        const operands = withDesignSampleCounts(enabled, design, noting);
        for (const lam of requiredLambdas(operands)) set.add(lam);   // exact, no rounding
        add(overrideReference(design));
    } else {
        const xk = parseAxisVar(spec.xVar).kind, yk = parseAxisVar(spec.yVar).kind;
        let lams;
        if (xk === 'lambda')      lams = linspace(spec.xFrom, spec.xTo, spec.xSteps);
        else if (yk === 'lambda') lams = linspace(spec.yFrom, spec.yTo, spec.ySteps);
        else                      lams = [spec.fixedLambda_nm];
        for (const l of lams) add(l);
        const last = lams[lams.length - 1];
        if (lams.length > 1) addGrid(lams[0], last, (last - lams[0]) / (lams.length - 1));
    }
    return Array.from(set).sort((a, b) => a - b);
}

/**
 * Axis title for a surface axis variable. `labels` is t.plotEngine, which carries
 * the translated names for the wavelength and AOI axes; layer variables are
 * designations rather than words and read the same in every language.
 */
export function surfaceAxisLabel(varTok, design, labels) {
    if (varTok === 'wavelength') return labels.varWavelength;
    if (varTok === 'aoi') return labels.varAOI;
    const opts = buildAxisVarOptions(design, true);
    const found = opts.find(o => o.value === varTok);
    return found ? found.label : varTok;
}
