import { evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal } from '../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../utils/materials/catalogManager.js';
import { getMaterial } from '../utils/materials/materialDatabase.js';
import { useDesign } from '../state/DesignContext.js';
import { AVG_POINTS } from '../utils/physics/optimizer.js';
import { useIntegralPresets } from '../utils/physics/integralValues.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../utils/physics/spectralWeightings.js';

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

function computeMonitor(m, design, evalMode) {
    try {
        const incMat  = resolveMaterial(design.incidentMedium);
        const subMat  = resolveMaterial(design.substrate?.material);
        const exitMat = resolveMaterial(design.exitMedium);
        const subThick = design.substrate?.thickness ?? 1.0;

        const mapLayers = (arr) => (arr || [])
            .filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));

        const frontLayers = mapLayers(design.frontLayers);
        const backLayers  = mapLayers(design.backLayers);

        // Band-average + integral + min/max monitors sample at AVG_POINTS
        // evenly-spaced wavelengths the T/R/A_AVG and TIW/RIW/AIW operands use
        // (see operandSampleLambdas in optimizer.js), so the status-bar
        // readout matches the corresponding MFE operand value bit-identically
        // over the same band.
        const params = m.type === 'point'
            ? { lambdaStart: m.lambda, lambdaEnd: m.lambda, lambdaStep: 1, theta: 0 }
            : { lambdaStart: m.lambdaStart, lambdaEnd: m.lambdaEnd,
                lambdaStep: (m.lambdaEnd - m.lambdaStart) / (AVG_POINTS - 1), theta: 0 };

        // Integral monitors are full-system quantities by convention (Tvis
        // through the whole filter only makes sense end-to-end), so they pin
        // to evalMode='total' regardless of the global Optical Evaluation
        // selector. The chip badges this so the user sees the override.
        const effectiveMode = m.type === 'integral' ? 'total' : evalMode;

        let result;
        if (effectiveMode === 'back') {
            result = evaluateSpectrumBack(params, exitMat, subMat, backLayers);
        } else if (effectiveMode === 'total') {
            result = evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontLayers, backLayers, subThick);
        } else {
            result = evaluateSpectrum(params, incMat, subMat, frontLayers);
        }

        const KEY = {
            T: { avg: 'T', s: 'Ts', p: 'Tp' },
            R: { avg: 'R', s: 'Rs', p: 'Rp' },
            A: { avg: 'A', s: 'As', p: 'Ap' }
        };
        const key = KEY[m.qty]?.[m.pol] ?? m.qty;
        const arr = result[key];
        if (!arr || arr.length === 0) return null;

        // Weighted-integral monitor: C̄_w = Σ w_i·C_i / Σ w_i with
        // w(λ) = Source(λ) · Detector(λ). Same formula as the TIW/RIW/AIW
        // operands; spectrum (C_i) is the full-system spectrum (Macleod §2.6.4).
        if (m.type === 'integral') {
            const S = resolveSourceSpec(m.source     || { id: 'E'    });
            const D = resolveDetectorSpec(m.detector || { id: 'flat' });
            const lams = result.lambda;
            let num = 0, den = 0;
            for (let i = 0; i < lams.length; i++) {
                const w = S.sampler(lams[i]) * D.sampler(lams[i]);
                num += w * arr[i];
                den += w;
            }
            return den > 1e-30 ? (num / den) * 100 : null;
        }

        if (m.type === 'min') return Math.min(...arr) * 100;
        if (m.type === 'max') return Math.max(...arr) * 100;

        const val = m.type === 'point'
            ? arr[0]
            : arr.reduce((a, b) => a + b, 0) / arr.length;
        return val * 100;
    } catch {
        return null;
    }
}

function monitorLabel(m) {
    const polStr = m.pol === 'avg' ? '' : m.pol;
    const qty = m.qty + polStr;
    if (m.type === 'point') return `${qty} @${m.lambda}nm`;
    if (m.type === 'integral') {
        // Preset name (Tvis, Rsol, custom_…) is the canonical identity; the
        // band is implicit in the preset. Pol suffix only when not 'avg'.
        const lbl = m.presetLabel || m.presetKey || `${qty}·w(λ)`;
        return polStr ? `${lbl}${polStr}` : lbl;
    }
    if (m.type === 'min') return `${qty}min ${m.lambdaStart}–${m.lambdaEnd}nm`;
    if (m.type === 'max') return `${qty}max ${m.lambdaStart}–${m.lambdaEnd}nm`;
    // U+27E8/27E9 = ⟨ ⟩ mathematical angle brackets
    return `⟨${qty}⟩ ${m.lambdaStart}–${m.lambdaEnd}nm`;
}

function genId() { return Math.random().toString(36).slice(2, 9); }

// ── Add / Edit monitor form ──────────────────────────────────────────────────

function AddForm({ c, onAdd, onCancel, initial, mode }) {
    // `initial` (optional) seeds the form when editing an existing monitor.
    // `mode` ∈ 'add' | 'edit' — controls the submit-button label and which
    // ID the resulting object carries (preserved when editing).
    const [form, setForm] = useState(() => initial || {
        qty: 'R', type: 'avg', lambda: 550, lambdaStart: 400, lambdaEnd: 800, pol: 'avg'
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
        setValues(monitors.map(m => computeMonitor(m, design, evalMode)));
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
