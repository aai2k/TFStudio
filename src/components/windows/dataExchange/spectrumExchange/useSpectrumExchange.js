import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { withUniqueCurveIds } from '../../../../utils/io/spectrumTable.js';
import { useDesignExport, useMeasuredExport } from './exportActions.js';
import { useImportActions } from './importActions.js';
import { designPreview, designSeriesKey } from './designPreview.js';
import {
    clampedFitRange, defaultMeasuredFitOptions, measuredFitConstraintsInvalid,
    measuredFitMeritOperands, measuredFitSnapshot, orphanFitBlocks, restoredFitCurves,
} from './model.js';
import { spectrumExchangeSession, spectrumExchangeView } from './sessionState.js';
import { evalParamsSession } from '../../../../state/evalParamsSession.js';
import { useSplitWindowSession } from '../../windowSession.js';
import { useCurveEditorHost } from '../curveEditor/useCurveEditorHost.js';
import { useActionStatus } from '../chrome/actionStatus.js';

const { useCallback, useEffect, useMemo, useState } = React;

function previewCurveSwitches(curve) {
    const switches = { T: false, R: false, A: false, Ts: false, Rs: false, Tp: false, Rp: false };
    if (curve) switches[designSeriesKey(curve)] = true;
    return switches;
}

export function useSpectrumExchange(sx, ce) {
    const { design, updateDesign, checkpoint, evalMode } = useDesign();
    // The grid Optical Evaluation was last set to, as the export defaults. Read
    // once: these seed the fields below, which the user then owns.
    const evalParams = useMemo(() => evalParamsSession.peek(null), []);
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField] = useSplitWindowSession(
        spectrumExchangeSession, spectrumExchangeView, design);
    const {
        tab, expSource, expFormat, expSelected = {}, expXUnit, expYScale,
        parsed, fileName, colIdx, selectedCurveId, xUnit, aoi, pol,
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
    const setOv = value => setField('ov', value);
    const [loading, setLoading] = useState(false);
    const { status, flash, clear: clearStatus } = useActionStatus();
    const [fitDialogCurveId, setFitDialogCurveId] = useState(null);
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
    const fitConfig = useMemo(() => clampedFitRange(design, {
        ...defaultMeasuredFitOptions(fitDialogCurve),
        ...(fitDialogCurve ? fitOptions[fitDialogCurve.id] : {}),
    }), [design, fitDialogCurve, fitOptions]);
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
        // The dialog's range fields already state the range being stored, so
        // the confirmation does not need to report a clip.
        const message = sx.fitAdded(
            fitSnapshot.operand.curveName, fitSnapshot.operand.sampleLambdas.length);
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
        quantity, yscale, fileName, colIdx, ov, aoi, pol,
        setLoading, clearStatus, setParsed, setFileName, setColIdx, setOv, setXUnit,
        setSelectedCurveId, setAoi, setPol,
    });
    const previewCurve = (selectedCurveId ? selectedCurve : null) || importActions.previewCurve || selectedCurve;
    const preview = useMemo(
        () => designPreview(design, previewCurve, missingMaterialIds),
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
    const curveEditor = useCurveEditorHost({
        kind: 'spectrum', listKey: 'measuredCurves', design, updateDesign, checkpoint, flash, ce,
        onAdded: added => setSelectedCurveId(added[0].id),
    });

    return {
        design, tab, setTab, expSource, setExpSource, expFormat, setExpFormat,
        expXUnit, setExpXUnit, expYScale, setExpYScale,
        selectedExportCurves, setExportCurveSelected, selectAllExportCurves,
        parsed, fileName, colIdx, setColIdx, name, setName, loading, status,
        xUnit, setXUnit, quantity, yscale, setColOv, curves,
        aoi, setAoi, pol, setPol,
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
        dQ, setDQ, dSP, setDSP, onExportDesign, evalMode, missingMaterialIds, curveEditor,
    };
}
