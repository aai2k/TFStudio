import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { chartData, ellipsometryCurves, looksLikeCosDelta } from './model.js';
import {
    ellipsometryFitSnapshot, orphanEllipsometryFitBlocks, restoredEllipsometryCurves,
} from './fitModel.js';
import { defaultCurveName, useImportActions } from './importActions.js';
import { useExportActions } from './exportActions.js';
import {
    clampedFitRange, defaultMeasuredFitOptions, measuredFitConstraintsInvalid,
    measuredFitMeritOperands,
} from '../spectrumExchange/model.js';
import { measuredEllipsometrySession, measuredEllipsometryView } from './sessionState.js';
import { useSplitWindowSession } from '../../windowSession.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

/**
 * Turning one measured Ψ or Δ into a merit target, through the dialog
 * Measured Spectra uses.
 */
function useFitDialog({ design, curves, fitOptions, setField, updateDesign, checkpoint, flash, mx, fitText }) {
    const [fitCurveId, setFitCurveId] = useState(null);
    const fitDialogCurve = useMemo(
        () => curves.find(curve => curve.id === fitCurveId) || null,
        [curves, fitCurveId]);
    const fitConfig = useMemo(() => clampedFitRange(design, {
        ...defaultMeasuredFitOptions(fitDialogCurve),
        ...(fitDialogCurve ? fitOptions[fitCurveId] : {}),
    }), [design, fitDialogCurve, fitCurveId, fitOptions]);
    const setFitOption = useCallback((key, value) => {
        if (!fitCurveId) return;
        setField('fitOptions', previous => ({
            ...previous,
            [fitCurveId]: { ...(previous[fitCurveId] || {}), [key]: value },
        }));
    }, [fitCurveId, setField]);
    const fitSnapshot = useMemo(
        () => ellipsometryFitSnapshot(design, fitDialogCurve, fitConfig),
        [design, fitDialogCurve, fitConfig]);
    const closeFitDialog = useCallback(() => setFitCurveId(null), []);
    const onCreateFitOperand = useCallback(() => {
        if (!fitSnapshot.operand) {
            flash('error', fitText.fitErrors[fitSnapshot.error] || fitText.fitErrors.range);
            return;
        }
        if (measuredFitConstraintsInvalid(fitConfig)) {
            flash('error', fitText.fitConstraintError);
            return;
        }
        checkpoint();
        updateDesign({
            meritOperands: measuredFitMeritOperands(design.meritOperands, fitSnapshot.operand, fitConfig),
        });
        flash('success', mx.fitAdded(fitDialogCurve.name, fitSnapshot.sampled.lambdas.length));
        setFitCurveId(null);
    }, [fitSnapshot, fitConfig, fitDialogCurve, design, updateDesign, checkpoint, flash, fitText, mx]);
    return {
        fitDialogCurve, fitConfig, setFitOption, fitSnapshot, onCreateFitOperand, closeFitDialog,
        openFitDialog: curve => setFitCurveId(curve.id),
    };
}

// Edits to the curves already on the design.
function useCurveEdits({ design, updateDesign, checkpoint }) {
    const updateCurve = useCallback((id, patch) => {
        checkpoint();
        updateDesign({
            measuredEllipsometry: ellipsometryCurves(design)
                .map(curve => (curve.id === id ? { ...curve, ...patch } : curve)),
        });
    }, [design, updateDesign, checkpoint]);

    // Visibility is a view state, not an edit, so it takes no undo checkpoint.
    const toggleCurve = useCallback((id) => {
        updateDesign({
            measuredEllipsometry: ellipsometryCurves(design).map(curve => (
                curve.id === id ? { ...curve, visible: curve.visible === false } : curve
            )),
        });
    }, [design, updateDesign]);

    const removeCurve = useCallback((id) => {
        checkpoint();
        updateDesign({
            measuredEllipsometry: ellipsometryCurves(design).filter(curve => curve.id !== id),
        });
    }, [design, updateDesign, checkpoint]);

    return { updateCurve, toggleCurve, removeCurve };
}

export function useMeasuredEllipsometry(mx, xLabel, fitText) {
    const { design, updateDesign, checkpoint, hasActiveDesign } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField] = useSplitWindowSession(
        measuredEllipsometrySession, measuredEllipsometryView, design);
    const {
        tab, parsed, fileName, colIdx, selectedCurveId, xUnit, aoi, side, deltaConvention,
        expSource, expXUnit, expSelected = {}, expStart, expEnd, expStep, expAoi,
        expDeltaConvention, ov = {},
        fitOptions = {}, panelWidth,
    } = session;
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    // One timer for the status line, so an earlier message's expiry cannot
    // clear a later one, and nothing fires after the window is gone.
    const statusTimer = useRef(null);
    const flash = useCallback((type, msg) => {
        setStatus({ type, msg });
        clearTimeout(statusTimer.current);
        statusTimer.current = setTimeout(() => setStatus(null), 4000);
    }, []);
    useEffect(() => () => clearTimeout(statusTimer.current), []);

    const curves = ellipsometryCurves(design);
    const selectedCurve = curves.find(curve => curve.id === selectedCurveId) || null;
    const column = parsed?.columns?.[colIdx] || null;
    const override = ov[colIdx] || {};

    const importActions = useImportActions({
        design, updateDesign, checkpoint, flash, mx, setField, setLoading, setStatus, session,
    });
    const { columnQuantity, previewCurves, previewColumn, addCurves } = importActions;
    const edits = useCurveEdits({ design, updateDesign, checkpoint });
    const exportActions = useExportActions({ design, curves, session, missingMaterialIds, flash, mx });
    const fit = useFitDialog({
        design, curves, fitOptions, setField, updateDesign, checkpoint, flash, mx, fitText,
    });

    // A merit function loaded from a preset brings its fit targets but not the
    // curves behind them. The snapshots hold everything a curve needs, so the
    // measurement can be put back rather than imported again.
    const orphanFits = useMemo(() => orphanEllipsometryFitBlocks(design), [design]);
    const onRestoreFitCurves = useCallback(() => {
        const restored = restoredEllipsometryCurves(design);
        if (!restored) return;
        checkpoint();
        updateDesign(restored);
        flash('success', mx.fitCurvesRestored(restored.measuredEllipsometry.length - curves.length));
    }, [design, updateDesign, checkpoint, flash, mx, curves.length]);

    // The preview follows the file being configured until a curve on the design
    // is picked, so the panel the operator is looking at is the one drawn.
    const previewSource = selectedCurve || previewColumn;
    const preview = useMemo(
        () => chartData(previewSource ? [previewSource] : [], xLabel),
        [previewSource, xLabel]);

    return {
        design, hasActiveDesign, curves, selectedCurve, missingMaterialIds,
        // Which face a curve belongs to matters only when there is a coating
        // on each face to tell apart.
        hasBackCoating: (design.backLayers || []).length > 0,
        tab, setTab: value => setField('tab', value),
        panelWidth, setPanelWidth: value => setField('panelWidth', value),
        parsed, fileName, colIdx,
        // Configuring a column puts the preview back on the file, the way
        // Measured Spectra does: otherwise the plot keeps drawing whichever
        // imported curve was last clicked and the column controls look dead.
        setColIdx: (value) => { setField('colIdx', value); setField('selectedCurveId', null); },
        xUnit, setXUnit: value => setField('xUnit', value),
        aoi, setAoi: value => setField('aoi', value),
        side, setSide: value => setField('side', value),
        deltaConvention, setDeltaConvention: value => setField('deltaConvention', value),
        quantity: columnQuantity(colIdx),
        name: override.name || (column ? defaultCurveName(fileName, parsed, column) : ''),
        setName: value => setField('ov', { ...ov, [colIdx]: { ...override, name: value } }),
        setColQuantity: (value) => {
            setField('ov', { ...ov, [colIdx]: { ...override, quantity: value } });
            setField('selectedCurveId', null);
        },
        setSelectedCurveId: value => setField('selectedCurveId', value),
        previewCurves, previewColumn, preview,
        onImport: importActions.onImport, loading, status,
        cosDeltaCurve: curves.find(looksLikeCosDelta) || null,
        onAddSelected: () => addCurves([previewColumn]),
        onAddAll: () => addCurves(previewCurves.filter((_, index) => !!columnQuantity(index))),
        ...edits, ...fit, orphanFits, onRestoreFitCurves,
        expSource, setExpSource: value => setField('expSource', value),
        expXUnit, setExpXUnit: value => setField('expXUnit', value),
        expSelected, setExpSelected: (id, on) => setField('expSelected', { ...expSelected, [id]: on }),
        expStart, setExpStart: value => setField('expStart', value),
        expEnd, setExpEnd: value => setField('expEnd', value),
        expStep, setExpStep: value => setField('expStep', value),
        expAoi, setExpAoi: value => setField('expAoi', value),
        expDeltaConvention, setExpDeltaConvention: value => setField('expDeltaConvention', value),
        ...exportActions,
    };
}
