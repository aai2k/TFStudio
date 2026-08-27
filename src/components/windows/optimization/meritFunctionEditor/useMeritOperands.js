import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import {
    evaluateOperands, calcMF, calcOMF, buildEvalContext, operandEvaluationErrors,
    operandBandLevels, buildEnvironmentSpecs, calcMFMultiEnv, getMeritAccumulation,
    makeConeSpec, coneIsActive,
} from '../../../../utils/physics/optimizer.js';
import {
    editOperand, replaceOperandTail, addOperands, insertOperand,
    duplicateOperands, deleteOperands, moveOperand,
} from './meritOperandModel.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { meritOperandSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useAnalysisEvaluation } from '../../analysis/useAnalysisEvaluation.js';

const { useState, useEffect, useCallback, useMemo, useRef } = React;
const EMPTY_OPERANDS = [];

function evaluateEnvForDisplay(design, envIndex, operands) {
    const specs = buildEnvironmentSpecs(design, designMaterialLookup(design));
    const spec = specs[envIndex];
    if (!spec) {
        return { computed: [], errors: [], bandLevels: [], mf: null, omf: null };
    }
    const computed = evaluateOperands(operands, spec.ctx);
    const errors = operandEvaluationErrors(computed);
    const invalid = errors.some(Boolean);
    return {
        computed, errors, bandLevels: operandBandLevels(computed),
        mf: invalid ? null : calcMF(operands, computed),
        omf: invalid ? null : calcOMF(operands, computed),
    };
}

function evaluateDesignForDisplay(design, operands) {
    const ctx = buildEvalContext(design, designMaterialLookup(design));
    const computed = evaluateOperands(operands, ctx);
    const errors = operandEvaluationErrors(computed);
    const invalid = errors.some(Boolean);
    let perEnvMf = null;
    const envs = design.meritEnvironments || [];
    if (envs.length > 0 && !invalid) {
        try {
            const specs = buildEnvironmentSpecs(design, designMaterialLookup(design));
            const result = calcMFMultiEnv(specs, operands, { getMeritAccumulation });
            perEnvMf = result.perEnvMf;
        } catch (_) {
            perEnvMf = null;
        }
    }
    return {
        computed, errors, bandLevels: operandBandLevels(computed),
        mf: invalid ? null : calcMF(operands, computed),
        omf: invalid ? null : calcOMF(operands, computed),
        perEnvMf,
    };
}

function applyAdd(ctx, data, atIndex) {
    const result = addOperands(ctx.operands, data, atIndex);
    if (!result) return;
    ctx.setOperands(result.operands);
    ctx.setSelectedId(result.selectedId);
}

function applyDuplicate(ctx, ids) {
    const result = duplicateOperands(ctx.operands, ids);
    if (!result) return;
    ctx.setOperands(result.operands);
    if (result.selectedId) ctx.setSelectedId(result.selectedId);
}

function applyMove(ctx, direction) {
    if (!ctx.selectedId) return;
    ctx.setOperands(prev => moveOperand(prev, ctx.selectedId, direction));
}

function requestClear(ctx) {
    if (ctx.operands.length === 0) return;
    const message = ctx.te.clearConfirm || 'Clear all operands from the merit function table?';
    if (ctx.setInputDialog) {
        ctx.setInputDialog({
            confirm: true, title: ctx.te.clearTable || 'Clear', message,
            confirmLabel: ctx.te.clearTable || 'Clear',
            onConfirm: () => { ctx.setInputDialog(null); ctx.doClear(); },
            onCancel: () => ctx.setInputDialog(null),
        });
    } else if (window.confirm(message)) {
        ctx.doClear();
    }
}

/**
 * Merit-operand state for the merit function editor.
 *
 * `envIndex` selects the ACTIVE operand source (breadcrumb navigation):
 *   envIndex === null → design-level operands (design.meritOperands)
 *   envIndex >= 0     → that environment's own operands
 *                       (design.meritEnvironments[envIndex].operands, falling
 *                       back to the design-level set when the env has none)
 *
 * Every mutation routes through the same meritOperandModel pure functions and
 * writes back to the active source. Structural per-env mutations checkpoint
 * (undo/redo) before applying, matching the doClear pattern; the clear path
 * always checkpoints.
 */
export function useMeritOperands({ design, updateDesign, checkpoint, setInputDialog, te, envIndex = null }) {
    const [session, setSessionField] = useWindowSession(meritOperandSession, design);
    const selectedId = session.selectedId;
    const setSelectedId = value => setSessionField('selectedId', value);
    const [computed, setComputed] = useState([]);
    const [errors, setErrors] = useState([]);
    const [bandLevels, setBandLevels] = useState([]);
    const [mf, setMf] = useState(null);
    const [omf, setOmf] = useState(null);
    const [perEnvMf, setPerEnvMf] = useState(null);

    const isEnvMode = envIndex !== null;
    const environments = design?.meritEnvironments || [];
    const env = isEnvMode ? environments[envIndex] : null;
    // `??` (not `||`) so an env that was explicitly cleared keeps showing an
    // empty table instead of silently falling back to the design-level set.
    const operands = isEnvMode
        ? (env?.operands ?? design?.meritOperands ?? EMPTY_OPERANDS)
        : (design?.meritOperands || EMPTY_OPERANDS);

    // Selection belongs to one operand source: when the active source changes
    // (design level ↔ env N, or env N ↔ env M), drop the stale selection.
    // Guarded so the design-level selection survives an editor remount.
    const prevEnvIndex = useRef(envIndex);
    useEffect(() => {
        if (prevEnvIndex.current !== envIndex) {
            prevEnvIndex.current = envIndex;
            setSessionField('selectedId', null);
        }
    }, [envIndex, setSessionField]);

    const setOperands = useCallback((updater) => {
        const newOperands = typeof updater === 'function' ? updater(operands) : updater;
        if (isEnvMode) {
            const newEnvs = environments.map((e, i) =>
                i === envIndex ? { ...e, operands: newOperands } : e
            );
            updateDesign({ meritEnvironments: newEnvs });
        } else {
            updateDesign({ meritOperands: newOperands });
        }
    }, [operands, updateDesign, isEnvMode, envIndex, environments]);

    // Evaluated from the sampled design so the table follows an optimizer run
    // at the live-preview cadence rather than once per progress message.
    const { design: liveDesign } = useLiveDesign();
    const coneActive = operands.length > 0
        && coneIsActive(makeConeSpec(liveDesign?.cone || {}));
    const workerPayload = useMemo(
        () => ({ design: liveDesign, operands }),
        [liveDesign, operands],
    );
    const workerResult = useAnalysisEvaluation(coneActive, 'meritDisplay', workerPayload);

    useEffect(() => {
        if (!liveDesign || operands.length === 0) {
            setComputed([]); setErrors([]); setBandLevels([]); setMf(null); setOmf(null); setPerEnvMf(null);
            return;
        }
        if (coneActive) {
            const result = workerResult.data;
            if (result) {
                setComputed(result.computed); setErrors(result.errors); setBandLevels(result.bandLevels);
                setMf(result.mf); setOmf(result.omf);
                const envs = liveDesign.meritEnvironments || [];
                if (envs.length > 0) {
                    try {
                        const specs = buildEnvironmentSpecs(liveDesign, designMaterialLookup(liveDesign));
                        const { perEnvMf } = calcMFMultiEnv(specs, operands, { getMeritAccumulation });
                        setPerEnvMf(perEnvMf);
                    } catch (_) {
                        setPerEnvMf(null);
                    }
                } else {
                    setPerEnvMf(null);
                }
            } else if (workerResult.error) {
                setComputed([]); setErrors([te.evaluationFailed]); setBandLevels([]); setMf(null); setOmf(null); setPerEnvMf(null);
            }
            return;
        }
        try {
            if (isEnvMode) {
                const result = evaluateEnvForDisplay(liveDesign, envIndex, operands);
                setComputed(result.computed); setErrors(result.errors); setBandLevels(result.bandLevels);
                setMf(result.mf); setOmf(result.omf); setPerEnvMf(null);
            } else {
                const result = evaluateDesignForDisplay(liveDesign, operands);
                setComputed(result.computed); setErrors(result.errors); setBandLevels(result.bandLevels);
                setMf(result.mf); setOmf(result.omf); setPerEnvMf(result.perEnvMf);
            }
        } catch (_) {
            setComputed([]); setErrors([]); setBandLevels([]); setMf(null); setOmf(null); setPerEnvMf(null);
        }
    }, [operands, liveDesign, coneActive, workerResult.data, workerResult.error, isEnvMode, envIndex, te.evaluationFailed]);

    const handleEdit = useCallback((id, key, value) => {
        setOperands(prev => editOperand(prev, id, key, value));
    }, [setOperands]);

    const handleGenerate = useCallback((block, startRow) => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        const result = replaceOperandTail(operands, block, startRow);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands, isEnvMode, checkpoint]);

    const handleAdd = useCallback((data, atIndex) => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        applyAdd({ operands, setOperands, setSelectedId }, data, atIndex);
    }, [operands, setOperands, isEnvMode, checkpoint]);

    const handleInsertAt = useCallback((insertIndex, _source) => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        const result = insertOperand(operands, insertIndex);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands, isEnvMode, checkpoint]);

    const handleDuplicate = useCallback((ids) => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        applyDuplicate({ operands, setOperands, setSelectedId }, ids);
    }, [operands, setOperands, isEnvMode, checkpoint]);

    const handleDelete = useCallback((ids) => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        const result = deleteOperands(operands, ids);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands, isEnvMode, checkpoint]);

    const handleMoveUp = useCallback(() => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        applyMove({ selectedId, setOperands }, -1);
    }, [selectedId, setOperands, isEnvMode, checkpoint]);

    const handleMoveDown = useCallback(() => {
        if (isEnvMode && typeof checkpoint === 'function') checkpoint();
        applyMove({ selectedId, setOperands }, 1);
    }, [selectedId, setOperands, isEnvMode, checkpoint]);

    const doClear = useCallback(() => {
        if (typeof checkpoint === 'function') checkpoint();
        setOperands([]);
        setSelectedId(null);
    }, [checkpoint, setOperands]);

    const handleClear = useCallback(() => {
        requestClear({ operands, te, setInputDialog, doClear });
    }, [operands.length, te, setInputDialog, doClear]);

    return {
        operands, selectedId, setSelectedId, computed, errors, bandLevels, mf, omf, perEnvMf,
        evaluationBusy: coneActive && workerResult.busy, setOperands,
        handleEdit, handleGenerate, handleAdd, handleInsertAt, handleDuplicate,
        handleDelete, handleClear, handleMoveUp, handleMoveDown,
    };
}