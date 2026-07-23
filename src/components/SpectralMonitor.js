import { getMaterialById } from '../utils/materials/catalogManager.js';
import { getMaterial } from '../utils/materials/materialDatabase.js';
import { useDesign } from '../state/DesignContext.js';
import { makeOperand, evaluateOperands, buildEvalContext } from '../utils/physics/optimizer.js';
import { useIntegralPresets } from '../utils/physics/integralValues.js';

const { createElement: h, useState, useEffect, Fragment } = React;

const MONITORS_KEY = 'tfstudio-monitors-v1';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function loadMonitors() {
    try {
        const raw = localStorage.getItem(MONITORS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveMonitors(m) {
    try { localStorage.setItem(MONITORS_KEY, JSON.stringify(m)); } catch {}
}

// Monitor type → merit-function operand type code (qty ∈ T/R/A):
//   point → single-λ T/R/A · avg → TAV/RAV/AAV · min → TMN/RMN/AMN ·
//   max → TMX/RMX/AMX · integral → TIW/RIW/AIW.
// The operand pipeline is the SINGLE SOURCE OF TRUTH for the λ grid each
// characteristic is sampled on (operandSampleLambdas in optimizer.js), so
// evaluating the monitor through it — exactly as the Specification window and
// Merit Function Editor already do — makes the status-bar readout match the
// corresponding operand value bit-identically. A hand-rolled grid here (the
// former fixed AVG_POINTS sampling) drifted once the operands moved to
// density-based sampling (up to 201 pts for averages, 301 for min/max).
const MONITOR_OPERAND_TYPE = {
    point:    (q) => q,
    avg:      (q) => q + 'AV',
    min:      (q) => q + 'MN',
    max:      (q) => q + 'MX',
    integral: (q) => q + 'IW',
};

function computeMonitor(m, design) {
    try {
        const makeType = MONITOR_OPERAND_TYPE[m.type];
        if (!makeType) return null;
        const single = m.type === 'point';

        const op = makeOperand({
            type:        makeType(m.qty),
            lambdaStart: single ? m.lambda : m.lambdaStart,
            lambdaEnd:   single ? m.lambda : m.lambdaEnd,
            aoi:         m.aoi || 0,
            pol:         m.pol || 'avg',
            target:      0,
            weight:      1,
            // Integral weighting travels on the operand (E × flat = unweighted
            // band average when the monitor carries no preset).
            ...(m.type === 'integral'
                ? { source: m.source || { id: 'E' }, detector: m.detector || { id: 'flat' } }
                : {}),
        });

        // Integral monitors are full-system quantities by convention (Tvis
        // through the whole filter only makes sense end-to-end), so they pin to
        // full-system evaluation regardless of the global Front/Back/Total
        // selector. The chip badges this so the user sees the override. Every
        // other monitor follows the design's resolved eval mode (== the
        // `evalMode` chip), which buildEvalContext derives from the same
        // surfaceMode/mfEvalMode fields.
        const evalDesign = m.type === 'integral' ? { ...design, mfEvalMode: 'total' } : design;
        const ctx = buildEvalContext(evalDesign, resolveMaterial);
        const v = evaluateOperands([op], ctx)[0];
        return (v == null || !Number.isFinite(v)) ? null : v * 100;
    } catch {
        return null;
    }
}

function monitorLabel(m) {
    const polStr = m.pol === 'avg' ? '' : m.pol;
    const qty = m.qty + polStr;
    // AOI suffix only at oblique incidence (normal incidence stays uncluttered).
    const aoiStr = m.aoi ? ` @${m.aoi}°` : '';
    if (m.type === 'point') return `${qty} @${m.lambda}nm${aoiStr}`;
    if (m.type === 'integral') {
        // Preset name (Tvis, Rsol, custom_…) is the canonical identity; the
        // band is implicit in the preset. Pol suffix only when not 'avg'.
        const lbl = m.presetLabel || m.presetKey || `${qty}·w(λ)`;
        return (polStr ? `${lbl}${polStr}` : lbl) + aoiStr;
    }
    if (m.type === 'min') return `${qty}min ${m.lambdaStart}–${m.lambdaEnd}nm${aoiStr}`;
    if (m.type === 'max') return `${qty}max ${m.lambdaStart}–${m.lambdaEnd}nm${aoiStr}`;
    // U+27E8/27E9 = ⟨ ⟩ mathematical angle brackets
    return `⟨${qty}⟩ ${m.lambdaStart}–${m.lambdaEnd}nm${aoiStr}`;
}

function genId() { return Math.random().toString(36).slice(2, 9); }

// ── Add / Edit monitor form ──────────────────────────────────────────────────

function AddForm({ c, onAdd, onCancel, initial, mode }) {
    // `initial` (optional) seeds the form when editing an existing monitor.
    // `mode` ∈ 'add' | 'edit' — controls the submit-button label and which
    // ID the resulting object carries (preserved when editing).
    const [form, setForm] = useState(() => initial || {
        qty: 'R', type: 'avg', lambda: 550, lambdaStart: 400, lambdaEnd: 800, aoi: 0, pol: 'avg'
    });
    const integralPresets = useIntegralPresets();

    const setF = (patch) => setForm(prev => ({ ...prev, ...patch }));

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

    const miniInput = (val, onChange, width = 52) => h('input', {
        type: 'number', value: val,
        onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); },
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
        // Qty — driven by the preset's char when type='integral'; user-picked otherwise.
        h('span', { style: dim }, 'Qty:'),
        h('div', { style: { display: 'flex', gap: 2 } },
            ['T', 'R', 'A'].map(q => h('button', {
                key:      q,
                onClick:  () => form.type === 'integral' ? null : setF({ qty: q }),
                disabled: form.type === 'integral',
                title:    form.type === 'integral' ? 'Integral preset determines T/R/A' : null,
                style:    { ...btnStyle(form.qty === q), opacity: form.type === 'integral' ? 0.55 : 1 }
            }, q))
        ),
        h('div', { style: { width: 1, height: 16, background: c.border } }),
        // Type
        h('span', { style: dim }, 'Type:'),
        h('div', { style: { display: 'flex', gap: 2 } },
            h('button', { onClick: () => setF({ type: 'point' }),    style: btnStyle(form.type === 'point') },    '@λ'),
            h('button', { onClick: () => setF({ type: 'avg'   }),    style: btnStyle(form.type === 'avg')   },    'avg'),
            h('button', { onClick: () => setF({ type: 'min'   }),    style: btnStyle(form.type === 'min')   },    'min'),
            h('button', { onClick: () => setF({ type: 'max'   }),    style: btnStyle(form.type === 'max')   },    'max'),
            h('button', { onClick: () => setF({ type: 'integral' }), style: btnStyle(form.type === 'integral') }, '∫ integral')
        ),
        h('div', { style: { width: 1, height: 16, background: c.border } }),
        // Wavelength inputs / integral preset picker
        form.type === 'point'
            ? h(Fragment, null,
                h('span', { style: dim }, 'λ:'),
                miniInput(form.lambda, v => setF({ lambda: v })),
                h('span', { style: dim }, 'nm')
              )
            : form.type === 'integral'
            ? h(Fragment, null,
                h('span', { style: dim }, 'Preset:'),
                h('select', {
                    value: (form.presetKey && integralPresets.some(p => p.key === form.presetKey)) ? form.presetKey : '',
                    onChange: e => applyPreset(e.target.value),
                    title: form.presetLabel || 'Pick a saved integral preset',
                    style: {
                        height: 20, backgroundColor: c.panel, color: c.text,
                        border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
                        padding: '0 4px', outline: 'none',
                        fontFamily: 'system-ui, -apple-system, sans-serif'
                    }
                },
                    !form.presetKey && h('option', { key: '_none', value: '', style: { color: c.textDim } }, '(pick…)'),
                    integralPresets.map(p => h('option', { key: p.key, value: p.key, title: p.label }, p.label))
                ),
                form.presetKey && h('span', { style: { ...dim, fontVariantNumeric: 'tabular-nums' } },
                    `${form.lambdaStart}–${form.lambdaEnd} nm`)
              )
            : h(Fragment, null,
                miniInput(form.lambdaStart, v => setF({ lambdaStart: v })),
                h('span', { style: dim }, '–'),
                miniInput(form.lambdaEnd, v => setF({ lambdaEnd: v })),
                h('span', { style: dim }, 'nm')
              ),
        h('div', { style: { width: 1, height: 16, background: c.border } }),
        // AOI — applies to every monitor type (oblique incidence).
        h('span', { style: dim }, 'AOI:'),
        miniInput(form.aoi ?? 0, v => setF({ aoi: v }), 40),
        h('span', { style: dim }, '°'),
        h('div', { style: { width: 1, height: 16, background: c.border } }),
        // Pol
        h('span', { style: dim }, 'Pol:'),
        h('div', { style: { display: 'flex', gap: 2 } },
            ['avg', 's', 'p'].map(p => h('button', { key: p, onClick: () => setF({ pol: p }), style: btnStyle(form.pol === p) }, p))
        ),
        // Confirm / cancel
        h('button', {
            onClick: () => onAdd({
                ...(initial && mode === 'edit' ? { id: initial.id } : { id: genId() }),
                ...form,
            }),
            disabled: form.type === 'integral' && !form.presetKey,
            title: (form.type === 'integral' && !form.presetKey) ? 'Pick an integral preset first' : null,
            style: {
                padding: '2px 10px', fontSize: 11,
                cursor: (form.type === 'integral' && !form.presetKey) ? 'default' : 'pointer',
                outline: 'none',
                border: `1px solid ${c.accent}`, borderRadius: 3,
                backgroundColor: c.accent + '33', color: c.accent,
                opacity: (form.type === 'integral' && !form.presetKey) ? 0.45 : 1,
                fontFamily: 'system-ui, -apple-system, sans-serif', marginLeft: 4
            }
        }, mode === 'edit' ? '✓ Save' : '✓ Add'),
        h('button', {
            onClick: onCancel,
            style: {
                padding: '2px 8px', fontSize: 11, cursor: 'pointer', outline: 'none',
                border: `1px solid ${c.border}`, borderRadius: 3,
                backgroundColor: 'transparent', color: c.textDim,
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        }, 'Cancel')
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SpectralMonitor({ c }) {
    const { design, evalMode } = useDesign();
    const [monitors, setMonitors] = useState(loadMonitors);
    const [values, setValues]     = useState(() => loadMonitors().map(() => null));
    const [adding, setAdding]     = useState(false);
    const [editingId, setEditingId] = useState(null);  // id of monitor being edited, or null
    const [dragOverId, setDragOverId] = useState(null); // id under the pointer during drag (for drop-zone highlight)

    useEffect(() => {
        saveMonitors(monitors);
        setValues(monitors.map(m => computeMonitor(m, design)));
    }, [design, monitors, evalMode]);

    const addMonitor = (m) => { setMonitors(prev => [...prev, m]); setAdding(false); };
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
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
                padding: '3px 8px', minHeight: 26
            }
        },
            h('span', { style: { fontSize: 10, color: c.textDim, flexShrink: 0, letterSpacing: '0.03em' } }, 'MONITORS'),
            h('span', {
                style: {
                    fontSize: 10, color: c.accent, flexShrink: 0,
                    padding: '0 5px', border: `1px solid ${c.accent}33`,
                    borderRadius: 3, backgroundColor: c.accent + '11'
                }
            }, evalMode === 'front' ? 'Front' : evalMode === 'back' ? 'Back' : 'Total'),
            h('div', { style: { width: 1, height: 14, background: c.border } }),
            monitors.map((m, i) => {
                const val = values[i];
                const display = val == null ? '—' : val.toFixed(3) + '%';
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
                    title: 'Drag to reorder · Click to edit',
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
                    // Integral monitors override the global Front/Back/Total
                    // selector and always compute on the full system — badge
                    // the chip so the user sees the override at a glance.
                    m.type === 'integral' && h('span', {
                        title: 'Integral always computed on full system (front + substrate + back)',
                        style: {
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                            padding: '0 4px', marginRight: 2,
                            color: '#7e57c2',
                            border: '1px solid #7e57c266',
                            backgroundColor: '#7e57c222',
                            borderRadius: 2,
                        }
                    }, 'TOTAL'),
                    h('span', { style: { fontSize: 11, color: c.textDim } }, monitorLabel(m) + ' = '),
                    h('span', { style: { fontSize: 11, color: c.text, fontWeight: 600 } }, display),
                    h('button', {
                        onClick: (e) => {
                            e.stopPropagation();
                            removeMonitor(m.id);
                            if (editingId === m.id) setEditingId(null);
                        },
                        title: 'Remove',
                        style: {
                            marginLeft: 3, background: 'none', border: 'none',
                            cursor: 'pointer', color: c.textDim, fontSize: 11,
                            padding: '0 1px', lineHeight: 1, outline: 'none'
                        }
                    }, '\xd7')
                );
            }),
            monitors.length === 0 && !adding && h('span', { style: { fontSize: 11, color: c.textDim, fontStyle: 'italic' } }, 'no monitors — click + to add'),
            h('button', {
                onClick: () => { setEditingId(null); setAdding(p => !p); },
                title: adding ? 'Cancel' : 'Add monitor', style: addBtn
            }, adding ? '\xd7' : '+')
        ),

        // Inline form — Add OR Edit (mutually exclusive)
        adding && h(AddForm, { c, mode: 'add', onAdd: addMonitor, onCancel: () => setAdding(false) }),
        editingId && (() => {
            const m = monitors.find(x => x.id === editingId);
            return m ? h(AddForm, {
                c, mode: 'edit', initial: m,
                onAdd: updateMonitor,
                onCancel: () => setEditingId(null),
            }) : null;
        })()
    );
}
