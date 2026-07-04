/**
 * Specification — design-requirements / qualifiers window.
 *
 * Each row is a single PASS/FAIL design requirement against the active
 * design. The window auto-recomputes on design change. A "Generate MF
 * from spec" button converts qualifiers into OPGT/OPLT merit-function
 * operands and writes them into design.meritOperands.
 *
 * See `src/utils/qualifiers.js` for the math; this file is UI only.
 */

import { useDesign }      from '../../state/DesignContext.js';
import { getMaterialById } from '../../utils/materials/catalogManager.js';
import { getMaterial }    from '../../utils/materials/materialDatabase.js';
import {
    makeQualifier, QUALIFIER_KINDS, QUALIFIER_CMPS,
    evaluateQualifiers, aggregateVerdict, qualifiersToMFOperands, defaultTolForKind,
} from '../../utils/synthesis/qualifiers.js';
import { QUALIFIER_PRESETS, applyPreset } from '../../utils/synthesis/qualifierPresets.js';
import { OPERAND_POLS } from '../../utils/physics/optimizer.js';
import { useTableShortcuts } from '../../hooks/useTableShortcuts.js';
import { EvalModeBadge } from '../SurfaceModeBar.js';

const { createElement: h, useState, useEffect, useMemo, useCallback, useRef } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Kind metadata: which fields are relevant for each qualifier kind ─────────
// Drives the row-editor — only show the fields that apply, hide the rest.

const KIND_META = {
    T_AT:             { channelFixed: 'T', single: true,                                fmt: 'pct' },
    R_AT:             { channelFixed: 'R', single: true,                                fmt: 'pct' },
    A_AT:             { channelFixed: 'A', single: true,                                fmt: 'pct' },
    T_AVG:            { channelFixed: 'T',                                               fmt: 'pct' },
    R_AVG:            { channelFixed: 'R',                                               fmt: 'pct' },
    A_AVG:            { channelFixed: 'A',                                               fmt: 'pct' },
    MIN_MAX:          { channelPick: true, direction: true,                              fmt: 'pct' },
    INTEGRAL:         { channelPick: true,  integral: true,                              fmt: 'pct' },
    CENTRAL_LAMBDA:   { channelPick: true, direction: true,                              fmt: 'nm' },
    FWHM:             { channelPick: true, direction: true, level: true,                 fmt: 'nm' },
    EDGE_LAMBDA:      { channelPick: true,                  level: true, edgeSide: true, fmt: 'nm' },
    THICKNESS_BUDGET: { geomOnly: true,                                                  fmt: 'nm' },
    LAYER_COUNT:      { geomOnly: true,                                                  fmt: 'int' },
};

function isPct(meta) { return meta?.fmt === 'pct'; }

// ── Component ────────────────────────────────────────────────────────────────

export function Specification({ c, theme, t, setInputDialog }) {
    const ts = t.specification || {};

    const { design, updateDesign, checkpoint } = useDesign();

    // Source of truth: design.qualifiers (persisted in .tfs).
    const qualifiers = design?.qualifiers || [];

    // Live evaluation
    const results = useMemo(() => {
        if (!design) return [];
        try { return evaluateQualifiers(qualifiers, design, resolveMat); }
        catch { return qualifiers.map(() => ({ value: null, pass: null })); }
    }, [qualifiers, design]);

    const verdict = useMemo(() => aggregateVerdict(results), [results]);

    // ── Mutations ────────────────────────────────────────────────────────────
    const writeQualifiers = useCallback((next) => {
        updateDesign({ qualifiers: next });
    }, [updateDesign]);

    // ── Selection (used by Ins/Del/Ctrl+D keyboard shortcuts) ────────────────
    const [selectedId, setSelectedId] = useState(null);
    const containerRef = useRef(null);
    const selectAndFocus = useCallback((id) => {
        setSelectedId(id);
        containerRef.current?.focus();
    }, []);

    const addQualifier = useCallback((kind) => {
        const q = makeQualifier({ kind: kind || 'T_AVG' });
        writeQualifiers([...qualifiers, q]);
        setSelectedId(q.id);
    }, [qualifiers, writeQualifiers]);

    const updateQualifier = useCallback((id, patch) => {
        writeQualifiers(qualifiers.map(q => q.id === id ? { ...q, ...patch } : q));
    }, [qualifiers, writeQualifiers]);

    const removeQualifier = useCallback((id) => {
        writeQualifiers(qualifiers.filter(q => q.id !== id));
        setSelectedId(prev => prev === id ? null : prev);
    }, [qualifiers, writeQualifiers]);

    // Splice a fresh row at a specific index. `source` (if given) carries
    // kind/cmp/channel/direction/level/lambda*/aoi/pol/target as defaults so
    // the new row is a near-clone — only target / label still need editing.
    const insertQualifierAt = useCallback((insertIdx, source) => {
        const seed = source
            ? {
                kind: source.kind, cmp: source.cmp,
                channel: source.channel, direction: source.direction,
                level: source.level,
                lambdaStart: source.lambdaStart, lambdaEnd: source.lambdaEnd,
                lambda: source.lambda,
                aoi: source.aoi, pol: source.pol,
                target: source.target,
                edgeSide: source.edgeSide,
                integralId: source.integralId,
                tolerance: source.tolerance,
            }
            : { kind: 'T_AVG' };
        const q = makeQualifier(seed);
        const pos = Math.max(0, Math.min(insertIdx, qualifiers.length));
        const next = [...qualifiers.slice(0, pos), q, ...qualifiers.slice(pos)];
        writeQualifiers(next);
        setSelectedId(q.id);
        containerRef.current?.focus();
        return q.id;
    }, [qualifiers, writeQualifiers]);

    // Duplicate by id — each clone placed immediately AFTER its source. Used
    // by Ctrl+D shortcut. The toolbar Add/Apply paths are independent.
    const duplicateQualifier = useCallback((id) => {
        const idx = qualifiers.findIndex(q => q.id === id);
        if (idx < 0) return;
        const src = qualifiers[idx];
        const { id: _omit, ...rest } = src;
        const clone = makeQualifier(rest);
        const next = [...qualifiers.slice(0, idx + 1), clone, ...qualifiers.slice(idx + 1)];
        writeQualifiers(next);
        setSelectedId(clone.id);
        containerRef.current?.focus();
    }, [qualifiers, writeQualifiers]);

    // ── Wire keyboard shortcuts ──────────────────────────────────────────────
    const selectedIdx = selectedId ? qualifiers.findIndex(q => q.id === selectedId) : -1;
    const { onKeyDown: qualifierKeyDown } = useTableShortcuts({
        focusIdx: selectedIdx,
        rows: qualifiers,
        isLocked: () => false,
        onInsertAbove: (i) => {
            const src = i >= 0 ? qualifiers[i] : null;
            insertQualifierAt(i >= 0 ? i : qualifiers.length, src);
        },
        onInsertBelow: (i) => {
            const src = i >= 0 ? qualifiers[i] : null;
            insertQualifierAt(i >= 0 ? i + 1 : qualifiers.length, src);
        },
        onDelete: (i) => {
            if (i < 0 || i >= qualifiers.length) return;
            const victim = qualifiers[i];
            removeQualifier(victim.id);
            const newLen = qualifiers.length - 1;
            if (newLen <= 0) return;
            const newIdx = Math.min(i, newLen - 1);
            const remaining = qualifiers.filter((_, k) => k !== i);
            if (remaining[newIdx]) setSelectedId(remaining[newIdx].id);
        },
        onDuplicate: (i) => {
            if (i >= 0 && qualifiers[i]) duplicateQualifier(qualifiers[i].id);
        },
    });

    const generateMF = useCallback(() => {
        if (typeof checkpoint === 'function') checkpoint();
        const ops = qualifiersToMFOperands(qualifiers);
        updateDesign({ meritOperands: ops });
    }, [qualifiers, updateDesign, checkpoint]);

    // ── Built-in preset library ──────────────────────────────────────────────
    const onApplyBuiltinPreset = useCallback((presetId, mode) => {
        const items = applyPreset(presetId);
        if (items.length === 0) return;
        if (typeof checkpoint === 'function') checkpoint();
        if (mode === 'append')   writeQualifiers([...qualifiers, ...items]);
        else                     writeQualifiers(items);   // replace
    }, [qualifiers, writeQualifiers, checkpoint]);

    // ── User-saved .tfsq presets (Documents\TFStudio\Qualifiers\) ────────────
    const [diskPresets, setDiskPresets] = useState([]);
    const [diskBusy, setDiskBusy]       = useState(false);
    const [diskMsg,  setDiskMsg]        = useState(null);

    const refreshDiskPresets = useCallback(async () => {
        if (!window.electronAPI?.listQualifierPresets) return;
        try {
            const res = await window.electronAPI.listQualifierPresets();
            if (res?.success) setDiskPresets(res.presets || []);
        } catch (_) { /* no-op */ }
    }, []);

    useEffect(() => { refreshDiskPresets(); }, [refreshDiskPresets]);

    const doSavePreset = useCallback(async (name) => {
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
    }, [qualifiers, refreshDiskPresets, ts]);

    const onSavePreset = useCallback(() => {
        if (!window.electronAPI?.saveQualifierPreset) return;
        if (qualifiers.length === 0) {
            setDiskMsg(ts.noQualifiersToSave || 'Add at least one qualifier first.');
            return;
        }
        // Use the app's InputDialog — window.prompt() is not supported in the
        // Electron renderer (it throws "prompt() is not supported").
        if (!setInputDialog) return;
        const defaultName = (design?.name ? design.name + ' spec' : 'New spec');
        setInputDialog({
            title: ts.savePresetPrompt || 'Save spec preset as:',
            defaultValue: defaultName,
            onConfirm: (name) => { setInputDialog(null); doSavePreset(name); },
            onCancel:  () => setInputDialog(null),
        });
    }, [qualifiers, design, ts, setInputDialog, doSavePreset]);

    const onLoadDiskPreset = useCallback(async (name, mode) => {
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
    }, [qualifiers, writeQualifiers, checkpoint, ts]);

    const onDeleteDiskPreset = useCallback(async (name) => {
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
    }, [refreshDiskPresets, ts]);

    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, ts.noDesign || 'No design selected.');
    }

    // ── Render ───────────────────────────────────────────────────────────────
    return h('div', {
        ref: containerRef,
        tabIndex: 0,
        onKeyDown: qualifierKeyDown,
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
            outline: 'none',
        }
    },
        h(VerdictBar, { verdict, c, ts, qualifiers, generateMF, design, t }),
        h(Toolbar,    {
            addQualifier, c, ts,
            onApplyBuiltinPreset,
            diskPresets, diskBusy, diskMsg,
            onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
        }),
        h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } },
            qualifiers.length === 0
                ? h(EmptyState, { c, ts, addQualifier })
                : h(QTable, { qualifiers, results, c, ts, updateQualifier, removeQualifier,
                              selectedId, onSelect: selectAndFocus })
        )
    );
}

// ── Verdict banner ───────────────────────────────────────────────────────────

function VerdictBar({ verdict, c, ts, qualifiers, generateMF, design, t }) {
    const { passing, total, allPass } = verdict;
    const color = total === 0 ? c.textDim
                : allPass     ? c.success
                              : c.error;
    const label = total === 0 ? (ts.noActive || 'No active qualifiers')
                : allPass     ? (ts.allPass  || 'All requirements pass')
                              : (ts.someFail || `${total - passing} requirement(s) failing`);

    return h('div', {
        style: {
            padding: '8px 12px', background: c.panel,
            borderBottom: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }
    },
        h('div', {
            style: {
                fontSize: 12, fontWeight: 700, color,
                padding: '4px 10px', borderRadius: 12,
                background: `${color}1a`, border: `1px solid ${color}55`,
            }
        }, label),
        total > 0 && h('div', { style: { fontSize: 11, color: c.textDim } },
            `${passing}/${total} ${ts.passingSuffix || 'passing'}`),
        // Read-only reminder of what qualifiers are scored against
        // (set in the Design Editor).
        design && h(EvalModeBadge, { design, c, t, style: { marginLeft: 12 } }),
        h('div', { style: { flex: 1 } }),
        qualifiers.length > 0 && h('button', {
            onClick: generateMF,
            title: ts.generateMFTip || 'Convert qualifiers into MF operands (OPGT/OPLT) and write to the design',
            style: btnStyle(c),
        }, ts.generateMF || 'Generate MF')
    );
}

// ── Toolbar (Add + Presets + Save/Load) ──────────────────────────────────────

function Toolbar({
    addQualifier, c, ts,
    onApplyBuiltinPreset,
    diskPresets, diskBusy, diskMsg,
    onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
}) {
    const [kind, setKind]                 = useState('T_AVG');
    const [builtinSel, setBuiltinSel]     = useState('');
    const [diskSel,    setDiskSel]        = useState('');
    const [applyMode,  setApplyMode]      = useState('replace'); // 'replace' | 'append'

    return h('div', {
        style: {
            padding: '6px 10px', background: c.panel,
            borderBottom: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            flexWrap: 'wrap',
        }
    },
        // Add single
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.addKindLabel || 'Add:'),
        h('select', {
            value: kind, onChange: e => setKind(e.target.value),
            style: { ...selStyle(c), minWidth: 180 },
        }, QUALIFIER_KINDS.map(k =>
            h('option', { key: k, value: k, style: { background: c.panel } },
              (ts.kinds && ts.kinds[k]) || k))
        ),
        h('button', { onClick: () => addQualifier(kind), style: btnStyle(c) },
          ts.add || '+ Add'),

        // Divider
        h('span', { style: { width: 1, height: 18, background: c.border, marginLeft: 6, marginRight: 6 } }),

        // Built-in presets
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.presetLabel || 'Preset:'),
        h('select', {
            value: builtinSel, onChange: e => setBuiltinSel(e.target.value),
            style: { ...selStyle(c), minWidth: 200 },
            title: ts.presetTip || 'Canned spec sheets for common coating types',
        },
            h('option', { value: '', style: { background: c.panel, color: c.textDim } },
              ts.presetPicker || '(pick a built-in spec…)'),
            QUALIFIER_PRESETS.map(p => h('option', {
                key: p.id, value: p.id,
                title: p.description,
                style: { background: c.panel },
            }, p.label))
        ),
        h('select', {
            value: applyMode, onChange: e => setApplyMode(e.target.value),
            style: { ...selStyle(c), width: 96 },
            title: ts.modeTip || 'Replace = overwrite current list; Append = add to it',
        },
            h('option', { value: 'replace', style: { background: c.panel } }, ts.modeReplace || 'replace'),
            h('option', { value: 'append',  style: { background: c.panel } }, ts.modeAppend  || 'append'),
        ),
        h('button', {
            onClick: () => { if (builtinSel) { onApplyBuiltinPreset(builtinSel, applyMode); setBuiltinSel(''); } },
            disabled: !builtinSel,
            style: { ...btnStyle(c), opacity: builtinSel ? 1 : 0.4, cursor: builtinSel ? 'pointer' : 'default' },
        }, ts.apply || 'Apply'),

        // Divider
        h('span', { style: { width: 1, height: 18, background: c.border, marginLeft: 6, marginRight: 6 } }),

        // Saved-to-disk presets
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.savedLabel || 'Saved:'),
        h('select', {
            value: diskSel, onChange: e => setDiskSel(e.target.value),
            style: { ...selStyle(c), minWidth: 180 },
            title: ts.diskTip || 'User-saved spec presets from Documents\\TFStudio\\Qualifiers\\',
        },
            h('option', { value: '', style: { background: c.panel, color: c.textDim } },
              diskPresets.length === 0
                ? (ts.diskEmpty || '(no saved presets)')
                : (ts.diskPicker || '(pick a saved spec…)')),
            diskPresets.map(p => h('option', {
                key: p.file, value: p.name,
                title: `${p.count} qualifiers — ${p.file}`,
                style: { background: c.panel },
            }, p.name))
        ),
        h('button', {
            onClick: () => { if (diskSel) { onLoadDiskPreset(diskSel, applyMode); } },
            disabled: !diskSel || diskBusy,
            style: { ...btnStyle(c), opacity: diskSel ? 1 : 0.4 },
        }, ts.load || 'Load'),
        h('button', {
            onClick: () => { if (diskSel) onDeleteDiskPreset(diskSel); },
            disabled: !diskSel || diskBusy,
            title: ts.deleteTip || 'Delete the selected saved preset',
            style: { ...btnStyle(c), opacity: diskSel ? 1 : 0.4, color: diskSel ? c.error : c.textDim },
        }, '✕'),
        h('button', {
            onClick: onSavePreset, disabled: diskBusy,
            style: btnStyle(c),
            title: ts.saveTip || 'Save current spec list as a reusable preset',
        }, ts.savePreset || 'Save…'),

        // Disk feedback message (last action)
        diskMsg && h('span', {
            style: { fontSize: 10, color: c.textDim, marginLeft: 'auto', fontStyle: 'italic' }
        }, diskMsg),
    );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ c, ts, addQualifier }) {
    const suggested = ['T_AVG', 'CENTRAL_LAMBDA', 'FWHM', 'INTEGRAL'];
    return h('div', {
        style: {
            padding: 32, textAlign: 'center', color: c.textDim, fontSize: 12,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }
    },
        h('div', { style: { fontSize: 13, color: c.text, opacity: 0.6 } },
          ts.emptyTitle || 'No design requirements yet.'),
        h('div', null, ts.emptyHint || 'Add specifications your design must satisfy (T/R/A levels, central wavelength, FWHM, integral targets, etc.).'),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 } },
            suggested.map(k => h('button', {
                key: k, onClick: () => addQualifier(k),
                style: { ...btnStyle(c), background: c.bg },
            }, '+ ' + ((ts.kinds && ts.kinds[k]) || k)))
        )
    );
}

// ── Qualifier table ──────────────────────────────────────────────────────────

function QTable({ qualifiers, results, c, ts, updateQualifier, removeQualifier, selectedId, onSelect }) {
    return h('div', { style: { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 } },
        qualifiers.map((q, i) => h(QRow, {
            key: q.id, q, r: results[i], c, ts, updateQualifier, removeQualifier,
            isSelected: q.id === selectedId,
            onSelect,
        }))
    );
}

function QRow({ q, r, c, ts, updateQualifier, removeQualifier, isSelected, onSelect }) {
    const meta = KIND_META[q.kind] || {};
    const onF  = (k, v) => updateQualifier(q.id, { [k]: v });

    const passColor = r?.pass === true  ? c.success
                   : r?.pass === false ? c.error
                                      : c.textDim;
    const passBadge = r?.pass === true  ? '✓'
                   : r?.pass === false ? '✗'
                                      : '—';

    return h('div', {
        onMouseDown: (e) => {
            // Don't steal focus from inline inputs/selects the user is editing.
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
            onSelect && onSelect(q.id);
        },
        style: {
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '8px 10px', background: isSelected ? (c.hover || c.panel) : c.panel,
            border: `1px solid ${isSelected ? c.accent : c.border}`,
            borderLeft: `3px solid ${passColor}`,
            borderRadius: 4,
            outline: isSelected ? `1px solid ${c.accent}55` : 'none',
        }
    },
        // ── Row header: enabled toggle / kind / label / verdict ──────────────
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim, cursor: 'pointer' } },
                h('input', {
                    type: 'checkbox', checked: q.enabled !== false,
                    onChange: e => onF('enabled', e.target.checked),
                }),
                ts.enabledLabel || 'on'
            ),
            h('select', {
                value: q.kind,
                // Changing kind can switch the unit (% ↔ nm ↔ count), so reset the
                // eq tolerance to the new kind's native-unit default in the same
                // update (otherwise a 0.01 fraction tol lingers as 0.01 nm).
                onChange: e => updateQualifier(q.id, { kind: e.target.value, tol: defaultTolForKind(e.target.value) }),
                style: { ...selStyle(c), minWidth: 170 },
            }, QUALIFIER_KINDS.map(k =>
                h('option', { key: k, value: k, style: { background: c.panel } },
                  (ts.kinds && ts.kinds[k]) || k))
            ),
            h('input', {
                type: 'text', value: q.label || '',
                placeholder: ts.labelPlaceholder || 'optional label',
                onChange: e => onF('label', e.target.value),
                style: { ...inpStyle(c), flex: 1, width: 'auto' },
            }),
            // Verdict badge — value + cmp + pass mark
            h('div', {
                style: {
                    fontSize: 11, color: passColor, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 11,
                    background: `${passColor}1a`, border: `1px solid ${passColor}55`,
                    minWidth: 60, textAlign: 'center',
                }
            }, passBadge + '  ' + (r?.displayValue || '—')),
            h('button', {
                onClick: () => removeQualifier(q.id),
                title: ts.remove || 'Remove',
                style: { ...btnStyle(c), padding: '2px 8px', color: c.textDim },
            }, '✕'),
        ),

        // ── Row body: kind-specific fields ──────────────────────────────────
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: c.textDim } },
            // Channel (when not fixed by kind)
            meta.channelPick && h(Field, { label: ts.channel || 'Ch', c },
                h('select', {
                    value: q.channel || 'T', onChange: e => onF('channel', e.target.value),
                    style: { ...selStyle(c), width: 48 },
                },
                    ['T','R','A'].map(x => h('option', { key: x, value: x, style: { background: c.panel } }, x))
                )
            ),
            meta.channelFixed && h('div', { style: { fontSize: 10, color: c.text, padding: '2px 6px', background: c.bg, borderRadius: 3, border: `1px solid ${c.border}` } },
                meta.channelFixed
            ),

            // λ — single, band, or hidden (geom-only kinds)
            meta.single
                ? h(Field, { label: 'λ', c },
                    numInp(q.lambda, v => onF('lambda', v), c))
                : !meta.geomOnly
                    ? [
                        h(Field, { label: 'λ start', c, key: 'ls' },
                            numInp(q.lambdaStart, v => onF('lambdaStart', v), c)),
                        h(Field, { label: 'λ end',   c, key: 'le' },
                            numInp(q.lambdaEnd,   v => onF('lambdaEnd',   v), c)),
                      ]
                    : null,

            // AOI, pol — only for optical kinds
            !meta.geomOnly && h(Field, { label: 'AOI', c },
                numInp(q.aoi, v => onF('aoi', v), c)),
            !meta.geomOnly && h(Field, { label: ts.pol || 'pol', c },
                h('select', {
                    value: q.pol || 'avg', onChange: e => onF('pol', e.target.value),
                    style: { ...selStyle(c), width: 54 },
                }, OPERAND_POLS.map(p =>
                    h('option', { key: p, value: p, style: { background: c.panel } }, p)
                ))
            ),

            // Peak direction
            meta.direction && h(Field, { label: ts.direction || 'dir', c },
                h('select', {
                    value: q.direction || 'max', onChange: e => onF('direction', e.target.value),
                    style: { ...selStyle(c), width: 70 },
                },
                    h('option', { value: 'max', style: { background: c.panel } }, ts.dirMax || 'max'),
                    h('option', { value: 'min', style: { background: c.panel } }, ts.dirMin || 'min'),
                )
            ),

            // FWHM / edge crossing level
            meta.level && h(Field, { label: ts.level || 'level', c, tip: ts.levelTip || 'Crossing level as a fraction of peak (e.g. 0.5 = half-max).' },
                numInp(q.level ?? 0.5, v => onF('level', v), c, 0, 1, 0.01)),

            // Edge side
            meta.edgeSide && h(Field, { label: ts.edge || 'edge', c },
                h('select', {
                    value: q.edgeSide || 'left', onChange: e => onF('edgeSide', e.target.value),
                    style: { ...selStyle(c), width: 70 },
                },
                    h('option', { value: 'left',  style: { background: c.panel } }, ts.left  || 'left'),
                    h('option', { value: 'right', style: { background: c.panel } }, ts.right || 'right'),
                )
            ),

            // INTEGRAL — source & detector picker (simple v1: id-only strings)
            meta.integral && [
                h(Field, { label: ts.source || 'source', c, key: 'src' },
                    h('select', {
                        value: q.source?.id || 'D65', onChange: e => onF('source', { id: e.target.value }),
                        style: { ...selStyle(c), width: 100 },
                    },
                        ['D65','D50','A','AM1.5G','E','BB','user'].map(x =>
                            h('option', { key: x, value: x, style: { background: c.panel } }, x))
                    )),
                h(Field, { label: ts.detector || 'detector', c, key: 'det' },
                    h('select', {
                        value: q.detector?.id || 'photopic', onChange: e => onF('detector', { id: e.target.value }),
                        style: { ...selStyle(c), width: 100 },
                    },
                        ['photopic','flat','user'].map(x =>
                            h('option', { key: x, value: x, style: { background: c.panel } }, x))
                    )),
            ],

            // Comparison cmp + target(s)
            h(Field, { label: ts.cmp || 'cmp', c },
                h('select', {
                    value: q.cmp || 'ge', onChange: e => onF('cmp', e.target.value),
                    style: { ...selStyle(c), width: 78 },
                },
                    h('option', { value: 'ge',      style: { background: c.panel } }, '≥'),
                    h('option', { value: 'le',      style: { background: c.panel } }, '≤'),
                    h('option', { value: 'eq',      style: { background: c.panel } }, '= ±tol'),
                    h('option', { value: 'between', style: { background: c.panel } }, '∈ [lo,hi]'),
                )
            ),
            (q.cmp === 'between')
                ? [
                    h(Field, { label: ts.lo || 'lo', c, key: 'lo' },
                        numInpTarget(q.lo,  meta, v => onF('lo', v), c)),
                    h(Field, { label: ts.hi || 'hi', c, key: 'hi' },
                        numInpTarget(q.hi,  meta, v => onF('hi', v), c)),
                  ]
                : [
                    h(Field, { label: ts.target || 'target', c, key: 'tgt' },
                        numInpTarget(q.target, meta, v => onF('target', v), c)),
                    q.cmp === 'eq' && h(Field, { label: ts.tol || 'tol', c, key: 'tol' },
                        numInpTarget(q.tol,    meta, v => onF('tol',    v), c)),
                  ],
        ),

        // Tooltip / summary line for non-pass cases
        r?.summary && r?.pass === false && h('div', {
            style: { fontSize: 10, color: c.textDim, fontStyle: 'italic', paddingLeft: 4 },
        }, r.summary)
    );
}

// ── Tiny helpers ─────────────────────────────────────────────────────────────

function Field({ label, c, tip, children }) {
    return h('label', {
        title: tip,
        style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: c.textDim, cursor: tip ? 'help' : 'default' }
    },
        h('span', null, label),
        children
    );
}

// Editable numeric field with LOCAL text state. The old version was a
// controlled type=number that only committed finite numbers, so clearing the
// box (empty / "-" / "1.") never propagated and the value snapped back — making
// it impossible to delete and retype. This keeps the raw text while editing,
// commits only valid numbers upstream, and re-syncs from the external value
// when not focused. `inPct` shows/accepts percent (stores the 0..1 fraction).
function NumberField({ value, onCommit, c, width = 64, inPct = false }) {
    const toDisp = (v) => (v == null || Number.isNaN(v))
        ? '' : String(inPct ? +(v * 100).toFixed(6) : v);
    const [text, setText] = useState(() => toDisp(value));
    const editingRef = useRef(false);

    // Re-sync from the external value, but never while the user is mid-edit
    // (otherwise their transient empty/partial text gets clobbered).
    useEffect(() => {
        if (!editingRef.current) setText(toDisp(value));
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    const handle = (raw) => {
        setText(raw);
        // Transient states the user passes through while typing — don't commit.
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
        const n = parseFloat(raw);
        if (Number.isFinite(n)) onCommit(inPct ? n / 100 : n);
    };

    return h('input', {
        type: 'text', inputMode: 'decimal',
        value: text,
        onFocus: () => { editingRef.current = true; },
        onBlur:  () => { editingRef.current = false; setText(toDisp(value)); },
        onChange: e => handle(e.target.value),
        style: { ...inpStyle(c), width },
    });
}

function numInp(value, onChange, c) {
    return h(NumberField, { value, onCommit: onChange, c, width: 64 });
}

// Same as numInp but displays in % when meta.fmt = 'pct' (the user types 99 →
// the qualifier stores 0.99; vice versa on display).
function numInpTarget(value, meta, onChange, c) {
    return h(NumberField, { value, onCommit: onChange, c, width: 70, inPct: isPct(meta) });
}

function inpStyle(c) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        outline: 'none', width: 64,
    };
}
function selStyle(c) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        outline: 'none',
    };
}
function btnStyle(c) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '3px 10px', fontFamily: 'inherit',
        cursor: 'pointer', outline: 'none',
    };
}
