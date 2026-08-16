import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useAnalysisDefaults, useAnalysisSettings } from '../../../../state/AnalysisSettingsContext.js';
import { computeOpticalSpectrum } from './spectrum.js';
import { buildCSV, createTargetOperands, editTargetOperands, deleteTargetOperand } from './model.js';

const { useState, useEffect, useCallback, useMemo, useRef } = React;

// The spectrum is computed from the sampled design, so a run redraws this
// window at the shared preview cadence rather than once per progress message.
function useSpectrumEvaluation({ params, evalMode }) {
    const { design } = useLiveDesign();
    return useMemo(() => {
        try {
            return { data: computeOpticalSpectrum(design, params, evalMode), error: null };
        } catch (error) {
            console.error('TMM error:', error);
            return { data: null, error: error.message || 'Computation error' };
        }
    }, [design, params, evalMode]);
}

function useTargetEditor({ design, updateDesign }) {
    const [editMode, setEditMode] = useState(false);
    const [editTool, setEditTool] = useState('draw');
    const [editCurve, setEditCurve] = useState('R');
    const [editPol, setEditPol] = useState('avg');
    const [editKind, setEditKind] = useState('average');
    const [snapOn, setSnapOn] = useState(true);
    const [snapNm, setSnapNm] = useState(10);
    const [snapPct, setSnapPct] = useState(5);
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
        editMode, setEditMode, editTool, setEditTool,
        editCurve, setEditCurve, editPol, setEditPol, editKind, setEditKind,
        snapOn, setSnapOn, snapNm, setSnapNm, snapPct, setSnapPct,
        onCreateTarget, onEditTarget, onDeleteTarget,
    };
}

function useDisplayOptions(params, setParams) {
    const displayDefaults = useAnalysisDefaults('opticalEvaluation');
    const sharedDefaults = useAnalysisDefaults('shared');
    const analysisSettings = useAnalysisSettings();
    const defaultsReady = analysisSettings?.ready !== false;
    const defaultsApplied = useRef(defaultsReady);
    const [showCurves, setShowCurves] = useState({
        T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false
    });
    const [showTable, setShowTable] = useState(false);
    const [showTargets, setShowTargets] = useState(true);
    // Display defaults are sampled when the window mounts. Changes made in
    // Settings therefore affect the next window opening without overwriting
    // adjustments the user makes inside an already-open evaluation window.
    const [yAuto, setYAuto] = useState(() => displayDefaults.booleans.yAuto);
    const [yMin, setYMin] = useState(() => displayDefaults.numbers.yMin);
    const [yMax, setYMax] = useState(() => displayDefaults.numbers.yMax);
    const [spectralUnit, setSpectralUnit] = useState(() => sharedDefaults.enums.spectralUnit);

    // A restored layout can mount this window while settings.json is still
    // loading. In that case apply the persisted defaults once when they arrive;
    // subsequent Settings edits must not overwrite this open window's controls.
    useEffect(() => {
        if (!defaultsReady || defaultsApplied.current) return;
        defaultsApplied.current = true;
        setYAuto(displayDefaults.booleans.yAuto);
        setYMin(displayDefaults.numbers.yMin);
        setYMax(displayDefaults.numbers.yMax);
        setSpectralUnit(sharedDefaults.enums.spectralUnit);
    }, [defaultsReady, displayDefaults.booleans.yAuto, displayDefaults.numbers.yMin,
        displayDefaults.numbers.yMax, sharedDefaults.enums.spectralUnit]);

    const yRange = useMemo(() => ({ auto: yAuto, min: yMin, max: yMax }), [yAuto, yMin, yMax]);
    const lamRange = useMemo(
        () => ({ min: params.lambdaStart, max: params.lambdaEnd }),
        [params.lambdaStart, params.lambdaEnd]
    );
    const toggleCurve = key => setShowCurves(current => ({ ...current, [key]: !current[key] }));
    const setThetas = useCallback(next => {
        setParams(current => ({ ...current, thetas: next }));
    }, []);
    return {
        showCurves, showTable, setShowTable,
        showTargets, setShowTargets, yAuto, setYAuto, yMin, setYMin,
        yMax, setYMax, spectralUnit, setSpectralUnit, yRange, lamRange,
        toggleCurve, setThetas,
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
    const display = useDisplayOptions(params, setParams);
    const spectrum = useSpectrumEvaluation({ params, evalMode });
    const targets = useTargetEditor({ design, updateDesign });
    const csv = useCsvActions({ data: spectrum.data, showCurves: display.showCurves, design });
    return {
        design, evalMode, params, setParams,
        ...display, ...spectrum, ...targets, ...csv,
        ...designSummary(design, evalMode, spectrum.data),
    };
}
