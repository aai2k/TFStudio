import { useDesign } from '../../state/DesignContext.js';
import { getMaterialById } from '../../utils/materials/catalogManager.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import {
    OPERAND_POLS, FILTER_CATEGORIES, FILTER_TYPES,
    defaultFilterParams, generateFilterOperands,
    makeOperand, makeConstraintOperand,
    evaluateOperands, calcMF, calcOMF, isConstraint, makeDmfsOperand,
    isArgwave, isMath, isTotalThickness, mathTargetInPercent,
    buildEvalContext,
} from '../../utils/physics/optimizer.js';
import { MFTable } from './MFTableComponents.js';
import { EvalModeBadge, OptimizeBadge } from '../SurfaceModeBar.js';
import { Checkbox } from '../ui/Checkbox.js';

const { createElement: h, useState, useEffect, useCallback, useMemo } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── DMFS comment builder (summarizes the generated filter) ────────────────────

function buildDmfsComment(tw, typeId, params, common, constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal) {
    const typeLabel = tw.types[typeId]?.label || typeId;
    const def       = FILTER_TYPES[typeId];

    // Summarize fields like "λ 400–700 nm" or "λ₀ 550 nm" using a few heuristics
    // so we don't need a verbose per-type formatter.
    const f = (k) => params[k];
    let fieldStr = '';
    if (def.fields.find(x => x.key === 'lamStart')) {
        fieldStr = `λ ${f('lamStart')}–${f('lamEnd')} nm`;
        if (def.fields.find(x => x.key === 'tStart')) {
            fieldStr += `, T ${f('tStart').toFixed(2)}`;
            if (f('tEnd') != null) fieldStr += `→${f('tEnd').toFixed(2)}`;
        }
        if (def.fields.find(x => x.key === 'rPct'))   fieldStr += `, R=${f('rPct')}%`;
        if (def.fields.find(x => x.key === 'rsPct'))  fieldStr += `, Rs=${f('rsPct')}% / Rp=${f('rpPct')}%`;
    } else if (def.fields.find(x => x.key === 'lam0')) {
        fieldStr = `λ₀=${f('lam0')} nm`;
    } else if (def.fields.find(x => x.key === 'lam3')) {
        fieldStr = `λ=${f('lam1')}/${f('lam2')}/${f('lam3')} nm`;
    } else if (def.fields.find(x => x.key === 'lam2')) {
        fieldStr = `λ=${f('lam1')}/${f('lam2')} nm`;
    } else if (def.fields.find(x => x.key === 'passStart')) {
        const sp = def.fields.find(x => x.key === 'stopStart');
        if (sp && def.fields[0].key === 'stopStart') {
            fieldStr = `stop ${f('stopStart')}–${f('stopEnd')} nm, pass ${f('passStart')}–${f('passEnd')} nm`;
        } else {
            fieldStr = `pass ${f('passStart')}–${f('passEnd')} nm, stop ${f('stopStart')}–${f('stopEnd')} nm`;
        }
    } else if (def.fields.find(x => x.key === 'lowStopStart')) {
        fieldStr = `stop ${f('lowStopStart')}–${f('lowStopEnd')} | pass ${f('passStart')}–${f('passEnd')} | stop ${f('highStopStart')}–${f('highStopEnd')} nm`;
    } else if (def.fields.find(x => x.key === 'lowPassStart')) {
        fieldStr = `pass ${f('lowPassStart')}–${f('lowPassEnd')} | stop ${f('stopStart')}–${f('stopEnd')} | pass ${f('highPassStart')}–${f('highPassEnd')} nm`;
    }

    let s = `${typeLabel}, ${fieldStr}`;
    const aoiStr = (common.aoi === common.aoiEnd || common.aoiEnd == null)
        ? `AOI ${common.aoi}°`
        : `AOI ${common.aoi}–${common.aoiEnd}° (${common.aoiSteps} steps)`;
    s += `, ${aoiStr}, ${common.pol} pol`;
    if (def.supportsTargetMode) {
        s += common.targetMode === 'discrete'
            ? `, discrete @${common.stepNm} nm`
            : `, continuous target`;
    }
    if (constraintsEnabled) s += `; ≥${minThick} nm, ≤${maxThick} nm`;
    if (totalEnabled)       s += `; Σd ≤ ${maxTotal} nm`;
    return s;
}

// ── Filter-type wizard (categorized, per-type form) ──────────────────────────

function DMFWizard({ design, onGenerate, operandCount, c, t }) {
    const tw = t.meritFunctionEditor.wizard;

    // Category + type
    const [catId,  setCatId]  = useState(FILTER_CATEGORIES[0].id);
    const [typeId, setTypeId] = useState(FILTER_CATEGORIES[0].types[0]);

    // Per-type parameters (seeded from FILTER_TYPES defaults whenever type changes)
    const [params, setParams] = useState(() => defaultFilterParams(FILTER_CATEGORIES[0].types[0]));

    // Common settings (always visible)
    const [aoi,                setAoi]                = useState(0);
    const [aoiEnd,             setAoiEnd]             = useState(0);
    const [aoiSteps,           setAoiSteps]           = useState(3);
    const [pol,                setPol]                = useState('avg');
    const [constraintsEnabled, setConstraintsEnabled] = useState(true);
    const [minThick,           setMinThick]           = useState(40);
    const [maxThick,           setMaxThick]           = useState(1000);
    // Total-thickness constraint (TT operand). Off by default — most designs
    // only bound per-layer thickness; total-budget caps are an explicit choice.
    const [totalEnabled,       setTotalEnabled]       = useState(false);
    const [maxTotal,           setMaxTotal]           = useState(3000);
    // Spectral-target expansion (beamsplitter / gradient): 'continuous' = one
    // range-target operand per band; 'discrete' = point operands at `stepNm`.
    const [targetMode,         setTargetMode]         = useState('continuous');
    const [stepNm,             setStepNm]             = useState(1);
    // Row (1-based) where the generated block is inserted. Defaults to the end
    // so successive generations stack into separate DMFS blocks instead of the
    // new one overwriting the old. Resets to "append" when the design changes.
    const [startRow,           setStartRow]           = useState((operandCount || 0) + 1);
    useEffect(() => { setStartRow((operandCount || 0) + 1); }, [design?.id]); // eslint-disable-line

    const typeDef = FILTER_TYPES[typeId];
    const cat     = FILTER_CATEGORIES.find(c => c.id === catId) || FILTER_CATEGORIES[0];

    // Re-seed params when switching type
    const switchType = useCallback((newTypeId) => {
        setTypeId(newTypeId);
        setParams(defaultFilterParams(newTypeId));
    }, []);

    const switchCategory = useCallback((newCatId) => {
        const newCat = FILTER_CATEGORIES.find(c => c.id === newCatId);
        if (!newCat) return;
        setCatId(newCatId);
        const firstType = newCat.types[0];
        setTypeId(firstType);
        setParams(defaultFilterParams(firstType));
    }, []);

    const updateParam = useCallback((key, value) => {
        setParams(prev => ({ ...prev, [key]: value }));
    }, []);

    const lbl = { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' };
    const inp = {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        width: 62, outline: 'none'
    };
    const sel = { ...inp, width: 'auto', minWidth: 100 };
    const grp = { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 };
    const pillBtn = (active) => ({
        padding: '2px 9px', fontSize: 11, fontFamily: 'inherit',
        border: `1px solid ${active ? c.accent : c.border}`, borderRadius: 11,
        background: active ? c.accent : c.bg,
        color: active ? '#fff' : c.text,
        cursor: 'pointer', fontWeight: active ? 600 : 400,
    });

    const handleGenerate = () => {
        const layerCount = Math.max(1, (design?.frontLayers || []).length);
        const common = {
            aoi:      Number(aoi) || 0,
            aoiEnd:   Number(aoiEnd) || 0,
            aoiSteps: Math.max(1, Math.round(aoiSteps)),
            pol,
            targetMode,
            stepNm:   Math.max(0.1, Number(stepNm) || 1),
        };
        const comment = buildDmfsComment(tw, typeId, params, common, constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal);
        const dmfs    = makeDmfsOperand(comment);
        const optical = generateFilterOperands(typeId, params, common);
        // Constraints apply to ALL layers, including ones GE/Needle will insert
        // later. The evaluator (optimizer.js evalOperand) clamps the upper
        // bound to thicknesses.length at evaluation time, so 9999 = "every
        // current and future layer".
        const constraints = constraintsEnabled ? [
            makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 9999, target: Math.max(0.01, minThick) }),
            makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: 9999, target: Math.max(0.01, maxThick) }),
        ] : [];
        // Total-thickness cap: a single TT operand with cmp 'le' (Σ d ≤ maxTotal,
        // nm). One-sided so it's inert until the budget is exceeded, and — like
        // MNT/MXT — excluded from the optical/needle scan MF (skipConstraints).
        const totalConstraint = totalEnabled
            ? [makeOperand({ type: 'TT', cmp: 'le', target: Math.max(1, maxTotal), weight: 1 })]
            : [];
        const block = [dmfs, ...optical, ...constraints, ...totalConstraint];
        onGenerate(block, Math.max(1, Math.round(startRow)));
        // Advance the insertion point past the block just added so a second
        // "Generate" naturally stacks below the first (the user's stated flow).
        setStartRow(r => Math.max(1, Math.round(r)) + block.length);
    };

    // Field unit hint: λ-like fields → "nm", T-like → none, percentage → "%"
    const fieldUnit = (key) => {
        if (key === 'rPct' || key === 'rsPct' || key === 'rpPct') return '%';
        if (key === 'tStart' || key === 'tEnd') return '';
        if (key === 'points') return '';
        return 'nm';
    };

    return h('div', {
        style: {
            padding: '7px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0
        }
    },
        h('div', { style: { fontSize: 11, fontWeight: 600, color: c.textDim, marginBottom: 5, letterSpacing: '0.05em', textTransform: 'uppercase' } },
            tw.sectionTitle),

        // Category row
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' } },
            h('span', { style: lbl }, tw.categoryLabel + ':'),
            FILTER_CATEGORIES.map(catEntry =>
                h('button', {
                    key: catEntry.id,
                    onClick: () => switchCategory(catEntry.id),
                    style: pillBtn(catEntry.id === catId),
                }, tw.categories[catEntry.id] || catEntry.id)
            )
        ),

        // Type row (filtered by category)
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' } },
            h('span', { style: lbl }, tw.typeLabel + ':'),
            cat.types.map(tId =>
                h('button', {
                    key: tId,
                    onClick: () => switchType(tId),
                    style: pillBtn(tId === typeId),
                    title: tw.types[tId]?.tip || tId,
                }, tw.types[tId]?.label || tId)
            )
        ),

        // Per-type fields
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 5 } },
            typeDef.fields.map(field =>
                h('div', { key: field.key, style: grp },
                    h('span', { style: lbl }, (tw.fields[field.key] || field.key) + ':'),
                    h('input', {
                        type: 'number',
                        value: params[field.key] ?? field.default,
                        min: field.min, max: field.max, step: field.step ?? 1,
                        onChange: e => updateParam(field.key, +e.target.value),
                        style: { ...inp, width: 70 }
                    }),
                    fieldUnit(field.key) && h('span', { style: { ...lbl, color: c.textDim } }, fieldUnit(field.key))
                )
            )
        ),

        // Advanced settings (always visible): AOI, pol, thickness constraints
        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 5, borderTop: `1px solid ${c.border}` }
        },
            h('div', { style: grp },
                h('span', { style: lbl }, tw.aoiRange + ':'),
                h('input', { type: 'number', value: aoi, min: 0, max: 89, onChange: e => setAoi(+e.target.value), style: { ...inp, width: 48 } }),
                h('span', { style: { ...lbl, color: c.text } }, '–'),
                h('input', { type: 'number', value: aoiEnd, min: 0, max: 89, onChange: e => setAoiEnd(+e.target.value), style: { ...inp, width: 48 } })
            ),

            aoi !== aoiEnd && h('div', { style: grp },
                h('span', { style: lbl }, tw.aoiSteps + ':'),
                h('input', { type: 'number', value: aoiSteps, min: 2, max: 20, onChange: e => setAoiSteps(+e.target.value), style: { ...inp, width: 40 } })
            ),

            h('div', { style: grp },
                h('span', { style: lbl }, tw.pol + ':'),
                h('select', { value: pol, onChange: e => setPol(e.target.value), style: sel },
                    OPERAND_POLS.map(p => h('option', { key: p, value: p }, p)))
            ),

            // Spectral-target mode — only for types that build a target across a
            // band (beamsplitter, gradient). Continuous = one range-target
            // operand; Discrete = point operands every `stepNm`.
            typeDef.supportsTargetMode && h('div', { style: grp },
                h('span', { style: lbl }, tw.targetMode + ':'),
                h('select', { value: targetMode, onChange: e => setTargetMode(e.target.value), style: sel },
                    h('option', { value: 'continuous' }, tw.targetContinuous),
                    h('option', { value: 'discrete' },   tw.targetDiscrete)
                ),
                targetMode === 'discrete' && h('span', { style: lbl }, tw.stepNm + ':'),
                targetMode === 'discrete' && h('input', {
                    type: 'number', value: stepNm, min: 0.1, step: 0.5,
                    onChange: e => setStepNm(+e.target.value), style: { ...inp, width: 52 }
                })
            ),

            // Per-layer thickness constraints (MNT/MXT). Checkbox + its Min/Max
            // inputs live in ONE nowrap group so the label never wraps away from
            // its controls when the window narrows (the whole cluster wraps as a
            // unit instead).
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'nowrap' } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' } },
                    h(Checkbox, {
                        c, checked: constraintsEnabled,
                        onChange: e => setConstraintsEnabled(e.target.checked),
                    }),
                    h('span', { style: { fontSize: 11, color: c.text, whiteSpace: 'nowrap' } }, tw.constraintsLabel)
                ),
                constraintsEnabled && h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                    h('span', { style: lbl }, tw.minLabel + ':'),
                    h('input', { type: 'number', value: minThick, min: 0.01, step: 1, onChange: e => setMinThick(+e.target.value), style: { ...inp, width: 64 } }),
                    h('span', { style: lbl }, tw.maxLabel + ':'),
                    h('input', { type: 'number', value: maxThick, min: 0.01, step: 10, onChange: e => setMaxThick(+e.target.value), style: { ...inp, width: 72 } })
                )
            ),

            // Total-thickness cap (TT operand, Σd ≤ max). Same nowrap-group rule.
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'nowrap' } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' } },
                    h(Checkbox, {
                        c, checked: totalEnabled,
                        onChange: e => setTotalEnabled(e.target.checked),
                    }),
                    h('span', { style: { fontSize: 11, color: c.text, whiteSpace: 'nowrap' } }, tw.totalConstraintLabel)
                ),
                totalEnabled && h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                    h('span', { style: lbl }, tw.maxTotalLabel + ':'),
                    h('input', { type: 'number', value: maxTotal, min: 1, step: 50, onChange: e => setMaxTotal(+e.target.value), style: { ...inp, width: 80 } })
                )
            ),

            h('div', { style: { flex: 1 } }),

            h('div', { style: grp, title: tw.startRowTip },
                h('span', { style: lbl }, tw.startRow + ':'),
                h('input', {
                    type: 'number', value: startRow, min: 1, step: 1,
                    onChange: e => setStartRow(Math.max(1, Math.round(+e.target.value) || 1)),
                    style: { ...inp, width: 56 }
                })
            ),

            h('button', {
                onClick: handleGenerate,
                style: {
                    padding: '3px 14px', fontSize: 11, border: 'none', borderRadius: 3,
                    background: c.accent, color: '#fff', cursor: 'pointer', fontWeight: 600,
                    fontFamily: 'inherit', flexShrink: 0
                },
                title: tw.willReplace
            }, tw.generate)
        )
    );
}

// ── .tfsm preset bar (Save / Load / Delete reusable merit functions) ──────────

function PresetBar({ c, te, diskPresets, diskBusy, diskMsg, onSavePreset, onLoadDiskPreset, onDeleteDiskPreset }) {
    const [diskSel,   setDiskSel]   = useState('');
    const [applyMode, setApplyMode] = useState('replace'); // 'replace' | 'append'

    const sel = {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit', outline: 'none',
    };
    const btn = {
        padding: '2px 9px', fontSize: 11, fontFamily: 'inherit',
        border: `1px solid ${c.border}`, borderRadius: 3,
        background: c.bg, color: c.text, cursor: 'pointer',
    };

    return h('div', {
        style: {
            padding: '5px 10px', background: c.panel, borderBottom: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap',
        }
    },
        h('span', { style: { fontSize: 11, color: c.textDim } }, (te.savedLabel || 'Saved MF') + ':'),
        h('select', {
            value: diskSel, onChange: e => setDiskSel(e.target.value),
            style: { ...sel, minWidth: 180 },
            title: te.diskTip || 'User-saved merit functions from Documents\\TFStudio\\MeritFunctions\\',
        },
            h('option', { value: '', style: { background: c.panel, color: c.textDim } },
                diskPresets.length === 0 ? (te.diskEmpty || '(no saved merit functions)') : (te.diskPicker || '(pick a saved MF…)')),
            diskPresets.map(p => h('option', {
                key: p.file, value: p.name, title: `${p.count} operands — ${p.file}`,
                style: { background: c.panel },
            }, p.name))
        ),
        h('select', {
            value: applyMode, onChange: e => setApplyMode(e.target.value),
            style: { ...sel, width: 96 },
            title: te.modeTip || 'Replace = overwrite current table; Append = add to it',
        },
            h('option', { value: 'replace', style: { background: c.panel } }, te.modeReplace || 'replace'),
            h('option', { value: 'append',  style: { background: c.panel } }, te.modeAppend  || 'append'),
        ),
        h('button', {
            onClick: () => { if (diskSel) onLoadDiskPreset(diskSel, applyMode); },
            disabled: !diskSel || diskBusy,
            style: { ...btn, opacity: diskSel ? 1 : 0.4, cursor: diskSel ? 'pointer' : 'default' },
        }, te.load || 'Load'),
        h('button', {
            onClick: () => { if (diskSel) onDeleteDiskPreset(diskSel); },
            disabled: !diskSel || diskBusy,
            title: te.deleteTip || 'Delete the selected saved merit function',
            style: { ...btn, opacity: diskSel ? 1 : 0.4, color: diskSel ? '#ef5350' : c.textDim, cursor: diskSel ? 'pointer' : 'default' },
        }, '✕'),
        h('button', {
            onClick: onSavePreset, disabled: diskBusy,
            style: btn,
            title: te.saveTip || 'Save the current MF table as a reusable preset',
        }, te.savePreset || 'Save As…'),
        diskMsg && h('span', {
            style: { fontSize: 10, color: c.textDim, marginLeft: 'auto', fontStyle: 'italic' }
        }, diskMsg),
    );
}

// ── Main MeritFunctionEditor window ───────────────────────────────────────────

export function MeritFunctionEditor({ c, t, setInputDialog }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const [selectedId, setSelectedId] = useState(null);
    const [computed,   setComputed]   = useState([]);
    const [mf,         setMf]         = useState(null);
    const [omf,        setOmf]        = useState(null);

    // .tfsm preset persistence (Documents\TFStudio\MeritFunctions\)
    const [diskPresets, setDiskPresets] = useState([]);
    const [diskBusy,    setDiskBusy]    = useState(false);
    const [diskMsg,     setDiskMsg]     = useState(null);

    const te = t.meritFunctionEditor;
    // Memoize so the empty-case fallback keeps a STABLE identity across renders.
    // A bare `design?.meritOperands || []` makes a fresh [] every render, which
    // made the evaluation effect below (dep [operands, design]) re-fire forever →
    // "Maximum update depth exceeded".
    const operands = useMemo(() => design?.meritOperands || [], [design?.meritOperands]);

    const setOperands = useCallback((updater) => {
        const newOps = typeof updater === 'function' ? updater(operands) : updater;
        updateDesign({ meritOperands: newOps });
    }, [operands, updateDesign]);

    // Evaluate operands for current display
    useEffect(() => {
        if (!design || operands.length === 0) { setComputed([]); setMf(null); setOmf(null); return; }
        try {
            // buildEvalContext honors design.surfaceMode so the displayed MF
            // reflects the full system in symmetric/both_independent modes.
            const ctx  = buildEvalContext(design, resolveMat);
            const comp = evaluateOperands(operands, ctx);
            setComputed(comp);
            setMf(calcMF(operands, comp));
            setOmf(calcOMF(operands, comp));   // optical merit (no thickness constraints)
        } catch (_) { setComputed([]); setMf(null); setOmf(null); }
    }, [operands, design]);

    const handleEdit = useCallback((id, key, value) => {
        setOperands(prev => prev.map(op => {
            if (op.id !== id) return op;
            if (key === '_patch') {
                // Bulk multi-field update (used by the *IW preset picker so all
                // four fields land in one re-render).
                return { ...op, ...value };
            }
            if (key === 'target') {
                const n = typeof value === 'number' ? value : parseFloat(value);
                // Constraint (nm), argwave (λ in nm) store raw. Math operands
                // inherit their reference's unit — if the ref returns a
                // fraction T/R/A the math row's target is also a fraction
                // (entered as percent, stored as /100), otherwise raw.
                const byId = new Map(prev.map(o => [o.id, o]));
                const mthPct = isMath(op.type) && mathTargetInPercent(op, byId);
                const storeRaw = isConstraint(op.type) || isTotalThickness(op.type) || isArgwave(op.type)
                              || (isMath(op.type) && !mthPct);
                return { ...op, target: storeRaw ? n : n / 100 };
            }
            return { ...op, [key]: value };
        }));
    }, [setOperands]);

    // Place the generated DMFS block at the requested 1-based row: rows BEFORE
    // it are kept, everything FROM that row onward is removed and replaced by the
    // new block. So generating the first block (Start=1), then a second at Start=6
    // keeps rows 1–5 and rebuilds from row 6 — letting several DMFS blocks coexist
    // while a re-generate at the same row cleanly overwrites the tail.
    const handleGenerate = useCallback((newDmfsBlock, startRow) => {
        setOperands(prev => {
            const pos = Math.max(0, Math.min((startRow ?? prev.length + 1) - 1, prev.length));
            return [...prev.slice(0, pos), ...newDmfsBlock];
        });
        setSelectedId(null);
    }, [setOperands]);

    // "+ Add" / Ctrl+V paste. A bare add (data == null) creates an inert BLNK
    // placeholder — the user then picks the real operand type. This avoids a
    // freshly-added row silently contributing a meaningless RAV target to the MF.
    const handleAdd = useCallback((data) => {
        const op = makeOperand(data ?? { type: 'BLNK', comment: '' });
        setOperands(prev => [op, ...prev]);
        setSelectedId(op.id);
    }, [setOperands]);

    // Positional insert (used by Ins / Shift+Ins shortcuts). New rows are inert
    // BLNK placeholders (same rationale as "+ Add"); use Ctrl+D to duplicate an
    // existing operand instead. `source` is intentionally ignored.
    const handleInsertAt = useCallback((insertIdx, _source) => {
        const op = makeOperand({ type: 'BLNK', comment: '' });
        setOperands(prev => {
            const pos = Math.max(0, Math.min(insertIdx, prev.length));
            return [...prev.slice(0, pos), op, ...prev.slice(pos)];
        });
        setSelectedId(op.id);
    }, [setOperands]);

    // Duplicate the given ids, placing each clone immediately AFTER its source.
    const handleDuplicate = useCallback((ids) => {
        const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
        if (idSet.size === 0) return;
        let lastNewId = null;
        setOperands(prev => {
            const out = [];
            for (const op of prev) {
                out.push(op);
                if (idSet.has(op.id)) {
                    // Clone EVERY field (including type-specific ones: refId /
                    // refId1 / refId2 for math operands, source / detector /
                    // presetKey for integrals, cmp for TT) and just stamp a
                    // fresh id. A cherry-picked copy silently dropped these,
                    // turning a duplicated OPGT into a stale-reference row and
                    // resetting an integral's source/detector to defaults.
                    const clone = { ...op, id: Math.random().toString(36).slice(2, 10), enabled: op.enabled !== false };
                    out.push(clone);
                    lastNewId = clone.id;
                }
            }
            return out;
        });
        if (lastNewId) setSelectedId(lastNewId);
    }, [setOperands]);

    const handleDelete = useCallback((ids) => {
        const set = new Set(Array.isArray(ids) ? ids : [ids]);
        setOperands(prev => prev.filter(op => !set.has(op.id)));
        setSelectedId(null);
    }, [setOperands]);

    const handleMoveUp = useCallback(() => {
        if (!selectedId) return;
        setOperands(prev => {
            const i = prev.findIndex(op => op.id === selectedId);
            if (i <= 0) return prev;
            const a = prev.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a;
        });
    }, [selectedId, setOperands]);

    const handleMoveDown = useCallback(() => {
        if (!selectedId) return;
        setOperands(prev => {
            const i = prev.findIndex(op => op.id === selectedId);
            if (i < 0 || i >= prev.length - 1) return prev;
            const a = prev.slice(); [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a;
        });
    }, [selectedId, setOperands]);

    // Remove every operand (one undo checkpoint so Ctrl+Z restores the table).
    const doClear = useCallback(() => {
        if (typeof checkpoint === 'function') checkpoint();
        setOperands([]);
        setSelectedId(null);
    }, [checkpoint, setOperands]);

    const handleClear = useCallback(() => {
        if (operands.length === 0) return;
        const msg = te.clearConfirm || 'Clear all operands from the merit function table?';
        if (setInputDialog) {
            setInputDialog({
                confirm: true, title: te.clearTable || 'Clear', message: msg,
                confirmLabel: te.clearTable || 'Clear',
                onConfirm: () => { setInputDialog(null); doClear(); },
                onCancel:  () => setInputDialog(null),
            });
        } else if (window.confirm(msg)) {
            doClear();
        }
    }, [operands.length, te, setInputDialog, doClear]);

    // ── .tfsm preset persistence ──────────────────────────────────────────────
    // Re-stamp ids on load so loaded operands can't collide with existing rows.
    const reIdOperands = (ops) => ops.map(({ id, ...rest }) => makeOperand(rest));

    const refreshDiskPresets = useCallback(async () => {
        if (!window.electronAPI?.listMFPresets) return;
        try {
            const res = await window.electronAPI.listMFPresets();
            if (res?.success) setDiskPresets(res.presets || []);
        } catch (_) { /* no-op */ }
    }, []);

    useEffect(() => { refreshDiskPresets(); }, [refreshDiskPresets]);

    const doSavePreset = useCallback(async (name) => {
        const nm = (name || '').trim();
        if (!window.electronAPI?.saveMFPreset || !nm) return;
        setDiskBusy(true);
        try {
            const res = await window.electronAPI.saveMFPreset({ name: nm, description: '', operands });
            if (res?.success) {
                setDiskMsg((te.savedAs || 'Saved as') + ' ' + nm + '.tfsm');
                refreshDiskPresets();
            } else {
                setDiskMsg((te.saveError || 'Save failed') + ': ' + (res?.error || 'unknown'));
            }
        } catch (e) {
            setDiskMsg((te.saveError || 'Save failed') + ': ' + e.message);
        } finally { setDiskBusy(false); }
    }, [operands, refreshDiskPresets, te]);

    const onSavePreset = useCallback(() => {
        if (!window.electronAPI?.saveMFPreset) return;
        if (operands.length === 0) { setDiskMsg(te.noOpsToSave || 'Add at least one operand first.'); return; }
        const defaultName = (design?.name ? design.name + ' MF' : 'New MF');
        const prompt = te.savePresetPrompt || 'Save merit function as:';
        if (setInputDialog) {
            setInputDialog({
                title: prompt, defaultValue: defaultName,
                onConfirm: (name) => { setInputDialog(null); doSavePreset(name); },
                onCancel:  () => setInputDialog(null),
            });
        } else {
            // No dialog host available — window.prompt is unsupported in Electron,
            // so fall back to the design name rather than throwing.
            doSavePreset(defaultName);
        }
    }, [operands.length, design, setInputDialog, doSavePreset, te]);

    const onLoadDiskPreset = useCallback(async (name, mode) => {
        if (!window.electronAPI?.loadMFPreset || !name) return;
        setDiskBusy(true);
        try {
            const res = await window.electronAPI.loadMFPreset(name);
            if (res?.success && Array.isArray(res.preset?.operands)) {
                const fresh = reIdOperands(res.preset.operands);
                if (typeof checkpoint === 'function') checkpoint();
                setOperands(prev => mode === 'append' ? [...prev, ...fresh] : fresh);
                setSelectedId(null);
                setDiskMsg((te.loaded || 'Loaded') + ' ' + name);
            } else {
                setDiskMsg((te.loadError || 'Load failed') + ': ' + (res?.error || 'unknown'));
            }
        } catch (e) {
            setDiskMsg((te.loadError || 'Load failed') + ': ' + e.message);
        } finally { setDiskBusy(false); }
    }, [setOperands, checkpoint, te]);

    const doDeletePreset = useCallback(async (name) => {
        if (!window.electronAPI?.deleteMFPreset || !name) return;
        setDiskBusy(true);
        try {
            const res = await window.electronAPI.deleteMFPreset(name);
            if (res?.success) { setDiskMsg((te.deleted || 'Deleted') + ' ' + name); refreshDiskPresets(); }
        } catch (_) { /* no-op */ }
        finally { setDiskBusy(false); }
    }, [refreshDiskPresets, te]);

    const onDeleteDiskPreset = useCallback((name) => {
        if (!name) return;
        const title = (te.confirmDelete || 'Delete preset');
        if (setInputDialog) {
            setInputDialog({
                confirm: true, title, message: '"' + name + '"?',
                confirmLabel: (t.dialogs?.input?.ok || 'OK'),
                onConfirm: () => { setInputDialog(null); doDeletePreset(name); },
                onCancel:  () => setInputDialog(null),
            });
        } else if (window.confirm(title + ' "' + name + '"?')) {
            doDeletePreset(name);
        }
    }, [setInputDialog, doDeletePreset, te, t]);

    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, te.noDesign);
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden'
        }
    },
        h(DMFWizard, { design, onGenerate: handleGenerate, operandCount: operands.length, c, t }),

        h(PresetBar, {
            c, te, diskPresets, diskBusy, diskMsg,
            onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
        }),

        // Consolidated Optimize + Evaluate bar (was a badge here + the surface
        // dropdown in the Design Editor). Editable; the MF value sits on the right.
        h('div', {
            style: {
                padding: '3px 10px', background: c.panel, borderBottom: `1px solid ${c.border}`,
                fontSize: 11, color: c.textDim, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 10,
            }
        },
            h(OptimizeBadge, { design, c, t }),
            h(EvalModeBadge, { design, c, t }),
            mf != null && h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 12 } },
                h('span', null, (te.mfLabel || 'MF:') + ' ',
                    h('span', { style: { color: c.text, fontWeight: 600 } }, mf.toFixed(6))),
                omf != null && h('span', { title: te.omfTip || 'Optical merit — excludes thickness constraints (MNT/MXT/TT)' },
                    (te.omfLabel || 'OMF:') + ' ',
                    h('span', { style: { color: c.text, fontWeight: 600 } }, omf.toFixed(6)))
            )
        ),

        h('div', { style: { flex: 1, overflow: 'hidden' } },
            h(MFTable, {
                operands, computed, selectedId,
                noOperandsMsg: te.noOperands,
                onSelect: setSelectedId,
                onEdit:   handleEdit,
                onAdd:    handleAdd,
                onInsertAt: handleInsertAt,
                onDuplicate: handleDuplicate,
                onDelete: handleDelete,
                onClear:  handleClear,
                onMoveUp: handleMoveUp,
                onMoveDown: handleMoveDown,
                c, t
            })
        )
    );
}
