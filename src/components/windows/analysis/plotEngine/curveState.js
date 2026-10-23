import { paletteColors } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { makeDefaultCurve } from '../../../../utils/physics/plotQuantities.js';
import { computeCurveResults } from './curveResults.js';
import { plotEngineSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useEvaluationUnderCone } from '../useEvaluationUnderCone.js';

const { useMemo, useCallback } = React;

const NO_CURVES = {};

// A new curve for the design's evaluation mode, named by `nameCurve` from
// t.plotEngine.
function newCurve(evalMode, palette, nameCurve) {
    return makeDefaultCurve({ surfaceMode: evalMode || 'front', palette, nameCurve });
}

// Reads the curve list from the session store, standing in a default curve while
// the design has no list of its own yet.
function useStoredCurves(design, evalMode, palette, nameCurve) {
    const [session, setField] = useWindowSession(plotEngineSession, design);
    // Memoised so the substituted default is one stable array rather than a new
    // one per render, which would recompute every curve on every render.
    const curves = useMemo(
        () => (session.curves.length ? session.curves : [newCurve(evalMode, palette, nameCurve)]),
        [session.curves, evalMode, palette, nameCurve],
    );
    const setCurves = useCallback(next => {
        setField('curves', current => {
            const base = current.length ? current : [newCurve(evalMode, palette, nameCurve)];
            return typeof next === 'function' ? next(base) : next;
        });
    }, [setField, evalMode, palette, nameCurve]);
    return [curves, setCurves];
}

// The curves of a design under a cone of incidence are computed in the analysis
// worker and drawn once it answers.
function useCurveResults(curves, design) {
    const payload = useMemo(() => ({ design, curves }), [design, curves]);
    const { data } = useEvaluationUnderCone(design, 'plotCurves', payload,
        request => computeCurveResults(request.curves, request.design));
    return data || NO_CURVES;
}

// `pe` is t.plotEngine, which names a new curve.
export function useCurvePlot(design, evalMode, pe) {
    const configured = useAnalysisColors('plotEngine');
    const palette = useMemo(() => paletteColors(configured, 'series'), [configured]);
    const nameCurve = pe.curveName;
    const [curves, setCurves] = useStoredCurves(design, evalMode, palette, nameCurve);
    const results = useCurveResults(curves, design);

    const addCurve = useCallback(() => {
        setCurves(prev => [...prev, newCurve(evalMode, palette, nameCurve)]);
    }, [evalMode, palette, nameCurve]);
    const updateCurve = useCallback((id, patch) => {
        setCurves(prev => prev.map(cv => cv.id === id ? { ...cv, ...patch } : cv));
    }, []);
    const deleteCurve = useCallback((id) => {
        setCurves(prev => prev.filter(cv => cv.id !== id));
    }, []);

    return { curves, results, addCurve, updateCurve, deleteCurve };
}
