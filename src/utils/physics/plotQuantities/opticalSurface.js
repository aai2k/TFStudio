/**
 * Optical Z (T/R/A) surface — samples the validated runSpectrum path at each
 * (x, y) grid point, with thickness / n / k overrides cloning the front stack.
 */

import { parseAxisVar } from './axisVars.js';
import { collectLayerOverrides } from './layerOverrides.js';
import { overrideMaterial } from './materialOverride.js';
import { pickChannel, runSpectrum } from './spectrumRunner.js';

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

// Front layers keep their FULL list (incl. zero-thickness) so layer-index
// overrides stay aligned with buildAxisVarOptions; evaluateSpectrum filters
// d>0 internally, so a layer swept up from 0 simply becomes active.
function buildOpticalBaseCtx(design, resolveMat) {
    return {
        incMat:  resolveMat(design.incidentMedium),
        subMat:  resolveMat(design.substrate?.material),
        exitMat: resolveMat(design.exitMedium),
        frontLayers: (design.frontLayers || [])
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness || 0 })),
        backLayers: (design.backLayers || []).filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness })),
        subThickness_mm: design.substrate?.thickness ?? 1.0,
    };
}

function perPointRow(spec, baseCtx, x, yVal) {
    const row = new Array(x.length);
    for (let i = 0; i < x.length; i++) row[i] = opticalSurfaceZ(spec, baseCtx, x[i], yVal);
    return row;
}

// Each Y row is an independent batched λ-row (falls back per-point per row if
// it can't batch). Row-independent → parallelizes cleanly.
function fillLambdaOnXRows(z, spec, baseCtx, grid) {
    const { x, y, rowFrom, rowTo } = grid;
    for (let j = rowFrom; j < rowTo; j++) {
        z[j] = opticalLambdaRow(spec, baseCtx, x, spec.yVar, y[j]) || perPointRow(spec, baseCtx, x, y[j]);
    }
}

// λ on Y: batch along COLUMNS (one λ-sweep per x value). Only called when we
// own the whole grid — a row subset can't column-batch, so it goes per-point.
function fillLambdaOnYRows(z, spec, baseCtx, grid) {
    const { x, y } = grid;
    const cols = x.map(ov => opticalLambdaRow(spec, baseCtx, y, spec.xVar, ov));
    if (cols.every(Boolean)) {
        for (let j = 0; j < y.length; j++) {
            const row = new Array(x.length);
            for (let i = 0; i < x.length; i++) row[i] = cols[i][j];
            z[j] = row;
        }
    } else {
        for (let j = 0; j < y.length; j++) z[j] = perPointRow(spec, baseCtx, x, y[j]);
    }
}

function fillPerPointRows(z, spec, baseCtx, grid) {
    const { x, y, rowFrom, rowTo } = grid;
    for (let j = rowFrom; j < rowTo; j++) z[j] = perPointRow(spec, baseCtx, x, y[j]);
}

/**
 * Compute the optical (T/R/A) surface over `grid` = {x, y, rowFrom, rowTo, nPoints}.
 * `fullRange` is true when the caller owns the whole grid (no worker row-chunking),
 * which unlocks the column-batched λ-on-Y path.
 */
export function computeOpticalSurface(spec, design, resolveMat, grid, fullRange) {
    const { x, y, nPoints } = grid;
    const baseCtx = buildOpticalBaseCtx(design, resolveMat);
    const xk = parseAxisVar(spec.xVar).kind, yk = parseAxisVar(spec.yVar).kind;
    const lamOnX = xk === 'lambda', lamOnY = yk === 'lambda';

    const z = new Array(y.length);
    if (lamOnX) {
        fillLambdaOnXRows(z, spec, baseCtx, grid);
    } else if (lamOnY && fullRange) {
        fillLambdaOnYRows(z, spec, baseCtx, grid);
    } else {
        fillPerPointRows(z, spec, baseCtx, grid);
    }
    const zLabel = { T: 'Transmittance', R: 'Reflectance', A: 'Absorptance' }[spec.z] || spec.z;
    return { ok: true, x, y, z, zLabel, nPoints };
}
