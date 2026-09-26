import { useDesign } from '../../../../state/DesignContext.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { listThinLayers } from '../../../../utils/synthesis/designCleaner.js';
import { applyCleanup, computeCleanupPreview, computeMeritValue } from './model.js';
import { designCleanerSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useState, useMemo, useCallback, useEffect, useRef } = React;

// Apply + the optional re-optimize pass, run in the optimizer worker so the
// window stays responsive. `progress` is { step, iters, mf } while the pass
// runs. Stop ends the pass and applies the cleanup with the best thicknesses
// so far. Closing the window or switching to another design discards the
// pass: its result belongs to the design it started on, and the update would
// land on whichever design is active by then. The result is written with the
// latest updateDesign: the one from the click applies its patch to the design
// as it was then, and would put back anything edited while the pass ran.
export function useCleanupRun({ dc, design, preview, settings, resolveMaterial, updateDesign, checkpoint }) {
    const [applying,  setApplying]  = useState(false);
    const [progress,  setProgress]  = useState(null);
    const [resultMsg, setResultMsg] = useState(null);
    const runRef = useRef(null);            // { designId, ctrl, closed } of the pass in flight
    const designIdRef = useRef(design?.id);
    designIdRef.current = design?.id;
    const updateDesignRef = useRef(updateDesign);
    updateDesignRef.current = updateDesign;

    useEffect(() => () => {
        const run = runRef.current;
        if (run) { run.closed = true; run.ctrl.abort(); }
    }, []);
    useEffect(() => {
        if (runRef.current && runRef.current.designId !== design?.id) runRef.current.ctrl.abort();
    }, [design?.id]);

    const apply = useCallback(async () => {
        if (runRef.current) return;
        if (!preview || preview.ops.length === 0) {
            setResultMsg(dc.nothingToDo);
            return;
        }
        const run = { designId: design.id, ctrl: new AbortController(), closed: false };
        const sameDesign = () => designIdRef.current === run.designId;
        runRef.current = run;
        setApplying(true);
        setResultMsg(null);

        try {
            const { nextDesign, msg } = await applyCleanup(preview, design, dc, {
                ...settings, inWorker: true, signal: run.ctrl.signal, onProgress: setProgress,
            }, resolveMaterial);
            if (run.closed) return;
            if (sameDesign()) {
                // Single undo checkpoint covers both the cleanup and any refinement
                if (typeof checkpoint === 'function') checkpoint();
                updateDesignRef.current({ frontLayers: nextDesign.frontLayers, backLayers: nextDesign.backLayers });
                setResultMsg(msg);
            } else {
                setResultMsg(dc.discarded);
            }
        } catch (e) {
            setResultMsg(`Error: ${e.message || e}`);
        }
        runRef.current = null;
        setProgress(null);
        setApplying(false);
    }, [preview, dc, design, checkpoint, settings, resolveMaterial]);

    const stop = useCallback(() => runRef.current?.ctrl.abort(), []);

    return { applying, progress, resultMsg, apply, stop };
}

export function useDesignCleaner(dc) {
    const { design, updateDesign, checkpoint } = useDesign();

    const [session, setField] = useWindowSession(designCleanerSession, design);
    const { dMin, mergeAdjacent, cleanBack, reoptimize, reoptIters } = session;
    const setDMin          = value => setField('dMin', value);
    const setMergeAdjacent = value => setField('mergeAdjacent', value);
    const setCleanBack     = value => setField('cleanBack', value);
    const setReoptimize    = value => setField('reoptimize', value);
    const setReoptIters    = value => setField('reoptIters', value);

    const resolveMaterial = useMemo(() => designMaterialLookup(design), [design]);

    const preview = useMemo(
        () => computeCleanupPreview(design, { dMin, mergeAdjacent, cleanBack }),
        [design, dMin, mergeAdjacent, cleanBack]
    );

    // MF (before vs after) — uses live design operands if any
    const mfBefore = useMemo(
        () => computeMeritValue(design, design?.meritOperands, resolveMaterial),
        [design, resolveMaterial]
    );
    const mfAfter = useMemo(
        () => computeMeritValue(preview?.design, design?.meritOperands, resolveMaterial),
        [preview, design, resolveMaterial]
    );

    const settings = useMemo(() => ({ reoptimize, reoptIters, dMin }), [reoptimize, reoptIters, dMin]);
    const run = useCleanupRun({ dc, design, preview, settings, resolveMaterial, updateDesign, checkpoint });

    const ops = preview?.ops || [];
    const removedOps = ops.filter(o => o.kind === 'remove');
    const mergedOps  = ops.filter(o => o.kind === 'merge');

    // Thin-layer-only list (for the "what's currently sub-threshold" view —
    // the Thin Layer Removal mode)
    const thinList = design ? listThinLayers(design, dMin) : [];

    return {
        design, dMin, setDMin, mergeAdjacent, setMergeAdjacent,
        cleanBack, setCleanBack, reoptimize, setReoptimize,
        reoptIters, setReoptIters, ...run,
        preview, mfBefore, mfAfter,
        ops, removedOps, mergedOps, thinList,
    };
}
