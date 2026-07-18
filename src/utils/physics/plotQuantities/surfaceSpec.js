/**
 * 3D surface spec — default spec construction, axis sampling, and the
 * exact-λ set the surface compute will query (for worker pre-sampling).
 */

import { requiredLambdas } from '../optimizer.js';
import { buildAxisVarOptions, parseAxisVar } from './axisVars.js';

export const Z_QUANTITIES = ['T', 'R', 'A', 'MF'];
export const SURFACE_RENDERS = ['surface', 'heatmap'];
export const COLORSCALES = ['Viridis', 'Cividis', 'Jet', 'Hot', 'Portland', 'Electric', 'Greys'];

export const MAX_AXIS_STEPS = 400;     // per-axis sample cap
export const MAX_GRID_POINTS = 90000;  // total (nx·ny) cap — guards pathological grids

/** Linearly spaced sample array (inclusive), clamped to [2, MAX_AXIS_STEPS]. */
export function linspace(from, to, steps) {
    const n = Math.max(2, Math.min(MAX_AXIS_STEPS, Math.round(steps || 2)));
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
    return {
        z: 'T',
        polarization: 'avg',
        surfaceMode: defaults.surfaceMode || 'front',
        fixedLambda_nm: 550,
        fixedAOI_deg: 0,
        xVar: hasL0 ? 'thk:0' : 'wavelength',
        xFrom: hasL0 ? Math.max(1, d0 * 0.5) : 400,
        xTo:   hasL0 ? d0 * 1.5 : 800,
        xSteps: 40,
        yVar: hasL1 ? 'thk:1' : 'aoi',
        yFrom: hasL1 ? Math.max(1, d1 * 0.5) : 0,
        yTo:   hasL1 ? d1 * 1.5 : 60,
        ySteps: 40,
        render: 'surface',
        colorscale: 'Viridis',
        ...defaults,
    };
}

/**
 * Exact λ set the surface compute will query getNK at — for Approach-A worker
 * pre-sampling (so the worker's table-lookup getNK is byte-identical to the
 * main thread). MF: the operands' sample λ + 550 (n/k override reference).
 * Optical: the wavelength-axis samples (or the fixed λ) — both the RAW linspace
 * values (n/k override reference samples there) AND their 1e-3 rounding (what
 * evaluateSpectrum queries internally).
 */
export function requiredSurfaceLambdas(spec, design) {
    const set = new Set();
    const add = v => { if (Number.isFinite(v)) { set.add(v); set.add(Math.round(v * 1000) / 1000); } };
    if (spec.z === 'MF') {
        const operands = (design.meritOperands || []).filter(op => op && op.enabled);
        for (const lam of requiredLambdas(operands)) set.add(lam);   // exact, no rounding
        add(550);
    } else {
        const xk = parseAxisVar(spec.xVar).kind, yk = parseAxisVar(spec.yVar).kind;
        let lams;
        if (xk === 'lambda')      lams = linspace(spec.xFrom, spec.xTo, spec.xSteps);
        else if (yk === 'lambda') lams = linspace(spec.yFrom, spec.yTo, spec.ySteps);
        else                      lams = [spec.fixedLambda_nm];
        for (const l of lams) add(l);
    }
    return Array.from(set).sort((a, b) => a - b);
}

/** Axis title for a surface axis variable. */
export function surfaceAxisLabel(varTok, design) {
    const opts = buildAxisVarOptions(design, true);
    const found = opts.find(o => o.value === varTok);
    return found ? found.label : varTok;
}
