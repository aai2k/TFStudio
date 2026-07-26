/**
 * Per-layer deposition step for simulateRun. `ctx` bundles the run's
 * invariant config + material arrays; `mut` bundles the mutable
 * accumulators/state threaded across layers (as-built arrays, the OU
 * rate-process maps, and the running deposition clock).
 */

import { drawRealizedRate, computeExcludedCut, applyExtraThicknessAndShutter } from './layerDeposition.js';
import { runBroadbandLayerCut } from './broadbandCutSearch.js';
import { recordZeroThicknessLayer } from '../zeroThicknessLayer.js';

// Optical-feedback cut search bounds + call for one non-excluded layer.
// `layer` bundles the per-layer scalars (index, target, realized rate, and
// the theoretical time-to-target) so this stays under the param-count limit.
function runLayerCutSearch({ i, d_target, r, t_target }, ctx, mut) {
    const dHiCap = Math.max(d_target * 3, d_target + 50);
    const scan = runBroadbandLayerCut({
        theta: ctx.theta, incMat: ctx.incMat, subMat: ctx.subMat,
        truthMats: ctx.truthMats, modelMats: ctx.modelMats, i,
        truthThicksBelow: mut.truthThicks.slice(i + 1),
        modelThicksBelow: mut.modelThicks.slice(i + 1),
        lambdas: ctx.lambdas, char: ctx.char, pol: ctx.pol,
        r, dt: ctx.dt, d_target, t_target, dHiCap, confirmScans: ctx.confirmScans,
        randomPct: ctx.randomPct, driftSlope: ctx.driftSlope,
        fitStartFrac: ctx.fitStartFrac, fitMaxIter: ctx.fitMaxIter, rng: ctx.rng,
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

    // Realized rate for this layer (clipped to > 0). Correlated in time via
    // an OU process at the material's correlation time τ; with τ≤0 the first
    // rng draw reduces EXACTLY to the v1 white draw  mean + σ·N(0,1)  so
    // existing Monte-Carlo runs (which pass no corrTime) stay bit-identical.
    const rateSpec = ctx.rates.get(matId) || { mean: 0.5, sigma: 0 };
    const dtc = Math.max(0, mut.tElapsed - (mut.ouLastT.get(matId) ?? 0));
    const r = drawRealizedRate(rateSpec, mut.ouRate.get(matId), dtc, ctx.rng);
    mut.ouRate.set(matId, r);
    mut.acc.realizedRates[i] = r;

    // Time to reach the target at the actual rate (purely theoretical reference)
    const t_target = d_target / r;

    // Layers monitored by other means (time / quartz crystal) are excluded
    // from the broadband fit. Their as-built thickness deviates from target
    // only by the supplementary monitoring's relative thickness error.
    const isExcluded = !!(ctx.excludeLayers && ctx.excludeLayers.has(i));

    let cut;
    if (isExcluded) {
        const relPct = ctx.relThkErrByLayer ? (ctx.relThkErrByLayer[i] || 0) : 0;
        cut = computeExcludedCut(d_target, r, relPct, ctx.rng);
    } else {
        cut = runLayerCutSearch({ i, d_target, r, t_target }, ctx, mut);
    }

    // Apply extra thickness deviation + shutter delay (independent of
    // monitoring); the cut time itself is unaffected.
    const { thickness: d_built, shutterDelay } = applyExtraThicknessAndShutter({
        cut_d_actual: cut.cut_d_actual, r, d_target,
        sigmaThkAbsNm: ctx.sigmaThkAbsNm, sigmaThkRelPct: ctx.sigmaThkRelPct,
        shutterMeanS: ctx.shutterMeanS, shutterRmsS: ctx.shutterRmsS, rng: ctx.rng,
    });

    mut.acc.asBuilt[i] = d_built;
    mut.acc.cutTimes[i] = cut.cut_time;
    if (mut.acc.estimated) mut.acc.estimated[i] = cut.cut_d_hat;

    // Advance the OU clock: record when this material was last deposited so
    // the next layer of the same material decorrelates over the elapsed time.
    if (isExcluded) mut.t_global += cut.cut_time;
    mut.t_global += shutterDelay;
    mut.tElapsed += cut.cut_time + shutterDelay;
    mut.ouLastT.set(matId, mut.tElapsed);

    // Optional per-layer progress hook (used by the wizard's run worker to
    // drive a progress bar); counts completed deposition steps, so storage
    // index i maps to step N-i. MC path passes none.
    if (ctx.onLayer) ctx.onLayer(ctx.N - i, ctx.N);

    // Update truth and model histories. The monitor's model history is the
    // monitor's BEST ESTIMATE of what it just deposited, which (in our
    // simplification) equals the as-built thickness. This is realistic for
    // BBM: the monitor's fit at cut time gives the estimated thickness,
    // and the monitor uses that estimate going forward.
    mut.truthThicks[i] = d_built;
    mut.modelThicks[i] = d_built;
}
