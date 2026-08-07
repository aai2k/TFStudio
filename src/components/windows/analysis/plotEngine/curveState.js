import { paletteColors } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { makeDefaultCurve, computeCurve } from '../../../../utils/physics/plotQuantities.js';
import { buildEvaluationContext } from './materialContext.js';

const { useState, useMemo, useEffect, useCallback } = React;

// Per-design state survives docking switches, which unmount and remount the window.
const plotCache = new Map();

function defaultCurves(evalMode, palette) {
    return [makeDefaultCurve({ surfaceMode: evalMode || 'front', palette })];
}

function cachedCurves(design, evalMode, palette) {
    const cached = design && plotCache.get(design.id);
    return cached?.length ? cached.map(x => ({ ...x })) : defaultCurves(evalMode, palette);
}

function useCachedCurves(design, evalMode, palette) {
    const [curves, setCurves] = useState(() => cachedCurves(design, evalMode, palette));

    useEffect(() => {
        if (!design) return;
        setCurves(cachedCurves(design, evalMode, palette));
    }, [design?.id]);

    useEffect(() => {
        if (!design) return;
        plotCache.set(design.id, curves.map(x => ({ ...x })));
    }, [curves, design?.id]);

    return [curves, setCurves];
}

function computeCurveResults(curves, ctx) {
    if (!ctx) return {};
    const out = {};
    for (const cv of curves) {
        if (!cv.visible) continue;
        try {
            out[cv.id] = computeCurve(cv, ctx);
        } catch (e) {
            console.error('PlotEngine curve error:', cv.id, e);
            out[cv.id] = { x: [], y: [] };
        }
    }
    return out;
}

export function useCurvePlot(design, evalMode) {
    const configured = useAnalysisColors('plotEngine');
    const palette = useMemo(() => paletteColors(configured, 'series'), [configured]);
    const [curves, setCurves] = useCachedCurves(design, evalMode, palette);
    const ctx = useMemo(() => buildEvaluationContext(design), [design]);
    const results = useMemo(() => computeCurveResults(curves, ctx), [curves, ctx]);

    const addCurve = useCallback(() => {
        setCurves(prev => [...prev, makeDefaultCurve({ surfaceMode: evalMode || 'front', palette })]);
    }, [evalMode, palette]);
    const updateCurve = useCallback((id, patch) => {
        setCurves(prev => prev.map(cv => cv.id === id ? { ...cv, ...patch } : cv));
    }, []);
    const deleteCurve = useCallback((id) => {
        setCurves(prev => prev.filter(cv => cv.id !== id));
    }, []);

    return { curves, results, addCurve, updateCurve, deleteCurve };
}
