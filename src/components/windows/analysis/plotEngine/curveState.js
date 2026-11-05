import { paletteColors } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { coneIsActive, makeConeSpec } from '../../../../utils/physics/optimizer.js';
import { curveNumber, makeDefaultCurve, quantityFamily } from '../../../../utils/physics/plotQuantities.js';
import { editCurve } from './curveEdits.js';
import { quantityOptionLabel } from './quantityLabels.js';
import {
    computeCurveResults, curvesToCompute, mergeCurveResults, shownCurveResults,
} from './curveResults.js';
import { plotEngineSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';

const { useMemo, useCallback, useEffect } = React;

// A new curve for the design's evaluation mode, named by `nameCurve` from
// t.plotEngine.
function newCurve(evalMode, palette, nameCurve) {
    return makeDefaultCurve({ surfaceMode: evalMode || 'front', palette, nameCurve });
}

// The curve list from the session, standing in a default curve while the
// design has no list of its own yet. The first edit starts from that same
// curve, so it lands on the curve the window shows.
function useStoredCurves(session, setField, evalMode, palette, nameCurve) {
    const empty = session.curves.length === 0;
    // Memoised so the default is one stable curve rather than a new one per
    // render, which would compute every curve again on every render.
    const standIn = useMemo(
        () => (empty ? newCurve(evalMode, palette, nameCurve) : null),
        [empty, evalMode, palette, nameCurve],
    );
    const curves = useMemo(() => (empty ? [standIn] : session.curves), [empty, standIn, session.curves]);
    const setCurves = useCallback(next => {
        setField('curves', current => {
            const base = current.length ? current : [standIn];
            return typeof next === 'function' ? next(base) : next;
        });
    }, [setField, standIn]);
    return [curves, setCurves];
}

const hasLayers = design => Boolean(design?.frontLayers?.length || design?.backLayers?.length);

// Families that cost one spectrum per curve, which the window computes itself
// in collimated light, as Optical Evaluation does. A phase quantity takes
// derivatives at every sample, the merit function evaluates every operand at
// every sample, and a cone of incidence traces a spectrum per ray: those are
// computed in the worker.
const QUICK_FAMILIES = new Set(['sweep', 'optical', 'ellipsometric']);

function computedHere(curves, design) {
    if (coneIsActive(makeConeSpec(design?.cone || {}))) return false;
    return curves.every(curve => QUICK_FAMILIES.has(quantityFamily(curve.x.quantity))
        && QUICK_FAMILIES.has(quantityFamily(curve.y.quantity)));
}

// The computation for the curves `pending` still needs, unless it was stopped.
// The payload follows the request rather than the curve objects, so
// recolouring a curve that is still being computed does not start it again.
function useCurveRequest(pending, design, stoppedFor) {
    const requestKey = [...pending.keys()].join('\n');
    const stopped = Boolean(requestKey) && stoppedFor?.design === design && stoppedFor.requestKey === requestKey;
    const payload = useMemo(
        () => (requestKey && !stopped ? { design, curves: [...pending.values()] } : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [design, requestKey, stopped]);
    const here = Boolean(payload) && computedHere(payload.curves, design);
    const evaluation = useAnalysisEvaluation(Boolean(payload) && !here, 'plotCurves', payload);
    const direct = useMemo(
        () => (here ? { data: computeCurveResults(payload.curves, design) } : null),
        [here, payload, design]);
    const answered = direct || (payload && evaluation.payload === payload ? evaluation : null);
    return { requestKey, stopped, payload, answered };
}

/**
 * The curves, kept in the window's session with the design they were computed
 * for, by the settings that decide them (curveResults.js). A tab switch or a
 * redock mounts the window afresh and shows them again rather than computing
 * them again; a curve recoloured or hidden is not computed at all, and an edit
 * computes the curves it changed.
 *
 * Stop ends a computation in the worker for the design and the curves it was
 * started for, and keeps it ended across a remount. Any change, or Compute,
 * runs it again.
 */
function useCurveCompute(curves, design, session, setField) {
    const kept = session.curveResults;
    const pending = useMemo(
        () => (hasLayers(design)
            ? curvesToCompute(curves, kept?.design === design ? kept.byKey : null)
            : new Map()),
        [curves, design, kept]);
    const stoppedFor = session.curvesStoppedFor;
    const { requestKey, stopped, payload, answered } = useCurveRequest(pending, design, stoppedFor);
    // An answer is drawn in the render it arrives in, and kept from the next.
    const current = useMemo(
        () => (answered?.data ? mergeCurveResults(kept, design, payload.curves, answered.data, curves) : kept),
        [answered, kept, design, payload, curves]);
    useEffect(() => {
        if (current !== kept) setField('curveResults', current);
    }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
    const stoppedElsewhere = Boolean(stoppedFor) && !stopped;
    useEffect(() => {
        if (stoppedElsewhere) setField('curvesStoppedFor', null);
    }, [stoppedElsewhere, setField]);

    const busy = Boolean(payload) && !answered;
    const results = useMemo(
        () => shownCurveResults(curves, current, design, busy),
        [curves, current, design, busy]);
    return {
        results, busy, stopped,
        stop: () => setField('curvesStoppedFor', { design, requestKey }),
        resume: () => setField('curvesStoppedFor', null),
    };
}

// `t` names a new curve, and renames one still under its default name when an
// edit changes what it plots.
export function useCurvePlot(design, evalMode, t) {
    const pe = t.plotEngine;
    // Following the sampled design keeps an optimizer run from starting one
    // computation per progress message.
    const { design: liveDesign } = useLiveDesign();
    const configured = useAnalysisColors('plotEngine');
    const palette = useMemo(() => paletteColors(configured, 'series'), [configured]);
    const nameCurve = pe.curveName;
    const defaultName = useCallback(
        curve => pe.curveName(quantityOptionLabel(curve.y.quantity, curve.sweep, design, t), curveNumber(curve)),
        [pe, design, t]);
    const [session, setField] = useWindowSession(plotEngineSession, design);
    const [curves, setCurves] = useStoredCurves(session, setField, evalMode, palette, nameCurve);
    const compute = useCurveCompute(curves, liveDesign, session, setField);

    const addCurve = useCallback(() => {
        setCurves(prev => [...prev, newCurve(evalMode, palette, nameCurve)]);
    }, [setCurves, evalMode, palette, nameCurve]);
    const updateCurve = useCallback((id, patch) => {
        setCurves(prev => prev.map(cv => (cv.id === id ? editCurve(cv, patch, design, defaultName) : cv)));
    }, [setCurves, design, defaultName]);
    const deleteCurve = useCallback((id) => {
        setCurves(prev => prev.filter(cv => cv.id !== id));
    }, [setCurves]);

    return { curves, ...compute, addCurve, updateCurve, deleteCurve };
}
