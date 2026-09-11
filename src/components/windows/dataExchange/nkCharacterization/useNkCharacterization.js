import { useDesign } from '../../../../state/DesignContext.js';
import { useWindowSession } from '../../windowSession.js';
import { startCharacterization, stopCharacterization } from './characterizationRun.js';
import {
    applyDefaultRange, chosenCurves, commonRange, syncCurveSelection,
} from './curveSelection.js';
import { characterizableCurves, defaultMeasurementMode } from './model.js';
import {
    nkCharacterizationResultSession,
    nkCharacterizationSession,
    nkCharacterizationViewSession,
} from './sessionState.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

/** Whole seconds since `since`, ticking once a second while `active`. */
function useElapsedSeconds(active, since) {
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!active) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active, since]);
    return active ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

export function useNkCharacterization() {
    const { design } = useDesign();
    const [settings, setField] = useWindowSession(nkCharacterizationSession, design);
    const [view, setViewField] = useWindowSession(nkCharacterizationViewSession, design);
    const [runState, , patchRunState] = useWindowSession(
        nkCharacterizationResultSession, design);
    const [running, setRunning] = useState(false);
    // What the worker last said it was doing, and when it was started. A run
    // is seconds to a minute of silence otherwise, with nothing to tell a
    // stalled worker from a working one.
    const [progress, setProgress] = useState(null);
    const [startedAt, setStartedAt] = useState(0);
    const elapsedSeconds = useElapsedSeconds(running, startedAt);
    // The settings the shown result was produced from, so an edited setting can
    // mark it stale instead of silently describing a run that no longer matches
    // the controls above it.
    const { result, ranWith } = runState;

    const measurementMode = settings.measurementMode || defaultMeasurementMode(design);
    // Only the curves this mode can use. A spectrophotometer measurement is
    // never offered to an ellipsometric fit, or the other way round.
    const curves = useMemo(
        () => characterizableCurves(design, measurementMode), [design, measurementMode]);
    // Everything the design holds, of either kind. The window closes down to a
    // message only when there is nothing at all: a mode with no curves of its
    // own still has to keep the control row, or the button that would switch
    // back to the other mode goes with it.
    const anyCurves = useMemo(() => [
        ...characterizableCurves(design, 'photometry'),
        ...characterizableCurves(design, 'ellipsometry'),
    ], [design]);
    const chosen = useMemo(
        () => chosenCurves(design, settings, measurementMode),
        [design, measurementMode, settings.transmittanceId, settings.reflectanceId,
            settings.psiId, settings.deltaId]);

    useEffect(() => {
        syncCurveSelection({ anyCurves, design, measurementMode, settings, setField });
    }, [anyCurves, design, measurementMode, settings.transmittanceId,
        settings.reflectanceId, settings.psiId, settings.deltaId]);

    const range = useMemo(() => commonRange(chosen), [chosen]);
    useEffect(() => {
        applyDefaultRange({ range, settings, setField });
    }, [range, settings.lambdaStart, settings.lambdaEnd]);

    const signature = useMemo(
        () => JSON.stringify({ settings, design: design?.id, curves: chosen.map(curve => curve.id) }),
        [settings, design?.id, chosen],
    );

    const workerRef = useRef(null);
    const stop = useCallback(() => stopCharacterization(workerRef, setRunning), []);
    useEffect(() => stop, [stop]);

    const run = useCallback(() => startCharacterization({
        design, settings, signature, patchRunState, stop, workerRef,
        setRunning, setProgress, setStartedAt,
    }), [design, settings, signature, patchRunState, stop]);

    return {
        design, curves, anyCurves, chosen, settings, measurementMode, view, result, running,
        progress, elapsedSeconds,
        stale: !!result && ranWith !== signature,
        measuredRange: range,
        setField, setViewField, run, stop,
        clearResult: () => patchRunState({ result: null, ranWith: '' }),
    };
}
