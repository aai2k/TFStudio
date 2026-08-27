/**
 * useEnvOperands - per-environment operand editing (breadcrumb navigation).
 *
 * The merit function editor can edit either the design-level operand set
 * (design.meritOperands) or one environment's own operand set
 * (design.meritEnvironments[i].operands). This hook resolves the ACTIVE source
 * for a given envIndex and routes every mutation (edit/add/delete/clear/…)
 * through the same meritOperandModel pure functions, writing back to the
 * correct place:
 *
 *   envIndex >= 0  → updateDesign({ meritEnvironments: [...] })  (env operands)
 *   envIndex == null → updateDesign({ meritOperands: [...] })   (design level)
 *
 * An environment without its own operands falls back to the design-level set
 * (backward compatible with the engine: spec.operands === null → shared set).
 * `customize()` materializes a copy of the design-level operands into the env,
 * regenerating every operand id so the two sets never share ids.
 *
 * The clear path checkpoints before mutating, matching useMeritOperands.js.
 */

import {
    editOperand, replaceOperandTail, addOperands, insertOperand,
    duplicateOperands, deleteOperands, moveOperand,
} from './meritOperandModel.js';

const { useState, useEffect, useCallback } = React;

function newOperandId() {
    // Same id scheme as makeOperand (operandModel.js).
    return Math.random().toString(36).slice(2, 10);
}

/**
 * Pure: resolve the operand source for an env index.
 * envIndex >= 0 → env.operands ?? design.meritOperands; else design.meritOperands.
 */
export function resolveEnvOperands(design, envIndex) {
    const envs = design?.meritEnvironments || [];
    if (envIndex != null && envIndex >= 0 && envs[envIndex]) {
        return envs[envIndex].operands ?? design?.meritOperands ?? [];
    }
    return design?.meritOperands ?? [];
}

/**
 * Pure: clone operands with freshly generated, unique ids.
 * Used when an environment "customizes" away from the design-level set.
 */
export function cloneOperandsWithNewIds(operands) {
    const used = new Set();
    return (operands || []).map(op => {
        let id = newOperandId();
        while (used.has(id)) id = newOperandId();
        used.add(id);
        return { ...op, id };
    });
}

/**
 * Pure: build the design patch that writes operands into env[envIndex].
 */
export function writeEnvOperands(design, envIndex, newOperands) {
    const envs = design?.meritEnvironments || [];
    return {
        meritEnvironments: envs.map((env, i) =>
            i === envIndex ? { ...env, operands: newOperands } : env),
    };
}

function requestClear(ctx) {
    if (ctx.operands.length === 0) return;
    const message = ctx.te?.clearConfirm || 'Clear all operands from the merit function table?';
    if (ctx.setInputDialog) {
        ctx.setInputDialog({
            confirm: true, title: ctx.te?.clearTable || 'Clear', message,
            confirmLabel: ctx.te?.clearTable || 'Clear',
            onConfirm: () => { ctx.setInputDialog(null); ctx.doClear(); },
            onCancel: () => ctx.setInputDialog(null),
        });
    } else if (window.confirm(message)) {
        ctx.doClear();
    }
}

/**
 * Hook: active operand source for the merit function editor.
 *
 * @param {object} options
 * @param {object} options.design        active design
 * @param {Function} options.updateDesign design patch writer
 * @param {Function} options.checkpoint   undo checkpoint (called before clear)
 * @param {number|null} options.envIndex  active env index; null = design level
 * @param {Function} [options.setInputDialog] confirm-dialog opener
 * @param {object} [options.te]           meritFunctionEditor locale strings
 */
export function useEnvOperands({ design, updateDesign, checkpoint, envIndex, setInputDialog, te }) {
    const envs = design?.meritEnvironments || [];
    const env = envIndex != null && envIndex >= 0 ? envs[envIndex] : null;
    const operands = resolveEnvOperands(design, envIndex);
    const isCustomized = !!(env && env.operands);

    // Selection is per source: reset when the active env (or design level) changes.
    const [selectedId, setSelectedId] = useState(null);
    useEffect(() => { setSelectedId(null); }, [envIndex]);

    const setOperands = useCallback((updater) => {
        const next = typeof updater === 'function' ? updater(operands) : updater;
        if (envIndex != null && envIndex >= 0) {
            updateDesign(writeEnvOperands(design, envIndex, next));
        } else {
            updateDesign({ meritOperands: next });
        }
    }, [design, envIndex, operands, updateDesign]);

    const customize = useCallback(() => {
        if (envIndex == null || envIndex < 0 || isCustomized) return;
        updateDesign(writeEnvOperands(design, envIndex, cloneOperandsWithNewIds(design?.meritOperands || [])));
    }, [design, envIndex, isCustomized, updateDesign]);

    const handleEdit = useCallback((id, key, value) => {
        setOperands(prev => editOperand(prev, id, key, value));
    }, [setOperands]);

    const handleGenerate = useCallback((block, startRow) => {
        const result = replaceOperandTail(operands, block, startRow);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleAdd = useCallback((data, atIndex) => {
        const result = addOperands(operands, data, atIndex);
        if (!result) return;
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleInsertAt = useCallback((insertIndex) => {
        const result = insertOperand(operands, insertIndex);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleDuplicate = useCallback((ids) => {
        const result = duplicateOperands(operands, ids);
        if (!result) return;
        setOperands(result.operands);
        if (result.selectedId) setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleDelete = useCallback((ids) => {
        const result = deleteOperands(operands, ids);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleMoveUp = useCallback(() => {
        if (!selectedId) return;
        setOperands(prev => moveOperand(prev, selectedId, -1));
    }, [selectedId, setOperands]);

    const handleMoveDown = useCallback(() => {
        if (!selectedId) return;
        setOperands(prev => moveOperand(prev, selectedId, 1));
    }, [selectedId, setOperands]);

    const doClear = useCallback(() => {
        if (typeof checkpoint === 'function') checkpoint();
        setOperands([]);
        setSelectedId(null);
    }, [checkpoint, setOperands]);

    const handleClear = useCallback(() => {
        requestClear({ operands, te, setInputDialog, doClear });
    }, [operands.length, te, setInputDialog, doClear]);

    return {
        operands, selectedId, setSelectedId, isCustomized,
        computed: [], errors: [], bandLevels: [],
        setOperands, customize,
        handleEdit, handleGenerate, handleAdd, handleInsertAt, handleDuplicate,
        handleDelete, handleClear, handleMoveUp, handleMoveDown,
    };
}