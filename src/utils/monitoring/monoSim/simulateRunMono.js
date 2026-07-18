/**
 * Monochromatic (single-wavelength) Monitoring Simulator engine.
 *
 * Companion to monitoringSim.js (broadband). Broadband and monochromatic
 * monitoring are the SAME computational-manufacturing experiment differing
 * only in the cut rule, so this module deliberately mirrors simulateRun
 * (monitoringSim.js): identical cfg fields (rates + OU correlation,
 * per-material Δn/Δk, shutter delay, excluded layers, signal random/drift)
 * and an identical return shape, so the wizard reuses the same playback /
 * results / spectrum code. The ONE difference is the per-layer termination
 * rule:
 *
 *   'turning' — Turning-point (extremum) monitoring. The layer is cut when the
 *               single-wavelength signal passes its order-th extremum. Classical
 *               method for quarter-wave stacks, where the design cut coincides
 *               with a max/min of the monitor signal (the cut is first-order
 *               insensitive to small thickness errors). Macleod §12.2.
 *   'level'   — Level monitoring. The layer is cut when the signal crosses the
 *               theoretical level S(d_target) (nominal materials) in the
 *               expected direction. For non-QW (mid-slope) cuts.
 *   'time'    — Thickness / time monitoring (no optical feedback). Cut at
 *               d_target on the realized rate plus a relative-thickness error.
 *               Also used for layers excluded from optical monitoring (quartz).
 *
 * The monitor uses NOMINAL materials and its accumulated as-built history of the
 * previous layers to predict the target level / extremum, while the "true"
 * chamber signal is generated from the per-run perturbed (truth) materials —
 * exactly the BBM convention, so monitoring imprecision propagates to the final
 * spectral performance.
 *
 * References:
 *   - H. A. Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 *   - A. V. Tikhonravov & M. K. Trubetskov, Appl. Opt. 44, 6877 (2005).
 *   - A. V. Tikhonravov, M. K. Trubetskov, T. V. Amotchkina, Appl. Opt. 45,
 *     7863 (2006) — choosing a monochromatic-monitoring strategy.
 */

import { gauss } from './rng.js';
import { drawFrontMaterialDeltas } from './materialPerturbation.js';
import { parseMonoRateConfig, parseMonoMonitorConfig, parseMonoSignalConfig, parseMonoLayerConfig } from './simulateRunMonoConfig.js';
import { processMonoLayer } from './layerLoop.js';

/**
 * Simulate one monochromatic-monitoring deposition run. cfg matches
 * monitoringSim.simulateRun, except the monitoring system is per-layer:
 *   - monTable: [{ lambda, strategy:'turning'|'level'|'time', order, sigmaRelPct }]
 *   - mon:      { char, theta, polarization, scanIntervalSec, confirmScans }
 * Return shape is identical to simulateRun (+ cutStrategies).
 */
export function simulateRunMono(design, resolveMat, cfg) {
    const rateCfg  = parseMonoRateConfig(cfg);
    const monCfg   = parseMonoMonitorConfig(cfg);
    const sigCfg   = parseMonoSignalConfig(cfg);
    const layerCfg = parseMonoLayerConfig(cfg);
    const { rng } = rateCfg;
    const refLam = design.referenceWavelength || 550;

    const incId  = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId  = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = (design.frontLayers || []).map(l => ({ ...l }));
    const N = front.length;

    const { modelMats, truthMats, layerDeltas } = drawFrontMaterialDeltas({
        front, resolveMat,
        perMaterial: rateCfg.perMaterial, matDev: rateCfg.matDev,
        sigmaReN: rateCfg.sigmaReN, sigmaImN: rateCfg.sigmaImN, rng,
    });

    const driftSlope = sigCfg.driftPctPer1000s > 0
        ? (gauss(rng) * sigCfg.driftPctPer1000s) / 100 / 1000
        : 0;

    const acc = {
        asBuilt:       new Array(N),
        cutTimes:      new Array(N),
        realizedRates: new Array(N),
        cutStrategies: new Array(N),
        estimated:     layerCfg.recordTrajectory ? new Array(N) : null,
    };
    const mut = {
        acc,
        truthThicksPrev: [],
        modelThicksPrev: [],
        ouRate:  new Map(),
        ouLastT: new Map(),
        tElapsed: 0,
        t_global: 0,
    };
    const ctx = {
        ...monCfg, ...sigCfg, ...layerCfg,
        rng, rates: rateCfg.rates,
        incMat, subMat, modelMats, truthMats, driftSlope, refLam,
        N, onLayer: cfg.onLayer,
    };

    for (let i = 0; i < N; i++) {
        processMonoLayer(i, front[i], ctx, mut);
    }

    const out = {
        asBuiltFront: acc.asBuilt,
        targetFront:  front.map(l => l.thickness || 0),
        matDeltas:    layerDeltas,
        cutTimes:     acc.cutTimes,
        rates:        acc.realizedRates,
        cutStrategies: acc.cutStrategies,
    };
    if (layerCfg.recordTrajectory) {
        out.estimatedFront = acc.estimated;
        out.materialsFront = front.map(l => l.material);
    }
    return out;
}
