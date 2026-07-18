/**
 * Single-run broadband monitoring simulator: orchestrates one deposition run
 * layer-by-layer, delegating the realized-rate draw, the optical cut search
 * (or its excluded/time-monitored fallback), and the post-cut thickness
 * deviations to the sibling helper modules.
 */

import { gauss } from './rng.js';
import { drawFrontMaterialDeltas } from './materialPerturbation.js';
import { parseMaterialRateConfig, parseMonitorConfig, parseSignalConfig, parseLayerConfig } from './simulateRunConfig.js';
import { processLayer } from './layerLoop.js';

/**
 * Simulate one deposition run.
 *
 * @param {object} design        TFStudio design object (CLAUDE.md schema)
 * @param {Function} resolveMat  id → material object (with `.getNK(λ)`)
 * @param {object} cfg
 *   - rates:            Map<materialId, { mean: nm/s, sigma: nm/s }>
 *                       per-material deposition-rate stats. Missing materials
 *                       default to { mean: 0.5, sigma: 0 }.
 *   - sigmaReN:         absolute σ on Re(n) per-material (default 0)
 *   - sigmaImN:         absolute σ on Im(n) per-material (default 0)
 *   - perMaterial:      true → one Δn/Δk draw shared across all layers of the
 *                       same material id (default true)
 *   - sigmaThkAbsNm:    extra additive σ on as-built thickness (nm), independent
 *                       of monitoring (e.g. shutter jitter). Default 0.
 *   - sigmaThkRelPct:   extra relative σ on as-built thickness (%). Default 0.
 *   - mon: monitoring system config
 *       - char:        'T' | 'R'           (default 'T')
 *       - theta:       deg                  (default 0)
 *       - polarization:'s'|'p'|'avg'       (default 'avg')
 *       - lambdaStart, lambdaEnd: nm        (default 400, 1000)
 *       - nPoints:     samples per scan     (default 41)
 *       - scanIntervalSec: time between scans (default 0.5)
 *       - confirmScans: # consecutive scans with d_hat ≥ d_target needed to
 *                       trigger cut (default 2). Suppresses single-scan
 *                       outliers from noisy spectra.
 *   - sig: signal-error config
 *       - randomPct:   per-point Gaussian random noise (% of signal). Default 1.
 *       - driftPctPer1000s: linear drift (additive percentage points per 1000 s)
 *                          drawn once per run as N(0, driftPctPer1000s/√3) and
 *                          accumulated linearly. Default 0.
 *   - rng:             Math.random()-style function (default Math.random)
 *
 * @returns {{
 *   asBuiltFront: number[],     // as-built thickness per front layer (nm)
 *   targetFront:  number[],     // theoretical target thickness per layer
 *   matDeltas:    {dn:number,dk:number}[],   // per-layer Δn, Δk applied
 *   cutTimes:     number[],     // cut time per layer (s)
 *   rates:        number[],     // realized rate per layer (nm/s)
 * }}
 */
export function simulateRun(design, resolveMat, cfg) {
    const rateCfg  = parseMaterialRateConfig(cfg);
    const monCfg   = parseMonitorConfig(cfg);
    const sigCfg   = parseSignalConfig(cfg);
    const layerCfg = parseLayerConfig(cfg);
    const { rng } = rateCfg;

    // Build scan λ grid (uniform in λ)
    const lambdas = new Float64Array(monCfg.nPoints);
    const stepLam = (monCfg.lamB - monCfg.lamA) / (monCfg.nPoints - 1);
    for (let i = 0; i < monCfg.nPoints; i++) lambdas[i] = monCfg.lamA + i * stepLam;

    const incId  = typeof design.incidentMedium === 'string' ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const subId  = design.substrate?.material ?? 'BK7';
    const incMat = resolveMat(incId);
    const subMat = resolveMat(subId);

    const front = (design.frontLayers || []).map(l => ({ ...l }));
    const N = front.length;

    // Per-material refractive-index deviation override (systematic + random);
    // falls back to the global sigmaReN/sigmaImN model when absent.
    const { modelMats, truthMats, layerDeltas } = drawFrontMaterialDeltas({
        front, resolveMat,
        perMaterial: rateCfg.perMaterial, matDev: rateCfg.matDev,
        sigmaReN: rateCfg.sigmaReN, sigmaImN: rateCfg.sigmaImN, rng,
    });

    // ── Draw drift rate (once per run) ────────────────────────────────────────
    // Linear in time, additive to T_meas. driftPctPer1000s is a tolerance; we
    // draw the actual drift slope from N(0, σ_drift) so the corridor is symmetric.
    // Convert to fraction-per-second:  slope = drawn_pct / 100 / 1000
    const driftSlope = sigCfg.driftPctPer1000s > 0
        ? (gauss(rng) * sigCfg.driftPctPer1000s) / 100 / 1000
        : 0;

    const acc = {
        asBuilt:       new Array(N),
        cutTimes:      new Array(N),
        realizedRates: new Array(N),
        estimated:     layerCfg.recordTrajectory ? new Array(N) : null,   // monitor d_hat at cut
    };

    // Mutable state threaded across layers: `t_global` is cumulative time
    // across ALL layers (for drift); the OU maps + `tElapsed` give the
    // realized per-layer rate temporal correlation across layers of the same
    // material at the user's correlation time. `truthThicksPrev` /
    // `modelThicksPrev` are the truth/model as-built history the monitor
    // fits against (v1 assumes the monitor tracks its own as-built).
    const mut = {
        acc,
        truthThicksPrev: [],
        modelThicksPrev: [],
        ouRate:  new Map(),   // matId → last realized rate
        ouLastT: new Map(),   // matId → cumulative time at last deposition
        tElapsed: 0,          // cumulative deposition time at layer start
        t_global: 0,
    };

    const ctx = {
        ...monCfg, ...sigCfg, ...layerCfg,
        rng, rates: rateCfg.rates,
        incMat, subMat, lambdas, modelMats, truthMats, driftSlope,
        N, onLayer: cfg.onLayer,
    };

    for (let i = 0; i < N; i++) {
        processLayer(i, front[i], ctx, mut);
    }

    const out = {
        asBuiltFront: acc.asBuilt,
        targetFront:  front.map(l => l.thickness || 0),
        matDeltas:    layerDeltas,
        cutTimes:     acc.cutTimes,
        rates:        acc.realizedRates,
    };
    if (layerCfg.recordTrajectory) {
        // Per-layer trajectory for the live deposition view (page 5) and the
        // resulting-performance tables (page 6).
        out.estimatedFront = acc.estimated;
        out.materialsFront = front.map(l => l.material);
    }
    return out;
}
