import { useDesign } from '../../../../state/DesignContext.js';
import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { useWindowSession } from '../../windowSession.js';
import { CHARACTERIZATION_WORKER_URL } from '../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import {
    characterizableCurves, characterizationRequest, curveById, defaultCurveSelection,
    defaultMeasurementMode,
} from './model.js';
import {
    nkCharacterizationResultSession,
    nkCharacterizationSession,
    nkCharacterizationViewSession,
} from './sessionState.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

/** The wavelengths every chosen curve covers. */
function commonRange(curves) {
    if (curves.length === 0) return null;
    const spans = curves.map((curve) => {
        const { x } = measuredCurveData(curve);
        return [x[0], x[x.length - 1]];
    });
    const low = Math.max(...spans.map(span => span[0]));
    const high = Math.min(...spans.map(span => span[1]));
    return high > low ? [low, high] : null;
}

export function useNkCharacterization() {
    const { design } = useDesign();
    const [settings, setField] = useWindowSession(nkCharacterizationSession, design);
    const [view, setViewField] = useWindowSession(nkCharacterizationViewSession, design);
    const [runState, , patchRunState] = useWindowSession(
        nkCharacterizationResultSession, design);
    const [running, setRunning] = useState(false);
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
    const chosen = useMemo(() => {
        const ids = measurementMode === 'ellipsometry'
            ? [settings.psiId, settings.deltaId]
            : [settings.transmittanceId, settings.reflectanceId];
        return ids.map(id => curveById(design, id, measurementMode)).filter(Boolean);
    }, [design, measurementMode, settings.transmittanceId, settings.reflectanceId,
        settings.psiId, settings.deltaId]);

    // Pick up a design's curves once, and let go of a curve that was removed.
    useEffect(() => {
        const available = new Set(anyCurves.map(curve => curve.id));
        const defaults = defaultCurveSelection(design);
        for (const key of ['transmittanceId', 'reflectanceId', 'psiId', 'deltaId']) {
            if (settings[key] && !available.has(settings[key])) setField(key, '');
        }
        const keys = measurementMode === 'ellipsometry'
            ? ['psiId', 'deltaId'] : ['transmittanceId', 'reflectanceId'];
        if (!settings[keys[0]] && !settings[keys[1]]) {
            for (const key of keys) if (defaults[key]) setField(key, defaults[key]);
        }
    }, [anyCurves, design, measurementMode, settings.transmittanceId,
        settings.reflectanceId, settings.psiId, settings.deltaId]);

    // The range follows the chosen curves until the user sets one.
    const range = useMemo(() => commonRange(chosen), [chosen]);
    useEffect(() => {
        if (!range) return;
        if (!settings.lambdaStart) setField('lambdaStart', String(Math.round(range[0])));
        if (!settings.lambdaEnd) setField('lambdaEnd', String(Math.round(range[1])));
    }, [range, settings.lambdaStart, settings.lambdaEnd]);

    const signature = useMemo(
        () => JSON.stringify({ settings, design: design?.id, curves: chosen.map(curve => curve.id) }),
        [settings, design?.id, chosen],
    );

    // The extraction runs in a worker. On a spectroscopic ellipsometer's own
    // grid it is tens of seconds, which on this thread is an application that
    // stops answering; here the window stays alive and the run can be stopped.
    const workerRef = useRef(null);
    const stop = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
        setRunning(false);
    }, []);
    useEffect(() => stop, [stop]);

    const run = useCallback(() => {
        const prepared = characterizationRequest(design, settings);
        if (prepared.error) {
            patchRunState({ result: prepared, ranWith: signature });
            return;
        }
        stop();
        setRunning(true);

        const finish = (result) => {
            if (workerRef.current !== worker) return;
            workerRef.current = null;
            patchRunState({
                result: result.error ? result : { ...result, measurementMode: prepared.measurementMode },
                ranWith: signature,
            });
            setRunning(false);
            worker.terminate();
        };

        let worker;
        try {
            worker = new Worker(CHARACTERIZATION_WORKER_URL, { type: 'module' });
        } catch (caught) {
            console.error('[Characterization worker] construction failed', caught);
            patchRunState({
                result: { error: 'failed', message: caught?.message || String(caught) },
                ranWith: signature,
            });
            setRunning(false);
            return;
        }
        workerRef.current = worker;
        worker.onmessage = (event) => {
            if (event.data?.type === 'result') finish(event.data.result);
            else if (event.data?.type === 'error') {
                console.error('[Characterization worker]', event.data.message);
                finish({ error: 'failed', message: event.data.message });
            }
        };
        worker.onerror = (event) => {
            console.error('[Characterization worker]', event.message);
            finish({ error: 'failed', message: event.message });
        };
        const wasmBytes = getTmmWasmBytesForWorker();
        if (wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes });
        worker.postMessage({ type: 'characterize', request: prepared.request });
    }, [design, settings, signature, patchRunState, stop]);

    return {
        design, curves, anyCurves, chosen, settings, measurementMode, view, result, running,
        stale: !!result && ranWith !== signature,
        measuredRange: range,
        setField, setViewField, run, stop,
        clearResult: () => patchRunState({ result: null, ranWith: '' }),
    };
}
