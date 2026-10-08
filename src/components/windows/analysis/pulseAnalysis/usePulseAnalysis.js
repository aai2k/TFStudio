import { pulseProblem } from '../../../../utils/physics/pulsePropagation.js';
import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useWindowSession } from '../../windowSession.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';
import { meritTargetSide } from '../gdGddEvaluation/gdTargets.js';
import { emptyTable, tableFromPulseSpectrum } from '../../dataExchange/curveEditor/curveTable.js';
import { pulseSpectrumFromTable } from '../../dataExchange/curveEditor/curveApply.js';
import { tableFromText } from '../../dataExchange/curveEditor/tableText.js';
import { pulseFromSettings, spectrumCentreField } from './pulseModel.js';
import { pulseSession } from './sessionState.js';

const { useCallback, useEffect, useMemo, useState } = React;

const GDD_TARGET_TYPES = { R: new Set(['GDD', 'GDDFLAT']), T: new Set(['GDDT', 'GDDTFLAT']) };

function hasLayers(design, side) {
    if (side === 'whole') return true;
    const layers = side === 'back' ? design?.backLayers : design?.frontLayers;
    return (layers || []).some(layer => layer.material && layer.thickness > 0);
}

/**
 * The mean GDD the merit function asks of this response, fs² per bounce, or
 * null when it asks for none. Every enabled GDD target for R, or for T, counts,
 * whatever polarization and angle it is scored at: the value is what the
 * coating was designed to give. The targets belong to the one side the merit
 * function scores, so another side, or the whole part, has none.
 */
export function designGddTarget(operands, { target, side, surfaceMode }) {
    if (side !== meritTargetSide(surfaceMode)) return null;
    const values = (operands || [])
        .filter(operand => operand?.enabled && GDD_TARGET_TYPES[target]?.has(operand.type))
        .map(operand => Number(operand.target))
        .filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** The input GDD that "From target" sets: the design's GDD per bounce, times the bounces, sign reversed. */
export function gddFromTarget(gddTarget, passes) {
    return -gddTarget * Math.max(1, Math.round(passes));
}

/**
 * The design's pulse spectrum in the curve editor. Load file… reads a file
 * into the editor, where its columns, units and rows are checked before
 * Apply; Edit… opens what the design holds, or an empty table to type or paste
 * into. Apply keeps the spectrum on the design, so it is saved with the
 * project and undone as any other edit, and moves the centre wavelength to the
 * spectrum's centroid in frequency, where a typed TOD adds the least GDD.
 */
function useSpectrumEditor(patch) {
    const { design, updateDesign, checkpoint } = useDesign();
    const [editorTable, setEditorTable] = useState(null);
    const [fileError, setFileError] = useState(null);
    const canPick = typeof window !== 'undefined' && !!window.electronAPI?.spectrumPickFile;
    const loadSpectrum = useCallback(async () => {
        setFileError(null);
        const result = await window.electronAPI.spectrumPickFile();
        if (!result?.success) {
            if (!result?.canceled) setFileError({ reason: result?.error || '' });
            return;
        }
        const read = tableFromText(result.text || '', emptyTable('pulse'), result.fileName || '');
        if (read.error) {
            setFileError({ parse: true });
            return;
        }
        setEditorTable(read.table);
    }, []);
    const editSpectrum = useCallback(() => {
        setFileError(null);
        setEditorTable(tableFromPulseSpectrum(design?.pulseSpectrum));
    }, [design]);
    const applySpectrum = useCallback((table) => {
        const spectrum = pulseSpectrumFromTable(table);
        checkpoint();
        updateDesign({ pulseSpectrum: spectrum });
        const centre = spectrumCentreField(spectrum);
        patch({ source: 'file', ...(centre > 0 ? { centerWavelength: centre } : {}) });
        setEditorTable(null);
    }, [checkpoint, updateDesign, patch]);
    return {
        canPick, loadSpectrum, editSpectrum, applySpectrum, fileError, editorTable,
        closeEditor: () => setEditorTable(null),
    };
}

/**
 * The pulse evaluated in the worker, kept in the window's session with the
 * design and the request it answers. A tab switch, a dock or a redock mounts
 * the window afresh; a result kept for the same design and request is shown
 * again rather than computed again, and a run stopped for them stays stopped.
 * A new request runs even after Stop.
 */
function useKeptEvaluation(payload, session, patch) {
    const requestKey = useMemo(() => (payload ? JSON.stringify(payload.request) : null), [payload]);
    const design = payload?.design;
    const answers = entry => Boolean(payload) && entry?.design === design && entry.requestKey === requestKey;
    const kept = answers(session.result) ? session.result : null;
    const stopped = answers(session.stoppedFor);
    const evaluation = useAnalysisEvaluation(Boolean(payload) && !stopped && !kept, 'pulseAnalysis', payload);
    const finished = evaluation.payload === payload ? evaluation.data : null;
    useEffect(() => {
        if (finished) patch({ result: { design, requestKey, data: finished } });
    }, [finished, design, requestKey, patch]);
    const stoppedElsewhere = Boolean(session.stoppedFor) && !stopped;
    useEffect(() => {
        if (stoppedElsewhere) patch({ stoppedFor: null });
    }, [stoppedElsewhere, patch]);
    return {
        evaluation: kept ? { data: kept.data, error: null, busy: false } : evaluation,
        stopped,
        stop: () => patch({ stoppedFor: { design, requestKey } }),
    };
}

export function usePulseAnalysis(design) {
    // Following the sampled design keeps an optimizer run from starting one
    // evaluation per progress message.
    const { design: liveDesign } = useLiveDesign();
    const [session, setField, patch] = useWindowSession(pulseSession, design);
    const {
        source, shape, centerWavelength, duration, bandwidth, order, gdd, tod,
        side, target, pol, theta, passes,
    } = session;
    const spectrum = liveDesign?.pulseSpectrum ?? null;

    const pulse = useMemo(() => pulseFromSettings({
        source, shape, centerWavelength, duration, bandwidth, order, gdd, tod, spectrum,
    }), [source, shape, centerWavelength, duration, bandwidth, order, gdd, tod, spectrum]);
    const spectrumCentre = useMemo(() => spectrumCentreField(spectrum), [spectrum]);
    const problem = pulseProblem(pulse);
    const hasStack = hasLayers(liveDesign, side);
    const payload = useMemo(() => (hasStack && !problem ? {
        design: liveDesign,
        request: { pulse, side, target, polarization: pol, thetaDeg: theta, passes: Math.max(1, Math.round(passes)) },
    } : null), [hasStack, problem, liveDesign, pulse, side, target, pol, theta, passes]);

    const run = useKeptEvaluation(payload, session, patch);
    const gddTarget = designGddTarget(liveDesign?.meritOperands, {
        target, side, surfaceMode: liveDesign?.surfaceMode,
    });
    const file = useSpectrumEditor(patch);

    return {
        session, setField, patch, pulse, problem, hasStack, payload,
        ...run,
        gddTarget,
        fillGddFromTarget: () => {
            if (gddTarget !== null) setField('gdd', gddFromTarget(gddTarget, passes));
        },
        spectrum, spectrumCentre,
        ...file,
    };
}
