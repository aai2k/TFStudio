/**
 * cfg destructuring/defaults for simulateRun, split into the logical groups
 * documented on simulateRun itself (material/rate model, monitor system,
 * signal errors, per-layer overrides). Kept as small flat functions so each
 * stays easy to read and cheap to change independently.
 */

export function parseMaterialRateConfig(cfg) {
    return {
        rng:           cfg.rng || Math.random,
        rates:         cfg.rates || new Map(),
        sigmaReN:      cfg.sigmaReN ?? 0,
        sigmaImN:      cfg.sigmaImN ?? 0,
        perMaterial:   cfg.perMaterial != null ? !!cfg.perMaterial : true,
        matDev:        cfg.matDev || null,
    };
}

export function parseMonitorConfig(cfg) {
    const mon = cfg.mon || {};
    return {
        char:         mon.char || 'T',
        theta:        mon.theta ?? 0,
        pol:          mon.polarization || 'avg',
        lamA:         mon.lambdaStart ?? 400,
        lamB:         mon.lambdaEnd ?? 1000,
        nPoints:      Math.max(3, mon.nPoints ?? 41),
        dt:           Math.max(1e-6, mon.scanIntervalSec ?? 0.5),
        confirmScans: Math.max(1, Math.floor(mon.confirmScans ?? 2)),
    };
}

export function parseSignalConfig(cfg) {
    const sig = cfg.sig || {};
    return {
        randomPct:        sig.randomPct ?? 1.0,
        driftPctPer1000s: sig.driftPctPer1000s ?? 0,
    };
}

// Extra thickness deviations independent of monitoring (shutter jitter +
// close-delay) and per-layer overrides (excluded/quartz-monitored layers,
// trajectory recording, and the two cut-search performance knobs).
export function parseLayerConfig(cfg) {
    return {
        sigmaThkAbsNm:      cfg.sigmaThkAbsNm ?? 0,
        sigmaThkRelPct:     cfg.sigmaThkRelPct ?? 0,
        shutterMeanS:       cfg.shutterDelayMeanS ?? 0,
        shutterRmsS:        cfg.shutterDelayRmsS ?? 0,
        excludeLayers:      cfg.excludeLayers || null,
        relThkErrByLayer:   cfg.relThkErrByLayer || null,
        recordTrajectory:   !!cfg.recordTrajectory,
        fitStartFrac:       cfg.fitStartFrac ?? 0.6,
        fitMaxIter:         cfg.fitMaxIter ?? 14,
    };
}
