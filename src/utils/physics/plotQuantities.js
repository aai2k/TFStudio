/**
 * Plot Engine — generic XY plot builder.
 *
 * A "curve" in the Plot Engine is a recipe that maps an x-axis quantity
 * (wavelength or angle of incidence) to a y-axis quantity (T, R, A — for
 * any polarization) at fixed values of the non-axis parameters.
 *
 * Pure compute helpers used by `PlotEngine.js`. No React, no global state.
 *
 * Curve spec:
 *   {
 *     id, label,
 *     xAxis: 'wavelength' | 'aoi',
 *     yChannel: 'T' | 'R' | 'A',
 *     polarization: 'avg' | 's' | 'p',
 *     surfaceMode: 'front' | 'back' | 'total',
 *     // Fixed (the non-x parameter):
 *     lambdaFixed_nm: number,   // used when xAxis = 'aoi'
 *     aoiFixed_deg:   number,   // used when xAxis = 'wavelength'
 *     // Range:
 *     rangeFrom: number,
 *     rangeTo:   number,
 *     rangeStep: number,
 *     // Visual:
 *     color, dash, width, visible
 *   }
 *
 * v1 scope: T/R/A vs (λ | AOI). v2 can add Ψ/Δ, φ, GD/GDD, |E|², admittance,
 * and per-layer quantities. The dispatch table here makes that extension easy:
 * just add new (xAxis, yChannel) handlers.
 */

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from './thinFilmMath.js';
import { buildEvalContext, evaluateOperands, calcMF, requiredLambdas } from './optimizer.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const X_AXES = ['wavelength', 'aoi'];
export const Y_CHANNELS = ['T', 'R', 'A'];
export const POLARIZATIONS = ['avg', 's', 'p'];
export const SURFACE_MODES = ['front', 'back', 'total'];
export const DASHES = ['solid', 'dot', 'dash', 'dashdot'];

const CURVE_COLORS = [
    '#4fc3f7', '#ef5350', '#66bb6a', '#ffb74d', '#ba68c8',
    '#81c784', '#ff8a65', '#7986cb', '#a1887f', '#90a4ae',
];

let _curveSeq = 1;

/**
 * Build a default new curve, populating with sensible defaults and a unique
 * color from the rotating palette.
 *
 * @param {object} [defaults]  optional fields to merge in (e.g. surfaceMode
 *                             from the active design's evalMode)
 */
export function makeDefaultCurve(defaults = {}) {
    const idx = _curveSeq++;
    const color = CURVE_COLORS[(idx - 1) % CURVE_COLORS.length];
    return {
        id: `curve_${idx}`,
        label: `${defaults.yChannel || 'T'} curve ${idx}`,
        xAxis: 'wavelength',
        yChannel: 'T',
        polarization: 'avg',
        surfaceMode: 'front',
        lambdaFixed_nm: 550,
        aoiFixed_deg:   0,
        rangeFrom: 400,
        rangeTo:   800,
        rangeStep: 5,
        color,
        dash: 'solid',
        width: 2,
        visible: true,
        ...defaults,
    };
}

/**
 * Generate the x-axis sample points for a curve (clamped & validated).
 */
export function xSamples(curve) {
    const { rangeFrom, rangeTo, rangeStep } = curve;
    const a = Math.min(rangeFrom, rangeTo);
    const b = Math.max(rangeFrom, rangeTo);
    const s = Math.max(1e-6, Math.abs(rangeStep || 1));
    const out = [];
    for (let v = a; v <= b + 1e-9; v += s) {
        out.push(Math.round(v * 1000) / 1000);
        if (out.length > 50000) break;  // safety cap
    }
    return out;
}

/**
 * Extract the right y value from an evaluateSpectrum result, given the
 * polarization + channel. The full result already has Rs/Ts/As/Rp/Tp/Ap.
 */
function pickChannel(out, pol, channel) {
    if (pol === 's') return out[`${channel}s`];
    if (pol === 'p') return out[`${channel}p`];
    return out[channel];
}

/**
 * Compute one curve's (x, y) arrays.
 *
 * Caller supplies the design state (already resolved materials) so this
 * helper stays pure and testable.
 *
 * @param {object} curve
 * @param {{ incMat, subMat, exitMat, frontLayers, backLayers, subThickness_mm }} ctx
 * @returns {{ x:number[], y:number[] }}
 */
export function computeCurve(curve, ctx) {
    if (!curve || !ctx) return { x: [], y: [] };
    const xs = xSamples(curve);

    if (curve.xAxis === 'wavelength') {
        // Sweep λ; AOI fixed.
        const params = {
            lambdaStart: xs[0],
            lambdaEnd:   xs[xs.length - 1],
            lambdaStep:  curve.rangeStep,
            theta:        curve.aoiFixed_deg,
            polarization: curve.polarization,
        };
        const out = runSpectrum(curve.surfaceMode, params, ctx);
        const y = pickChannel(out, curve.polarization, curve.yChannel);
        return { x: out.lambda, y };
    }

    if (curve.xAxis === 'aoi') {
        // Sweep AOI at fixed λ. We have to call the TMM per-AOI.
        const lam = curve.lambdaFixed_nm;
        const x = xs;
        const y = new Array(x.length);
        for (let i = 0; i < x.length; i++) {
            const params = {
                lambdaStart: lam,
                lambdaEnd:   lam,
                lambdaStep:  1,
                theta:       x[i],
                polarization: curve.polarization,
            };
            const out = runSpectrum(curve.surfaceMode, params, ctx);
            const channel = pickChannel(out, curve.polarization, curve.yChannel);
            y[i] = channel[0];
        }
        return { x, y };
    }

    return { x: [], y: [] };
}

function runSpectrum(surfaceMode, params, ctx) {
    if (surfaceMode === 'back') {
        return evaluateSpectrumBack(params, ctx.exitMat, ctx.subMat, ctx.backLayers || []);
    }
    if (surfaceMode === 'total') {
        return evaluateSpectrumTotal(
            params, ctx.incMat, ctx.subMat, ctx.exitMat,
            ctx.frontLayers || [], ctx.backLayers || [],
            ctx.subThickness_mm ?? 1.0,
        );
    }
    // default: front
    return evaluateSpectrum(params, ctx.incMat, ctx.subMat, ctx.frontLayers || []);
}

// ── Axis units / labels ──────────────────────────────────────────────────────

export function xAxisLabel(xAxis) {
    if (xAxis === 'aoi') return 'AOI (°)';
    return 'λ (nm)';
}

export function yAxisLabel(yChannels) {
    // Single channel → unit; mixed → generic "Intensity"
    if (!yChannels || yChannels.length === 0) return 'Value';
    const u = yChannels[0];
    if (yChannels.every(c => c === u)) {
        return { T: 'Transmittance', R: 'Reflectance', A: 'Absorptance' }[u] || 'Value';
    }
    return 'T / R / A';
}

/**
 * Suggested numeric formatter for a curve's y values (hover tooltip).
 */
export function yFormatter(yChannel) {
    return (v) => Number.isFinite(v) ? v.toFixed(4) : '—';
}

// ═══════════════════════════════════════════════════════════════════════════
// 3D surface plotting
//
// Plot a scalar quantity Z over TWO swept variables. Two Z families:
//   • Optical (T / R / A) at a single (λ, AOI) probe — reuses the validated
//     runSpectrum path; thickness / n / k overrides clone the front stack.
//   • Merit Function — reuses buildEvalContext + evaluateOperands + calcMF, so
//     it's the SAME MF the optimizer minimizes (the "optimization landscape").
//
// An axis variable is one of:
//   'wavelength'      λ in nm           (optical Z only)
//   'aoi'             angle of incidence in °  (optical Z only)
//   'thk:<i>'         thickness of front layer i (nm)
//   'n:<i>'           refractive index n of front layer i (constant-index what-if)
//   'k:<i>'           extinction k of front layer i (constant-index what-if)
//
// n / k sweeps replace that layer with a NON-dispersive constant-index material
// (the un-swept member of the n,k pair is taken from the layer's nominal value
// at the probe λ for optical, or at 550 nm for MF). This is an explicit
// what-if — the real material's dispersion is bypassed for the swept layer only.
// ═══════════════════════════════════════════════════════════════════════════

export const Z_QUANTITIES = ['T', 'R', 'A', 'MF'];
export const SURFACE_RENDERS = ['surface', 'heatmap'];
export const COLORSCALES = ['Viridis', 'Cividis', 'Jet', 'Hot', 'Portland', 'Electric', 'Greys'];

const MAX_AXIS_STEPS = 400;     // per-axis sample cap
const MAX_GRID_POINTS = 90000;  // total (nx·ny) cap — guards pathological grids

/** A constant-index ("what-if") pseudo-material: getNK returns [n,k] for all λ. */
function constMaterial(n, k) {
    const nk = [n, k];
    return { name: `n=${n.toFixed(3)} k=${k.toFixed(3)}`, getNK: () => nk };
}

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
    if (p.kind === 'lambda') return { from: 400, to: 800 };
    if (p.kind === 'aoi')    return { from: 0,   to: 60 };
    const l = (design?.frontLayers || [])[p.layer];
    if (p.kind === 'thk') {
        const d = (l?.thickness) || 100;
        return { from: Math.max(1, Math.round(d * 0.5)), to: Math.round(d * 1.5) };
    }
    if (p.kind === 'n') return { from: 1.3, to: 2.6 };
    if (p.kind === 'k') return { from: 0,   to: 0.1 };
    return { from: 0, to: 1 };
}

/** Linearly spaced sample array (inclusive), clamped to [2, MAX_AXIS_STEPS]. */
function linspace(from, to, steps) {
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

/** Collect per-layer overrides {thk?,n?,k?} from the two axis values. */
function collectLayerOverrides(spec, xv, yv) {
    const byLayer = {};
    let lambda = spec.fixedLambda_nm, aoi = spec.fixedAOI_deg;
    for (const [varTok, value] of [[spec.xVar, xv], [spec.yVar, yv]]) {
        const p = parseAxisVar(varTok);
        if (p.kind === 'lambda') lambda = value;
        else if (p.kind === 'aoi') aoi = value;
        else (byLayer[p.layer] || (byLayer[p.layer] = {}))[p.kind] = value;
    }
    return { byLayer, lambda, aoi };
}

/** Apply n/k overrides to a resolved material, sampling un-swept member at λ. */
function overrideMaterial(baseMat, ov, refLambda) {
    if (ov.n == null && ov.k == null) return baseMat;
    const nk0 = baseMat.getNK(refLambda);
    const n = ov.n != null ? ov.n : nk0[0];
    const k = ov.k != null ? ov.k : nk0[1];
    return constMaterial(n, k);
}

// ── Optical Z (T/R/A) at one (λ, AOI) with overridden front stack ─────────────
function opticalSurfaceZ(spec, baseCtx, xv, yv) {
    const { byLayer, lambda, aoi } = collectLayerOverrides(spec, xv, yv);
    const frontLayers = baseCtx.frontLayers.map((l, i) => {
        const ov = byLayer[i];
        if (!ov) return l;
        return {
            material: overrideMaterial(l.material, ov, lambda),
            thickness: ov.thk != null ? ov.thk : l.thickness,
        };
    });
    const ctx = { ...baseCtx, frontLayers };
    const params = { lambdaStart: lambda, lambdaEnd: lambda, lambdaStep: 1, theta: aoi, polarization: spec.polarization };
    const out = runSpectrum(spec.surfaceMode, params, ctx);
    const ch = pickChannel(out, spec.polarization, spec.z);
    return ch && ch.length ? ch[0] : NaN;
}

// ── Merit-function Z over two design parameters ───────────────────────────────
// `optical=true` plots the OMF (excludes MNT/MXT/TT thickness constraints).
function meritSurfaceZ(spec, evalCtx, operands, xv, yv, optical = false) {
    const { byLayer } = collectLayerOverrides(spec, xv, yv);
    const isBackOnly = evalCtx.surfaceMode === 'back_only';
    const frontThicks = evalCtx.frontThicks.slice();
    const frontMats   = evalCtx.frontMats.slice();
    const backThicks  = evalCtx.backThicks  ? evalCtx.backThicks.slice()  : [];
    const backMats    = evalCtx.backMats    ? evalCtx.backMats.slice()    : [];
    for (const key in byLayer) {
        const i = +key, ov = byLayer[key];
        // In back_only mode axis tokens (thk:i, n:i, k:i) address the back stack.
        if (isBackOnly) {
            if (ov.thk != null) backThicks[i] = ov.thk;
            if ((ov.n != null || ov.k != null) && evalCtx.backMats[i])
                backMats[i] = overrideMaterial(evalCtx.backMats[i], ov, 550);
        } else {
            if (ov.thk != null) frontThicks[i] = ov.thk;
            if (ov.n != null || ov.k != null) frontMats[i] = overrideMaterial(evalCtx.frontMats[i], ov, 550);
        }
    }
    const ctx = { ...evalCtx, frontThicks, frontMats, backThicks, backMats };
    if (evalCtx.surfaceMode === 'symmetric') {
        ctx.backThicks = [...frontThicks].reverse();
        ctx.backMats   = [...frontMats].reverse();
    }
    ctx.fullThicks = evalCtx.surfaceMode === 'both_independent'
        ? [...frontThicks, ...backThicks]
        : isBackOnly ? backThicks : frontThicks;
    const computed = evaluateOperands(operands, ctx);
    return calcMF(operands, computed, optical ? { skipConstraints: true } : undefined);
}

// ── Batched optical row along a wavelength axis (WASM-friendly) ────────────────
// When one axis IS wavelength and the OTHER axis is λ-independent (AOI or layer
// thickness), the whole λ row is one evaluateSpectrum call — which dispatches to
// the batched WASM spectrum kernel — instead of N separate 1-λ TMMs. Bit-
// identical to the per-point path (no per-λ material-reference sampling here, so
// the un-swept-member subtlety of n/k overrides never applies). Returns the Z
// array over `lambdas`, or null if it can't batch (caller falls back per-point).
function opticalLambdaRow(spec, baseCtx, lambdas, otherVar, otherVal) {
    const p = parseAxisVar(otherVar);
    let aoi = spec.fixedAOI_deg;
    let frontLayers = baseCtx.frontLayers;
    if (p.kind === 'aoi') {
        aoi = otherVal;
    } else if (p.kind === 'thk') {
        frontLayers = baseCtx.frontLayers.map((l, i) =>
            i === p.layer ? { material: l.material, thickness: otherVal } : l);
    } else {
        return null;   // n/k override needs per-λ reference sampling → per-point
    }
    const step = (lambdas[lambdas.length - 1] - lambdas[0]) / (lambdas.length - 1);
    if (!(step > 0)) return null;   // degenerate λ range → per-point (avoids a 0-step spectrum loop)
    const params = {
        lambdaStart: lambdas[0], lambdaEnd: lambdas[lambdas.length - 1],
        lambdaStep: step, theta: aoi, polarization: spec.polarization,
    };
    const res = runSpectrum(spec.surfaceMode, params, { ...baseCtx, frontLayers });
    const ch = pickChannel(res, spec.polarization, spec.z);
    // Guard: the spectrum kernel regenerates its own uniform λ grid; if the
    // sample count drifts (float edges), bail so the caller stays per-point.
    if (!ch || ch.length !== lambdas.length) return null;
    return ch.slice();
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

/**
 * Compute a Z(x, y) surface grid.
 *
 * @param {object} spec      a surface spec (see makeDefaultSurfaceSpec)
 * @param {object} design    the active design
 * @param {(id:any)=>object} resolveMat  material resolver (id → {getNK})
 * @param {{rowFrom?:number, rowTo?:number}} [opts]  fill only rows [rowFrom,rowTo)
 *          (the rest of z stays empty) — used to fan the sweep across a worker
 *          pool by Y-row chunk. Defaults to the full grid.
 * @returns {{ ok:boolean, error?:string, x:number[], y:number[], z:number[][],
 *             zLabel:string, nPoints:number }}
 *          z[j][i] = Z at (x[i], y[j]) — Plotly surface/heatmap row-major order.
 */
export function computeSurface(spec, design, resolveMat, opts = {}) {
    if (!spec || !design) return { ok: false, error: 'no spec/design', x: [], y: [], z: [] };
    const isMF  = spec.z === 'MF';

    // Guard: MF axes must be design parameters (λ/AOI are integrated out in MF).
    if (isMF && (!isLayerVar(spec.xVar) || !isLayerVar(spec.yVar))) {
        return { ok: false, error: 'MF axes must be layer parameters (thickness / n / k).', x: [], y: [], z: [] };
    }

    const x = linspace(spec.xFrom, spec.xTo, spec.xSteps);
    const y = linspace(spec.yFrom, spec.yTo, spec.ySteps);
    const nPoints = x.length * y.length;
    if (nPoints > MAX_GRID_POINTS) {
        return { ok: false, error: `Grid too large (${nPoints} > ${MAX_GRID_POINTS} points). Reduce steps.`, x: [], y: [], z: [] };
    }

    const rowFrom = Math.max(0, opts.rowFrom ?? 0);
    const rowTo   = Math.min(y.length, opts.rowTo ?? y.length);
    const fullRange = rowFrom === 0 && rowTo === y.length;
    const z = new Array(y.length);

    if (isMF) {
        const operands = (design.meritOperands || []).filter(op => op && op.enabled);
        if (!operands.length) {
            return { ok: false, error: 'No enabled merit operands. Set up targets in the Merit Function Editor.', x: [], y: [], z: [] };
        }
        const evalCtx = buildEvalContext(design, resolveMat);
        for (let j = rowFrom; j < rowTo; j++) {
            const row = new Array(x.length);
            for (let i = 0; i < x.length; i++) row[i] = meritSurfaceZ(spec, evalCtx, operands, x[i], y[j]);
            z[j] = row;
        }
        return { ok: true, x, y, z, zLabel: 'Merit Function', nPoints };
    }

    // Optical Z — build a resolved base context once. Front layers keep their
    // FULL list (incl. zero-thickness) so layer-index overrides stay aligned
    // with buildAxisVarOptions; evaluateSpectrum filters d>0 internally, so a
    // layer swept up from 0 simply becomes active.
    const baseCtx = {
        incMat:  resolveMat(design.incidentMedium),
        subMat:  resolveMat(design.substrate?.material),
        exitMat: resolveMat(design.exitMedium),
        frontLayers: (design.frontLayers || [])
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness || 0 })),
        backLayers: (design.backLayers || []).filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness })),
        subThickness_mm: design.substrate?.thickness ?? 1.0,
    };

    const xk = parseAxisVar(spec.xVar).kind, yk = parseAxisVar(spec.yVar).kind;
    const lamOnX = xk === 'lambda', lamOnY = yk === 'lambda';
    const perPointRow = (j) => {
        const row = new Array(x.length);
        for (let i = 0; i < x.length; i++) row[i] = opticalSurfaceZ(spec, baseCtx, x[i], y[j]);
        return row;
    };

    if (lamOnX) {
        // Each Y row is an independent batched λ-row (falls back per-point per row
        // if it can't batch). Row-independent → parallelizes cleanly.
        for (let j = rowFrom; j < rowTo; j++) {
            z[j] = opticalLambdaRow(spec, baseCtx, x, spec.yVar, y[j]) || perPointRow(j);
        }
    } else if (lamOnY && fullRange) {
        // λ on Y: batch along COLUMNS (one λ-sweep per x value). Only when we own
        // the whole grid — a row subset can't column-batch, so it goes per-point.
        const cols = x.map(ov => opticalLambdaRow(spec, baseCtx, y, spec.xVar, ov));
        if (cols.every(Boolean)) {
            for (let j = 0; j < y.length; j++) {
                const row = new Array(x.length);
                for (let i = 0; i < x.length; i++) row[i] = cols[i][j];
                z[j] = row;
            }
        } else {
            for (let j = 0; j < y.length; j++) z[j] = perPointRow(j);
        }
    } else {
        for (let j = rowFrom; j < rowTo; j++) z[j] = perPointRow(j);
    }
    const zLabel = { T: 'Transmittance', R: 'Reflectance', A: 'Absorptance' }[spec.z] || spec.z;
    return { ok: true, x, y, z, zLabel, nPoints };
}

/** Axis title for a surface axis variable. */
export function surfaceAxisLabel(varTok, design) {
    const opts = buildAxisVarOptions(design, true);
    const found = opts.find(o => o.value === varTok);
    return found ? found.label : varTok;
}
