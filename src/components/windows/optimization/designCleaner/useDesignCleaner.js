import { useDesign } from '../../../../state/DesignContext.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { listThinLayers } from '../../../../utils/synthesis/designCleaner.js';
import {
    applyCleanup, computeCleanupPreview, computeMeritValue,
} from './model.js';
import {
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable, isPhaseDispersion,
    makeConeSpec, coneIsActive,
} from '../../../../utils/physics/optimizer.js';
import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import { SYNTHESIS_WORKER_URL } from '../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { designCleanerSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useAnalysisEvaluation } from '../../analysis/useAnalysisEvaluation.js';

const { useState, useMemo, useCallback, useEffect, useRef } = React;

function serializableDesign(design) {
    return {
        surfaceMode: design.surfaceMode || 'front_only',
        mfEvalMode: design.mfEvalMode ?? 'side',
        incidentMedium: design.incidentMedium ?? 'Air',
        exitMedium: design.exitMedium ?? 'Air',
        substrate: {
            material: design.substrate?.material ?? 'BK7',
            thickness: design.substrate?.thickness ?? 1.0,
        },
        frontLayers: (design.frontLayers || []).map(layer => ({ ...layer })),
        backLayers: (design.backLayers || []).map(layer => ({ ...layer })),
        ...(design.cone ? { cone: design.cone } : {}),
    };
}

export function useDesignCleaner(dc) {
    const { design, updateDesign, checkpoint } = useDesign();

    const [session, setField] = useWindowSession(designCleanerSession, design);
    const {
        dMin, mergeAdjacent, cleanBack, reoptimize, reoptIters,
        mode, meritBudget, meritIters, meritDMin,
    } = session;
    const setDMin          = value => setField('dMin', value);
    const setMergeAdjacent = value => setField('mergeAdjacent', value);
    const setCleanBack     = value => setField('cleanBack', value);
    const setReoptimize    = value => setField('reoptimize', value);
    const setReoptIters    = value => setField('reoptIters', value);
    const setMode          = value => setField('mode', value);
    const setMeritBudget   = value => setField('meritBudget', value);
    const setMeritIters    = value => setField('meritIters', value);
    const setMeritDMin     = value => setField('meritDMin', value);

    const [applying,  setApplying]  = useState(false);
    const [resultMsg, setResultMsg] = useState(null);
    const [meritAnalysis, setMeritAnalysis] = useState(null);
    const [meritBusy, setMeritBusy] = useState(false);
    const [meritProgress, setMeritProgress] = useState(null);
    const meritWorkerRef = useRef(null);
    const resolveMaterial = useMemo(() => designMaterialLookup(design), [design]);

    const preview = useMemo(
        () => computeCleanupPreview(design, { dMin, mergeAdjacent, cleanBack }),
        [design, dMin, mergeAdjacent, cleanBack]
    );

    // MF (before vs after): cone-heavy previews stay off the renderer.
    const operands = design?.meritOperands || [];
    const coneActive = operands.length > 0 && coneIsActive(makeConeSpec(design?.cone || {}));
    const meritPayload = useMemo(
        () => ({ design, candidateDesign: preview?.design, operands }),
        [design, preview, operands],
    );
    const meritPreview = useAnalysisEvaluation(coneActive, 'meritPair', meritPayload);
    const directMerit = useMemo(() => coneActive ? null : ({
        before: computeMeritValue(design, operands, resolveMaterial),
        after: computeMeritValue(preview?.design, operands, resolveMaterial),
    }), [coneActive, design, preview, operands, resolveMaterial]);
    const mfBefore = coneActive ? meritPreview.data?.before?.mf ?? null : directMerit.before;
    const mfAfter = coneActive ? meritPreview.data?.after?.mf ?? null : directMerit.after;
    const mfBusy = coneActive && meritPreview.busy;

    const apply = useCallback(() => {
        if (!preview || preview.ops.length === 0) {
            setResultMsg(dc.nothingToDo);
            return;
        }
        setApplying(true);
        setResultMsg(null);

        // Single undo checkpoint covers both the cleanup and any refinement
        if (typeof checkpoint === 'function') checkpoint();

        try {
            const { nextDesign, msg } = applyCleanup(
                preview, design, dc, { reoptimize, reoptIters, dMin }, resolveMaterial
            );
            updateDesign({
                frontLayers: nextDesign.frontLayers,
                backLayers:  nextDesign.backLayers,
            });
            setResultMsg(msg);
        } catch (e) {
            setResultMsg(dc.error(e.message || e));
        }
        setApplying(false);
    }, [preview, dc, design, updateDesign, checkpoint, reoptimize, reoptIters, dMin, resolveMaterial]);

    useEffect(() => {
        setMeritAnalysis(null);
        if (meritWorkerRef.current) {
            meritWorkerRef.current.terminate();
            meritWorkerRef.current = null;
            setMeritBusy(false);
            setMeritProgress(null);
        }
    }, [design, cleanBack, meritIters, meritDMin]);

    useEffect(() => () => meritWorkerRef.current?.terminate(), []);

    const cancelMerit = useCallback(() => {
        meritWorkerRef.current?.terminate();
        meritWorkerRef.current = null;
        setMeritBusy(false);
        setMeritProgress(null);
        setResultMsg(dc.meritCancelled);
    }, [dc.meritCancelled]);

    const runMeritJob = useCallback(async type => {
        const operands = (design?.meritOperands || []).filter(op => op.enabled);
        if (!operands.length) {
            setResultMsg(dc.reoptimizeNoOperands);
            return;
        }
        meritWorkerRef.current?.terminate();
        setMeritBusy(true);
        setMeritProgress(null);
        setResultMsg(null);

        let pool = null;
        try {
            const lambdas = requiredLambdas(operands);
            const pairs = collectDesignMaterialIds(design)
                .map(id => ({ id, mat: resolveMaterial(id) }));
            const materials = buildPresampledTable(lambdas, pairs, {
                includeOmegaResponses: operands.some(op => isPhaseDispersion(op.type)),
            });
            const wasmBytes = getTmmWasmBytesForWorker();
            pool = new WorkerPool(
                SYNTHESIS_WORKER_URL, 1,
                wasmBytes ? { type: 'wasmInit', wasmBytes } : null,
            );
            meritWorkerRef.current = pool;
            const result = await pool.run({
                type,
                jobId: `clean-${Date.now()}`,
                operands,
                design: serializableDesign(design),
                materials,
                cleanBack,
                dMin: Math.max(0.001, Number(meritDMin) || 0.001),
                maxIter: Math.max(1, Math.min(250, Math.round(Number(meritIters) || 1))),
                budget: Math.max(0, Number(meritBudget) || 0),
                maxRemovals: 1000,
                engine: 'dls',
            }, progress => {
                if (progress.phase === 'candidate' || progress.phase === 'ranking') {
                    setMeritProgress({ done: progress.done, total: progress.total, removed: progress.removed || 0 });
                } else if (progress.phase === 'accepted') {
                    setMeritProgress({ done: 0, total: 0, removed: progress.removed });
                }
            });
            if (meritWorkerRef.current !== pool) return;

            if (type === 'rankRemoval') {
                setMeritAnalysis({ mfBefore: result.mfBefore, candidates: result.candidates || [] });
            } else if (!(result.removed || []).length) {
                setResultMsg(dc.meritNothing);
            } else {
                if (typeof checkpoint === 'function') checkpoint();
                updateDesign({
                    frontLayers: result.design.frontLayers,
                    backLayers: result.design.backLayers,
                });
                setResultMsg(dc.meritApplied(
                    result.removed.length, result.baseline, result.mfAfter,
                ));
                setMeritAnalysis(null);
            }
        } catch (error) {
            if (String(error?.message) !== 'pool terminated') {
                setResultMsg(dc.error(error.message || error));
            }
        } finally {
            if (meritWorkerRef.current === pool) {
                pool?.terminate();
                meritWorkerRef.current = null;
                setMeritBusy(false);
                setMeritProgress(null);
            }
        }
    }, [checkpoint, cleanBack, dc, design, meritBudget, meritDMin, meritIters, resolveMaterial, updateDesign]);

    const analyzeMerit = useCallback(() => runMeritJob('rankRemoval'), [runMeritJob]);

    const applyMeritCandidate = useCallback(candidate => {
        if (!candidate?.design) return;
        if (typeof checkpoint === 'function') checkpoint();
        updateDesign({
            frontLayers: candidate.design.frontLayers,
            backLayers: candidate.design.backLayers,
        });
        setResultMsg(dc.meritManualApplied(
            candidate.side === 'front' ? dc.sideFrontShort : dc.sideBackShort,
            candidate.layerIndex + 1, candidate.deltaMF,
        ));
        setMeritAnalysis(null);
    }, [checkpoint, dc, updateDesign]);

    const autoEliminate = useCallback(() => runMeritJob('budgetRemoval'), [runMeritJob]);

    const ops = preview?.ops || [];
    const removedOps = ops.filter(o => o.kind === 'remove');
    const mergedOps  = ops.filter(o => o.kind === 'merge');

    // Thin-layer-only list (for the "what's currently sub-threshold" view —
    // the Thin Layer Removal mode)
    const thinList = design ? listThinLayers(design, dMin) : [];

    return {
        design, dMin, setDMin, mergeAdjacent, setMergeAdjacent,
        cleanBack, setCleanBack, reoptimize, setReoptimize,
        reoptIters, setReoptIters, applying, resultMsg,
        mode, setMode, meritBudget, setMeritBudget, meritIters, setMeritIters,
        meritDMin, setMeritDMin,
        meritAnalysis, meritBusy, meritProgress, analyzeMerit, applyMeritCandidate, autoEliminate, cancelMerit,
        preview, mfBefore, mfAfter, mfBusy, apply,
        ops, removedOps, mergedOps, thinList,
    };
}
