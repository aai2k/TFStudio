/**
 * Per-layer deposition step for simulateRunMono. `ctx` bundles the run's
 * invariant config + material arrays; `mut` bundles the mutable
 * accumulators/state threaded across layers (as-built arrays, the OU
 * rate-process maps, and the running deposition clock).
 */

import { _realizedRate, _timeCut, _applyShutter } from './layerDeposition.js';
import { _scanCutMono } from './scanCutMono.js';

// Per-layer monitor row + resolved strategy. Excluded (time/quartz) layers
// always use 'time'; otherwise the row's own strategy (default 'turning').
function resolveMonoLayerPlan(i, ctx) {
    const monRow = ctx.monTable[i] || {};
    const monLam = monRow.lambda || ctx.refLam;
    const order  = Math.max(1, Math.floor(monRow.order || 1));
    const isExcluded = !!(ctx.excludeLayers && ctx.excludeLayers.has(i));
    const strat = isExcluded ? 'time' : (monRow.strategy || 'turning');
    return { monRow, monLam, order, isExcluded, strat };
}

// Relative-thickness-error % for the 'time' strategy: the excluded-layer
// spec for quartz-monitored layers, else the monitor row's own sigmaRelPct.
function timeCutRelPct(i, plan, relThkErrByLayer) {
    return plan.isExcluded
        ? (relThkErrByLayer ? (relThkErrByLayer[i] || 0) : 0)
        : (plan.monRow.sigmaRelPct || 0);
}

export function processMonoLayer(i, layer, ctx, mut) {
    const d_target = Math.max(0, layer.thickness || 0);
    const matId    = layer.material;
    const plan = resolveMonoLayerPlan(i, ctx);
    mut.acc.cutStrategies[i] = plan.strat;

    // Realized rate via OU correlated process (identical to simulateRun).
    const rateSpec = ctx.rates.get(matId) || { mean: 0.5, sigma: 0 };
    const dtc = Math.max(0, mut.tElapsed - (mut.ouLastT.get(matId) ?? 0));
    const r = _realizedRate(rateSpec, mut.ouRate.get(matId), dtc, ctx.rng);
    mut.ouRate.set(matId, r);
    mut.acc.realizedRates[i] = r;

    const t_target = d_target / r;
    let cut_time = t_target;
    let cut_d_actual = r * t_target;   // fallback: dead-reckon to target
    const cut_d_hat = d_target;

    if (plan.strat === 'time') {
        const relPct = timeCutRelPct(i, plan, ctx.relThkErrByLayer);
        ({ cut_d_actual, cut_time } = _timeCut(d_target, r, relPct, ctx.rng));
        mut.t_global += t_target;
    } else if (d_target > 0) {
        const scan = _scanCutMono({
            monLam: plan.monLam, theta: ctx.theta, pol: ctx.pol, char: ctx.char,
            incMat: ctx.incMat, subMat: ctx.subMat, modelMats: ctx.modelMats,
            modelThicksPrev: mut.modelThicksPrev,
            i, d_target, truthMats: ctx.truthMats, truthThicksPrev: mut.truthThicksPrev,
            r, dt: ctx.dt, t_target, confirmScans: ctx.confirmScans,
            noiseFrac: ctx.randomPct / 100, driftSlope: ctx.driftSlope,
            strat: plan.strat, order: plan.order, rng: ctx.rng,
            t_global: mut.t_global, cut_d_actual, cut_time,
        });
        cut_d_actual = scan.cut_d_actual;
        cut_time     = scan.cut_time;
        mut.t_global = scan.t_global;
    }

    if (ctx.shutterMeanS > 0 || ctx.shutterRmsS > 0) {
        ({ cut_d_actual, cut_time } = _applyShutter(cut_d_actual, cut_time, r,
            { meanS: ctx.shutterMeanS, rmsS: ctx.shutterRmsS }, ctx.rng));
    }

    mut.acc.asBuilt[i] = Math.max(0, cut_d_actual);
    mut.acc.cutTimes[i] = cut_time;
    if (mut.acc.estimated) mut.acc.estimated[i] = cut_d_hat;

    mut.tElapsed += cut_time;
    mut.ouLastT.set(matId, mut.tElapsed);
    if (ctx.onLayer) ctx.onLayer(i + 1, ctx.N);

    mut.truthThicksPrev.push(mut.acc.asBuilt[i]);
    mut.modelThicksPrev.push(mut.acc.asBuilt[i]);
}
