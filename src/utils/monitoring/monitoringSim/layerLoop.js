/**
 * Per-layer deposition step for simulateRun. `ctx` bundles the run's
 * invariant config + material arrays; `mut` bundles the mutable
 * accumulators/state threaded across layers (as-built arrays, the OU
 * rate-process maps, and the running deposition clock).
 */

import {
    drawRealizedRate, startLayerGrowth, growLayer, excludedLayerCut, drawExtraThickness, drawShutterDelay,
} from './layerDeposition.js';
import { runBroadbandLayerCut } from './broadbandCutSearch.js';
import { recordZeroThicknessLayer } from '../zeroThicknessLayer.js';

// Optical-feedback cut search bounds + call for one non-excluded layer. The
// fit's allowed range runs to three times the target (at least 50 nm past it).
function runLayerCutSearch({ i, d_target, chamber, rateSpec }, ctx, mut) {
    const dHiCap = Math.max(d_target * 3, d_target + 50);
    const scan = runBroadbandLayerCut({
        theta: ctx.theta, incMat: ctx.incMat, subMat: ctx.subMat, subThickMM: ctx.subThickMM,
        truthMats: ctx.truthMats, modelMats: ctx.modelMats, i,
        truthThicksBelow: mut.truthThicks.slice(i + 1),
        modelThicksBelow: mut.modelThicks.slice(i + 1),
        lambdas: ctx.lambdas, char: ctx.char, pol: ctx.pol,
        chamber, rateSpec, dt: ctx.dt, d_target, dHiCap, confirmScans: ctx.confirmScans,
        randomPct: ctx.randomPct, absNoisePct: ctx.absNoisePct || 0, driftSlope: ctx.driftSlope,
        fitStartFrac: ctx.fitStartFrac, rng: ctx.rng,
        t_global: mut.t_global,
    });
    mut.t_global = scan.t_global;
    return scan;
}

export function processLayer(i, layer, ctx, mut) {
    const d_target = Math.max(0, layer.thickness || 0);
    const matId    = layer.material;

    // Disabled layers never enter the cut search or receive shutter latency.
    if (d_target <= 0) {
        recordZeroThicknessLayer(i, ctx, mut);
        return;
    }

    // The rate at the start of the layer continues this material's OU
    // process from where its last layer left it; inside the layer the
    // chamber steps the same process at the scan interval.
    const rateSpec = ctx.rates.get(matId) || { mean: 0.5, sigma: 0 };
    const dtc = Math.max(0, mut.tElapsed - (mut.ouLastT.get(matId) ?? 0));
    const chamber = startLayerGrowth(drawRealizedRate(rateSpec, mut.ouRate.get(matId), dtc, ctx.rng));

    // Layers monitored by other means (time / quartz crystal) are excluded
    // from the broadband fit. Their as-built thickness deviates from target
    // only by the supplementary monitoring's relative thickness error.
    const isExcluded = !!(ctx.excludeLayers && ctx.excludeLayers.has(i));

    let cut;
    if (isExcluded) {
        const relPct = ctx.relThkErrByLayer ? (ctx.relThkErrByLayer[i] || 0) : 0;
        cut = excludedLayerCut(chamber, d_target, relPct, rateSpec, ctx.rng);
    } else {
        cut = runLayerCutSearch({ i, d_target, chamber, rateSpec }, ctx, mut);
    }

    // Extra thickness deviation + shutter delay (independent of monitoring);
    // the layer keeps growing at its own rate while the shutter closes, and
    // the cut time itself is unaffected.
    const extra = drawExtraThickness(d_target, ctx.sigmaThkAbsNm, ctx.sigmaThkRelPct, ctx.rng);
    const shutterDelay = drawShutterDelay(ctx.shutterMeanS, ctx.shutterRmsS, ctx.rng);
    growLayer(chamber, shutterDelay, rateSpec, ctx.rng);
    const d_built = Math.max(0, chamber.d + extra);

    mut.acc.asBuilt[i] = d_built;
    mut.acc.cutTimes[i] = cut.cut_time;
    mut.acc.realizedRates[i] = chamber.t > 0 ? chamber.d / chamber.t : chamber.r;
    if (mut.acc.estimated) mut.acc.estimated[i] = cut.cut_d_hat;

    // Advance the OU clock: record the material's rate and the time its
    // layer ended, so its next layer continues the process over the gap.
    if (isExcluded) mut.t_global += cut.cut_time;
    mut.t_global += shutterDelay;
    mut.tElapsed += cut.cut_time + shutterDelay;
    mut.ouRate.set(matId, chamber.r);
    mut.ouLastT.set(matId, mut.tElapsed);

    // Optional per-layer progress hook (used by the wizard's run worker to
    // drive a progress bar); counts completed deposition steps, so storage
    // index i maps to step N-i. MC path passes none.
    if (ctx.onLayer) ctx.onLayer(ctx.N - i, ctx.N);

    // The chamber holds what was really deposited; the monitor's model of
    // the stack holds what the monitor believes it deposited, its estimate
    // at the cut. The next layer is fitted over that model, so the monitor's
    // errors carry into the layers above.
    mut.truthThicks[i] = d_built;
    mut.modelThicks[i] = cut.cut_d_hat;
}
