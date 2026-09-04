import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useAnalysisDefaults, useAnalysisSettings } from '../../../../state/AnalysisSettingsContext.js';
import { computeOpticalSpectrum } from './spectrum.js';
import { makeConeSpec, coneIsActive } from '../../../../utils/physics/optimizer.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';
import { buildCSV, createTargetOperands, editTargetOperands, deleteTargetOperand } from './model.js';
import { opticalEvaluationSession, opticalTargetSession } from './sessionState.js';
import { isLogYScale, yScaleReadsQuantity } from './yScale.js';
import { useWindowSession } from '../../windowSession.js';

const { useState, useEffect, useCallback, useMemo } = React;

// The spectrum is computed from the sampled design, so a run redraws this
// window at the shared preview cadence rather than once per progress message.
function useSpectrumEvaluation({ params, evalMode }) {
    const { design } = useLiveDesign();
    // Narrowed to what the spectrum is actually computed from. The display unit
    // travels with the range but only changes axis labels, so recomputing every
    // wavelength for it would be work for nothing.
    const { lambdaStart, lambdaEnd, lambdaStep, thetas } = params;
    const spectrumParams = useMemo(
        () => ({ lambdaStart, lambdaEnd, lambdaStep, thetas }),
        [lambdaStart, lambdaEnd, lambdaStep, thetas]);
    const coneActive = coneIsActive(makeConeSpec(design?.cone || {}));
    const payload = useMemo(
        () => ({ design, params: spectrumParams, evalMode }),
        [design, spectrumParams, evalMode],
    );
    const workerResult = useAnalysisEvaluation(coneActive, 'opticalSpectrum', payload);
    const directResult = useMemo(() => {
        if (coneActive) return { data: null, error: null };
        try {
            return { data: computeOpticalSpectrum(design, spectrumParams, evalMode), error: null };
        } catch (error) {
            console.error('TMM error:', error);
            return { data: null, error: 'ANALYSIS_EVALUATION_FAILED' };
        }
    }, [coneActive, design, spectrumParams, evalMode]);
    return coneActive
        ? { data: workerResult.data, error: workerResult.error, busy: workerResult.busy }
        : directResult;
}

function useTargetEditor({ design, updateDesign, yScale }) {
    const [session, setField] = useWindowSession(opticalTargetSession, design);
    const { editMode, editTool, editPol, editKind, snapOn, snapNm } = session;
    // The level snap steps a grid of percentage points, which a logarithmic
    // axis does not rule: a stopband drawn at 0.001 % would land on 0, a level
    // that axis cannot even show. Wavelengths snap as they always do.
    const logScale = isLogYScale(yScale);
    const snapPct = logScale ? 0 : session.snapPct;
    // Optical density reads transmittance and nothing else, so while it is
    // shown a new target is drawn on T whatever family was chosen; the choice
    // itself is kept for when another unit comes back.
    const editCurve = yScaleReadsQuantity(yScale, session.editCurve) ? session.editCurve : 'T';
    const onCreateTarget = useCallback(line => {
        updateDesign({
            meritOperands: createTargetOperands({
                operands: design.meritOperands || [], line,
                editCurve, editPol, editKind, snapOn, snapNm, snapPct, logScale,
            })
        });
    }, [design, updateDesign, editCurve, editPol, editKind, snapOn, snapNm, snapPct, logScale]);
    const onEditTarget = useCallback((meta, coords) => {
        updateDesign({
            meritOperands: editTargetOperands({
                operands: design.meritOperands || [], meta, coords, snapOn, snapNm, snapPct, logScale,
            })
        });
    }, [design, updateDesign, snapOn, snapNm, snapPct, logScale]);
    const onDeleteTarget = useCallback(opId => {
        updateDesign({ meritOperands: deleteTargetOperand(design.meritOperands || [], opId) });
    }, [design, updateDesign]);
    return {
        editMode, setEditMode: value => setField('editMode', value),
        editTool, setEditTool: value => setField('editTool', value),
        editCurve, setEditCurve: value => setField('editCurve', value),
        editPol, setEditPol: value => setField('editPol', value),
        editKind, setEditKind: value => setField('editKind', value),
        snapOn, setSnapOn: value => setField('snapOn', value),
        snapNm, setSnapNm: value => setField('snapNm', value),
        snapPct: session.snapPct, setSnapPct: value => setField('snapPct', value),
        snapLevels: !logScale,
        onCreateTarget, onEditTarget, onDeleteTarget,
    };
}

function useDisplayOptions(params, setParams, design) {
    const [session, setField] = useWindowSession(opticalEvaluationSession, design);
    // The Y axis and the curve switches are configured defaults: the session
    // store starts from the analysis registry and adopts the saved values when
    // the preferences file arrives, so there is nothing to substitute here.
    const { showCurves, showTable, showTargets, yAuto, yMin, yMax, yScale } = session;
    // The unit the spectral range is entered and labelled in belongs with the
    // range itself, which is shared with the other evaluation windows.
    const spectralUnit = params.spectralUnit || 'nm';

    const yRange = useMemo(() => ({ auto: yAuto, min: yMin, max: yMax }), [yAuto, yMin, yMax]);
    const lamRange = useMemo(
        () => ({ min: params.lambdaStart, max: params.lambdaEnd }),
        [params.lambdaStart, params.lambdaEnd]
    );
    const toggleCurve = key => setField('showCurves', current => ({ ...current, [key]: !current[key] }));
    const setThetas = useCallback(next => {
        setParams(current => ({ ...current, thetas: next }));
    }, []);
    return {
        showCurves, showTable, setShowTable: value => setField('showTable', value),
        showTargets, setShowTargets: value => setField('showTargets', value),
        yAuto, setYAuto: value => setField('yAuto', value),
        yMin, setYMin: value => setField('yMin', value),
        yMax, setYMax: value => setField('yMax', value),
        yScale, setYScale: value => setField('yScale', value),
        spectralUnit, setSpectralUnit: value => setParams({ spectralUnit: value }),
        yRange, lamRange, toggleCurve, setThetas,
    };
}

function useCsvActions({ data, showCurves, yScale, design }) {
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const copyCSV = () => {
        const csv = buildCSV(data, showCurves, yScale);
        if (navigator.clipboard) navigator.clipboard.writeText(csv);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const saveCSV = async () => {
        const csv = buildCSV(data, showCurves, yScale);
        if (!csv || !window.electronAPI?.spectrumSaveFile) return;
        const base = (design.name || 'spectrum').replace(/[^\w.-]+/g, '_');
        const result = await window.electronAPI.spectrumSaveFile(csv, `${base}_spectrum.csv`);
        if (result?.success) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
    };
    return { copied, saved, copyCSV, saveCSV };
}

function designSummary(design, evalMode, data) {
    const frontLayers = design.frontLayers || [];
    const backLayers = design.backLayers || [];
    const frontCount = frontLayers.length;
    const backCount = backLayers.length;
    const frontNm = frontLayers.reduce((sum, layer) => sum + (layer.thickness || 0), 0);
    const backNm = backLayers.reduce((sum, layer) => sum + (layer.thickness || 0), 0);
    const subThick = design.substrate.thickness ?? 1.0;
    return {
        frontCount, backCount, frontNm, backNm, subThick,
        showEmpty: evalMode === 'front' && frontCount === 0 && !data,
        hasTargets: !!design.meritOperands?.length,
    };
}

export function useOpticalEvaluation() {
    const context = useDesign();
    const { design, updateDesign, evalMode, evalParams: params, setEvalParams: setParams } = context;
    const display = useDisplayOptions(params, setParams, design);
    const spectrum = useSpectrumEvaluation({ params, evalMode });
    const targets = useTargetEditor({ design, updateDesign, yScale: display.yScale });
    const csv = useCsvActions({
        data: spectrum.data, showCurves: display.showCurves, yScale: display.yScale, design,
    });
    return {
        design, evalMode, params, setParams,
        ...display, ...spectrum, ...targets, ...csv,
        ...designSummary(design, evalMode, spectrum.data),
    };
}
