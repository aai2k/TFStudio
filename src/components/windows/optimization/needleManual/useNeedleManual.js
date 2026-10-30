// State/logic hook for the Needle Manual window.
//
// Reuses the validated math from optimizer.js verbatim:
//   • scanNeedlesPFunction   — analytic P-function (FD fallback)
//   • insertNeedle / insertNeedleIntra — gap / intra-layer insertion (auto-mirror in symmetric)
//   • startingThickness (insertion.js): golden-section thickness for the initial d_new
//
// The scan and the starting-thickness search run in the optimizer worker, with
// Stop, so the window keeps answering while a fine Step takes seconds.
//
// Reference: Tikhonravov et al., Applied Optics 35(28), 5493 (1996);
//            Sullivan & Dobrowolski, Applied Optics 35(28), 5484 (1996).

import { useDesign } from '../../../../state/DesignContext.js';
import { poolCatalogs } from '../synthesisShared/synthesisHelpers.js';
import { needleManualSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { resolveScanSide, makeConeSpec, coneIsActive } from '../../../../utils/physics/optimizer.js';
import {
    countPoolMaterials, POOL_MAX_SYNC,
    useCatSelection, materialLookup, matFriendlyName, getPoolMaterials,
} from '../synthesisShared/synthesisHelpers.js';
import {
    candidateDepth, insertForSelection, scanStatus, buildPlotData,
    resolveHostInfo, resolveDRange, insertionRefineJob, refineAndCommit, enabledRows, runOperands, scanOperands,
    profileScanOffThread, startingThicknessOffThread,
} from './model.js';
import { useAnalysisEvaluation } from '../../analysis/useAnalysisEvaluation.js';
import { useMeritValues, sampledOn, meritOrInfinity } from '../useMeritValues.js';

const { useState, useEffect, useRef, useCallback, useMemo } = React;

const NEEDLE_MANUAL_CATS_KEY = 'tfstudio_needleManual_selectedCats';

// ── Settings (deltaNm, dMin, profile resolution, refine, material pool) ─────────

function useNeedleSettings(design) {
    const [session, setField] = useWindowSession(needleManualSession, design);
    const { deltaNm, dMin, nIntra, refineAfter, dlsIter, requestedSide } = session;
    const catSelection = useCatSelection(NEEDLE_MANUAL_CATS_KEY, design);

    return {
        deltaNm, setDeltaNm: value => setField('deltaNm', value),
        dMin, setDMin: value => setField('dMin', value),
        nIntra, setNIntra: value => setField('nIntra', value),
        refineAfter, setRefineAfter: value => setField('refineAfter', value),
        dlsIter, setDlsIter: value => setField('dlsIter', value),
        requestedSide, setRequestedSide: value => setField('requestedSide', value),
        selectedCats: catSelection.selectedCats,
        excludedMats: catSelection.excludedMats,
        handleToggleCat: catSelection.handleToggleCat,
        handleSelectAllCats: catSelection.handleSelectAllCats,
        handleClearCats: catSelection.handleClearCats,
        handleToggleMat: catSelection.handleToggleMat,
    };
}

// ── Scan → selection workflow (P-function profile, candidate pick, geometry) ────

/**
 * The profile scan or the starting-thickness search in the optimizer worker,
 * one at a time, each kept with the design it was asked for. Starting another,
 * `stop`, a change to that design and closing the window end it. `finish(job)`
 * takes `job` off as the one running and says whether it still was, so the
 * answer of a job another has replaced is dropped; `onScreen(job)` says whether
 * its design is still the one on screen, as an answer for a design that has
 * changed since is not shown either.
 */
function useNeedleJobs(design) {
    const jobRef = useRef(null);
    const designRef = useRef(design);
    designRef.current = design;

    useEffect(() => () => {
        const job = jobRef.current;
        jobRef.current = null;
        job?.ctrl.abort();
    }, []);
    useEffect(() => {
        if (jobRef.current && jobRef.current.design !== design) jobRef.current.ctrl.abort();
    }, [design]);

    return useMemo(() => ({
        start(forDesign) {
            jobRef.current?.ctrl.abort();
            const job = { ctrl: new AbortController(), design: forDesign };
            jobRef.current = job;
            return job;
        },
        finish(job) {
            if (jobRef.current !== job) return false;
            jobRef.current = null;
            return true;
        },
        onScreen: job => job.design === designRef.current,
        stop: () => jobRef.current?.ctrl.abort(),
    }), []);
}

// What the window shows once the scan `job` ends: the profile and its status
// line, or the scan error; for a design no longer on screen, no profile and a
// status line saying the design changed; stopped, no profile and no status, as
// before a scan.
function endScan(ctx, job, out, err) {
    const { jobs, tn, setScanning, setScan, setStatusMsg } = ctx;
    if (!jobs.finish(job)) return;
    setScanning(false);
    if (!jobs.onScreen(job)) { setStatusMsg(tn.designChanged); return; }
    if (!out && !err) { setStatusMsg(''); return; }
    if (err) {
        console.error('[NeedleManual] scan failed:', err);
        setStatusMsg(tn.scanError);
        return;
    }
    setScan(out.scan);
    setStatusMsg(scanStatus(out.scan, tn));
}

// Starts the profile scan in the optimizer worker. The profile on screen goes
// at once, so no point of it can be picked while the new one is computed.
// More candidate materials than POOL_MAX_SYNC are refused.
function runComputeProfile(ctx) {
    const {
        design, operands, selectedCats, excludedMats, deltaNm, nIntra, requestedSide, tn, t, jobs,
        setStatusMsg, setScanBlocked, setScanning, setSelected, setScan,
    } = ctx;
    const ops = scanOperands(operands);
    if (ops.length === 0) { setStatusMsg(tn.noOperands); return; }
    const poolCount = countPoolMaterials(selectedCats, excludedMats, design);
    if (poolCount > POOL_MAX_SYNC) {
        setScanBlocked(true);
        setStatusMsg(t.pool.tooMany(poolCount, POOL_MAX_SYNC));
        return;
    }
    setScanBlocked(false);
    const pool = getPoolMaterials(selectedCats, {
        excluded: excludedMats, design, designName: t.pool.designCatalog,
    });
    if (!pool.length) { setStatusMsg(tn.noMaterials); return; }

    setScanning(true); setStatusMsg(tn.scanning); setSelected(null); setScan(null);
    const job = jobs.start(design);
    // Started a timer turn later, so the status paints before the material
    // tables are sampled and copied to the worker.
    setTimeout(() => profileScanOffThread(
        { operands: ops, design, candidateMats: pool, deltaNm, nIntra, side: requestedSide }, job.ctrl.signal,
    ).then(out => endScan(ctx, job, out, null), err => endScan(ctx, job, null, err)), 0);
}

// Picks `cand`. The needle starts at dMin while the worker searches for its
// starting thickness (startingThickness) and moves there when the answer comes.
// Stopped, it stays at dMin, the thickness the search gives when it finds none
// better; answered for a design no longer on screen, it stays at dMin and the
// status line says the design changed.
function runPick(ctx, cand) {
    const {
        scan, design, operands, selectedCats, excludedMats, resolveMat, dMin, requestedSide, jobs, tn,
        setSelected, setDNew, setPicking, setStatusMsg,
    } = ctx;
    setSelected({ ...cand, z: candidateDepth(cand, scan?.zb || [0]), grad: cand.grad });
    setDNew(dMin);
    setPicking(true);
    const pool = getPoolMaterials(selectedCats, { excluded: excludedMats, design });
    const mat  = pool.find(p => p.id === cand.materialId)?.mat || resolveMat(cand.materialId);
    const job = jobs.start(design);
    const end = (dNew) => {
        if (!jobs.finish(job)) return;
        setPicking(false);
        if (!jobs.onScreen(job)) setStatusMsg(tn.designChanged);
        else if (dNew != null) setDNew(dNew);
    };
    startingThicknessOffThread(
        { operands: scanOperands(operands), design, candidate: cand, mat, dMin, side: requestedSide }, job.ctrl.signal,
    ).then(end, (err) => {
        console.error('[NeedleManual] starting thickness search failed:', err);
        end(null);
    });
}

function useNeedleWorkflow({ design, resolveMat, effSide, operands, selectedCats, excludedMats, deltaNm, nIntra, dMin, requestedSide, tn, t }) {
    const [scan,      setScan]      = useState(null);   // { candidates, mf0, side, zb, layers }
    const [scanning,  setScanning]  = useState(false);
    const [picking,   setPicking]   = useState(false);  // the starting-thickness search of a pick runs
    const [statusMsg, setStatusMsg] = useState('');
    const [scanBlocked, setScanBlocked] = useState(false);   // pool larger than POOL_MAX_SYNC
    const [selected,  setSelected]  = useState(null);   // { ...candidate, z, grad }
    const [dNew,      setDNew]      = useState(1.0);
    const jobs = useNeedleJobs(design);

    // Clear selection + scan when the design or active side changes.
    useEffect(() => {
        setScan(null); setSelected(null); setStatusMsg('');
    }, [design?.id, effSide]);

    const computeProfile = useCallback(() => {
        runComputeProfile({
            design, operands, selectedCats, excludedMats, deltaNm, nIntra, requestedSide, tn, t, jobs,
            setStatusMsg, setScanBlocked, setScanning, setSelected, setScan,
        });
    }, [design, operands, selectedCats, excludedMats, deltaNm, nIntra, requestedSide, tn, t, jobs]);

    const plotData = useMemo(() => buildPlotData(scan, design), [scan, design]);

    const hostInfo = useMemo(
        () => resolveHostInfo(selected, scan, dMin, tn, design), [selected, scan, dMin, tn, design]);
    const dRange   = useMemo(() => resolveDRange(selected, hostInfo, dMin), [selected, hostInfo, dMin]);

    const handlePick = useCallback((cand) => {
        runPick({
            scan, design, operands, selectedCats, excludedMats, resolveMat, dMin, requestedSide, jobs, tn,
            setSelected, setDNew, setPicking, setStatusMsg,
        }, cand);
    }, [scan, selectedCats, excludedMats, operands, design, resolveMat, dMin, requestedSide, jobs, tn]);

    // Clamp d_new into range when the selection / range changes.
    useEffect(() => {
        if (!selected) return;
        setDNew(prev => Math.min(Math.max(prev, dRange[0]), dRange[1]));
    }, [dRange[0], dRange[1], selected]);

    return {
        scan, setScan, scanning, picking, statusMsg, setStatusMsg, scanBlocked, computeProfile, stopSearch: jobs.stop,
        selected, setSelected, dNew, setDNew, plotData, hostInfo, dRange, handlePick,
    };
}

// ── Predicted optical merit at d_new (exact, via calcOMF on the inserted design) ─
// OMF drops the MNT/MXT/TT constraints. The needle scan is itself optical-only,
// and a thin needle always starts below MNT; showing the full MF here would
// report a large, transient constraint penalty rather than the optical benefit.

const NO_PREDICTION = Object.freeze({
    predictedOMF: null, omfNow: null, predictedOMFBusy: false,
    predictedProvisional: false, omfNowProvisional: false,
});

/**
 * The OMF of the design and of the design with the picked needle inserted.
 * Under a cone the analysis worker scores each on the rows `operands`
 * (runOperands), sampled further where that design's own fringes need more,
 * with `predictedOMFBusy` on while it works. Otherwise both are scored on the
 * enabled rows sampled on the design's grid, read as the merit tables read
 * theirs (useMeritValues): at the default steps first, marked by
 * `omfNowProvisional` and `predictedProvisional`, then on the worker at the
 * rows' own Steps unless `hold` is on.
 */
export function usePredictedOMF({ selected, scan, design, operands, dNew, requestedSide, hold }) {
    const inserted = useMemo(
        () => selected ? insertForSelection(selected, design, dNew, requestedSide) : null,
        [selected, design, dNew, requestedSide],
    );
    const picked = !!(selected && scan && inserted);
    const coneActive = !!inserted && operands.length > 0
        && coneIsActive(makeConeSpec(design?.cone || {}));
    const meritPayload = useMemo(
        () => ({ design, candidateDesign: inserted, operands }),
        [design, inserted, operands],
    );
    const workerResult = useAnalysisEvaluation(coneActive, 'meritPair', meritPayload);
    const here = picked && !coneActive;
    const rows = useMemo(() => enabledRows(design), [design]);
    const onDesignGrid = useMemo(() => sampledOn(design), [design]);
    const now = useMeritValues(here ? design : null, rows, hold, onDesignGrid);
    const after = useMeritValues(here ? inserted : null, rows, hold, onDesignGrid);

    if (!picked) return NO_PREDICTION;
    if (coneActive) {
        return {
            ...NO_PREDICTION,
            omfNow: workerResult.data?.before?.omf ?? null,
            predictedOMF: workerResult.data?.after?.omf ?? null,
            predictedOMFBusy: workerResult.busy,
        };
    }
    return {
        omfNow: meritOrInfinity(now, 'omf'), predictedOMF: meritOrInfinity(after, 'omf'),
        omfNowProvisional: now.mfProvisional, predictedProvisional: after.mfProvisional,
        predictedOMFBusy: false,
    };
}

// ── Apply: single insertion, optionally followed by one refinement pass ─────────

function commitInsertion(inserted, updateDesign) {
    updateDesign({ frontLayers: inserted.frontLayers, backLayers: inserted.backLayers });
}

// The refine after Apply, off the UI thread, on the design active at Apply.
// Writes go through the latest updateDesign, so an edit made to that design
// while the refine runs (an operand, the angle) is not overwritten.
function startRefine(ctx, inserted, finish) {
    const {
        operands, resolveMat, dMin, dlsIter, selected, tn, design,
        setRefining, setStatusMsg, runRef, designIdRef, updateDesignRef,
    } = ctx;
    const run = { designId: design.id, ctrl: new AbortController() };
    runRef.current = run;
    setRefining(true);
    setStatusMsg(tn.refining);
    refineAndCommit({
        inserted, job: insertionRefineJob(operands, inserted, dMin, dlsIter), resolveMat,
        signal: run.ctrl.signal,
        isCurrent: () => designIdRef.current === run.designId,
        write: (patch, opts) => updateDesignRef.current(patch, opts),
        onProgress: p => setStatusMsg(tn.refiningStep(p.step, p.iters, p.mf)),
    }).then((out) => {
        runRef.current = null;
        setRefining(false);
        if (!out) return;
        const name = matFriendlyName(selected.materialId, design);
        finish(out.mfBest == null ? tn.inserted(name) : tn.insertedRefined(name, out.mfBest.toFixed(6)));
    });
}

function runHandleApply(ctx) {
    const {
        selected, design, busy, dNew, refineAfter, requestedSide, checkpoint, updateDesign, tn,
        setStatusMsg, setScan, setSelected,
    } = ctx;
    if (!selected || busy) return;
    checkpoint && checkpoint();   // one undo step covers insert (+ refine)

    const inserted = insertForSelection(selected, design, dNew, requestedSide);
    const finish = (msg) => { setStatusMsg(msg); setScan(null); setSelected(null); };

    if (!refineAfter) {
        commitInsertion(inserted, updateDesign);
        finish(tn.inserted(matFriendlyName(selected.materialId, design)));
        return;
    }
    startRefine(ctx, inserted, finish);
}

// Apply, and the refine after it. Stop, or closing the window, ends the refine
// early and keeps the insertion with the best thicknesses so far; Stop before
// the first step keeps it unrefined. Switching to another design ends it and
// writes nothing more to either design. `searching` is on while the scan or a
// pick's starting-thickness search runs, which Apply waits for.
function useNeedleApply({
    searching, selected, design, resolveMat, dNew, refineAfter, requestedSide, operands, dMin, dlsIter,
    checkpoint, updateDesign, tn, setStatusMsg, setScan, setSelected,
}) {
    const [refining, setRefining] = useState(false);
    const busy = searching || refining;
    const runRef = useRef(null);             // { designId, ctrl } of the refine in flight
    const designIdRef = useRef(design?.id);
    designIdRef.current = design?.id;
    const updateDesignRef = useRef(updateDesign);
    updateDesignRef.current = updateDesign;

    // Flip the global isOptimizing flag while a refine runs (throttles live
    // previews in other windows, matches NeedleVariation).
    const { beginOptimization, endOptimization } = useDesign();
    useEffect(() => {
        if (!refining) return;
        beginOptimization();
        return () => endOptimization();
    }, [refining, beginOptimization, endOptimization]);

    useEffect(() => () => runRef.current?.ctrl.abort(), []);
    useEffect(() => {
        if (runRef.current && runRef.current.designId !== design?.id) runRef.current.ctrl.abort();
    }, [design?.id]);

    const handleApply = useCallback(() => {
        runHandleApply({
            selected, design, resolveMat, busy, dNew, refineAfter, requestedSide, operands, dMin, dlsIter,
            checkpoint, updateDesign, tn,
            setRefining, setStatusMsg, setScan, setSelected, runRef, designIdRef, updateDesignRef,
        });
    }, [selected, design, resolveMat, busy, dNew, refineAfter, requestedSide, operands, dMin, dlsIter, checkpoint, updateDesign, tn]);

    const stop = useCallback(() => runRef.current?.ctrl.abort(), []);

    return { refining, busy, handleApply, stop };
}

// ── Top-level combinator ─────────────────────────────────────────────────────────

export function useNeedleManual(t) {
    const { design, updateDesign, checkpoint, isOptimizing } = useDesign();
    const tn = t.needleManual;
    const settings = useNeedleSettings(design);
    const resolveMat = useMemo(() => materialLookup(design), [design]);

    const surfaceMode = design?.surfaceMode || 'front_only';
    const effSide = resolveScanSide(surfaceMode, settings.requestedSide);
    const showSideRadio = surfaceMode === 'both_independent';
    const operands = useMemo(() => runOperands(design, resolveMat), [design, resolveMat]);

    const workflow = useNeedleWorkflow({
        design, resolveMat, effSide, operands, tn, t,
        selectedCats: settings.selectedCats, excludedMats: settings.excludedMats,
        deltaNm: settings.deltaNm, nIntra: settings.nIntra, dMin: settings.dMin,
        requestedSide: settings.requestedSide,
    });

    // Nothing is predicted for a pick until its starting thickness comes.
    const predicted = usePredictedOMF({
        selected: workflow.picking ? null : workflow.selected, scan: workflow.scan, design, operands,
        dNew: workflow.dNew, requestedSide: settings.requestedSide, hold: isOptimizing,
    });

    const apply = useNeedleApply({
        searching: workflow.scanning || workflow.picking, selected: workflow.selected, design, resolveMat,
        dNew: workflow.dNew, refineAfter: settings.refineAfter, requestedSide: settings.requestedSide,
        operands, dMin: settings.dMin, dlsIter: settings.dlsIter,
        checkpoint, updateDesign, tn,
        setStatusMsg: workflow.setStatusMsg, setScan: workflow.setScan, setSelected: workflow.setSelected,
    });

    const { stopSearch } = workflow;
    const stopRefine = apply.stop;
    const stop = useCallback(() => { stopSearch(); stopRefine(); }, [stopSearch, stopRefine]);

    return {
        design, tn, surfaceMode, effSide, showSideRadio, operands,
        catalogs: poolCatalogs(design, t.pool.designCatalog),
        ...settings,
        ...workflow,
        ...predicted,
        ...apply,
        stop,
    };
}
