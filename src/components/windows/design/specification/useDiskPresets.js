import { makeQualifier } from '../../../../utils/synthesis/qualifiers.js';

const { useCallback, useEffect, useState } = React;

async function refreshPresetsList(setDiskPresets) {
    if (!window.electronAPI?.listQualifierPresets) return;
    try {
        const res = await window.electronAPI.listQualifierPresets();
        if (res?.success) setDiskPresets(res.presets || []);
    } catch (_) { /* no-op */ }
}

async function savePresetToDisk(name, { qualifiers, ts, setDiskMsg, setDiskBusy, refreshDiskPresets }) {
    if (!name) return;
    setDiskBusy(true);
    try {
        const res = await window.electronAPI.saveQualifierPreset({
            name,
            description: '',
            qualifiers,
        });
        if (res?.success) {
            setDiskMsg((ts.savedAs || 'Saved as') + ' ' + name + '.tfsq');
            refreshDiskPresets();
        } else {
            setDiskMsg((ts.saveError || 'Save failed') + ': ' + (res?.error || 'unknown'));
        }
    } catch (e) {
        setDiskMsg((ts.saveError || 'Save failed') + ': ' + e.message);
    } finally { setDiskBusy(false); }
}

// Use the app's InputDialog — window.prompt() is not supported in the
// Electron renderer (it throws "prompt() is not supported").
function promptSavePreset({ qualifiers, design, ts, setInputDialog, setDiskMsg, doSavePreset }) {
    if (!window.electronAPI?.saveQualifierPreset) return;
    if (qualifiers.length === 0) {
        setDiskMsg(ts.noQualifiersToSave || 'Add at least one qualifier first.');
        return;
    }
    if (!setInputDialog) return;
    const defaultName = (design?.name ? design.name + ' spec' : 'New spec');
    setInputDialog({
        title: ts.savePresetPrompt || 'Save spec preset as:',
        defaultValue: defaultName,
        onConfirm: (name) => { setInputDialog(null); doSavePreset(name); },
        onCancel:  () => setInputDialog(null),
    });
}

async function loadPresetFromDisk(name, mode, { qualifiers, writeQualifiers, checkpoint, ts, setDiskMsg, setDiskBusy }) {
    if (!window.electronAPI?.loadQualifierPreset) return;
    setDiskBusy(true);
    try {
        const res = await window.electronAPI.loadQualifierPreset(name);
        if (res?.success && Array.isArray(res.preset?.qualifiers)) {
            // Re-stamp ids so the loaded items don't collide with current ones
            const fresh = res.preset.qualifiers.map(q => makeQualifier({ ...q }));
            if (typeof checkpoint === 'function') checkpoint();
            if (mode === 'append') writeQualifiers([...qualifiers, ...fresh]);
            else                   writeQualifiers(fresh);
            setDiskMsg((ts.loaded || 'Loaded') + ' ' + name);
        } else {
            setDiskMsg((ts.loadError || 'Load failed') + ': ' + (res?.error || 'unknown'));
        }
    } catch (e) {
        setDiskMsg((ts.loadError || 'Load failed') + ': ' + e.message);
    } finally { setDiskBusy(false); }
}

async function deletePresetFromDisk(name, { ts, setDiskMsg, setDiskBusy, refreshDiskPresets }) {
    if (!window.electronAPI?.deleteQualifierPreset) return;
    if (!window.confirm((ts.confirmDelete || 'Delete preset') + ' "' + name + '"?')) return;
    setDiskBusy(true);
    try {
        const res = await window.electronAPI.deleteQualifierPreset(name);
        if (res?.success) {
            setDiskMsg((ts.deleted || 'Deleted') + ' ' + name);
            refreshDiskPresets();
        }
    } catch (_) { /* no-op */ }
    finally { setDiskBusy(false); }
}

// User-saved .tfsq presets (Documents\TFStudio\Qualifiers\).
export function useDiskPresets({ qualifiers, writeQualifiers, checkpoint, design, ts, setInputDialog }) {
    const [diskPresets, setDiskPresets] = useState([]);
    const [diskBusy, setDiskBusy]       = useState(false);
    const [diskMsg,  setDiskMsg]        = useState(null);

    const refreshDiskPresets = useCallback(() => refreshPresetsList(setDiskPresets), []);

    useEffect(() => { refreshDiskPresets(); }, [refreshDiskPresets]);

    const doSavePreset = useCallback((name) => savePresetToDisk(name, {
        qualifiers, ts, setDiskMsg, setDiskBusy, refreshDiskPresets,
    }), [qualifiers, refreshDiskPresets, ts]);

    const onSavePreset = useCallback(() => promptSavePreset({
        qualifiers, design, ts, setInputDialog, setDiskMsg, doSavePreset,
    }), [qualifiers, design, ts, setInputDialog, doSavePreset]);

    const onLoadDiskPreset = useCallback((name, mode) => loadPresetFromDisk(name, mode, {
        qualifiers, writeQualifiers, checkpoint, ts, setDiskMsg, setDiskBusy,
    }), [qualifiers, writeQualifiers, checkpoint, ts]);

    const onDeleteDiskPreset = useCallback((name) => deletePresetFromDisk(name, {
        ts, setDiskMsg, setDiskBusy, refreshDiskPresets,
    }), [refreshDiskPresets, ts]);

    return { diskPresets, diskBusy, diskMsg, onSavePreset, onLoadDiskPreset, onDeleteDiskPreset };
}
