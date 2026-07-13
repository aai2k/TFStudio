import { useDesign } from '../../../../state/DesignContext.js';
import { computeOpticalSpectrum } from './spectrum.js';
import { buildCSV, createTargetOperands, editTargetOperands, deleteTargetOperand } from './model.js';

const { useState, useEffect, useCallback, useMemo, useRef } = React;

function deriveAutoSpectrum(autoCalc, isOptimizing, computeSpectrum) {
    if (!autoCalc || isOptimizing) return null;
    try {
        return { data: computeSpectrum(), error: null };
    } catch (error) {
        console.error('TMM error:', error);
        return { data: null, error: error.message || 'Computation error' };
    }
}

function useOptimizationThrottle(autoCalc, isOptimizing, compute) {
    const computeRef = useRef(compute);
    useEffect(() => { computeRef.current = compute; }, [compute]);
    useEffect(() => {
        if (!autoCalc || !isOptimizing) return;
        computeRef.current();
        const interval = setInterval(() => computeRef.current(), 250);
        return () => clearInterval(interval);
    }, [autoCalc, isOptimizing]);
}

function useSpectrumEvaluation({ design, params, evalMode, autoCalc, isOptimizing }) {
    const [manualData, setManualData] = useState(null);
    const [computing, setComputing] = useState(false);
    const [manualError, setManualError] = useState(null);
    const computeSpectrum = useCallback(
        () => computeOpticalSpectrum(design, params, evalMode),
        [design, params, evalMode]
    );
    const auto = useMemo(
        () => deriveAutoSpectrum(autoCalc, isOptimizing, computeSpectrum),
        [autoCalc, isOptimizing, computeSpectrum]
    );
    const compute = useCallback(() => {
        setComputing(true);
        try {
            setManualData(computeSpectrum());
            setManualError(null);
        } catch (error) {
            console.error('TMM error:', error);
            setManualData(null);
            setManualError(error.message || 'Computation error');
        }
        setComputing(false);
    }, [computeSpectrum]);

    useEffect(() => { setManualData(null); setManualError(null); }, [evalMode]);
    useOptimizationThrottle(autoCalc, isOptimizing, compute);

    return {
        data: auto ? auto.data : manualData,
        error: auto ? auto.error : manualError,
        computing,
        compute,
    };
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
    const [showCurves, setShowCurves] = useState({
        T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false
    });
    const [autoCalc, setAutoCalc] = useState(true);
    const [showTable, setShowTable] = useState(false);
    const [showTargets, setShowTargets] = useState(true);
    const [yAuto, setYAuto] = useState(false);
    const [yMin, setYMin] = useState(0);
    const [yMax, setYMax] = useState(100);
    const [spectralUnit, setSpectralUnit] = useState('nm');
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
        showCurves, autoCalc, setAutoCalc, showTable, setShowTable,
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
    const { design, updateDesign, evalMode, evalParams: params, setEvalParams: setParams, isOptimizing } = context;
    const display = useDisplayOptions(params, setParams);
    const spectrum = useSpectrumEvaluation({ design, params, evalMode, autoCalc: display.autoCalc, isOptimizing });
    const targets = useTargetEditor({ design, updateDesign });
    const csv = useCsvActions({ data: spectrum.data, showCurves: display.showCurves, design });
    return {
        design, evalMode, params, setParams,
        ...display, ...spectrum, ...targets, ...csv,
        ...designSummary(design, evalMode, spectrum.data),
    };
}
