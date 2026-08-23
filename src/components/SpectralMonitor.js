import { useDesign } from '../state/DesignContext.js';
import { designMaterialLookup } from '../utils/materials/designMaterials.js';
import { useUnresolvedMaterials } from '../utils/materials/useUnresolvedMaterials.js';
import { makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';
import {
    DIRECT_MONITOR_META, FACT_MONITOR_META, DERIVED_MONITOR_META,
    scopedFactLayers, computeMonitor,
} from '../utils/physics/statusMonitorEvaluation.js';
import { useIntegralPresets } from '../utils/physics/integralValues.js';
import { DebouncedInput } from './ui/DebouncedInput.js';
import { useAnalysisEvaluation } from './windows/analysis/useAnalysisEvaluation.js';

const { createElement: h, useState, useEffect, useMemo, Fragment } = React;

const MONITORS_KEY = 'tfstudio-monitors-v1';

const MONITOR_TYPE_GROUPS = [
    ['spectral', ['point', 'avg', 'min', 'max', 'integral', 'fwhm', 'edgeLeft', 'edgeRight']],
    ['phase', ['PR', 'PT', 'GD', 'GDT', 'GDD', 'GDDT', 'TOD', 'TODT',
        'GDFLAT', 'GDTFLAT', 'GDDFLAT', 'GDDTFLAT', 'TODFLAT', 'TODTFLAT']],
    ['field', ['EFMX', 'PSI', 'DEL']],
    ['featureWavelength', ['MXWT', 'MXWR', 'MXWA', 'MNWT', 'MNWR', 'MNWA']],
    ['designFacts', ['TT', 'MNT', 'MXT', ...Object.keys(FACT_MONITOR_META).map(key => `fact:${key}`)]],
];

function loadMonitors() {
    try {
        const raw = localStorage.getItem(MONITORS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveMonitors(m) {
    try { localStorage.setItem(MONITORS_KEY, JSON.stringify(m)); } catch {}
}

function monitorMeta(m) {
    if (m.type === 'fact') return FACT_MONITOR_META[m.fact] || { unit: 'none', decimals: 3 };
    return DIRECT_MONITOR_META[m.type] || DERIVED_MONITOR_META[m.type]
        || { unit: 'percent', decimals: 3 };
}

function unitSuffix(unitCode, strings) {
    const unit = strings.units[unitCode];
    if (!unit) return '';
    return `${unitCode === 'percent' || unitCode === 'deg' ? '' : ' '}${unit}`;
}

function formatMonitorValue(m, value, strings) {
    if (value == null) return '–';
    const meta = monitorMeta(m);
    return `${value.toFixed(meta.decimals)}${unitSuffix(meta.unit, strings)}`;
}

function monitorScopeBadge(m, design) {
    if (m.type === 'integral') return 'total';
    const meta = DIRECT_MONITOR_META[m.type];
    if (meta?.frontOnly) return 'front';
    if (meta?.phase) return design.surfaceMode === 'back_only' ? 'back' : 'front';
    return null;
}

function monitorLabel(m, strings = {}) {
    const localized = key => strings.types?.[key];
    if (m.type === 'fact') return localized(`fact:${m.fact}`);
    const direct = DIRECT_MONITOR_META[m.type];
    if (direct) {
        const baseLabel = localized(m.type);
        if (direct.mode === 'fact') return baseLabel;
        if (direct.mode === 'layers') return `${baseLabel} L${m.layerStart ?? 1}–${m.layerEnd ?? strings.rangeEnd}`;
        const polStr = direct.noPol || m.pol === 'avg' ? '' : ` ${m.pol}`;
        const aoiStr = m.aoi ? ` @${m.aoi}${strings.units.deg}` : '';
        if (direct.mode === 'point') return `${baseLabel}${polStr} @${m.lambda} ${strings.units.nm}${aoiStr}`;
        const target = direct.level ? ` ${strings.about} ${m.target ?? 0}${unitSuffix(direct.unit, strings)}` : '';
        return `${baseLabel}${polStr}${target} ${m.lambdaStart}–${m.lambdaEnd} ${strings.units.nm}${aoiStr}`;
    }
    if (DERIVED_MONITOR_META[m.type]) {
        const qty = `${m.qty || 'T'}${m.pol === 'avg' ? '' : m.pol}`;
        const level = Math.round((m.level ?? 0.5) * 100);
        return `${localized(m.type)} ${qty} @${level}${strings.units.percent} ${m.lambdaStart}–${m.lambdaEnd} ${strings.units.nm}`;
    }
    const polStr = m.pol === 'avg' ? '' : m.pol;
    const qty = m.qty + polStr;
    // AOI suffix only at oblique incidence (normal incidence stays uncluttered).
    const aoiStr = m.aoi ? ` @${m.aoi}${strings.units.deg}` : '';
    if (m.type === 'point') return `${qty} @${m.lambda} ${strings.units.nm}${aoiStr}`;
    if (m.type === 'integral') {
        // Preset name (Tvis, Rsol, custom_…) is the canonical identity; the
        // band is implicit in the preset. Pol suffix only when not 'avg'.
        const lbl = m.presetLabel || m.presetKey || `${qty}·w(λ)`;
        return (polStr ? `${lbl}${polStr}` : lbl) + aoiStr;
    }
    if (m.type === 'min') return `${qty}${strings.minSuffix} ${m.lambdaStart}–${m.lambdaEnd} ${strings.units.nm}${aoiStr}`;
    if (m.type === 'max') return `${qty}${strings.maxSuffix} ${m.lambdaStart}–${m.lambdaEnd} ${strings.units.nm}${aoiStr}`;
    // U+27E8/27E9 = ⟨ ⟩ mathematical angle brackets
    return `⟨${qty}⟩ ${m.lambdaStart}–${m.lambdaEnd} ${strings.units.nm}${aoiStr}`;
}

function genId() { return Math.random().toString(36).slice(2, 9); }

// ── Add / Edit monitor form ──────────────────────────────────────────────────

function AddForm({ c, t, layerCount, onAdd, onCancel, initial, mode }) {
    // `initial` (optional) seeds the form when editing an existing monitor.
    // `mode` ∈ 'add' | 'edit' — controls the submit-button label and which
    // ID the resulting object carries (preserved when editing).
    const [form, setForm] = useState(() => initial || {
        qty: 'R', type: 'avg', lambda: 550, lambdaStart: 400, lambdaEnd: 800, aoi: 0, pol: 'avg'
    });
    const integralPresets = useIntegralPresets();
    const directMeta = DIRECT_MONITOR_META[form.type];
    const isFact = form.type === 'fact';
    const isDerived = !!DERIVED_MONITOR_META[form.type];
    const isLayerRange = directMeta?.mode === 'layers';
    const usesQuantity = ['point', 'avg', 'min', 'max', 'integral'].includes(form.type) || isDerived;
    const pointWavelength = form.type === 'point' || directMeta?.mode === 'point';
    const bandWavelength = ['avg', 'min', 'max'].includes(form.type) || isDerived || directMeta?.mode === 'band';
    const usesGeometry = !isFact && !directMeta?.noGeometry;
    const selectedType = isFact ? `fact:${form.fact || 'layerCount'}` : form.type;
    const monitorStrings = t?.statusMonitors || {};

    const setF = (patch) => setForm(prev => ({ ...prev, ...patch }));
    const chooseType = value => {
        if (value.startsWith('fact:')) setF({ type: 'fact', fact: value.slice(5) });
        else if (value === 'MNT' || value === 'MXT') setF({
            type: value, layerStart: form.layerStart ?? 1,
            layerEnd: form.layerEnd ?? Math.max(1, layerCount),
        });
        else setF({ type: value });
    };

    // Picking an integral preset atomically fixes qty (= preset.char), band,
    // source/detector — same patch shape the MFE *IW picker writes.
    const applyPreset = (key) => {
        const p = integralPresets.find(pp => pp.key === key);
        if (!p) { setF({ presetKey: '', presetLabel: '' }); return; }
        setF({
            qty:         p.char,
            presetKey:   p.key,
            presetLabel: p.label,
            source:      { ...p.sourceSpec },
            detector:    { ...p.detectorSpec },
            lambdaStart: p.band[0],
            lambdaEnd:   p.band[1],
        });
    };

    const btnStyle = (active) => ({
        padding: '1px 7px', fontSize: 11, cursor: 'pointer', outline: 'none',
        border: `1px solid ${active ? c.accent : c.border}`, borderRadius: 3,
        backgroundColor: active ? c.accent + '33' : 'transparent',
        color: active ? c.accent : c.text,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    });

    const miniInput = (val, onChange, width = 52) => h(DebouncedInput, {
        value: val, inputMode: 'decimal',
        onChange: raw => { const value = Number.parseFloat(raw); if (Number.isFinite(value)) onChange(value); },
        style: {
            width, height: 20, backgroundColor: c.panel, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
            padding: '0 4px', outline: 'none', textAlign: 'right',
            fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    });

    const dim = { fontSize: 11, color: c.textDim, flexShrink: 0 };

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '4px 8px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel
        }
    },
        // Type
        h('span', { style: dim }, monitorStrings.type),
        h('select', {
            value: selectedType, onChange: event => chooseType(event.target.value),
            style: {
                height: 22, maxWidth: 205, backgroundColor: c.panel, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
                padding: '0 4px', outline: 'none',
            },
        }, MONITOR_TYPE_GROUPS.map(([group, options]) => h('optgroup', {
            key: group, label: monitorStrings.groups[group],
        }, options.map(value => h('option', { key: value, value },
            monitorStrings.types[value]))))),
        usesQuantity && h(Fragment, null,
            h('div', { style: { width: 1, height: 16, background: c.border } }),
            h('span', { style: dim }, monitorStrings.quantity),
            h('div', { style: { display: 'flex', gap: 2 } },
                ['T', 'R', 'A'].map(q => h('button', {
                    key: q,
                    onClick: () => form.type === 'integral' ? null : setF({ qty: q }),
                    disabled: form.type === 'integral',
                    title: form.type === 'integral' ? monitorStrings.integralQuantityTip : null,
                    style: { ...btnStyle(form.qty === q), opacity: form.type === 'integral' ? 0.55 : 1 },
                }, q))
            )
        ),
        !isFact && h('div', { style: { width: 1, height: 16, background: c.border } }),
        // Wavelength inputs / integral preset picker
        pointWavelength
            ? h(Fragment, null,
                h('span', { style: dim }, 'λ:'),
                miniInput(form.lambda, v => setF({ lambda: v })),
                h('span', { style: dim }, monitorStrings.units.nm)
              )
            : form.type === 'integral'
            ? h(Fragment, null,
                h('span', { style: dim }, monitorStrings.preset),
                h('select', {
                    value: (form.presetKey && integralPresets.some(p => p.key === form.presetKey)) ? form.presetKey : '',
                    onChange: e => applyPreset(e.target.value),
                    title: form.presetLabel || monitorStrings.pickPresetTip,
                    style: {
                        height: 20, backgroundColor: c.panel, color: c.text,
                        border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
                        padding: '0 4px', outline: 'none',
                        fontFamily: 'system-ui, -apple-system, sans-serif'
                    }
                },
                    !form.presetKey && h('option', { key: '_none', value: '', style: { color: c.textDim } }, monitorStrings.pickPreset),
                    integralPresets.map(p => h('option', { key: p.key, value: p.key, title: p.label }, p.label))
                ),
                form.presetKey && h('span', { style: { ...dim, fontVariantNumeric: 'tabular-nums' } },
                    `${form.lambdaStart}–${form.lambdaEnd} ${monitorStrings.units.nm}`)
              )
            : bandWavelength ? h(Fragment, null,
                miniInput(form.lambdaStart, v => setF({ lambdaStart: v })),
                h('span', { style: dim }, '–'),
                miniInput(form.lambdaEnd, v => setF({ lambdaEnd: v })),
                h('span', { style: dim }, monitorStrings.units.nm)
              ) : isLayerRange ? h(Fragment, null,
                h('span', { style: dim }, monitorStrings.layerRange),
                miniInput(form.layerStart ?? 1, v => setF({ layerStart: Math.max(1, Math.round(v)) }), 42),
                h('span', { style: dim }, '–'),
                miniInput(form.layerEnd ?? Math.max(1, layerCount), v => setF({ layerEnd: Math.max(1, Math.round(v)) }), 58)
              ) : null,
        directMeta?.level && h(Fragment, null,
            h('span', { style: dim }, monitorStrings.level),
            miniInput(form.target ?? 0, v => setF({ target: v }), 60),
            h('span', { style: dim }, monitorStrings.units[directMeta.unit]),
        ),
        isDerived && h(Fragment, null,
            h('span', { style: dim }, monitorStrings.crossing),
            miniInput((form.level ?? 0.5) * 100, v => setF({ level: Math.max(0.1, Math.min(99.9, v)) / 100 }), 45),
            h('span', { style: dim }, monitorStrings.units.percent),
            h('select', {
                value: form.direction || 'max', onChange: event => setF({ direction: event.target.value }),
                style: { height: 20, background: c.panel, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3 },
            }, h('option', { value: 'max' }, monitorStrings.peak), h('option', { value: 'min' }, monitorStrings.notch)),
        ),
        usesGeometry && h('div', { style: { width: 1, height: 16, background: c.border } }),
        // AOI — applies to every monitor type (oblique incidence).
        usesGeometry && h(Fragment, null,
            h('span', { style: dim }, monitorStrings.angle),
            miniInput(form.aoi ?? 0, v => setF({ aoi: v }), 40),
            h('span', { style: dim }, monitorStrings.units.deg),
            !directMeta?.noPol && h('div', { style: { width: 1, height: 16, background: c.border } }),
        ),
        // Pol
        usesGeometry && !directMeta?.noPol && h(Fragment, null,
            h('span', { style: dim }, monitorStrings.polarization),
            h('div', { style: { display: 'flex', gap: 2 } },
                ['avg', 's', 'p'].map(p => h('button', { key: p, onClick: () => setF({ pol: p }), style: btnStyle(form.pol === p) }, p))
            ),
        ),
        // Confirm / cancel
        h('button', {
            onClick: () => onAdd({
                ...(initial && mode === 'edit' ? { id: initial.id } : { id: genId() }),
                ...form,
            }),
            disabled: form.type === 'integral' && !form.presetKey,
            title: (form.type === 'integral' && !form.presetKey) ? monitorStrings.needPreset : null,
            style: {
                padding: '2px 10px', fontSize: 11,
                cursor: (form.type === 'integral' && !form.presetKey) ? 'default' : 'pointer',
                outline: 'none',
                border: `1px solid ${c.accent}`, borderRadius: 3,
                backgroundColor: c.accent + '33', color: c.accent,
                opacity: (form.type === 'integral' && !form.presetKey) ? 0.45 : 1,
                fontFamily: 'system-ui, -apple-system, sans-serif', marginLeft: 4
            }
        }, mode === 'edit' ? monitorStrings.save : monitorStrings.add),
        h('button', {
            onClick: onCancel,
            style: {
                padding: '2px 8px', fontSize: 11, cursor: 'pointer', outline: 'none',
                border: `1px solid ${c.border}`, borderRadius: 3,
                backgroundColor: 'transparent', color: c.textDim,
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        }, monitorStrings.cancel)
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SpectralMonitor({ c, t }) {
    const { design, evalMode } = useDesign();
    const monitorStrings = t.statusMonitors;
    const missingMaterialIds = useUnresolvedMaterials(design);
    const missingMaterialKey = missingMaterialIds.join('\u0000');
    const [monitors, setMonitors] = useState(loadMonitors);
    const [values, setValues]     = useState(() => loadMonitors().map(() => null));
    const [adding, setAdding]     = useState(false);
    const [editingId, setEditingId] = useState(null);  // id of monitor being edited, or null
    const [dragOverId, setDragOverId] = useState(null); // id under the pointer during drag (for drop-zone highlight)
    const coneActive = missingMaterialIds.length === 0
        && coneIsActive(makeConeSpec(design?.cone || {}));
    const monitorPayload = useMemo(() => ({ design, monitors }), [design, monitors]);
    const coneEvaluation = useAnalysisEvaluation(coneActive, 'statusMonitors', monitorPayload);

    useEffect(() => {
        saveMonitors(monitors);
        if (missingMaterialIds.length > 0) {
            setValues(monitors.map(() => null));
            return;
        }
        if (coneActive) {
            setValues(monitors.map(() => null));
            return;
        }
        const resolveMaterial = designMaterialLookup(design);
        setValues(monitors.map(m => computeMonitor(m, design, resolveMaterial)));
    }, [design, monitors, evalMode, missingMaterialKey, coneActive]);

    useEffect(() => {
        if (!coneActive) return;
        if (Array.isArray(coneEvaluation.data)) setValues(coneEvaluation.data);
        else if (coneEvaluation.error) setValues(monitors.map(() => null));
    }, [coneActive, coneEvaluation.data, coneEvaluation.error, monitors]);

    const addMonitor = (m) => {
        setMonitors(prev => [...prev, m]);
        setAdding(false);
    };
    const removeMonitor = (id) => setMonitors(prev => prev.filter(m => m.id !== id));
    const updateMonitor = (m) => {
        setMonitors(prev => prev.map(x => x.id === m.id ? m : x));
        setEditingId(null);
    };

    // Drag-to-reorder via HTML5 DnD. The chip is `draggable`; on `dragstart`
    // we stash the source id in dataTransfer, and on `drop` we splice the
    // monitor array so the source lands before the target.
    const reorderMonitors = (sourceId, targetId) => {
        if (sourceId === targetId) return;
        setMonitors(prev => {
            const src = prev.findIndex(x => x.id === sourceId);
            const tgt = prev.findIndex(x => x.id === targetId);
            if (src < 0 || tgt < 0) return prev;
            const next = [...prev];
            const [item] = next.splice(src, 1);
            // If we removed before the target, the target index shifts down by one.
            const insertAt = src < tgt ? tgt - 1 : tgt;
            next.splice(insertAt, 0, item);
            return next;
        });
    };

    const chipStyle = {
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 7px', borderRadius: 3,
        backgroundColor: c.bg, border: `1px solid ${c.border}`,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontVariantNumeric: 'tabular-nums', flexShrink: 0
    };

    const addBtn = {
        background: 'none', border: `1px solid ${adding ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer',
        color: adding ? c.accent : c.textDim,
        fontSize: 14, lineHeight: '16px', width: 18, height: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, outline: 'none', flexShrink: 0
    };

    return h('div', {
        style: {
            borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel,
            flexShrink: 0,
            fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    },
        // Chips row
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 6,
                padding: '3px 8px', minHeight: 26, overflowX: 'auto',
            }
        },
            h('span', { style: { fontSize: 10, color: c.textDim, flexShrink: 0, letterSpacing: '0.03em' } }, monitorStrings.title),
            h('span', {
                style: {
                    fontSize: 10, color: c.accent, flexShrink: 0,
                    padding: '0 5px', border: `1px solid ${c.accent}33`,
                    borderRadius: 3, backgroundColor: c.accent + '11'
                }
            }, evalMode === 'front' ? monitorStrings.evalFront
                : evalMode === 'back' ? monitorStrings.evalBack : monitorStrings.evalTotal),
            h('div', { style: { width: 1, height: 14, background: c.border } }),
            missingMaterialIds.length > 0 && h('span', {
                title: missingMaterialIds.join(', '),
                style: { color: c.error, fontSize: 11, fontWeight: 600 },
            }, `⚠ ${t.materialResolution.monitorsBlocked}`),
            coneActive && coneEvaluation.busy && h('span', {
                style: { color: c.textDim, fontSize: 10, fontStyle: 'italic', flexShrink: 0 },
            }, t.analysisEvaluation.computing),
            coneActive && coneEvaluation.error && h('span', {
                style: { color: c.error, fontSize: 10, flexShrink: 0 },
            }, t.analysisEvaluation.failed),
            monitors.map((m, i) => {
                const val = values[i];
                const display = formatMonitorValue(m, val, monitorStrings);
                const scopeBadge = monitorScopeBadge(m, design);
                const isDropTarget = dragOverId === m.id;
                return h('span', {
                    key: m.id,
                    draggable: true,
                    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); },
                    onDragOver:  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== m.id) setDragOverId(m.id); },
                    onDragLeave: () => { if (dragOverId === m.id) setDragOverId(null); },
                    onDrop: (e) => {
                        e.preventDefault();
                        const sourceId = e.dataTransfer.getData('text/plain');
                        setDragOverId(null);
                        if (sourceId) reorderMonitors(sourceId, m.id);
                    },
                    onDragEnd: () => setDragOverId(null),
                    onClick: (e) => {
                        if (e.target.tagName === 'BUTTON') return;
                        setAdding(false);
                        setEditingId(prev => prev === m.id ? null : m.id);
                    },
                    title: monitorStrings.editTip,
                    style: {
                        ...chipStyle,
                        cursor: 'grab',
                        userSelect: 'none',
                        outline: isDropTarget ? `2px solid ${c.accent}` : 'none',
                        outlineOffset: isDropTarget ? 1 : 0,
                        backgroundColor: editingId === m.id ? (c.accent + '22') : chipStyle.backgroundColor,
                        borderColor:     editingId === m.id ? c.accent : c.border,
                    }
                },
                    scopeBadge && h('span', {
                        title: scopeBadge === 'total'
                            ? monitorStrings.scopeTotalTip
                            : monitorStrings.scopeSideTip(scopeBadge === 'front'
                                ? monitorStrings.evalFront : monitorStrings.evalBack),
                        style: {
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                            padding: '0 4px', marginRight: 2,
                            color: '#7e57c2',
                            border: '1px solid #7e57c266',
                            backgroundColor: '#7e57c222',
                            borderRadius: 2,
                        }
                    }, scopeBadge === 'total' ? monitorStrings.scopeTotal
                        : scopeBadge === 'front' ? monitorStrings.scopeFront : monitorStrings.scopeBack),
                    h('span', { style: { fontSize: 11, color: c.textDim } }, monitorLabel(m, monitorStrings) + ' = '),
                    h('span', { style: { fontSize: 11, color: c.text, fontWeight: 600 } }, display),
                    h('button', {
                        onClick: (e) => {
                            e.stopPropagation();
                            removeMonitor(m.id);
                            if (editingId === m.id) setEditingId(null);
                        },
                        title: monitorStrings.remove,
                        style: {
                            marginLeft: 3, background: 'none', border: 'none',
                            cursor: 'pointer', color: c.textDim, fontSize: 11,
                            padding: '0 1px', lineHeight: 1, outline: 'none'
                        }
                    }, '\xd7')
                );
            }),
            monitors.length === 0 && !adding && h('span', { style: { fontSize: 11, color: c.textDim, fontStyle: 'italic' } }, monitorStrings.empty),
            h('button', {
                onClick: () => {
                    setEditingId(null); setAdding(p => !p);
                },
                title: adding ? monitorStrings.cancel : monitorStrings.addMonitor,
                style: addBtn,
            }, adding ? '\xd7' : '+')
        ),

        // Inline form — Add OR Edit (mutually exclusive)
        adding && h(AddForm, {
            c, t, layerCount: scopedFactLayers(design).length,
            mode: 'add', onAdd: addMonitor, onCancel: () => setAdding(false),
        }),
        editingId && (() => {
            const m = monitors.find(x => x.id === editingId);
            return m ? h(AddForm, {
                c, t, layerCount: scopedFactLayers(design).length,
                mode: 'edit', initial: m,
                onAdd: updateMonitor,
                onCancel: () => setEditingId(null),
            }) : null;
        })()
    );
}
