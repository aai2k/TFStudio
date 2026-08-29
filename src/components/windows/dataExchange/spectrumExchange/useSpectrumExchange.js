import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { computeDesignSpectrum } from '../../../../utils/io/designSpectrum.js';
import { measuredCurveData, withUniqueCurveIds } from '../../../../utils/io/spectrumTable.js';
import { resolveEvalMode } from '../../../../utils/physics/optimizer.js';
import { useDesignExport, useMeasuredExport } from './exportActions.js';
import { useImportActions } from './importActions.js';
import {
    defaultMeasuredFitOptions, measuredFitConstraintsInvalid, measuredFitMeritOperands,
    measuredFitSnapshot, orphanFitBlocks, restoredFitCurves,
} from './model.js';
import { spectrumExchangeSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useEffect, useMemo, useState } = React;

function previewCurveSwitches(curve) {
    const switches = { T: false, R: false, A: false, Ts: false, Rs: false, Tp: false, Rp: false };
    if (!curve) return switches;
    if (curve.quantity === 'A') switches.A = true;
    else if (curve.pol === 's') switches[`${curve.quantity}s`] = true;
    else if (curve.pol === 'p') switches[`${curve.quantity}p`] = true;
    else switches[curve.quantity] = true;
    return switches;
}

function computePreview(design, curve, missingMaterialIds) {
    if (!curve) return { data: null, range: null, error: null };
    const visible = measuredCurveData(curve);
    if (!visible.x.length) return { data: null, range: null, error: 'empty' };
    const min = visible.x[0], max = visible.x[visible.x.length - 1];
    const range = { min, max };
    if (missingMaterialIds.length) return { data: null, range, error: 'materials' };
    try {
        const span = Math.max(0, max - min);
        const step = span > 0 ? Math.max(0.1, span / 600) : 1;
        // Draw what the merit function scores. In whole-sample mode that is the
        // total spectrum, not the single front surface, and a measurement of a
        // coated substrate is a whole-sample measurement.
        const data = computeDesignSpectrum(design, {
            lambdaStart: min,
            lambdaEnd: max > min ? max : min + step,
            lambdaStep: step,
            thetas: [curve.aoi ?? 0],
        }, resolveEvalMode(design));
        return { data, range, error: null };
    } catch (error) {
        console.error('Measured spectrum preview error:', error);
        return { data: null, range, error: 'evaluation' };
    }
}

export function useSpectrumExchange(sx) {
    const { design, updateDesign, checkpoint, evalParams, evalMode } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField] = useWindowSession(spectrumExchangeSession, design);
    const {
        tab, expSource, expFormat, expSelected = {}, expXUnit, expYScale,
        parsed, fileName, colIdx, selectedCurveId, xUnit, aoi, pol, side,
        fitOptions = {}, ov,
    } = session;
    const setTab = value => setField('tab', value);
    const setExpSource = value => setField('expSource', value);
    const setExpFormat = value => setField('expFormat', value);
    const setExpXUnit = value => setField('expXUnit', value);
    const setExpYScale = value => setField('expYScale', value);
    const setParsed = value => setField('parsed', value);
    const setFileName = value => setField('fileName', value);
    // The preview shows whichever of the two lists was touched last: a column of
    // the file being configured, or a curve already on the design. Choosing a
    // column hands the preview back to the configure panel.
    const setColIdx = (value) => { setField('colIdx', value); setField('selectedCurveId', null); };
    const setSelectedCurveId = value => setField('selectedCurveId', value);
    const setXUnit = value => setField('xUnit', value);
    const setAoi = value => setField('aoi', value);
    const setPol = value => setField('pol', value);
    const setSide = value => setField('side', value);
    const setOv = value => setField('ov', value);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [fitDialogCurveId, setFitDialogCurveId] = useState(null);
    const flash = (type, msg) => setStatus({ type, msg });
    const curves = design.measuredCurves || [];
    // A design saved while two curves shared an id keeps them, and a shared id
    // makes both answer to one card. Repair it the first time the window sees it.
    useEffect(() => {
        const repaired = withUniqueCurveIds(curves);
        if (repaired !== curves) updateDesign({ measuredCurves: repaired });
    }, [curves, updateDesign]);
    // A merit function loaded from a preset brings its fit targets but not the
    // curves behind them. The snapshots hold everything a curve needs, so the
    // measurement can be put back rather than imported again.
    const orphanFits = useMemo(() => orphanFitBlocks(design), [design]);
    const onRestoreFitCurves = useCallback(() => {
        const restored = restoredFitCurves(design);
        if (!restored) return;
        checkpoint();
        updateDesign(restored);
        flash('success', sx.fitCurvesRestored(restored.measuredCurves.length - curves.length));
    }, [design, updateDesign, checkpoint, sx, curves.length]);
    const selectedCurve = curves.find(curve => curve.id === selectedCurveId) || curves[0] || null;
    const fitDialogCurve = curves.find(curve => curve.id === fitDialogCurveId) || null;
    const fitConfig = useMemo(() => ({
        ...defaultMeasuredFitOptions(fitDialogCurve),
        ...(fitDialogCurve ? fitOptions[fitDialogCurve.id] : {}),
    }), [fitDialogCurve, fitOptions]);
    const setFitOption = (key, value) => {
        if (!fitDialogCurve) return;
        setField('fitOptions', previous => ({
            ...previous,
            [fitDialogCurve.id]: { ...(previous[fitDialogCurve.id] || {}), [key]: value },
        }));
    };
    const fitSnapshot = useMemo(
        () => measuredFitSnapshot(design, fitDialogCurve, fitConfig),
        [design, fitDialogCurve, fitConfig],
    );
    const openFitDialog = id => {
        setSelectedCurveId(id);
        setFitDialogCurveId(id);
    };
    const closeFitDialog = () => setFitDialogCurveId(null);
    const onCreateFitOperand = useCallback(() => {
        if (!fitSnapshot.operand) {
            flash('error', sx.fitErrors[fitSnapshot.error] || sx.fitErrors.range);
            return;
        }
        if (measuredFitConstraintsInvalid(fitConfig)) {
            flash('error', sx.fitConstraintError);
            return;
        }
        checkpoint();
        updateDesign({
            meritOperands: measuredFitMeritOperands(
                design.meritOperands, fitSnapshot.operand, fitConfig),
        });
        const message = fitSnapshot.sampled.clipped
            ? sx.fitAddedClipped(fitSnapshot.operand.curveName, fitSnapshot.sampled.lambdas.length)
            : sx.fitAdded(fitSnapshot.operand.curveName, fitSnapshot.sampled.lambdas.length);
        flash('success', message);
        closeFitDialog();
    }, [fitSnapshot, fitConfig, design, updateDesign, checkpoint, sx]);
    const selectedExportCurves = curves.filter(curve => expSelected[curve.id] !== false);
    const setExportCurveSelected = (id, selected) => setField('expSelected', previous => ({
        ...previous,
        [id]: selected,
    }));
    const selectAllExportCurves = selected => setField('expSelected', Object.fromEntries(
        curves.map(curve => [curve.id, selected]),
    ));
    const col = parsed?.columns?.[colIdx] || null;
    const colOv = ov[colIdx] || {};
    const setColOv = (patch) => setOv((previous) => ({
        ...previous,
        [colIdx]: { ...previous[colIdx], ...patch },
    }));
    const baseName = (fileName || 'spectrum').replace(/\.[^.]+$/, '');
    const defaultName = parsed?.columns?.length > 1 ? `${baseName}: ${col?.name || ''}` : baseName;
    const name = colOv.name ?? defaultName;
    const setName = value => setColOv({ name: value });
    const quantity = colOv.quantity || col?.quantity || 'T';
    const yscale = colOv.yscale || (col?.isAbsorbance ? 'absorbance' : (col?.isPercent ? 'percent' : 'fraction'));

    const importActions = useImportActions({
        sx, design, updateDesign, checkpoint, flash, parsed, col, name, xUnit,
        quantity, yscale, fileName, colIdx, ov, aoi, pol, side,
        setLoading, setStatus, setParsed, setFileName, setColIdx, setOv, setXUnit,
        setSelectedCurveId, setAoi,
    });
    const previewCurve = (selectedCurveId ? selectedCurve : null) || importActions.previewCurve || selectedCurve;
    const preview = useMemo(
        () => computePreview(design, previewCurve, missingMaterialIds),
        [design, previewCurve, missingMaterialIds],
    );
    const previewShowCurves = useMemo(() => previewCurveSwitches(previewCurve), [previewCurve]);
    const onExport = useMeasuredExport({
        design, expFormat, curves: selectedExportCurves,
        xUnit: expXUnit, asPercent: expYScale === 'percent', flash, sx,
    });
    const [dStart, setDStart] = useState(evalParams?.lambdaStart ?? 400);
    const [dEnd, setDEnd] = useState(evalParams?.lambdaEnd ?? 800);
    const [dStep, setDStep] = useState(evalParams?.lambdaStep ?? 2);
    const [dAoi, setDAoi] = useState((evalParams?.thetas?.length ? evalParams.thetas : [0]).join(', '));
    const [dQ, setDQ] = useState({ T: true, R: true, A: true });
    const [dSP, setDSP] = useState(false);
    const onExportDesign = useDesignExport({
        design, evalMode, dStart, dEnd, dStep, dAoi, dQ, dSP, expFormat, flash, sx,
    });

    return {
        design, tab, setTab, expSource, setExpSource, expFormat, setExpFormat,
        expXUnit, setExpXUnit, expYScale, setExpYScale,
        selectedExportCurves, setExportCurveSelected, selectAllExportCurves,
        parsed, fileName, colIdx, setColIdx, name, setName, loading, status,
        xUnit, setXUnit, quantity, yscale, setColOv, curves,
        aoi, setAoi, pol, setPol, side, setSide,
        selectedCurve, selectedCurveId, setSelectedCurveId,
        orphanFits, onRestoreFitCurves,
        fitDialogCurve, openFitDialog, closeFitDialog,
        fitConfig, setFitOption, fitSnapshot, onCreateFitOperand,
        // Spread the raw import actions first. Its `previewCurve` describes a
        // not-yet-added delimited table and is null after a direct JCAMP import;
        // the merged value below must win so stored/imported curves reach the
        // chart instead of being replaced by that null.
        ...importActions, onExport,
        previewCurve, previewData: preview.data, previewRange: preview.range,
        previewError: preview.error, previewShowCurves,
        dStart, setDStart, dEnd, setDEnd, dStep, setDStep, dAoi, setDAoi,
        dQ, setDQ, dSP, setDSP, onExportDesign, evalMode, missingMaterialIds,
    };
}
