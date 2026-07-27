import {
    makeDefaultSurfaceSpec, computeSurface, isLayerVar, defaultAxisRange,
} from '../../../../utils/physics/plotQuantities.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { runSurfaceSweep } from './surfaceRunner.js';

const { useState, useEffect, useRef, useCallback } = React;

// Per-design state survives docking switches, which unmount and remount the window.
const surfaceCache = new Map();
const resultCache = new Map();
const modeCache = new Map();

function initialSurfaceSpec(design, evalMode) {
    const cached = design && surfaceCache.get(design.id);
    return cached ? { ...cached } : makeDefaultSurfaceSpec(design, { surfaceMode: evalMode || 'front' });
}

function useCachedSurfaceState(design, evalMode) {
    const [plotMode, setPlotMode] = useState(() => (design && modeCache.get(design.id)) || '2d');
    const [surfaceSpec, setSurfaceSpec] = useState(() => initialSurfaceSpec(design, evalMode));
    const [surfaceResult, setSurfaceResult] = useState(() => (design && resultCache.get(design.id)) || null);

    useEffect(() => {
        if (!design) return;
        const cached = surfaceCache.get(design.id);
        setSurfaceSpec(cached ? { ...cached } : makeDefaultSurfaceSpec(design, { surfaceMode: evalMode || 'front' }));
        setPlotMode(modeCache.get(design.id) || '2d');
        setSurfaceResult(resultCache.get(design.id) || null);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { if (design) surfaceCache.set(design.id, { ...surfaceSpec }); }, [surfaceSpec, design?.id]);
    useEffect(() => { if (design) modeCache.set(design.id, plotMode); }, [plotMode, design?.id]);
    useEffect(() => {
        if (!design) return;
        if (surfaceResult) resultCache.set(design.id, surfaceResult);
        else resultCache.delete(design.id);
    }, [surfaceResult, design?.id]);

    return { plotMode, setPlotMode, surfaceSpec, setSurfaceSpec, surfaceResult, setSurfaceResult };
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
    const state = useCachedSurfaceState(design, evalMode);
    const updateSurface = useCallback((patch) => {
        state.setSurfaceSpec(previous => patchSurfaceSpec(previous, patch, design));
        state.setSurfaceResult(null);
    }, [design]);
    const compute = useSurfaceCompute(state, design);
    return { ...state, ...compute, updateSurface };
}
