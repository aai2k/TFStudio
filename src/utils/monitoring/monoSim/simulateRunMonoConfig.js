/**
 * cfg destructuring/defaults for simulateRunMono, grouped the same way as
 * documented on simulateRunMono itself (material/rate model, per-layer
 * monitor table + system, signal errors, shutter/exclude overrides).
 */

export function parseMonoRateConfig(cfg) {
    return {
        rng:         cfg.rng || Math.random,
        rates:       cfg.rates || new Map(),
        sigmaReN:    cfg.sigmaReN ?? 0,
        sigmaImN:    cfg.sigmaImN ?? 0,
        perMaterial: cfg.perMaterial != null ? !!cfg.perMaterial : true,
        matDev:      cfg.matDev || null,
    };
}

export function parseMonoMonitorConfig(cfg) {
    const mon = cfg.mon || {};
    return {
        monTable:     cfg.monTable || [],
        char:         mon.char || 'T',
        theta:        mon.theta ?? 0,
        pol:          mon.polarization || 'avg',
        // The witness chip's glass; the design substrate when not set.
        chipMaterial: mon.chipMaterial || null,
        dt:           Math.max(1e-6, mon.scanIntervalSec ?? 0.5),
        confirmScans: Math.max(1, Math.floor(mon.confirmScans ?? 2)),
    };
}

export function parseMonoSignalConfig(cfg) {
    const sig = cfg.sig || {};
    return {
        randomPct:        sig.randomPct ?? 1.0,
        // The monitor's photometric noise floor, in percent of full scale: it
        // does not shrink with the signal, which is what makes a saturated
        // stopband wavelength unusable at a real monitor.
        absNoisePct:      sig.absNoisePct ?? 0,
        driftPctPer1000s: sig.driftPctPer1000s ?? 0,
    };
}

// Shutter jitter/close-delay + per-layer overrides (excluded/quartz-monitored
// layers, trajectory recording).
export function parseMonoLayerConfig(cfg) {
    return {
        shutterMeanS:      cfg.shutterDelayMeanS ?? 0,
        shutterRmsS:       cfg.shutterDelayRmsS ?? 0,
        excludeLayers:     cfg.excludeLayers || null,
        relThkErrByLayer:  cfg.relThkErrByLayer || null,
        recordTrajectory:  !!cfg.recordTrajectory,
    };
}
