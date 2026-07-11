/**
 * UserMaterialForm — the editable form for a user-catalog material.
 *
 * Edits a draft (see materialDraft.js) as either a tabular λ/n/k material or a
 * dispersion-formula material with an optional λ/k absorption table, with a
 * live n/k preview chart. Emits the updated draft via onChange; Save/Delete/Copy
 * are handled by the parent MaterialEditor.
 */

import { ndColor } from '../../../../utils/materials/catalogManager.js';
import { FORMULA_LATEX } from '../../../../utils/materials/dispersionFormulas.js';
import { NKDataGrid } from './nkDataGrid.js';
import { buildNKFromDraft, PRESET_COLORS, nextPresetColor } from './materialDraft.js';
import { KaTeXSpan, dotStyle, catTabStyle, smallBtn } from './materialEditorUI.js';

const { createElement: h, useRef, useEffect } = React;

// ── Live preview chart ────────────────────────────────────────────────────────

// Draw the draft's n (and optional k) over its wavelength range. Follows the
// material's actual range in nm — no fixed visible/NIR clamp — so EUV (<200 nm)
// and far-IR (>10 µm) materials plot correctly. Order is guaranteed.
function drawDraftChart(chartEl, draft, c, me) {
    const getNK = buildNKFromDraft(draft);
    if (!getNK) { window.Plotly.purge(chartEl); return; }

    const lMin = Math.max(1, parseFloat(draft.lambdaMinNm) || 300);
    const lMax = Math.max(lMin + 1, parseFloat(draft.lambdaMaxNm) || 2500);
    const step = Math.max(1e-3, (lMax - lMin) / 250);
    const lams = [], ns = [], ks = [];
    for (let l = lMin; l <= lMax; l += step) {
        try {
            const [n, k] = getNK(l);
            lams.push(l);
            ns.push(isFinite(n) ? n : null);
            ks.push(isFinite(k) && k > 1e-10 ? k : null);
        } catch (_) { lams.push(l); ns.push(null); ks.push(null); }
    }

    const hasK = ks.some(k => k != null && k > 0);
    const traces = [{ x: lams, y: ns, name: me.chartN, type: 'scatter', mode: 'lines', line: { color: '#5dade2', width: 2 }, yaxis: 'y' }];
    if (hasK) traces.push({ x: lams, y: ks, name: me.chartK, type: 'scatter', mode: 'lines', line: { color: '#e74c3c', width: 1.5, dash: 'dash' }, yaxis: 'y2' });

    const layout = {
        paper_bgcolor: c.bg, plot_bgcolor: c.bg,
        margin: { t: 6, b: 32, l: 48, r: hasK ? 48 : 12 },
        xaxis: { title: { text: me.wavelengthNm, font: { size: 10 } }, color: c.textDim, gridcolor: c.border, tickfont: { size: 9 } },
        yaxis: { color: '#5dade2', gridcolor: c.border, tickfont: { size: 9 } },
        legend: { font: { size: 10, color: c.text }, bgcolor: 'transparent', x: 0.01, y: 0.99 },
        font: { family: 'system-ui, -apple-system, sans-serif' },
    };
    if (hasK) layout.yaxis2 = { color: '#e74c3c', overlaying: 'y', side: 'right', tickfont: { size: 9 } };
    window.Plotly.react(chartEl, traces, layout, { responsive: true, displayModeBar: false });
}

// Automatic dot color — derived from the refractive index at 550 nm, previewing
// exactly what the Design Editor / synthesis history will show.
function computeDraftAutoColor(draft) {
    const fn = buildNKFromDraft(draft);
    if (!fn) return ndColor(null);
    try { const nk = fn(550); const n = Array.isArray(nk) ? nk[0] : nk; return ndColor(n); }
    catch (_) { return ndColor(null); }
}

// ── Render sections (module scope so their branches don't roll up) ────────────

function renderFormHeader({ draft, shownColor, set, setName, onCopy, onDelete, me, c, inputStyle }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${c.border}`, flexShrink: 0 } },
        h('span', { style: { ...dotStyle(shownColor, 14), cursor: 'pointer' }, onClick: () => set('color', nextPresetColor(draft.color)), title: me.colorTip }),
        h('input', {
            value: draft.name, onChange: e => setName(e.target.value),
            placeholder: me.materialName, style: { ...inputStyle, flex: 1, fontSize: 14, fontWeight: 600, padding: '2px 6px' }
        }),
        !draft.isNew && onCopy && h('button', {
            onClick: onCopy,
            title: me.copyMaterialTip || me.copyMaterial,
            style: { ...smallBtn(c), flexShrink: 0 }
        }, me.copyMaterial),
        !draft.isNew && h('button', {
            onClick: onDelete,
            style: { ...smallBtn(c), color: '#ec7063', borderColor: '#ec7063' + '88', flexShrink: 0 }
        }, me.deleteMaterial)
    );
}

function renderColorField({ draft, set, me, c, colorIsAuto, autoColor, labelStyle }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('span', { style: labelStyle }, me.colorLabel),
        h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
            // Automatic (index-derived) — selected when no preset is picked.
            h('span', {
                onClick: () => set('color', 'auto'),
                title: me.colorAutoTip,
                style: {
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    cursor: 'pointer', padding: '1px 6px 1px 3px', borderRadius: 9,
                    fontSize: 10, lineHeight: 1.6,
                    border: colorIsAuto ? `1px solid ${c.accent}` : `1px solid ${c.border}`,
                    color: colorIsAuto ? c.accent : c.textDim,
                }
            },
                h('span', { style: dotStyle(autoColor, 11) }),
                me.colorAuto
            ),
            PRESET_COLORS.slice(0, 8).map(col =>
                h('span', {
                    key: col,
                    onClick: () => set('color', col),
                    style: {
                        ...dotStyle(col, 14),
                        cursor: 'pointer',
                        outline: draft.color === col ? `2px solid ${c.accent}` : 'none',
                        outlineOffset: 1,
                    }
                })
            )
        )
    );
}

function renderPropertiesGrid(ctx) {
    const { draft, set, setId, me, c, inputStyle, labelStyle } = ctx;
    return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', paddingTop: 8 } },
        // ID
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h('span', { style: labelStyle }, me.materialId),
            h('input', {
                value: draft.id,
                onChange: e => setId(e.target.value),
                disabled: !draft.isNew,
                style: { ...inputStyle, width: '100%', boxSizing: 'border-box', opacity: draft.isNew ? 1 : 0.5 }
            })
        ),
        renderColorField(ctx),
        // λ min
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h('span', { style: labelStyle }, me.lambdaMinLabel),
            h('input', {
                type: 'number', value: draft.lambdaMinNm, min: 100, max: 99999,
                onChange: e => set('lambdaMinNm', e.target.value),
                style: { ...inputStyle, width: '100%', boxSizing: 'border-box' }
            })
        ),
        // λ max
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h('span', { style: labelStyle }, me.lambdaMaxLabel),
            h('input', {
                type: 'number', value: draft.lambdaMaxNm, min: 100, max: 99999,
                onChange: e => set('lambdaMaxNm', e.target.value),
                style: { ...inputStyle, width: '100%', boxSizing: 'border-box' }
            })
        )
    );
}

// Type toggle — hidden for RII imports (always tabular; Zemax formula UI is irrelevant).
// The two types are mutually exclusive: 'tabular' stores ONLY a λ/n/k table;
// 'formula' stores ONLY a dispersion formula (n) + an optional λ/k table (absorption).
function renderTypeToggle({ draft, set, me, c, sectionLabel }) {
    return h('div', null,
        sectionLabel(me.dataTypeLabel || 'Data type'),
        h('div', { style: { display: 'flex', gap: 6 } },
            ['tabular', 'formula'].map(type =>
                h('button', {
                    key: type,
                    onClick: () => set('type', type),
                    style: catTabStyle(draft.type === type, c)
                }, type === 'tabular' ? me.typeTabular : me.typeFormula)
            )
        ),
        h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 3, fontStyle: 'italic' } },
            draft.type === 'tabular' ? (me.dataTypeHintTabular || 'λ / n / k table only')
                                     : (me.dataTypeHintFormula || 'Formula for n + optional λ / k table'))
    );
}

function renderTabularEditor({ draft, editRow, delRow, addRow, pasteRows, sortRows, me, c, sectionLabel }) {
    return h('div', null,
        sectionLabel('n/k data'),
        h(NKDataGrid, {
            cols: [
                { key: 'lam', label: 'λ (nm)', width: '33%' },
                { key: 'n',   label: 'n',       width: '33%' },
                { key: 'k',   label: 'k',       width: '33%' },
            ],
            rows: draft.rows,
            onEdit: editRow,
            onDelete: delRow,
            onAdd: addRow,
            onPasteRows: pasteRows,
            addLabel: me.addRow,
            sortBtn: draft.rows.length > 1
                ? h('button', { onClick: sortRows, style: { padding: '2px 8px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3, background: c.panel, color: c.text, cursor: 'pointer', fontFamily: 'inherit' } }, me.sortRows)
                : null,
            c,
        })
    );
}

function renderFormulaEditor(ctx) {
    const { draft, set, me, c, sectionLabel, formulaInfo, coeffCount, inputStyle, labelStyle,
            addKRow, delKRow, editKRow, pasteKRows } = ctx;
    return h('div', null,
        sectionLabel(me.formulaLabel),
        h('select', {
            value: draft.formulaNum,
            onChange: e => set('formulaNum', Number(e.target.value)),
            style: { ...inputStyle, padding: '3px 6px', cursor: 'pointer', marginBottom: 6 }
        },
            Object.entries(FORMULA_LATEX).map(([num, info]) =>
                h('option', { key: num, value: num }, `${num} — ${info.name}`)
            )
        ),

        formulaInfo && h('div', { style: { marginBottom: 6, padding: '4px 6px', backgroundColor: c.panel, borderRadius: 3, border: `1px solid ${c.border}`, fontSize: 12, overflowX: 'auto' } },
            h(KaTeXSpan, { latex: formulaInfo.template, displayMode: false })
        ),

        sectionLabel('Coefficients'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' } },
            Array.from({ length: coeffCount }, (_, i) =>
                h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 4 } },
                    h('span', { style: { ...labelStyle, width: 28, textAlign: 'right', fontFamily: 'monospace' } }, formulaInfo?.coeffNames[i] || `c${i}`),
                    h('input', {
                        type: 'text',
                        value: draft.coeffs[i] || '',
                        onChange: e => {
                            const newCoeffs = [...draft.coeffs];
                            newCoeffs[i] = e.target.value;
                            set('coeffs', newCoeffs);
                        },
                        placeholder: '0',
                        style: { ...inputStyle, flex: 1, fontFamily: 'monospace' }
                    })
                )
            )
        ),

        // k table for formula mode
        sectionLabel(me.kTableLabel),
        h(NKDataGrid, {
            cols: [
                { key: 'lam', label: 'λ (nm)', width: '50%' },
                { key: 'k',   label: 'k',       width: '50%' },
            ],
            rows: draft.kRows,
            onEdit: editKRow,
            onDelete: delKRow,
            onAdd: addKRow,
            onPasteRows: pasteKRows,
            addLabel: me.addRow,
            c,
        })
    );
}

function renderPreviewChart({ chartRef, me, c, sectionLabel }) {
    return h('div', { style: { flexShrink: 0, marginTop: 8, borderTop: `1px solid ${c.border}` } },
        sectionLabel(me.chartTitle),
        h('div', { ref: chartRef, style: { height: 160 } })
    );
}

function renderFormFooter({ onSave, me, c }) {
    return h('div', { style: { flexShrink: 0, padding: '8px 0', borderTop: `1px solid ${c.border}` } },
        h('button', {
            onClick: onSave,
            style: {
                width: '100%', padding: '5px 0', fontSize: 12,
                backgroundColor: c.accent, color: '#fff', border: 'none',
                borderRadius: 3, cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        }, me.saveMaterial)
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UserMaterialForm({ draft, onChange, onSave, onDelete, onCopy, catalogs, c, t }) {
    const me = t.materialEditor;
    const chartRef = useRef(null);
    const seqRef = useRef(draft._rowSeq || (draft.rows.length + draft.kRows.length + 100));
    const nextKey = () => ++seqRef.current;

    // Live n/k chart
    useEffect(() => {
        if (!chartRef.current || !window.Plotly) return;
        drawDraftChart(chartRef.current, draft, c, me);
    }, [draft, c]);

    // Field / draft update helpers
    const set = (field, value) => onChange({ ...draft, [field]: value });
    const setName = (name) => {
        const update = { ...draft, name };
        if (draft.idAuto) update.id = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || '';
        onChange(update);
    };
    const setId = (id) => onChange({ ...draft, id, idAuto: false });

    // Row helpers — tabular data
    const addRow = () => {
        const lastLam = draft.rows.length > 0 ? parseFloat(draft.rows[draft.rows.length - 1].lam) + 50 : 400;
        onChange({ ...draft, rows: [...draft.rows, { _key: nextKey(), lam: String(isFinite(lastLam) ? lastLam : 400), n: '1.5', k: '0' }] });
    };
    const delRow = (key) => onChange({ ...draft, rows: draft.rows.filter(r => r._key !== key) });
    const editRow = (key, field, value) => onChange({ ...draft, rows: draft.rows.map(r => r._key === key ? { ...r, [field]: value } : r) });
    const sortRows = () => {
        const sorted = draft.rows.slice().sort((a, b) => (parseFloat(a.lam) || 0) - (parseFloat(b.lam) || 0));
        onChange({ ...draft, rows: sorted });
    };
    const pasteRows = (parsed) => {
        const newRows = parsed.map(p => ({ _key: nextKey(), lam: String(parseFloat(p.lam) || ''), n: String(parseFloat(p.n) || ''), k: String(parseFloat(p.k) || 0) })).filter(r => r.lam !== '' && r.n !== '');
        if (newRows.length > 0) onChange({ ...draft, rows: [...draft.rows, ...newRows] });
    };

    // Row helpers — k table (formula mode)
    const addKRow = () => {
        const lastLam = draft.kRows.length > 0 ? parseFloat(draft.kRows[draft.kRows.length - 1].lam) + 100 : 400;
        onChange({ ...draft, kRows: [...draft.kRows, { _key: nextKey(), lam: String(isFinite(lastLam) ? lastLam : 400), k: '0' }] });
    };
    const delKRow = (key) => onChange({ ...draft, kRows: draft.kRows.filter(r => r._key !== key) });
    const editKRow = (key, field, value) => onChange({ ...draft, kRows: draft.kRows.map(r => r._key === key ? { ...r, [field]: value } : r) });
    const pasteKRows = (parsed) => {
        const newRows = parsed.map(p => ({ _key: nextKey(), lam: String(parseFloat(p.lam) || ''), k: String(parseFloat(p.k) || 0) })).filter(r => r.lam !== '');
        if (newRows.length > 0) onChange({ ...draft, kRows: [...draft.kRows, ...newRows] });
    };

    const formulaInfo = FORMULA_LATEX[draft.formulaNum];
    const coeffCount = formulaInfo?.coeffNames?.length || 6;

    const colorIsAuto = !draft.color || draft.color === 'auto';
    const autoColor = computeDraftAutoColor(draft);
    const shownColor = colorIsAuto ? autoColor : draft.color;

    const inputStyle = {
        backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '1px 4px', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const labelStyle = { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' };
    const sectionLabel = (text) => h('div', {
        style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, margin: '8px 0 4px' }
    }, text);

    const ctx = {
        draft, set, setId, me, c, inputStyle, labelStyle, sectionLabel,
        formulaInfo, coeffCount, colorIsAuto, autoColor,
        addRow, delRow, editRow, sortRows, pasteRows,
        addKRow, delKRow, editKRow, pasteKRows,
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '0 12px' } },
        renderFormHeader({ draft, shownColor, set, setName, onCopy, onDelete, me, c, inputStyle }),
        h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
            renderPropertiesGrid(ctx),
            !draft.isRii && renderTypeToggle(ctx),
            draft.type === 'tabular' && renderTabularEditor(ctx),
            draft.type === 'formula' && renderFormulaEditor(ctx),
            renderPreviewChart({ chartRef, me, c, sectionLabel })
        ),
        renderFormFooter({ onSave, me, c })
    );
}
