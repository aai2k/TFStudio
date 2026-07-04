/**
 * Shared operand-table components used by both MeritFunctionEditor and Refinement.
 * Excel-like editing: cell selection, keyboard navigation, copy/paste, multi-row delete.
 */

import { OPERAND_TYPES, OPERAND_POLS, polFromType, isConstraint, isDmfs, isBlank, isTotalThickness, isRangeTarget, isRamp, isIntegral, isMinmax, isInequality, isArgwave, isMath, isMathSingleRef, isMathPairRef, isFractionalUnit, mathResidualKind, mathTargetInPercent } from '../../utils/physics/optimizer.js';
import { useIntegralPresets } from '../../utils/physics/integralValues.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── Per-type row accent colors ────────────────────────────────────────────────
// RGB tuples shared between background tint and left-stripe
const _TC = {
    T:   [80, 150, 255], TS:  [80, 150, 255], TP:  [80, 150, 255], TAV: [80, 150, 255],
    TIW: [80, 150, 255], TMN: [80, 150, 255], TMX: [80, 150, 255], TGT: [80, 150, 255],
    R:   [50, 200, 100], RS:  [50, 200, 100], RP:  [50, 200, 100], RAV: [50, 200, 100],
    RIW: [50, 200, 100], RMN: [50, 200, 100], RMX: [50, 200, 100], RGT: [50, 200, 100],
    A:   [255, 130, 30], AS:  [255, 130, 30], AP:  [255, 130, 30], AAV: [255, 130, 30],
    AIW: [255, 130, 30], AMN: [255, 130, 30], AMX: [255, 130, 30], AGT: [255, 130, 30],
    // Total thickness (nm) — same purple family as constraints.
    TT:   [180, 100, 255],
    // Math operands — neutral grey-blue (they reference other rows; channel
    // is inherited from the referenced operand).
    OPGT: [140, 160, 200], OPLT: [140, 160, 200],
    OPVA: [140, 160, 200], ABSO: [140, 160, 200],
    ABGT: [140, 160, 200], ABLT: [140, 160, 200],
    DIFF: [140, 160, 200], SUMM: [140, 160, 200], PROD: [140, 160, 200],
    // Argwave types — yellow/amber (λ-of-extremum). Pol via the Pol column.
    MXWT: [230, 190, 80], MXWR: [230, 190, 80], MXWA: [230, 190, 80],
    MNWT: [230, 190, 80], MNWR: [230, 190, 80], MNWA: [230, 190, 80],
    MNT: [180, 100, 255], MXT: [180, 100, 255],
    // Blank/comment — neutral grey.
    BLNK: [140, 140, 140],
};
function typeRgba(type, alpha) {
    const rgb = _TC[type];
    return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : null;
}

// ── Column layout ─────────────────────────────────────────────────────────────

export const COLS = [
    { key: 'num',         w: 32,  label: '#'             },
    { key: 'enabled',     w: 28,  label: '✓'             },
    { key: 'type',        w: 72,  label: 'Type'          },
    { key: 'lambdaStart', w: 96,  label: 'λ / Layer'     },
    { key: 'lambdaEnd',   w: 84,  label: 'End *'         },
    { key: 'aoi',         w: 58,  label: 'AOI (°)'       },
    { key: 'pol',         w: 56,  label: 'Pol'           },
    { key: 'target',      w: 80,  label: 'Target'        },
    { key: 'weight',      w: 62,  label: 'Weight'        },
    { key: 'current',     w: 84,  label: 'Current'       },
    { key: 'delta',       w: 72,  label: 'Δ'             },
];
export const TABLE_W = COLS.reduce((s, col) => s + col.w, 0) + 4;

const RANGE_AVG_TYPES    = new Set(['TAV', 'RAV', 'AAV']);
const RANGE_TARGET_TYPES = new Set(['TGT', 'RGT', 'AGT']);   // continuous per-λ target (start→end)
const EDITABLE_KEYS = ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight'];

// Column-header labels adapt to the focused operand so the user always knows
// what the active row's columns 4/5 actually mean. Returns { lambdaStart,
// lambdaEnd } overrides for the header row; other columns keep their defaults.
function dynamicHeaderLabels(op) {
    if (!op || isDmfs(op.type)) return { lambdaStart: 'λ / Layer', lambdaEnd: 'End *' };
    if (isBlank(op.type))       return { lambdaStart: 'Comment',   lambdaEnd: '—' };
    if (isTotalThickness(op.type)) return { lambdaStart: 'Cmp',    lambdaEnd: '—' };
    if (isConstraint(op.type))  return { lambdaStart: 'Layer 1',   lambdaEnd: 'Layer 2 (range)' };
    if (isIntegral(op.type))    return { lambdaStart: 'Integral',  lambdaEnd: '—' };
    if (isArgwave(op.type))     return { lambdaStart: 'λ Start',   lambdaEnd: 'λ End' };
    if (isMathSingleRef(op.type)) return { lambdaStart: 'Ref Op#', lambdaEnd: '—' };
    if (isMathPairRef(op.type))   return { lambdaStart: 'Ref Op#1', lambdaEnd: 'Ref Op#2' };
    if (isMinmax(op.type) || RANGE_AVG_TYPES.has(op.type) || RANGE_TARGET_TYPES.has(op.type))
                                return { lambdaStart: 'λ Start',   lambdaEnd: 'λ End' };
    return                             { lambdaStart: 'λ',         lambdaEnd: '—' };
}

function editableColsForRow(op) {
    if (isDmfs(op.type))       return ['enabled'];
    if (isBlank(op.type))      return ['enabled'];   // comment edited via the row's text cell
    if (isTotalThickness(op.type)) return ['enabled', 'type', 'lambdaStart', 'target', 'weight']; // lambdaStart = cmp picker; nm target
    if (isConstraint(op.type)) return ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'target', 'weight'];
    if (isIntegral(op.type))   return ['enabled', 'type', 'lambdaStart', 'aoi', 'pol', 'target', 'weight']; // λStart = preset picker; λEnd is read-only
    if (isArgwave(op.type))    return ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']; // λ band + λ-of-extremum target
    if (isMathSingleRef(op.type)) return ['enabled', 'type', 'lambdaStart', 'target', 'weight']; // λStart cell holds the ref picker
    if (isMathPairRef(op.type))   return ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'target', 'weight']; // λStart/λEnd hold ref1/ref2
    return EDITABLE_KEYS.filter(k => k !== 'lambdaEnd' || RANGE_AVG_TYPES.has(op.type) || RANGE_TARGET_TYPES.has(op.type) || isMinmax(op.type));
}

// Build the grouped <optgroup>/<option> list for the operand-type dropdown.
// Shared by the normal type cell and the BLNK comment row (so a comment row can
// be converted into any operand type and vice-versa).
const TYPE_GROUP_ORDER = ['optical', 'range', 'rangetarget', 'integral', 'worst', 'math', 'argwave', 'thick', 'misc'];
function typeOptionEls(t, c) {
    const odict = t?.meritFunctionEditor?.operandTypes || {};
    const gdict = t?.meritFunctionEditor?.operandGroups || {};
    const grouped = {};
    for (const ty of OPERAND_TYPES) {
        const g = odict[ty]?.group || 'optical';
        (grouped[g] = grouped[g] || []).push(ty);
    }
    const opts = [];
    for (const g of TYPE_GROUP_ORDER) {
        if (!grouped[g]) continue;
        opts.push(h('optgroup', { key: g, label: gdict[g] || g },
            grouped[g].map(ty => h('option', {
                key: ty, value: ty, title: odict[ty]?.label || ty, style: { background: c.panel },
            }, ty))
        ));
    }
    // Defensive: any code outside the known groups gets appended flat.
    for (const ty of OPERAND_TYPES) {
        const g = odict[ty]?.group || 'optical';
        if (TYPE_GROUP_ORDER.includes(g)) continue;
        opts.push(h('option', { key: ty, value: ty, style: { background: c.panel } }, ty));
    }
    return opts;
}

// ── Inline numeric/text input used when a cell is being edited ────────────────

function CellInput({ initValue, onCommit, onCancel, onNavigate, c }) {
    const [draft, setDraft] = useState(initValue);
    const ref = useRef(null);
    useEffect(() => { ref.current?.select(); }, []);

    const commit = useCallback(() => onCommit(draft), [draft, onCommit]);

    return h('input', {
        ref,
        value: draft,
        onChange: e => setDraft(e.target.value),
        onBlur: commit,
        onKeyDown: e => {
            if (e.key === 'Enter')     { e.preventDefault(); e.stopPropagation(); commit(); onNavigate('down'); }
            if (e.key === 'Tab')       { e.preventDefault(); e.stopPropagation(); commit(); onNavigate(e.shiftKey ? 'left' : 'right'); }
            if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); onCancel(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); commit(); onNavigate('down'); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); commit(); onNavigate('up'); }
        },
        style: {
            width: '100%', background: c.bg, color: c.text,
            border: `1px solid ${c.accent}`, borderRadius: 2,
            fontSize: 11, padding: '1px 3px', fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box'
        }
    });
}

// ── Small toolbar button ──────────────────────────────────────────────────────

export function TblBtn({ label, onClick, disabled, c, accent, title }) {
    return h('button', {
        onClick, disabled: !!disabled, title,
        style: {
            padding: '2px 8px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3,
            background: accent ? c.accent + '22' : c.panel,
            color: disabled ? c.textDim : accent ? c.accent : c.text,
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: 'inherit'
        }
    }, label);
}

// ── Operand table with toolbar ────────────────────────────────────────────────

export function MFTable({ operands, computed, selectedId, noOperandsMsg, onSelect, onEdit, onAdd, onInsertAt, onDuplicate, onDelete, onClear, onMoveUp, onMoveDown, showToolbar = true, c, t }) {
    const integralPresets = useIntegralPresets();
    // Multi-row selection
    const [selIds,    setSelIds]    = useState(() => selectedId ? new Set([selectedId]) : new Set());
    const [anchor,    setAnchor]    = useState(selectedId || null);
    // Cell focus: {rowIdx, colKey}
    const [focusCell, setFocusCell] = useState(null);
    // Active inline edit: {rowIdx, colKey, initValue}
    const [editCell,  setEditCell]  = useState(null);

    const tableRef = useRef(null);

    // Sync external selectedId → internal selection (e.g. after Add)
    useEffect(() => {
        if (selectedId == null) return;
        setSelIds(new Set([selectedId]));
        setAnchor(selectedId);
    }, [selectedId]);

    // Math operands inherit their reference's unit. We need an id→operand
    // lookup to decide whether each row's `target` should display in percent
    // (ref returns a fraction T/R/A) or raw (ref returns nm / dimensionless).
    const operandsById = useRef(new Map());
    operandsById.current = new Map(operands.map(op => [op.id, op]));
    const isMathPct = useCallback(
        (op) => mathTargetInPercent(op, operandsById.current),
        [operands],
    );

    // ── Selection helpers ─────────────────────────────────────────────────────

    const selectRow = useCallback((id, shift, ctrl) => {
        setSelIds(prev => {
            let next;
            if (shift && anchor) {
                const ai = operands.findIndex(op => op.id === anchor);
                const ci = operands.findIndex(op => op.id === id);
                const lo = Math.min(ai, ci), hi = Math.max(ai, ci);
                next = new Set(operands.slice(lo, hi + 1).map(op => op.id));
                if (ctrl) prev.forEach(x => next.add(x));
            } else if (ctrl) {
                next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                setAnchor(id);
            } else {
                next = new Set([id]);
                setAnchor(id);
            }
            return next;
        });
        onSelect(id);
    }, [anchor, operands, onSelect]);

    // ── Cell focus & edit helpers ─────────────────────────────────────────────

    const focusAt = useCallback((rowIdx, colKey) => {
        const op = operands[rowIdx];
        if (!op) return;
        setFocusCell({ rowIdx, colKey });
        setSelIds(new Set([op.id]));
        setAnchor(op.id);
        onSelect(op.id);
        tableRef.current?.focus();
    }, [operands, onSelect]);

    const startEdit = useCallback((rowIdx, colKey, initChar) => {
        const op = operands[rowIdx];
        if (!op) return;
        if (colKey === 'num' || colKey === 'current' || colKey === 'delta') return;
        if (colKey === 'enabled') { onEdit(op.id, 'enabled', !op.enabled); return; }
        // dropdowns are handled via inline select — just focus
        if (colKey === 'type' || colKey === 'pol') {
            setFocusCell({ rowIdx, colKey });
            return;
        }
        let val;
        if (colKey === 'target') {
            if (isRangeTarget(op.type)) {
                // Range-target row: show "start→end" % so the user can edit both ends.
                const end = op.targetEnd != null ? op.targetEnd : op.target;
                val = `${(op.target * 100).toFixed(1)}→${(end * 100).toFixed(1)}`;
            } else if (isMath(op.type) && isMathPct(op)) {
                // Math operand whose reference returns a fraction T/R/A —
                // display + edit target in percent to match the ref row.
                val = (op.target * 100).toFixed(2);
            } else if (isConstraint(op.type) || isTotalThickness(op.type) || isArgwave(op.type) || isMath(op.type)) {
                // Constraints (nm), total thickness (nm), argwave (λ in nm), math
                // with non-optical refs — all entered as raw numbers.
                val = String(op.target ?? 0);
            } else {
                val = (op.target * 100).toFixed(2);
            }
        } else {
            val = String(op[colKey] ?? '');
        }
        setEditCell({ rowIdx, colKey, initValue: initChar != null ? initChar : val });
    }, [operands, onEdit, isMathPct]);

    const commitEdit = useCallback((rowIdx, colKey, draft) => {
        setEditCell(null);
        const op = operands[rowIdx];
        if (!op) return;
        if (colKey === 'target') {
            const raw = (draft ?? '').toString().trim();
            // Accept "start→end" or "start->end" to set a per-wavelength ramp target on band-avg types.
            const arrow = raw.includes('→') ? '→' : raw.includes('->') ? '->' : null;
            // Only range-target operands (TGT/RGT/AGT) accept "start→end". TAV/RAV
            // are pure averages — a single value only.
            if (arrow !== null && RANGE_TARGET_TYPES.has(op.type)) {
                const pivot = raw.indexOf(arrow);
                const s = parseFloat(raw.slice(0, pivot));
                const e = parseFloat(raw.slice(pivot + arrow.length));
                if (!isNaN(s) && !isNaN(e)) {
                    // Don't stamp rampPoints — leave it unset so the operand uses
                    // the density-based runtime default (operandSampleLambdas).
                    // Only preserve an explicit user override if one already exists.
                    const patch = { target: s / 100, targetEnd: e / 100 };
                    if (Number.isFinite(op.rampPoints)) patch.rampPoints = op.rampPoints;
                    onEdit(op.id, '_patch', patch);
                }
            } else {
                const n = parseFloat(raw);
                if (!isNaN(n)) onEdit(op.id, 'target', n);
            }
        } else {
            const n = parseFloat(draft);
            if (!isNaN(n)) onEdit(op.id, colKey, n);
        }
    }, [operands, onEdit]);

    // Navigate to adjacent cell after commit/tab/arrow
    const navigate = useCallback((fromRowIdx, fromColKey, dir) => {
        const op = operands[fromRowIdx];
        if (!op) return;
        const cols = editableColsForRow(op);
        const ci = cols.indexOf(fromColKey);

        if (dir === 'down' || dir === 'up') {
            const newRow = fromRowIdx + (dir === 'down' ? 1 : -1);
            if (newRow >= 0 && newRow < operands.length) focusAt(newRow, fromColKey);
            return;
        }
        // left / right — wrap to adjacent row
        const delta = dir === 'right' ? 1 : -1;
        const newCi = ci + delta;
        if (newCi >= 0 && newCi < cols.length) {
            setFocusCell({ rowIdx: fromRowIdx, colKey: cols[newCi] });
        } else {
            const newRow = fromRowIdx + delta;
            if (newRow >= 0 && newRow < operands.length) {
                const newCols = editableColsForRow(operands[newRow]);
                const k = delta > 0 ? newCols[0] : newCols[newCols.length - 1];
                focusAt(newRow, k);
            }
        }
    }, [operands, focusAt]);

    // ── Keyboard handler on the table container div ───────────────────────────

    const onKeyDown = useCallback((e) => {
        if (editCell) return; // CellInput handles its own keys

        const fc = focusCell;
        if (!fc && selIds.size === 0) return;

        const rowIdx = fc?.rowIdx ?? operands.findIndex(op => selIds.has(op.id));
        if (rowIdx < 0) return;
        const colKey = fc?.colKey ?? 'type';

        if (e.key === 'Delete') {
            if (selIds.size > 0) { e.preventDefault(); onDelete([...selIds]); setSelIds(new Set()); setFocusCell(null); }
            return;
        }
        // ── Excel-like row shortcuts ──────────────────────────────────────
        // Ins / Shift+Ins insert above/below the focused row, copying its
        // type/λ/AOI/pol so the new row is a near-duplicate the user only
        // has to retarget. Ctrl+D duplicates the current selection below.
        if (e.key === 'Insert') {
            e.preventDefault();
            if (!onInsertAt) return;
            const src = operands[rowIdx] || null;
            const insertIdx = e.shiftKey ? rowIdx + 1 : rowIdx;
            onInsertAt(insertIdx, src);
            return;
        }
        if (e.ctrlKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            if (!onDuplicate) return;
            const ids = selIds.size > 0 ? [...selIds] : (operands[rowIdx] ? [operands[rowIdx].id] : []);
            if (ids.length) onDuplicate(ids);
            return;
        }
        if (e.key === 'ArrowDown')  { e.preventDefault(); focusAt(Math.min(rowIdx + 1, operands.length - 1), colKey); return; }
        if (e.key === 'ArrowUp')    { e.preventDefault(); focusAt(Math.max(rowIdx - 1, 0), colKey); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigate(rowIdx, colKey, 'right'); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); navigate(rowIdx, colKey, 'left'); return; }
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(rowIdx, colKey, null); return; }
        if (e.key === 'Tab') { e.preventDefault(); navigate(rowIdx, colKey, e.shiftKey ? 'left' : 'right'); return; }

        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            const rows = operands.filter(op => selIds.has(op.id));
            // Only T/R/A-valued targets are stored as fractions and shown as %;
            // nm-valued operands (TT, MNT/MXT, argwave) and dimensionless math
            // refs are raw. Scaling everything by 100 corrupted those on paste.
            const tsv = rows.map(op => {
                const tgt = op.target ?? 0;
                const tgtStr = (isFractionalUnit(op.type) ? tgt * 100 : tgt).toFixed(2);
                return [op.type, op.lambdaStart, op.lambdaEnd, op.aoi, op.pol, tgtStr, op.weight].join('\t');
            }).join('\n');
            navigator.clipboard?.writeText(tsv).catch(() => {});
            return;
        }
        if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            navigator.clipboard?.readText().then(text => {
                const lines = text.trim().split(/\r?\n/);
                lines.forEach(line => {
                    const parts = line.split('\t');
                    if (parts.length < 1) return;
                    const [type, lsStr, leStr, aoiStr, pol, tgtStr, wStr] = parts;
                    const ls = parseFloat(lsStr); const le = parseFloat(leStr);
                    const aoi = parseFloat(aoiStr); const tgt = parseFloat(tgtStr);
                    const w = parseFloat(wStr);
                    const safeType = OPERAND_TYPES.includes(type) ? type : 'RAV';
                    // Mirror the copy scaling: fractional (%) types divide by
                    // 100; nm / dimensionless types stay raw. (Note: math-ref
                    // links, integral source/detector, cmp and ramp ends are not
                    // carried by this flat TSV — use Ctrl+D to clone those.)
                    onAdd({
                        type:        safeType,
                        lambdaStart: isFinite(ls)  ? ls  : 400,
                        lambdaEnd:   isFinite(le)  ? le  : 700,
                        aoi:         isFinite(aoi) ? aoi : 0,
                        pol:         OPERAND_POLS.includes(pol) ? pol : 'avg',
                        target:      isFinite(tgt) ? (isFractionalUnit(safeType) ? tgt / 100 : tgt) : 0,
                        weight:      isFinite(w)   ? w   : 1,
                    });
                });
            }).catch(() => {});
            return;
        }

        // Start edit with typed char
        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
            startEdit(rowIdx, colKey, e.key);
        }
    }, [editCell, focusCell, selIds, operands, onDelete, onAdd, onInsertAt, onDuplicate, startEdit, focusAt, navigate]);

    // ── Copy via context (also support Ctrl+C on container) ──────────────────

    const thStyle = {
        padding: '2px 4px', textAlign: 'left', fontSize: 10,
        color: c.textDim, fontWeight: 600, letterSpacing: '0.03em',
        borderBottom: `1px solid ${c.border}`, userSelect: 'none',
        whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel, zIndex: 1
    };

    const primarySel = selIds.size === 1 ? [...selIds][0] : null;
    const hasSelection = selIds.size > 0;

    return h('div', {
        ref: tableRef,
        tabIndex: 0,
        onKeyDown,
        style: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', outline: 'none' }
    },
        h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } },
            h('table', {
                style: { borderCollapse: 'collapse', tableLayout: 'fixed', width: TABLE_W, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif' }
            },
                h('colgroup', null, COLS.map(col => h('col', { key: col.key, style: { width: col.w } }))),
                (() => {
                    // Pick the operand whose row drives the header labels: focused
                    // cell wins, then a single-selection, else the first operand.
                    const headerOp = (focusCell && operands[focusCell.rowIdx])
                        || (primarySel && operands.find(o => o.id === primarySel))
                        || operands[0]
                        || null;
                    const dyn = dynamicHeaderLabels(headerOp);
                    return h('thead', null,
                        h('tr', null, COLS.map(col => {
                            const lbl = col.key === 'lambdaStart' ? dyn.lambdaStart
                                      : col.key === 'lambdaEnd'   ? dyn.lambdaEnd
                                      : col.label;
                            return h('th', { key: col.key, style: { ...thStyle, width: col.w } }, lbl);
                        }))
                    );
                })(),
                h('tbody', null,
                    operands.length === 0
                        ? h('tr', null, h('td', {
                            colSpan: COLS.length,
                            style: { padding: 16, textAlign: 'center', color: c.textDim, fontSize: 12 }
                          }, noOperandsMsg || 'No operands.'))
                        : operands.map((op, rowIdx) => {
                            // ── DMFS sentinel row ──────────────────────────────
                            if (isDmfs(op.type)) {
                                const rowSel = selIds.has(op.id);
                                return h('tr', {
                                    key: op.id,
                                    onClick: e => selectRow(op.id, e.shiftKey, e.ctrlKey || e.metaKey),
                                    style: { cursor: 'default', backgroundColor: rowSel ? c.accent + '28' : c.accent + '12' }
                                },
                                    h('td', { style: { width: COLS[0].w, padding: '0 4px', textAlign: 'center', color: c.textDim, userSelect: 'none', fontSize: 11 } }, rowIdx + 1),
                                    h('td', {
                                        style: { width: COLS[1].w, padding: '0 4px', textAlign: 'center', cursor: 'pointer', color: op.enabled ? c.accent : c.textDim, userSelect: 'none', fontSize: 11 },
                                        onClick: e => { e.stopPropagation(); onEdit(op.id, 'enabled', !op.enabled); }
                                    }, op.enabled ? '✓' : '○'),
                                    h('td', {
                                        colSpan: COLS.length - 2,
                                        style: { padding: '2px 8px', fontStyle: 'italic', color: c.accent, fontSize: 11, borderLeft: `2px solid ${c.accent}50` }
                                    }, '▶ DMFS — ' + (op.comment || 'Default merit function'))
                                );
                            }

                            // ── BLNK comment row (inert; free-text annotation) ──
                            if (isBlank(op.type)) {
                                const rowSel = selIds.has(op.id);
                                return h('tr', {
                                    key: op.id,
                                    onClick: e => selectRow(op.id, e.shiftKey, e.ctrlKey || e.metaKey),
                                    style: { cursor: 'default', backgroundColor: rowSel ? c.accent + '28' : 'rgba(140,140,140,0.10)' }
                                },
                                    h('td', { style: { width: COLS[0].w, padding: '0 4px', textAlign: 'center', color: c.textDim, userSelect: 'none', fontSize: 11 } }, rowIdx + 1),
                                    h('td', {
                                        style: { width: COLS[1].w, padding: '0 4px', textAlign: 'center', cursor: 'pointer', color: op.enabled ? c.accent : c.textDim, userSelect: 'none', fontSize: 11 },
                                        onClick: e => { e.stopPropagation(); onEdit(op.id, 'enabled', !op.enabled); }
                                    }, op.enabled ? '✓' : '○'),
                                    // Type dropdown so a comment row can be converted into any operand (and back).
                                    h('td', { style: { width: COLS[2].w, padding: '0 2px' }, onClick: e => e.stopPropagation() },
                                        h('select', {
                                            value: op.type,
                                            onChange: e => onEdit(op.id, 'type', e.target.value),
                                            title: (t?.meritFunctionEditor?.operandTypes?.[op.type]?.label) || op.type,
                                            style: { width: '100%', background: 'transparent', color: c.textDim, border: 'none', fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }
                                        }, typeOptionEls(t, c))
                                    ),
                                    h('td', {
                                        colSpan: COLS.length - 3,
                                        style: { padding: '1px 6px', borderLeft: '2px solid rgba(140,140,140,0.4)' }
                                    },
                                        h('input', {
                                            value: op.comment || '',
                                            placeholder: '# comment…',
                                            onChange: e => onEdit(op.id, 'comment', e.target.value),
                                            onClick: e => e.stopPropagation(),
                                            style: { width: '100%', background: 'transparent', color: c.textDim, border: 'none', fontSize: 11, fontStyle: 'italic', padding: '1px 2px', fontFamily: 'inherit', outline: 'none' }
                                        })
                                    )
                                );
                            }

                            const isCon   = isConstraint(op.type);
                            const isTT    = isTotalThickness(op.type); // value & target in nm
                            const isArg   = isArgwave(op.type);   // value & target in nm
                            const isMth   = isMath(op.type);      // value & target in units inherited from ref
                            const mthPct  = isMth && isMathPct(op); // ref returns a fraction → display percent
                            const rawCur  = computed?.[rowIdx] != null ? computed[rowIdx] : null;
                            // Optical / math-with-optical-ref: cur/tgt in %; Constraint, TT,
                            // argwave, math with non-optical ref: cur/tgt raw (nm or dimensionless).
                            const useFraction = !isCon && !isTT && !isArg && (!isMth || mthPct);
                            const cur     = rawCur != null ? (useFraction ? rawCur * 100 : rawCur) : null;
                            const isRampRow = isRangeTarget(op.type);   // current = RMS deviation
                            const tgt     = useFraction ? op.target * 100 : op.target;
                            // Ramp `current` is the RMS deviation from the target
                            // line — the residual is the value itself.
                            const rawDelta = cur != null ? (isRampRow ? cur : cur - tgt) : null;
                            // Color: for one-sided math ops (OPGT/OPLT/ABGT/ABLT) we only
                            // care which side of target we're on; equality math ops use
                            // proximity coloring.
                            const mathKind = isMth ? mathResidualKind(op.type) : null;
                            // For MXT constraints, satisfaction means cur <= tgt (delta <= 0 is good)
                            const dColor  = rawDelta == null ? c.textDim
                                          : isCon
                                            ? (op.type === 'MNT'
                                                ? (rawDelta >= 0 ? c.success : c.error)
                                                : (rawDelta <= 0 ? c.success : c.error))
                                          : (isTT && (op.cmp === 'le' || op.cmp === 'ge'))
                                            // One-sided total-thickness constraint: green when satisfied.
                                            ? (op.cmp === 'le'
                                                ? (rawDelta <= 0 ? c.success : c.error)
                                                : (rawDelta >= 0 ? c.success : c.error))
                                          : isMth
                                            ? (mathKind === 'one-sided-min'
                                                ? (rawDelta >= 0 ? c.success : c.error)
                                              : mathKind === 'one-sided-max'
                                                ? (rawDelta <= 0 ? c.success : c.error)
                                              : Math.abs(rawDelta) < 0.005 ? c.success
                                              : Math.abs(rawDelta) < 0.02  ? '#ffa726'
                                                                            : '#ef5350')
                                          : isArg
                                            ? (Math.abs(rawDelta) < 1   ? c.success
                                              : Math.abs(rawDelta) < 5  ? '#ffa726'
                                              : '#ef5350')
                                          : Math.abs(rawDelta) < 0.5 ? c.success
                                          : Math.abs(rawDelta) < 2   ? '#ffa726'
                                          : '#ef5350';
                            const isRange  = RANGE_AVG_TYPES.has(op.type) || RANGE_TARGET_TYPES.has(op.type) || isMinmax(op.type) || isInequality(op.type) || isArgwave(op.type);
                            const rowSel   = selIds.has(op.id);
                            const rowBg    = typeRgba(op.type, 0.12) || 'transparent';
                            const rowStripe = typeRgba(op.type, 0.75);

                            const tdBase = (colKey, w, extra) => {
                                const isFocused = focusCell?.rowIdx === rowIdx && focusCell?.colKey === colKey;
                                return {
                                    width: w, padding: '0 4px',
                                    backgroundColor: isFocused ? c.accent + '44' : rowSel ? c.accent + '28' : rowBg,
                                    outline: isFocused ? `1px solid ${c.accent}` : 'none',
                                    outlineOffset: -1, cursor: 'default',
                                    ...extra
                                };
                            };

                            const cellClick = (colKey, e) => {
                                if (colKey === 'num' || colKey === 'current' || colKey === 'delta') {
                                    selectRow(op.id, e.shiftKey, e.ctrlKey || e.metaKey);
                                    return;
                                }
                                focusAt(rowIdx, colKey);
                            };

                            const cellDblClick = (colKey) => startEdit(rowIdx, colKey, null);

                            const renderCell = (colKey, w) => {
                                const editing = editCell?.rowIdx === rowIdx && editCell?.colKey === colKey;

                                if (colKey === 'enabled') {
                                    return h('td', {
                                        key: colKey,
                                        onClick: () => { focusAt(rowIdx, colKey); onEdit(op.id, 'enabled', !op.enabled); },
                                        style: { ...tdBase(colKey, w), textAlign: 'center', cursor: 'pointer', color: op.enabled ? c.accent : c.textDim, userSelect: 'none' }
                                    }, op.enabled ? '✓' : '○');
                                }

                                if (colKey === 'type') {
                                    // Native <select> rendered exactly like the Pol cell — same
                                    // transparent background, same minimal chrome. Option text is
                                    // the short code only, so the closed cell is compact and the
                                    // open dropdown lists codes in matching width. Full description
                                    // is on each option's `title` (browser hover tooltip) and on
                                    // the select itself (hover the selected code to read it).
                                    // <optgroup> headers categorize the codes (Optical / Band avg /
                                    // Weighted integral / Worst-case / Thickness).
                                    const odict = t?.meritFunctionEditor?.operandTypes || {};
                                    const opts = typeOptionEls(t, c);
                                    return h('td', { key: colKey, onClick: e => cellClick(colKey, e), style: tdBase(colKey, w, { padding: '0 2px' }) },
                                        h('select', {
                                            value: op.type,
                                            onChange: e => onEdit(op.id, 'type', e.target.value),
                                            title: odict[op.type]?.label || op.type,
                                            style: { width: '100%', background: 'transparent', color: c.text, border: 'none', fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }
                                        }, opts)
                                    );
                                }

                                // Constraint rows: aoi and pol not applicable
                                if (isCon && (colKey === 'aoi' || colKey === 'pol')) {
                                    return h('td', { key: colKey, style: { ...tdBase(colKey, w), color: c.textDim } }, '—');
                                }
                                // Total-thickness rows: λEnd/aoi/pol not applicable (acts on all layers).
                                if (isTT && (colKey === 'lambdaEnd' || colKey === 'aoi' || colKey === 'pol')) {
                                    return h('td', { key: colKey, style: { ...tdBase(colKey, w), color: c.textDim } }, '—');
                                }
                                // Total-thickness comparison picker: ≤ (max total), ≥ (min total),
                                // or = (equality target). Lives in the otherwise-unused λ cell so a
                                // TT row reads e.g. "TT  ≤  2000 nm".
                                if (isTT && colKey === 'lambdaStart') {
                                    const cmp = op.cmp || 'eq';
                                    return h('td', { key: colKey, onClick: e => cellClick(colKey, e), style: tdBase(colKey, w, { padding: '0 2px' }) },
                                        h('select', {
                                            value: cmp,
                                            onChange: e => onEdit(op.id, 'cmp', e.target.value),
                                            title: cmp === 'le' ? 'Total thickness ≤ target (max)'
                                                 : cmp === 'ge' ? 'Total thickness ≥ target (min)'
                                                 :                'Total thickness = target',
                                            style: { width: '100%', background: 'transparent', color: c.text, border: 'none', fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }
                                        },
                                            h('option', { value: 'le', style: { background: c.panel } }, '≤'),
                                            h('option', { value: 'ge', style: { background: c.panel } }, '≥'),
                                            h('option', { value: 'eq', style: { background: c.panel } }, '='),
                                        )
                                    );
                                }

                                // Weighted-integral rows: λStart cell becomes a preset picker
                                // (the preset drives type/source/detector/band atomically), and
                                // λEnd becomes a read-only band-end readout.
                                if (isIntegral(op.type) && colKey === 'lambdaStart') {
                                    const matchKey = (op.presetKey && integralPresets.some(p => p.key === op.presetKey))
                                        ? op.presetKey : '';
                                    return h('td', { key: colKey, onClick: e => cellClick(colKey, e), style: tdBase(colKey, w, { padding: '0 2px' }) },
                                        h('select', {
                                            value: matchKey,
                                            onChange: e => {
                                                const p = integralPresets.find(pp => pp.key === e.target.value);
                                                if (!p) return;
                                                const typeMap = { T: 'TIW', R: 'RIW', A: 'AIW' };
                                                onEdit(op.id, '_patch', {
                                                    type:        typeMap[p.char] || op.type,
                                                    presetKey:   p.key,
                                                    source:      { ...p.sourceSpec },
                                                    detector:    { ...p.detectorSpec },
                                                    lambdaStart: p.band[0],
                                                    lambdaEnd:   p.band[1],
                                                });
                                            },
                                            title: matchKey ? (integralPresets.find(p => p.key === matchKey)?.label || matchKey) : 'Pick a saved integral preset',
                                            style: { width: '100%', background: 'transparent', color: c.text, border: 'none', fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }
                                        },
                                            !matchKey && h('option', { key: '_none', value: '', style: { background: c.panel, color: c.textDim } }, '(custom)'),
                                            integralPresets.map(p => h('option', {
                                                key:   p.key,
                                                value: p.key,
                                                title: p.label,
                                                style: { background: c.panel },
                                            }, p.label))
                                        )
                                    );
                                }
                                if (isIntegral(op.type) && colKey === 'lambdaEnd') {
                                    return h('td', { key: colKey, style: { ...tdBase(colKey, w), color: c.textDim } }, '—');
                                }

                                // ── Math operand reference picker(s) ─────────────────────────
                                // For OPGT/OPLT/OPVA/ABSO/ABGT/ABLT: λStart cell holds the
                                // SINGLE ref picker; λEnd is em-dash.
                                // For DIFF/SUMM/PROD: λStart = refId1, λEnd = refId2.
                                // The dropdown lists every OTHER operand by Op# (1-based row
                                // number) + type so the user picks visually.  Stale refs (ref
                                // operand deleted) render red.
                                if (isMath(op.type) && (colKey === 'lambdaStart' || colKey === 'lambdaEnd')) {
                                    const isSecondRef = colKey === 'lambdaEnd';
                                    if (isSecondRef && !isMathPairRef(op.type)) {
                                        return h('td', { key: colKey, style: { ...tdBase(colKey, w), color: c.textDim } }, '—');
                                    }
                                    const refKey = isMathPairRef(op.type)
                                        ? (isSecondRef ? 'refId2' : 'refId1')
                                        : 'refId';
                                    const curRefId = op[refKey];
                                    const refOpIdx = curRefId ? operands.findIndex(o => o.id === curRefId) : -1;
                                    const stale    = curRefId && refOpIdx < 0;
                                    return h('td', { key: colKey, onClick: e => cellClick(colKey, e),
                                                     style: tdBase(colKey, w, { padding: '0 2px', color: stale ? '#ef5350' : c.text }) },
                                        h('select', {
                                            value: curRefId || '',
                                            onChange: e => onEdit(op.id, '_patch', { [refKey]: e.target.value || null }),
                                            title: stale ? 'Referenced operand was deleted'
                                                        : (refOpIdx >= 0 ? `#${refOpIdx + 1} (${operands[refOpIdx].type})` : 'Pick an operand to reference'),
                                            style: { width: '100%', background: 'transparent',
                                                     color: stale ? '#ef5350' : c.text,
                                                     border: 'none', fontSize: 11, padding: '1px 2px',
                                                     fontFamily: 'inherit', outline: 'none', cursor: 'pointer' },
                                        },
                                            h('option', { key: '_none', value: '', style: { background: c.panel, color: c.textDim } },
                                                stale ? '(deleted)' : '(pick…)'),
                                            operands.map((o2, idx) => {
                                                // Don't allow referencing self
                                                if (o2.id === op.id) return null;
                                                const tag = `#${idx + 1} ${o2.type}`;
                                                return h('option', { key: o2.id, value: o2.id, style: { background: c.panel } }, tag);
                                            }).filter(Boolean)
                                        )
                                    );
                                }
                                // Math operands hide AOI and Pol cells — they inherit from
                                // the referenced operand.
                                if (isMath(op.type) && (colKey === 'aoi' || colKey === 'pol')) {
                                    return h('td', { key: colKey, style: { ...tdBase(colKey, w), color: c.textDim } }, '—');
                                }

                                if (colKey === 'pol') {
                                    const embedded = polFromType(op.type);
                                    if (embedded) {
                                        return h('td', { key: colKey, onClick: e => cellClick(colKey, e), style: tdBase(colKey, w, { color: c.textDim }) }, embedded);
                                    }
                                    return h('td', { key: colKey, onClick: e => cellClick(colKey, e), style: tdBase(colKey, w, { padding: '0 2px' }) },
                                        h('select', {
                                            value: op.pol,
                                            onChange: e => onEdit(op.id, 'pol', e.target.value),
                                            style: { width: '100%', background: 'transparent', color: c.text, border: 'none', fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }
                                        }, OPERAND_POLS.map(p => h('option', { key: p, value: p, style: { background: c.panel } }, p)))
                                    );
                                }

                                if (colKey === 'current') {
                                    return h('td', { key: colKey, style: { ...tdBase(colKey, w), textAlign: 'right', color: c.text } },
                                        cur != null
                                            ? (isMth ? cur.toPrecision(4)
                                              : (isCon || isTT || isArg) ? cur.toFixed(2) + ' nm'
                                              : cur.toFixed(3) + ' %')
                                            : '—');
                                }
                                if (colKey === 'delta') {
                                    const dVal = rawDelta;
                                    return h('td', { key: colKey, style: { ...tdBase(colKey, w), textAlign: 'right', color: dColor, fontWeight: 500 } },
                                        dVal != null
                                            ? (isMth
                                                ? (dVal >= 0 ? '+' : '') + dVal.toPrecision(3)
                                              : (isCon || isTT || isArg)
                                                ? (dVal >= 0 ? '+' : '') + dVal.toFixed(2) + ' nm'
                                                : (dVal >= 0 ? '+' : '') + dVal.toFixed(3) + ' %')
                                            : '—');
                                }
                                if (colKey === 'num') {
                                    return h('td', { key: colKey, onClick: e => selectRow(op.id, e.shiftKey, e.ctrlKey || e.metaKey), style: {
                                        ...tdBase(colKey, w), textAlign: 'center', color: c.textDim, userSelect: 'none',
                                        boxShadow: rowStripe ? `inset 3px 0 0 0 ${rowStripe}` : 'none'
                                    } }, rowIdx + 1);
                                }

                                // Numeric editable cell
                                if (editing) {
                                    return h('td', { key: colKey, style: tdBase(colKey, w, { padding: '0 2px' }) },
                                        h(CellInput, {
                                            initValue: editCell.initValue,
                                            onCommit: draft => commitEdit(rowIdx, colKey, draft),
                                            onCancel: () => setEditCell(null),
                                            onNavigate: dir => navigate(rowIdx, colKey, dir),
                                            c
                                        })
                                    );
                                }

                                let display = op[colKey];
                                if (colKey === 'target') {
                                    const tEnd = op.targetEnd != null ? op.targetEnd : op.target;
                                    display = isMth
                                                ? (mthPct ? (op.target * 100).toFixed(2)
                                                          : (op.target?.toPrecision?.(4) ?? '0'))
                                            : (isCon || isTT || isArg) ? op.target.toFixed(2)
                                            : isRampRow ? `${(op.target * 100).toFixed(1)}→${(tEnd * 100).toFixed(1)}`
                                            : (op.target * 100).toFixed(2);
                                }
                                // lambdaEnd: show — for non-range optical; for constraints show end layer
                                if (colKey === 'lambdaEnd') {
                                    if (isCon) {
                                        display = String(Math.round(op.lambdaEnd));
                                    } else if (!isRange) {
                                        return h('td', { key: colKey, style: { ...tdBase(colKey, w), color: c.textDim } }, '—');
                                    }
                                }

                                return h('td', {
                                    key: colKey,
                                    onClick:    e => cellClick(colKey, e),
                                    onDoubleClick: () => cellDblClick(colKey),
                                    style: { ...tdBase(colKey, w), color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text' }
                                }, display ?? '');
                            };

                            return h('tr', {
                                key: op.id,
                                style: { opacity: op.enabled ? 1 : 0.45 }
                            }, COLS.map(col => renderCell(col.key, col.w)));
                        })
                )
            )
        ),
        showToolbar && h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderTop: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
            h(TblBtn, { label: '+ Add',    onClick: () => onAdd(null), c }),
            h(TblBtn, { label: '+ ' + (t?.meritFunctionEditor?.addComment || 'Comment'), onClick: () => onAdd({ type: 'BLNK', comment: '' }), c }),
            h(TblBtn, { label: '✕ Delete', onClick: () => onDelete([...selIds]), disabled: !hasSelection, c }),
            h(TblBtn, { label: '↑',        onClick: onMoveUp,   disabled: !primarySel, c }),
            h(TblBtn, { label: '↓',        onClick: onMoveDown, disabled: !primarySel, c }),
            onClear && h(TblBtn, {
                label: '🗑 ' + (t?.meritFunctionEditor?.clearTable || 'Clear'),
                onClick: () => onClear(), disabled: operands.length === 0, c,
                title: t?.meritFunctionEditor?.clearTableTip || 'Remove all operands from the table',
            }),
            selIds.size > 1 && h('span', { style: { fontSize: 10, color: c.textDim, marginLeft: 4 } }, `${selIds.size} selected`),
            h('span', { style: { fontSize: 10, color: c.textDim, marginLeft: 'auto' } }, 'Del=delete  Ctrl+C/V=copy/paste  Enter/Tab=navigate')
        )
    );
}
