/**
 * Shared Page-5 (Deposition Simulation) model for the BBM / Mono wizards.
 *
 * `useDepositionPlayback` owns the interactive timeline: a wall-clock-locked
 * playback cursor over a completed run's per-layer cut times, plus play/pause,
 * reset, scrub and jump-to-layer controls. `useDepositionCurves` builds the
 * theory guide curves (end / 80 % / 90 %) and the actual as-built curve at the
 * scrub position. Both wizards feed these into the shared SimulationView; only
 * the run engine (worker vs main thread) differs.
 */

import { systemSpectrum, splitActiveStacks, partialThicknesses, flipLayerIndex } from '../../../../utils/monitoring/depositionSpectrum.js';
import { makeShiftedMaterial }                              from '../../../../utils/monitoring/monitoringSim.js';
import { lineSeries }                                       from '../../../ui/chartOptions.js';

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ── Playback helpers (pure) ─────────────────────────────────────────────────────
// Cumulative deposition clock, indexed by DEPOSITION layer (1 = substrate-
// adjacent, grown first). `run.cutTimes` is in storage order (air→substrate),
// so it is consumed back-to-front to follow the chamber's actual sequence.
function buildCumTimes(run) {
    if (!run) return [0];
    const out = [0];
    for (let i = run.cutTimes.length - 1; i >= 0; i--) out.push(out[out.length - 1] + run.cutTimes[i]);
    return out;
}

function locateLayer(progress, cumTimes, N, run) {
    if (!run || N === 0) return { layerIdx: 0, frac: 0 };
    for (let i = 0; i < N; i++) {
        if (progress < cumTimes[i + 1] - 1e-9) {
            const span = cumTimes[i + 1] - cumTimes[i];
            return { layerIdx: i + 1, frac: span > 0 ? (progress - cumTimes[i]) / span : 1 };
        }
    }
    return { layerIdx: N, frac: 1 };
}

// One playback step: advance the deposition clock, stopping at the run end.
function advance(pr, dt, timeMult, totalTime, setPlaying) {
    const np = pr + dt * timeMult;   // sim-seconds = real-seconds × speed
    if (np >= totalTime) { setPlaying(false); return totalTime; }
    return np;
}

// Wall-clock-locked playback loop. `dt` is clamped so a tab-away / GC pause
// can't make the clock leap forward.
function usePlaybackLoop(playing, totalTime, timeMult, setProgress, setPlaying) {
    const rafRef = useRef(null);
    useEffect(() => {
        if (!playing || totalTime <= 0) return undefined;
        let last = null;
        const tick = (now) => {
            if (last == null) last = now;
            const dt = Math.min((now - last) / 1000, 0.25); last = now;
            setProgress(pr => advance(pr, dt, timeMult, totalTime, setPlaying));
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [playing, totalTime, timeMult, setProgress, setPlaying]);
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
}

export function useDepositionPlayback(run, N, timeMult) {
    const [progress, setProgress] = useState(0);   // cumulative time (s)
    const [playing, setPlaying] = useState(false);

    const cumTimes = useMemo(() => buildCumTimes(run), [run]);
    const totalTime = cumTimes[cumTimes.length - 1] || 0;
    const { layerIdx, frac } = useMemo(() => locateLayer(progress, cumTimes, N, run), [progress, cumTimes, N, run]);

    usePlaybackLoop(playing, totalTime, timeMult, setProgress, setPlaying);

    const playPause = useCallback(() => {
        if (totalTime <= 0) return;
        setProgress(pr => (pr >= totalTime - 1e-9 ? 0 : pr));
        setPlaying(pl => !pl);
    }, [totalTime]);
    const reset = useCallback(() => { setPlaying(false); setProgress(0); }, []);
    const scrub = useCallback((v) => { setPlaying(false); setProgress(v); }, []);
    const jumpLayer = useCallback((k) => { setPlaying(false); setProgress(Math.max(0, cumTimes[k] - (cumTimes[k] - cumTimes[k - 1]) * 0.02)); }, [cumTimes]);

    return { progress, setProgress, playing, setPlaying, cumTimes, totalTime, layerIdx, frac, playPause, reset, scrub, jumpLayer };
}

// ── Curve helpers (pure) ─────────────────────────────────────────────────────────
// Resulting-performance spectra follow the OE evaluation mode (front semi-
// infinite / total with the real back coating / back); in total mode the
// opposite coating is present at nominal thickness.
function perfSpec(activeStored, ctx, p, lamStep) {
    const { frontStored, backStored } = splitActiveStacks(ctx.activeSide, activeStored, ctx.otherStored);
    return systemSpectrum({
        evalMode: ctx.evalMode, frontStored, backStored,
        quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
        lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: lamStep,
        incidentMat: ctx.incMat, substrateMat: ctx.subMat, exitMat: ctx.exitMat, substrateThk: ctx.subThk,
    });
}

// As-built thicknesses at the scrub position: complete layers below `layerIdx`,
// the current layer at `frac`, later layers absent. `asBuiltFront` is in storage
// order while `layerIdx` counts deposition layers (see partialThicknesses).
function asBuiltPartial(asBuiltFront, layerIdx, frac) {
    return asBuiltFront.map((d, i) => {
        const dep = flipLayerIndex(asBuiltFront.length, i);
        if (dep < layerIdx) return d;
        if (dep === layerIdx) return d * frac;
        return 0;
    });
}

function buildTheoryCurves({ run, layers, layerIdx, baseThicks, ctx, p, lamStep }) {
    if (!run || layerIdx < 1) return null;
    const mk = (f) => {
        const thk = partialThicknesses(baseThicks, layerIdx, f);
        return perfSpec(layers.map((l, i) => ({ material: ctx.resolveMat(l.material), thickness: thk[i] })), ctx, p, lamStep);
    };
    return { end: mk(1), f80: mk(0.8), f90: mk(0.9) };
}

function buildActualCurve({ run, layers, layerIdx, frac, ctx, p, lamStep }) {
    if (!run || layerIdx < 1) return null;
    const thk = asBuiltPartial(run.asBuiltFront, layerIdx, frac);
    return perfSpec(layers.map((l, i) => ({
        material: makeShiftedMaterial(ctx.resolveMat(l.material), run.matDeltas[i]?.dn || 0, run.matDeltas[i]?.dk || 0),
        thickness: thk[i],
    })), ctx, p, lamStep);
}

function percentSeries(spec, color, width) {
    return lineSeries({ x: spec.lambda, y: spec.values.map(v => v * 100), color, width });
}

function buildCurveSeries(theoryCurves, actualCurve) {
    const series = [];
    if (theoryCurves) {
        series.push(percentSeries(theoryCurves.f80, '#d9a400', 1));
        series.push(percentSeries(theoryCurves.f90, '#1f6feb', 1));
        series.push(percentSeries(theoryCurves.end, '#2da44e', 2));
    }
    if (actualCurve) series.push(percentSeries(actualCurve, '#e5484d', 2));
    return series;
}

export function useDepositionCurves({ run, layers, layerIdx, frac, ctx, p }) {
    const baseThicks = layers.map(l => l.thickness || 0);
    const lamStep = Math.max(0.8, (p.lamMax - p.lamMin) / 160);

    const theoryCurves = useMemo(
        () => buildTheoryCurves({ run, layers, layerIdx, baseThicks, ctx, p, lamStep }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [run, layerIdx, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);
    const actualCurve = useMemo(
        () => buildActualCurve({ run, layers, layerIdx, frac, ctx, p, lamStep }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [run, layerIdx, frac, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);

    return { series: buildCurveSeries(theoryCurves, actualCurve) };
}
