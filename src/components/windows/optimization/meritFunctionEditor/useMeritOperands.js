import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
    evaluateOperands, calcMF, calcOMF, buildEvalContext,
} from '../../../../utils/physics/optimizer.js';
import {
    editOperand, replaceOperandTail, addOperands, insertOperand,
    duplicateOperands, deleteOperands, moveOperand,
} from './meritOperandModel.js';

const { useState, useEffect, useCallback } = React;
const EMPTY_OPERANDS = [];

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function evaluateForDisplay(design, operands) {
    const ctx = buildEvalContext(design, resolveMat);
    const computed = evaluateOperands(operands, ctx);
    return { computed, mf: calcMF(operands, computed), omf: calcOMF(operands, computed) };
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

export function useMeritOperands({ design, updateDesign, checkpoint, setInputDialog, te }) {
    const [selectedId, setSelectedId] = useState(null);
    const [computed, setComputed] = useState([]);
    const [mf, setMf] = useState(null);
    const [omf, setOmf] = useState(null);
    const operands = design?.meritOperands || EMPTY_OPERANDS;

    const setOperands = useCallback((updater) => {
        const newOperands = typeof updater === 'function' ? updater(operands) : updater;
        updateDesign({ meritOperands: newOperands });
    }, [operands, updateDesign]);

    useEffect(() => {
        if (!design || operands.length === 0) {
            setComputed([]); setMf(null); setOmf(null);
            return;
        }
        try {
            const result = evaluateForDisplay(design, operands);
            setComputed(result.computed); setMf(result.mf); setOmf(result.omf);
        } catch (_) {
            setComputed([]); setMf(null); setOmf(null);
        }
    }, [operands, design]);

    const handleEdit = useCallback((id, key, value) => {
        setOperands(prev => editOperand(prev, id, key, value));
    }, [setOperands]);

    const handleGenerate = useCallback((block, startRow) => {
        const result = replaceOperandTail(operands, block, startRow);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleAdd = useCallback((data, atIndex) => {
        applyAdd({ operands, setOperands, setSelectedId }, data, atIndex);
    }, [operands, setOperands]);

    const handleInsertAt = useCallback((insertIndex, _source) => {
        const result = insertOperand(operands, insertIndex);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleDuplicate = useCallback((ids) => {
        applyDuplicate({ operands, setOperands, setSelectedId }, ids);
    }, [operands, setOperands]);

    const handleDelete = useCallback((ids) => {
        const result = deleteOperands(operands, ids);
        setOperands(result.operands);
        setSelectedId(result.selectedId);
    }, [operands, setOperands]);

    const handleMoveUp = useCallback(() => {
        applyMove({ selectedId, setOperands }, -1);
    }, [selectedId, setOperands]);

    const handleMoveDown = useCallback(() => {
        applyMove({ selectedId, setOperands }, 1);
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
        operands, selectedId, setSelectedId, computed, mf, omf, setOperands,
        handleEdit, handleGenerate, handleAdd, handleInsertAt, handleDuplicate,
        handleDelete, handleClear, handleMoveUp, handleMoveDown,
    };
}
