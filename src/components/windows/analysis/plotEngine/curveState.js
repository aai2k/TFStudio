import { paletteColors } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { makeDefaultCurve, computeCurve } from '../../../../utils/physics/plotQuantities.js';
import { buildEvaluationContext } from './materialContext.js';
import { plotEngineSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo, useCallback } = React;

function defaultCurves(evalMode, palette) {
    return [makeDefaultCurve({ surfaceMode: evalMode || 'front', palette })];
}

// Reads the curve list from the session store, standing in a default curve while
// the design has no list of its own yet.
function useStoredCurves(design, evalMode, palette) {
    const [session, setField] = useWindowSession(plotEngineSession, design);
    // Memoised so the substituted default is one stable array rather than a new
    // one per render, which would recompute every curve on every render.
    const curves = useMemo(
        () => (session.curves.length ? session.curves : defaultCurves(evalMode, palette)),
        [session.curves, evalMode, palette],
    );
    const setCurves = useCallback(next => {
        setField('curves', current => {
            const base = current.length ? current : defaultCurves(evalMode, palette);
            return typeof next === 'function' ? next(base) : next;
        });
    }, [setField, evalMode, palette]);
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
    const [curves, setCurves] = useStoredCurves(design, evalMode, palette);
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
