// State/logic hook for the Needle Manual window.
//
// Reuses the validated math from optimizer.js verbatim:
//   • scanNeedlesPFunction   — analytic P-function (FD fallback)
//   • insertNeedle / insertNeedleIntra — gap / intra-layer insertion (auto-mirror in symmetric)
//   • findOptimalNeedleThickness       — golden-section thickness for the initial d_new
//
// Reference: Tikhonravov et al., Applied Optics 35(28), 5493 (1996);
//            Sullivan & Dobrowolski, Applied Optics 35(28), 5484 (1996).

import { useDesign } from '../../../../state/DesignContext.js';
import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import {
    findOptimalNeedleThickness, mirrorLayers,
    DLSOptimizer, resolveScanSide, isConstraint,
    buildEvalContext, evaluateOperands, calcOMF,
} from '../../../../utils/physics/optimizer.js';
import {
    countPoolMaterials, POOL_MAX_SYNC,
    useCatSelection, resolveMat, matDisplayName, getPoolMaterials,
} from '../synthesisShared/synthesisHelpers.js';
import {
    candidateDepth, insertForSelection, runNeedleScan, buildPlotData,
    resolveHostInfo, resolveDRange,
} from './model.js';

const { useState, useEffect, useRef, useCallback, useMemo } = React;

const NEEDLE_MANUAL_CATS_KEY = 'tfstudio_needleManual_selectedCats';

// ── Settings (deltaNm, dMin, profile resolution, refine, material pool) ─────────

function useNeedleSettings() {
    const [deltaNm,     setDeltaNm]     = useState(0.5);
    const [dMin,        setDMin]        = useState(1.0);
    const [nIntra,      setNIntra]      = useState(16);
    const [refineAfter, setRefineAfter] = useState(true);
    const [dlsIter,     setDlsIter]     = useState(80);
    const [requestedSide, setRequestedSide] = useState('front');
    const catSelection = useCatSelection(NEEDLE_MANUAL_CATS_KEY);

    return {
        deltaNm, setDeltaNm, dMin, setDMin, nIntra, setNIntra,
        refineAfter, setRefineAfter, dlsIter, setDlsIter,
        requestedSide, setRequestedSide,
        selectedCats: catSelection.selectedCats,
        excludedMats: catSelection.excludedMats,
        handleToggleCat: catSelection.handleToggleCat,
        handleSelectAllCats: catSelection.handleSelectAllCats,
        handleClearCats: catSelection.handleClearCats,
        handleToggleMat: catSelection.handleToggleMat,
    };
}

// ── Scan → selection workflow (P-function profile, candidate pick, geometry) ────

function scanAndSetResult({ ops, design, pool, deltaNm, nIntra, requestedSide, effSide, tn, setScan, setStatusMsg, setScanning }) {
    try {
        const { scan, statusMsg } = runNeedleScan({
            operands: ops, design, resolveMat, candidateMats: pool,
            deltaNm, nIntra, side: requestedSide, effSide, tn,
        });
        setScan(scan);
        setStatusMsg(statusMsg);
    } catch (err) {
        console.error('[NeedleManual] scan failed:', err);
        setStatusMsg(tn.scanError);
        setScan(null);
    } finally {
        setScanning(false);
    }
}

// The profile scan runs synchronously on the UI thread; past POOL_MAX_SYNC
// candidate materials it freezes/crashes the renderer, so refuse rather than
// attempt it and leave the user with no way to stop.
function runComputeProfile(ctx) {
    const {
        design, operands, selectedCats, excludedMats, deltaNm, nIntra,
        requestedSide, effSide, tn, t,
        setStatusMsg, setScanBlocked, setScanning, setSelected, setScan,
    } = ctx;
    if (!design) return;
    const ops = operands.filter(op => !isConstraint(op.type));   // synthesis = unconstrained
    if (ops.length === 0) { setStatusMsg(tn.noOperands); return; }
    const poolCount = countPoolMaterials(selectedCats, excludedMats);
    if (poolCount > POOL_MAX_SYNC) {
        setScanBlocked(true);
        setStatusMsg(t.pool.tooMany(poolCount, POOL_MAX_SYNC));
        return;
    }
    setScanBlocked(false);
    const pool = getPoolMaterials(selectedCats, { excluded: excludedMats });
    if (!pool.length) { setStatusMsg(tn.noMaterials); return; }

    setScanning(true); setStatusMsg(tn.scanning); setSelected(null);
    // Defer so the "Scanning…" status paints before the (synchronous) scan.
    setTimeout(() => scanAndSetResult({
        ops, design, pool, deltaNm, nIntra, requestedSide, effSide, tn,
        setScan, setStatusMsg, setScanning,
    }), 0);
}

function useNeedleWorkflow({ design, effSide, operands, selectedCats, excludedMats, deltaNm, nIntra, dMin, requestedSide, tn, t }) {
    const [scan,      setScan]      = useState(null);   // { candidates, mf0, side, zb, layers }
    const [scanning,  setScanning]  = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [scanBlocked, setScanBlocked] = useState(false);   // pool too large for the single-threaded scan
    const [selected,  setSelected]  = useState(null);   // { ...candidate, z, grad }
    const [dNew,      setDNew]      = useState(1.0);

    // Clear selection + scan when the design or active side changes.
    useEffect(() => {
        setScan(null); setSelected(null); setStatusMsg('');
    }, [design?.id, effSide]);

    const computeProfile = useCallback(() => {
        runComputeProfile({
            design, operands, selectedCats, excludedMats, deltaNm, nIntra,
            requestedSide, effSide, tn, t,
            setStatusMsg, setScanBlocked, setScanning, setSelected, setScan,
        });
    }, [design, operands, selectedCats, excludedMats, deltaNm, nIntra, requestedSide, effSide, tn, t]);

    const plotData = useMemo(() => buildPlotData(scan), [scan]);

    const hostInfo = useMemo(() => resolveHostInfo(selected, scan, dMin, tn), [selected, scan, dMin, tn]);
    const dRange   = useMemo(() => resolveDRange(selected, hostInfo, dMin), [selected, hostInfo, dMin]);

    const handlePick = useCallback((cand) => {
        const zb = scan?.zb || [0];
        const z = candidateDepth(cand, zb);
        setSelected({ ...cand, z, grad: cand.grad });
        // Initial d_new = golden-section optimum, clamped to the slider range.
        const pool = getPoolMaterials(selectedCats, { excluded: excludedMats });
        const mat  = pool.find(p => p.id === cand.materialId)?.mat || resolveMat(cand.materialId);
        let d0 = dMin;
        try {
            const ops = operands.filter(op => !isConstraint(op.type));
            d0 = findOptimalNeedleThickness({
                operands: ops, design, resolveMat,
                candidate: { ...cand, _mat: mat }, deltaNm: dMin, maxNm: 200, tol: 0.5, side: requestedSide,
            });
            if (!(d0 >= dMin)) d0 = dMin;
        } catch (_) { d0 = dMin; }
        setDNew(d0);
    }, [scan, selectedCats, excludedMats, operands, design, dMin, requestedSide]);

    // Clamp d_new into range when the selection / range changes.
    useEffect(() => {
        if (!selected) return;
        setDNew(prev => Math.min(Math.max(prev, dRange[0]), dRange[1]));
    }, [dRange[0], dRange[1], selected]);

    return {
        scan, setScan, scanning, statusMsg, setStatusMsg, scanBlocked, computeProfile,
        selected, setSelected, dNew, setDNew, plotData, hostInfo, dRange, handlePick,
    };
}

// ── Predicted optical merit at d_new (exact, via calcOMF on the inserted design) ─
// OMF drops the MNT/MXT/TT constraints. The needle scan is itself optical-only,
// and a thin needle always starts below MNT; showing the full MF here would
// report a large, transient constraint penalty rather than the optical benefit.

function usePredictedOMF({ selected, scan, design, operands, dNew, requestedSide }) {
    const [predictedOMF, setPredictedOMF] = useState(null);   // optical MF after insert
    const [omfNow,       setOmfNow]       = useState(null);   // optical MF of current design

    useEffect(() => {
        if (!selected || !scan || !design) {
            setPredictedOMF(null); setOmfNow(null);
            return;
        }
        const id = setTimeout(() => {
            try {
                const ops = operands;   // full enabled set; calcOMF skips constraint terms
                const compNow = evaluateOperands(ops, buildEvalContext(design, resolveMat));
                setOmfNow(calcOMF(ops, compNow));
                const inserted = insertForSelection(selected, design, dNew, requestedSide);
                const compIns = evaluateOperands(ops, buildEvalContext(inserted, resolveMat));
                setPredictedOMF(calcOMF(ops, compIns));
            } catch (_) { setPredictedOMF(null); setOmfNow(null); }
        }, 30);
        return () => clearTimeout(id);
    }, [selected, dNew, scan, design, operands, requestedSide]);

    return { predictedOMF, omfNow };
}

// ── Apply: single insertion, optionally followed by one DLS refinement pass ─────

function commitInsertion(inserted, updateDesign) {
    updateDesign({ frontLayers: inserted.frontLayers, backLayers: inserted.backLayers });
}

// Async-ticked DLS refinement loop so the UI stays responsive; re-schedules
// itself via refineTimerRef until converged or dlsIter is reached.
function runDlsRefineTick(ctx) {
    const { dls, inserted, dlsIter, surfaceMode, updateDesign, tn, selected,
             setRefining, setStatusMsg, setScan, setSelected, refineTimerRef } = ctx;
    dls.step();
    const done = dls.isConverged() || dls.iter >= dlsIter;
    // Live preview of the refining stack.
    const cur = dls.applyToDesign(inserted);
    updateDesign({ frontLayers: cur.frontLayers, backLayers: cur.backLayers }, { transient: true });
    if (!done) { refineTimerRef.current = setTimeout(() => runDlsRefineTick(ctx), 0); return; }

    let finalD = dls.applyToDesign(inserted);
    if (surfaceMode === 'symmetric') {
        finalD = { ...finalD, backLayers: mirrorLayers(finalD.frontLayers) };
    }
    updateDesign({ frontLayers: finalD.frontLayers, backLayers: finalD.backLayers });
    setRefining(false);
    setStatusMsg(tn.insertedRefined(matDisplayName(selected.materialId), dls.mf.toFixed(6)));
    setScan(null); setSelected(null);
}

function runHandleApply(ctx) {
    const {
        selected, design, busy, dNew, refineAfter, requestedSide, operands, dMin, dlsIter,
        surfaceMode, checkpoint, updateDesign, tn,
        setRefining, setStatusMsg, setScan, setSelected, refineTimerRef,
    } = ctx;
    if (!selected || !design || busy) return;
    checkpoint && checkpoint();   // one undo step covers insert (+ refine)

    const inserted = insertForSelection(selected, design, dNew, requestedSide);

    if (!refineAfter) {
        commitInsertion(inserted, updateDesign);
        setStatusMsg(tn.inserted(matDisplayName(selected.materialId)));
        setScan(null); setSelected(null);
        return;
    }

    let dls;
    try {
        dls = new DLSOptimizer(operands, inserted, resolveMat, { dMin });
    } catch (err) {
        console.error('[NeedleManual] DLS init failed, committing un-refined:', err);
        commitInsertion(inserted, updateDesign);
        setStatusMsg(tn.inserted(matDisplayName(selected.materialId)));
        setScan(null); setSelected(null);
        return;
    }
    setRefining(true);
    setStatusMsg(tn.refining);
    refineTimerRef.current = setTimeout(() => runDlsRefineTick({
        dls, inserted, dlsIter, surfaceMode, updateDesign, tn, selected,
        setRefining, setStatusMsg, setScan, setSelected, refineTimerRef,
    }), 0);
}

function useNeedleApply({
    scanning, selected, design, dNew, refineAfter, requestedSide, operands, dMin, dlsIter,
    surfaceMode, checkpoint, updateDesign, tn, setStatusMsg, setScan, setSelected,
}) {
    const [refining, setRefining] = useState(false);
    const busy = scanning || refining;
    const refineTimerRef = useRef(null);

    // Flip the global isOptimizing flag while a DLS refine runs (throttles live
    // previews in other windows, matches NeedleVariation).
    const { beginOptimization, endOptimization } = useDesign();
    useEffect(() => {
        if (!refining) return;
        beginOptimization();
        return () => endOptimization();
    }, [refining, beginOptimization, endOptimization]);

    useEffect(() => () => clearTimeout(refineTimerRef.current), []);

    const handleApply = useCallback(() => {
        runHandleApply({
            selected, design, busy, dNew, refineAfter, requestedSide, operands, dMin, dlsIter,
            surfaceMode, checkpoint, updateDesign, tn,
            setRefining, setStatusMsg, setScan, setSelected, refineTimerRef,
        });
    }, [selected, design, busy, dNew, refineAfter, requestedSide, operands, dMin, dlsIter, surfaceMode, checkpoint, updateDesign, tn]);

    return { refining, busy, handleApply };
}

// ── Top-level combinator ─────────────────────────────────────────────────────────

export function useNeedleManual(t) {
    const { design, updateDesign, checkpoint } = useDesign();
    const tn = t.needleManual;
    const settings = useNeedleSettings();

    const surfaceMode = design?.surfaceMode || 'front_only';
    const effSide = resolveScanSide(surfaceMode, settings.requestedSide);
    const showSideRadio = surfaceMode === 'both_independent';
    const operands = useMemo(() => (design?.meritOperands || []).filter(op => op.enabled), [design]);

    const workflow = useNeedleWorkflow({
        design, effSide, operands, tn, t,
        selectedCats: settings.selectedCats, excludedMats: settings.excludedMats,
        deltaNm: settings.deltaNm, nIntra: settings.nIntra, dMin: settings.dMin,
        requestedSide: settings.requestedSide,
    });

    const predicted = usePredictedOMF({
        selected: workflow.selected, scan: workflow.scan, design, operands,
        dNew: workflow.dNew, requestedSide: settings.requestedSide,
    });

    const apply = useNeedleApply({
        scanning: workflow.scanning, selected: workflow.selected, design,
        dNew: workflow.dNew, refineAfter: settings.refineAfter, requestedSide: settings.requestedSide,
        operands, dMin: settings.dMin, dlsIter: settings.dlsIter, surfaceMode,
        checkpoint, updateDesign, tn,
        setStatusMsg: workflow.setStatusMsg, setScan: workflow.setScan, setSelected: workflow.setSelected,
    });

    return {
        design, tn, surfaceMode, effSide, showSideRadio, operands,
        catalogs: getCatalogs(),
        ...settings,
        ...workflow,
        ...predicted,
        ...apply,
    };
}
