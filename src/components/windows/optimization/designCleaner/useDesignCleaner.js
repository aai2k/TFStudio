import { useDesign } from '../../../../state/DesignContext.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { listThinLayers } from '../../../../utils/synthesis/designCleaner.js';
import { applyCleanup, computeCleanupPreview, computeMeritValue } from './model.js';

const { useState, useMemo, useCallback } = React;

export function resolveCleanerMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function useDesignCleaner(dc) {
    const { design, updateDesign, checkpoint } = useDesign();

    const [dMin,           setDMin]           = useState(5.0);
    const [mergeAdjacent,  setMergeAdjacent]  = useState(true);
    const [cleanBack,      setCleanBack]      = useState(true);
    const [reoptimize,     setReoptimize]     = useState(true);
    const [reoptIters,     setReoptIters]     = useState(80);

    const [applying,  setApplying]  = useState(false);
    const [resultMsg, setResultMsg] = useState(null);

    const preview = useMemo(
        () => computeCleanupPreview(design, { dMin, mergeAdjacent, cleanBack }),
        [design, dMin, mergeAdjacent, cleanBack]
    );

    // MF (before vs after) — uses live design operands if any
    const mfBefore = useMemo(
        () => computeMeritValue(design, design?.meritOperands, resolveCleanerMaterial),
        [design]
    );
    const mfAfter = useMemo(
        () => computeMeritValue(preview?.design, design?.meritOperands, resolveCleanerMaterial),
        [preview, design]
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
                preview, design, dc, { reoptimize, reoptIters, dMin }, resolveCleanerMaterial
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
    }, [preview, dc, design, updateDesign, checkpoint, reoptimize, reoptIters, dMin]);

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
