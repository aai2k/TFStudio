import {
    makeDefaultSurfaceSpec, computeSurface, isLayerVar, defaultAxisRange, quantitySides,
} from '../../../../utils/physics/plotQuantities.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { BASE_ENVIRONMENT } from '../../../../utils/environments/environments.js';
import { surfaceEnvironment, withEnvironment } from './environmentField.js';
import { runSurfaceSweep } from './surfaceRunner.js';
import { plotEngineSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useAfterRefreshAll } from '../../../../state/refreshAll.js';

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// Reads the surface state from the session store, building a default
// specification while the design has none of its own yet.
function useStoredSurfaceState(design, evalMode) {
    const [session, setField] = useWindowSession(plotEngineSession, design);
    // Memoised so the substituted default is one stable object rather than a new
    // one per render, which would re-run the sweep effects on every render.
    const surfaceSpec = useMemo(
        () => session.surfaceSpec || makeDefaultSurfaceSpec(design, { surfaceMode: evalMode || 'front' }),
        [session.surfaceSpec, design, evalMode],
    );
    const setSurfaceSpec = useCallback(next => {
        setField('surfaceSpec', current => {
            const base = current || makeDefaultSurfaceSpec(design, { surfaceMode: evalMode || 'front' });
            return typeof next === 'function' ? next(base) : next;
        });
    }, [setField, design, evalMode]);
    return {
        plotMode: session.plotMode,
        setPlotMode: value => setField('plotMode', value),
        surfaceSpec,
        setSurfaceSpec,
        surfaceResult: session.surfaceResult,
        setSurfaceResult: value => setField('surfaceResult', value),
        showTable: session.showTable,
        setShowTable: value => setField('showTable', value),
    };
}

// A quantity read on fewer sides than the one set is read on its first, as a
// curve's axis is (curveEdits.js).
function onItsSide(spec) {
    const sides = quantitySides(spec.z);
    return sides.length && !sides.includes(spec.surfaceMode) ? { ...spec, surfaceMode: sides[0] } : spec;
}

export function patchSurfaceSpec(previous, patch, design) {
    const next = onItsSide({ ...previous, ...patch });
    if (patch.z !== 'MF') return next;
    const nLayers = (design?.frontLayers || []).length;
    if (!isLayerVar(next.xVar)) {
        next.xVar = 'thk:0';
        const range = defaultAxisRange(design, next.xVar);
        next.xFrom = range.from;
        next.xTo = range.to;
    }
    // A design with one front layer has no second thickness for Y; its MF
    // surface is refused for its axes (computeSurface.js).
    if (!isLayerVar(next.yVar) && nLayers > 1) {
        next.yVar = 'thk:1';
        const range = defaultAxisRange(design, next.yVar);
        next.yFrom = range.from;
        next.yTo = range.to;
    }
    return next;
}

function useSurfaceCompute(state, design) {
    const { surfaceSpec, surfaceResult, setSurfaceResult } = state;
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState(null);
    const poolRef = useRef(null);
    const requestRef = useRef(0);
    const inputRef = useRef(null);
    if (inputRef.current?.surfaceSpec !== surfaceSpec || inputRef.current?.design !== design) {
        inputRef.current = { surfaceSpec, design };
    }

    // Abandons the sweep in flight: its workers stop, and whatever it would
    // still report is no longer current.
    const abandon = useCallback(() => {
        requestRef.current += 1;
        const pool = poolRef.current;
        poolRef.current = null;
        try { pool?.terminate(); } catch (_) {}
    }, []);

    useEffect(() => {
        abandon();
        setComputing(false);
        setProgress(null);
    }, [surfaceSpec, design]);

    useEffect(() => () => {
        requestRef.current += 1;
        try { poolRef.current?.terminate(); } catch (_) {}
        poolRef.current = null;
    }, []);

    const computeMainThread = useCallback(() => {
        try {
            return computeSurface(surfaceSpec, design, designMaterialLookup(design));
        } catch (e) {
            return { ok: false, error: String(e && e.message || e), x: [], y: [], z: [] };
        }
    }, [surfaceSpec, design]);

    const startSweep = useCallback(() => {
        setComputing(true);
        setProgress(null);
        const requestId = ++requestRef.current;
        const requestInput = inputRef.current;
        runSurfaceSweep({
            surfaceSpec, design, poolRef, setProgress, setSurfaceResult,
            setComputing, computeMainThread,
            isCurrent: () => requestRef.current === requestId && inputRef.current === requestInput,
        });
    }, [surfaceSpec, design, computeMainThread]);

    const computeSurfaceNow = useCallback(() => {
        if (!computing) startSweep();
    }, [computing, startSweep]);

    // Ends the sweep in flight. Nothing of it is drawn, since a grid is only set
    // once every row is in; a surface already on screen stays.
    const stop = useCallback(() => {
        abandon();
        setComputing(false);
        setProgress(null);
    }, [abandon]);

    // After Refresh all a surface on screen, or one being computed, is computed
    // again against the files just read. The design changed in the same render,
    // so the effect above has already ended a sweep in flight; `computing`
    // still holds its value from before, which is why the guard is bypassed.
    useAfterRefreshAll(() => {
        if (!surfaceResult && !computing) return;
        abandon();
        startSweep();
    });

    return { computing, progress, computeSurfaceNow, stop };
}

/**
 * The heatmap and 3D surface, its specification kept in the window's session.
 * `currentId` is the design's current environment, which a surface on Current
 * is computed in; `computedSpec` is the specification as it is computed
 * (environmentField.js surfaceEnvironment). A surface is kept with the
 * environment it was computed in, and `surfaceResult` gives it only while the
 * settings compute in that environment, so moving the current environment or
 * deleting the one chosen leaves the plot empty until Compute, and going back
 * shows it again. A surface computed before the design had environments is
 * environment 1's.
 */
export function useSurfacePlot(design, evalMode, currentId = BASE_ENVIRONMENT) {
    const state = useStoredSurfaceState(design, evalMode);
    const updateSurface = useCallback((patch) => {
        state.setSurfaceSpec(previous => patchSurfaceSpec(previous, patch, design));
        state.setSurfaceResult(null);
    }, [design]);
    const env = surfaceEnvironment(state.surfaceSpec, design, currentId);
    const computedSpec = useMemo(() => withEnvironment(state.surfaceSpec, env), [state.surfaceSpec, env]);
    const kept = state.surfaceResult;
    const surfaceResult = kept && (kept.env ?? BASE_ENVIRONMENT) !== (env ?? BASE_ENVIRONMENT) ? null : kept;
    const compute = useSurfaceCompute({
        ...state, surfaceSpec: computedSpec, surfaceResult,
        setSurfaceResult: result => state.setSurfaceResult(result && withEnvironment(result, env)),
    }, design);
    return { ...state, surfaceResult, ...compute, updateSurface, computedSpec };
}
