import { useDesign } from '../../../../state/DesignContext.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { listThinLayers } from '../../../../utils/synthesis/designCleaner.js';
import { applyCleanup, computeCleanupPreview, computeMeritValue } from './model.js';
import { designCleanerSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useState, useMemo, useCallback } = React;

export function useDesignCleaner(dc) {
    const { design, updateDesign, checkpoint } = useDesign();

    const [session, setField] = useWindowSession(designCleanerSession, design);
    const { dMin, mergeAdjacent, cleanBack, reoptimize, reoptIters } = session;
    const setDMin          = value => setField('dMin', value);
    const setMergeAdjacent = value => setField('mergeAdjacent', value);
    const setCleanBack     = value => setField('cleanBack', value);
    const setReoptimize    = value => setField('reoptimize', value);
    const setReoptIters    = value => setField('reoptIters', value);

    const [applying,  setApplying]  = useState(false);
    const [resultMsg, setResultMsg] = useState(null);
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
            setResultMsg(`Error: ${e.message || e}`);
        }
        setApplying(false);
    }, [preview, dc, design, updateDesign, checkpoint, reoptimize, reoptIters, dMin, resolveMaterial]);

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
        preview, mfBefore, mfAfter, apply,
        ops, removedOps, mergedOps, thinList,
    };
}
