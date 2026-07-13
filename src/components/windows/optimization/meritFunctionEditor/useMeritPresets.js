import { reIdOperands } from './meritOperandModel.js';

const { useState, useEffect, useCallback } = React;

async function refreshPresets(setDiskPresets) {
    if (!window.electronAPI?.listMFPresets) return;
    try {
        const result = await window.electronAPI.listMFPresets();
        if (result?.success) setDiskPresets(result.presets || []);
    } catch (_) { /* no-op */ }
}

async function savePreset(ctx, name) {
    const trimmed = (name || '').trim();
    if (!window.electronAPI?.saveMFPreset || !trimmed) return;
    ctx.setDiskBusy(true);
    try {
        const result = await window.electronAPI.saveMFPreset({ name: trimmed, description: '', operands: ctx.operands });
        if (result?.success) {
            ctx.setDiskMsg((ctx.te.savedAs || 'Saved as') + ' ' + trimmed + '.tfsm');
            ctx.refreshDiskPresets();
        } else {
            ctx.setDiskMsg((ctx.te.saveError || 'Save failed') + ': ' + (result?.error || 'unknown'));
        }
    } catch (error) {
        ctx.setDiskMsg((ctx.te.saveError || 'Save failed') + ': ' + error.message);
    } finally {
        ctx.setDiskBusy(false);
    }
}

function requestSavePreset(ctx) {
    if (!window.electronAPI?.saveMFPreset) return;
    if (ctx.operands.length === 0) {
        ctx.setDiskMsg(ctx.te.noOpsToSave || 'Add at least one operand first.');
        return;
    }
    const defaultName = ctx.design?.name ? ctx.design.name + ' MF' : 'New MF';
    const prompt = ctx.te.savePresetPrompt || 'Save merit function as:';
    if (ctx.setInputDialog) {
        ctx.setInputDialog({
            title: prompt, defaultValue: defaultName,
            onConfirm: (name) => { ctx.setInputDialog(null); ctx.doSavePreset(name); },
            onCancel: () => ctx.setInputDialog(null),
        });
    } else {
        ctx.doSavePreset(defaultName);
    }
}

async function loadPreset(ctx, name, mode) {
    if (!window.electronAPI?.loadMFPreset || !name) return;
    ctx.setDiskBusy(true);
    try {
        const result = await window.electronAPI.loadMFPreset(name);
        if (result?.success && Array.isArray(result.preset?.operands)) {
            const fresh = reIdOperands(result.preset.operands);
            if (typeof ctx.checkpoint === 'function') ctx.checkpoint();
            ctx.setOperands(prev => mode === 'append' ? [...prev, ...fresh] : fresh);
            ctx.setSelectedId(null);
            ctx.setDiskMsg((ctx.te.loaded || 'Loaded') + ' ' + name);
        } else {
            ctx.setDiskMsg((ctx.te.loadError || 'Load failed') + ': ' + (result?.error || 'unknown'));
        }
    } catch (error) {
        ctx.setDiskMsg((ctx.te.loadError || 'Load failed') + ': ' + error.message);
    } finally {
        ctx.setDiskBusy(false);
    }
}

async function deletePreset(ctx, name) {
    if (!window.electronAPI?.deleteMFPreset || !name) return;
    ctx.setDiskBusy(true);
    try {
        const result = await window.electronAPI.deleteMFPreset(name);
        if (result?.success) {
            ctx.setDiskMsg((ctx.te.deleted || 'Deleted') + ' ' + name);
            ctx.refreshDiskPresets();
        }
    } catch (_) { /* no-op */ }
    finally { ctx.setDiskBusy(false); }
}

function requestDeletePreset(ctx, name) {
    if (!name) return;
    const title = ctx.te.confirmDelete || 'Delete preset';
    if (ctx.setInputDialog) {
        ctx.setInputDialog({
            confirm: true, title, message: '"' + name + '"?',
            confirmLabel: ctx.t.dialogs?.input?.ok || 'OK',
            onConfirm: () => { ctx.setInputDialog(null); ctx.doDeletePreset(name); },
            onCancel: () => ctx.setInputDialog(null),
        });
    } else if (window.confirm(title + ' "' + name + '"?')) {
        ctx.doDeletePreset(name);
    }
}

export function useMeritPresets(options) {
    const [diskPresets, setDiskPresets] = useState([]);
    const [diskBusy, setDiskBusy] = useState(false);
    const [diskMsg, setDiskMsg] = useState(null);

    const refreshDiskPresets = useCallback(() => refreshPresets(setDiskPresets), []);
    useEffect(() => { refreshDiskPresets(); }, [refreshDiskPresets]);

    const baseContext = {
        ...options, setDiskPresets, setDiskBusy, setDiskMsg, refreshDiskPresets,
    };
    const doSavePreset = useCallback((name) => savePreset(baseContext, name), [options.operands, refreshDiskPresets, options.te]);
    const onSavePreset = useCallback(() => requestSavePreset({ ...baseContext, doSavePreset }),
        [options.operands.length, options.design, options.setInputDialog, doSavePreset, options.te]);
    const onLoadDiskPreset = useCallback((name, mode) => loadPreset(baseContext, name, mode),
        [options.setOperands, options.checkpoint, options.te]);
    const doDeletePreset = useCallback((name) => deletePreset(baseContext, name), [refreshDiskPresets, options.te]);
    const onDeleteDiskPreset = useCallback((name) => requestDeletePreset({ ...baseContext, doDeletePreset }, name),
        [options.setInputDialog, doDeletePreset, options.te, options.t]);

    return {
        diskPresets, diskBusy, diskMsg,
        onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
    };
}
