import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useAnalysisDefaults, useAnalysisSettings } from '../../../../state/AnalysisSettingsContext.js';
import { computeOpticalSpectrum } from './spectrum.js';
import { buildCSV, createTargetOperands, editTargetOperands, deleteTargetOperand } from './model.js';
import { opticalEvaluationSession, opticalTargetSession } from './sessionState.js';
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
    return useMemo(() => {
        try {
            return { data: computeOpticalSpectrum(design, spectrumParams, evalMode), error: null };
        } catch (error) {
            console.error('TMM error:', error);
            return { data: null, error: error.message || 'Computation error' };
        }
    }, [design, spectrumParams, evalMode]);
}

function useTargetEditor({ design, updateDesign }) {
    const [session, setField] = useWindowSession(opticalTargetSession, design);
    const { editMode, editTool, editCurve, editPol, editKind, snapOn, snapNm, snapPct } = session;
    const onCreateTarget = useCallback(line => {
        updateDesign({
            meritOperands: createTargetOperands({
                operands: design.meritOperands || [], line,
                editCurve, editPol, editKind, snapOn, snapNm, snapPct,
            })
        });
    }, [design, updateDesign, editCurve, editPol, editKind, snapOn, snapNm, snapPct]);
    const onEditTarget = useCallback((meta, coords) => {
        updateDesign({
            meritOperands: editTargetOperands({
                operands: design.meritOperands || [], meta, coords, snapOn, snapNm, snapPct,
            })
        });
    }, [design, updateDesign, snapOn, snapNm, snapPct]);
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
        snapPct, setSnapPct: value => setField('snapPct', value),
        onCreateTarget, onEditTarget, onDeleteTarget,
    };
}

function useDisplayOptions(params, setParams, design) {
    const displayDefaults = useAnalysisDefaults('opticalEvaluation');
    const analysisSettings = useAnalysisSettings();
    const defaultsReady = analysisSettings?.ready !== false;
    const [session, setField, patch] = useWindowSession(opticalEvaluationSession, design);
    const { showCurves, showTable, showTargets, defaultsApplied } = session;
    // Until the configured defaults have been read in, show them rather than the
    // store's placeholders, so the first render already matches Settings.
    const yAuto = defaultsApplied ? session.yAuto : displayDefaults.booleans.yAuto;
    const yMin = defaultsApplied ? session.yMin : displayDefaults.numbers.yMin;
    const yMax = defaultsApplied ? session.yMax : displayDefaults.numbers.yMax;
    // The unit the spectral range is entered and labelled in belongs with the
    // range itself, which is shared with the other evaluation windows.
    const spectralUnit = params.spectralUnit || 'nm';

    // A restored layout can mount this window while the preferences file is
    // still loading, so the persisted defaults are applied once when they
    // arrive. After that the values belong to the session: a later Settings edit
    // applies to the next app run rather than overwriting controls set here.
    useEffect(() => {
        if (!defaultsReady || defaultsApplied) return;
        patch({
            defaultsApplied: true,
            yAuto: displayDefaults.booleans.yAuto,
            yMin: displayDefaults.numbers.yMin,
            yMax: displayDefaults.numbers.yMax,
        });
    }, [defaultsReady, defaultsApplied, patch,
        displayDefaults.booleans.yAuto, displayDefaults.numbers.yMin,
        displayDefaults.numbers.yMax]);

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
        spectralUnit, setSpectralUnit: value => setParams({ spectralUnit: value }),
        yRange, lamRange, toggleCurve, setThetas,
    };
}

function useCsvActions({ data, showCurves, design }) {
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const copyCSV = () => {
        const csv = buildCSV(data, showCurves);
        if (navigator.clipboard) navigator.clipboard.writeText(csv);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const saveCSV = async () => {
        const csv = buildCSV(data, showCurves);
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
    const targets = useTargetEditor({ design, updateDesign });
    const csv = useCsvActions({ data: spectrum.data, showCurves: display.showCurves, design });
    return {
        design, evalMode, params, setParams,
        ...display, ...spectrum, ...targets, ...csv,
        ...designSummary(design, evalMode, spectrum.data),
    };
}
