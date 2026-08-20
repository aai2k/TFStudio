import {
    makeDefaultSurfaceSpec, computeSurface, isLayerVar, defaultAxisRange,
} from '../../../../utils/physics/plotQuantities.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { runSurfaceSweep } from './surfaceRunner.js';
import { plotEngineSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

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
    };
}

function patchSurfaceSpec(previous, patch, design) {
    const next = { ...previous, ...patch };
    if (patch.z !== 'MF') return next;
    const nLayers = (design?.frontLayers || []).length;
    if (!isLayerVar(next.xVar)) {
        next.xVar = 'thk:0';
        const range = defaultAxisRange(design, next.xVar);
        next.xFrom = range.from;
        next.xTo = range.to;
    }
    if (!isLayerVar(next.yVar)) {
        next.yVar = nLayers > 1 ? 'thk:1' : 'n:0';
        const range = defaultAxisRange(design, next.yVar);
        next.yFrom = range.from;
        next.yTo = range.to;
    }
    return next;
}

function useSurfaceCompute(state, design) {
    const { surfaceSpec, setSurfaceResult } = state;
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState(null);
    const poolRef = useRef(null);
    const requestRef = useRef(0);
    const inputRef = useRef(null);
    if (inputRef.current?.surfaceSpec !== surfaceSpec || inputRef.current?.design !== design) {
        inputRef.current = { surfaceSpec, design };
    }

    useEffect(() => {
        requestRef.current += 1;
        const pool = poolRef.current;
        poolRef.current = null;
        try { pool?.terminate(); } catch (_) {}
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

    const computeSurfaceNow = useCallback(() => {
        if (!design || computing) return;
        setComputing(true);
        setProgress(null);
        const requestId = ++requestRef.current;
        const requestInput = inputRef.current;
        runSurfaceSweep({
            surfaceSpec, design, poolRef, setProgress, setSurfaceResult,
            setComputing, computeMainThread,
            isCurrent: () => requestRef.current === requestId && inputRef.current === requestInput,
        });
    }, [surfaceSpec, design, computing, computeMainThread]);

    return { computing, progress, computeSurfaceNow };
}

export function useSurfacePlot(design, evalMode) {
    const state = useStoredSurfaceState(design, evalMode);
    const updateSurface = useCallback((patch) => {
        state.setSurfaceSpec(previous => patchSurfaceSpec(previous, patch, design));
        state.setSurfaceResult(null);
    }, [design]);
    const compute = useSurfaceCompute(state, design);
    return { ...state, ...compute, updateSurface };
}
