import { useDesign } from '../../../../state/DesignContext.js';
import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { useWindowSession } from '../../windowSession.js';
import {
    characterizableCurves, curveById, defaultCurveSelection, runCharacterization,
} from './model.js';
import {
    nkCharacterizationResultSession,
    nkCharacterizationSession,
    nkCharacterizationViewSession,
} from './sessionState.js';

const { useCallback, useEffect, useMemo, useState } = React;

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

    const curves = useMemo(() => characterizableCurves(design), [design]);
    const chosen = useMemo(() => [
        curveById(design, settings.transmittanceId),
        curveById(design, settings.reflectanceId),
    ].filter(Boolean), [design, settings.transmittanceId, settings.reflectanceId]);

    // Pick up a design's curves once, and let go of a curve that was removed.
    useEffect(() => {
        const available = new Set(curves.map(curve => curve.id));
        const defaults = defaultCurveSelection(design);
        if (settings.transmittanceId && !available.has(settings.transmittanceId)) {
            setField('transmittanceId', '');
        } else if (!settings.transmittanceId && !settings.reflectanceId) {
            if (defaults.transmittanceId) setField('transmittanceId', defaults.transmittanceId);
            if (defaults.reflectanceId) setField('reflectanceId', defaults.reflectanceId);
        }
        if (settings.reflectanceId && !available.has(settings.reflectanceId)) {
            setField('reflectanceId', '');
        }
    }, [curves, design, settings.transmittanceId, settings.reflectanceId]);

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

    const run = useCallback(() => {
        setRunning(true);
        // Yield once so the button's pressed state paints before the extraction
        // takes the thread. It is a fraction of a second on the WASM kernel and
        // a few seconds without it.
        setTimeout(() => {
            let nextResult;
            try {
                nextResult = runCharacterization(design, settings);
            } catch (caught) {
                nextResult = { error: 'failed', message: caught?.message || String(caught) };
            }
            patchRunState({ result: nextResult, ranWith: signature });
            setRunning(false);
        }, 0);
    }, [design, settings, signature, patchRunState]);

    return {
        design, curves, chosen, settings, view, result, running,
        stale: !!result && ranWith !== signature,
        measuredRange: range,
        setField, setViewField, run,
        clearResult: () => patchRunState({ result: null, ranWith: '' }),
    };
}
