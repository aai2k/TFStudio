/**
 * Integral Values — weighted averages of T(λ), R(λ), A(λ).
 *
 *   Tvis / Rvis / Avis   — photopic V(λ) × D65   (Macleod §12.2)
 *   Tsol / Rsol / Asol   — solar AM1.5G          (ASTM G173-03 / NREL)
 *   TUV  / RUV           — flat 300–380 nm
 *   TNIR / RNIR          — flat 780–2500 nm
 *
 * In addition the user can build *custom* integrals by selecting a source
 * (D65/D50/A/AM1.5G/E/blackbody/custom-table) × a detector (photopic/flat/
 * custom-table) over an arbitrary band on T, R, or A. Custom sources and
 * detectors can be typed in directly via an in-window table editor.
 *
 * Each row shows the weighted average plus the unweighted min/max of the
 * channel within the integration band (useful for spec-style "T ≥ 99 %"
 * worst-case checks).
 *
 * Math in `src/utils/integralValues.js` and `src/utils/spectralWeightings.js`.
 */

import { useDesign }                  from '../../../state/DesignContext.js';
import {
    evaluateSpectrum,
    evaluateSpectrumBack,
    evaluateSpectrumTotal,
} from '../../../utils/physics/thinFilmMath.js';
import { getMaterialById }            from '../../../utils/materials/catalogManager.js';
import { getMaterial }                from '../../../utils/materials/materialDatabase.js';
import {
    DEFAULT_INTEGRALS,
    computeIntegralValueBatch,
    computeIntegralValue,
} from '../../../utils/physics/integralValues.js';
import {
    BUILTIN_SOURCES,
    BUILTIN_DETECTORS,
    composeWeighting,
    parseSpectrumCSV,
} from '../../../utils/physics/spectralWeightings.js';
import { makeConeSpec, coneAverageResult, resolveEvalMode } from '../../../utils/physics/optimizer.js';
import { EvalModeBadge, ConeBadge } from '../../SurfaceModeBar.js';

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Spectrum computation ─────────────────────────────────────────────────────
//
// Integrals (Tvis, Rsol, custom weighted averages …) are weighted averages of
// the underlying T(λ)/R(λ)/A(λ) spectrum, so they must be scored against the
// SAME spectrum the rest of the app evaluates — i.e. the design's evaluation
// mode (resolveEvalMode → 'front' | 'back' | 'total'), which folds in both the
// Surface selector (Front/Back/Both/symmetric) and the "Ignore other side"
// flag set in the Design Editor:
//   'front' — front coating over a (bare-back) substrate   evaluateSpectrum
//   'back'  — back coating over the substrate, exit side    evaluateSpectrumBack
//   'total' — full system front + substrate + back          evaluateSpectrumTotal
// This mirrors the Optical Evaluation plot exactly (Macleod §2.6.4 for total).

function computeSpectrumForMode(design, params, evalMode) {
    const incMat  = resolveMaterial(design.incidentMedium);
    const subMat  = resolveMaterial(design.substrate.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const subThick = design.substrate.thickness ?? 1.0;

    const fLayers = (design.frontLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    const bLayers = (design.backLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));

    const computeAt = (th) => {
        const p = { ...params, theta: th };
        if (evalMode === 'front') return evaluateSpectrum(p, incMat, subMat, fLayers);
        if (evalMode === 'back')  return evaluateSpectrumBack(p, exitMat, subMat, bLayers);
        return evaluateSpectrumTotal(p, incMat, subMat, exitMat, fLayers, bLayers, subThick);
    };

    // Cone-angle averaging: params.theta is the cone axis; integrals
    // are computed from the cone-averaged spectrum (inactive cone → single call).
    const coneSpec = makeConeSpec(design.cone || {});
    return coneAverageResult(
        coneSpec, params.theta ?? 0, computeAt,
        ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp', 'As', 'Ap'],
    );
}

// ── Spectrum × weighting overlay chart ───────────────────────────────────────

// Line color per channel: T = blue, R = red, A = green.
function overlayCharColor(char) {
    return char === 'T' ? '#4fc3f7' : char === 'R' ? '#ef5350' : '#66bb6a';
}

// Normalized weighting curve (% of its own max) over the λ grid, or null when
// the weighting has no explicit sampler (e.g. the photopic built-in).
function overlayWeightVals(lam, weighting) {
    const sampler = weighting && weighting.kind !== 'photopic' ? weighting.sampler : null;
    if (!sampler) return null;
    const raw = lam.map(l =>
        (l >= weighting.lamMin && l <= weighting.lamMax) ? sampler(l) : 0);
    const mx = Math.max(...raw, 1e-30);
    return raw.map(v => 100 * v / mx);
}

function overlayTraces(spectrum, char, weighting, minMaxMarks) {
    const lam  = spectrum.lambda;
    const fArr = spectrum[char] || [];
    const data = [
        {
            x: lam, y: fArr.map(v => v * 100),
            type: 'scatter', mode: 'lines',
            name: `${char}(λ)`,
            line: { color: overlayCharColor(char), width: 2 },
            hovertemplate: `%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
        },
    ];
    const weightVals = overlayWeightVals(lam, weighting);
    if (weightVals) {
        data.push({
            x: lam, y: weightVals,
            type: 'scatter', mode: 'lines',
            name: `${weighting?.label || ''} (norm.)`,
            line: { color: '#ffd54f', width: 1, dash: 'dot' },
            yaxis: 'y',
            hovertemplate: `%{x:.1f} nm<br>w(λ): %{y:.1f}%<extra></extra>`,
        });
    }
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMin)) {
        data.push({
            x: [minMaxMarks.lamAtMin], y: [minMaxMarks.min * 100],
            type: 'scatter', mode: 'markers',
            name: `min ${(minMaxMarks.min * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMin.toFixed(0)} nm`,
            marker: { color: '#ef5350', size: 9, symbol: 'triangle-down', line: { color: '#fff', width: 1 } },
            hovertemplate: `min<br>%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
        });
    }
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMax)) {
        data.push({
            x: [minMaxMarks.lamAtMax], y: [minMaxMarks.max * 100],
            type: 'scatter', mode: 'markers',
            name: `max ${(minMaxMarks.max * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMax.toFixed(0)} nm`,
            marker: { color: '#66bb6a', size: 9, symbol: 'triangle-up', line: { color: '#fff', width: 1 } },
            hovertemplate: `max<br>%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
        });
    }
    return data;
}

function overlayLayout(char, colors) {
    return {
        paper_bgcolor: colors.panel,
        plot_bgcolor:  colors.bg,
        margin: { l: 52, r: 16, t: 16, b: 44 },
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: 'Wavelength (nm)', standoff: 8 },
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
        },
        yaxis: {
            title: { text: `${char} (%)  /  w(λ) (% max)`, standoff: 8 },
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: { size: 10 },
            rangemode: 'tozero',
        },
        legend: {
            x: 1, xanchor: 'right', y: 1, yanchor: 'top',
            bgcolor: colors.panel + 'cc', bordercolor: colors.grid, borderwidth: 1,
            font: { size: 10 },
        },
        hovermode: 'x unified',
    };
}

function buildOverlayFigure(spectrum, char, weighting, minMaxMarks, colors) {
    if (!spectrum?.lambda) return { data: [], layout: {} };
    return {
        data:   overlayTraces(spectrum, char, weighting, minMaxMarks),
        layout: overlayLayout(char, colors),
    };
}

function OverlayChart({ spectrum, char, weighting, c, theme, minMaxMarks }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const colors = {
        bg:    c.bg     || '#1e1e1e',
        panel: c.panel  || '#252526',
        grid:  c.border || '#3a3a3a',
        text:  c.text   || '#cccccc',
    };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildOverlayFigure(spectrum, char, weighting, minMaxMarks, colors);
        const config = { responsive: true, displaylogo: false, displayModeBar: false };
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, data, layout, config);
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, data, layout, config);
        }
    }, [spectrum, char, weighting, minMaxMarks, c.bg, c.panel, c.border, c.text]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        // Guard the resize call: the observer can fire while the chart is
        // hidden (modal overlay, dock layout reshuffle) or after a remount
        // where Plotly has lost its grip on the div. `offsetParent === null`
        // catches both `display:none` ancestors and detached subtrees.
        const ro = new ResizeObserver(() => {
            if (!initRef.current) return;
            if (!el.isConnected || el.offsetParent === null) return;
            try { Plotly.Plots.resize(el); } catch (_) {}
        });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}

// ── Spectrum table editor (modal, Excel-like) ─────────────────────────────────
//
// Two-column editable grid of [λ_nm, value] rows modeled on the n,k editor in
// MaterialEditor.js: arrow keys + Tab + Enter navigate cells, Enter past the
// last row appends a new row, Ctrl+C / Ctrl+V copy/paste TSV (Excel-compatible),
// Delete clears, type to start editing. Per-cell refs let focus follow keys.
// CSV import/export and clear sit in the footer.

function SpectrumTableEditor({ open, initialTable, label, onApply, onCancel, c, t }) {
    const iv = t.integralValues;
    const [rows, setRows] = useState(
        () => (initialTable?.length ? initialTable.map(r => [...r]) : [[0, 0], [0, 0]])
    );
    const [err, setErr] = useState(null);
    const [focusCell, setFocusCell] = useState(null); // {ri, ci}
    const inputRefs = useRef({});
    const fileRef = useRef(null);

    useEffect(() => {
        if (open) {
            setRows(initialTable?.length ? initialTable.map(r => [...r]) : [[0, 0], [0, 0]]);
            setErr(null);
            setFocusCell(null);
            inputRefs.current = {};
        }
    }, [open, initialTable]);

    // IMPORTANT: do not early-return before the hooks below. React's Rules of
    // Hooks require the call order to be identical across renders, and an
    // early `return null` here would cause `useCallback` to be skipped when
    // `open === false`, then re-introduced once it flips true → React crashes
    // with "Rendered more hooks than during the previous render".
    const refKey = (ri, ci) => `${ri}_${ci}`;
    const focusInput = useCallback((ri, ci) => {
        const el = inputRefs.current[refKey(ri, ci)];
        if (el) { el.focus(); el.select(); }
        setFocusCell({ ri, ci });
    }, []);

    const updateCell = (i, col, raw) => {
        const v = parseFloat(raw);
        setRows(rs => {
            const next = rs.map(r => [...r]);
            next[i][col] = Number.isFinite(v) ? v : raw;
            return next;
        });
    };

    const addRow = () => {
        setRows(rs => {
            const last = rs[rs.length - 1] || [0, 0];
            return [...rs, [Number.isFinite(last[0]) ? last[0] + 10 : 0, 0]];
        });
        // Focus the new row's first cell after the state commits
        const newIdx = rows.length;
        setTimeout(() => focusInput(newIdx, 0), 0);
    };
    const delRow = (i) => {
        if (rows.length <= 1) return;
        setRows(rs => rs.filter((_, j) => j !== i));
        // Keep focus near where the deletion happened
        const targetRow = Math.max(0, Math.min(i, rows.length - 2));
        setTimeout(() => focusInput(targetRow, focusCell?.ci ?? 0), 0);
    };
    const clear  = () => {
        setRows([[0, 0], [0, 0]]);
        setFocusCell(null);
    };

    // Arrow / Enter / Tab navigation
    const navigate = useCallback((ri, ci, dir) => {
        if (dir === 'down' || dir === 'up') {
            const nr = ri + (dir === 'down' ? 1 : -1);
            if (nr >= 0 && nr < rows.length) focusInput(nr, ci);
            else if (dir === 'down') addRow();
            return;
        }
        const dc = dir === 'right' ? 1 : -1;
        const nc = ci + dc;
        if (nc >= 0 && nc < 2) { focusInput(ri, nc); return; }
        const nr = ri + dc;
        if (nr >= 0 && nr < rows.length) focusInput(nr, dc > 0 ? 0 : 1);
    }, [rows.length, focusInput, addRow]);

    // Clipboard helpers (TSV — Excel-compatible)
    const copyRowsTsv = (ri) => {
        const tsv = rows.map(r => `${r[0]}\t${r[1]}`).join('\n');
        navigator.clipboard?.writeText(tsv).catch(() => {});
    };

    // Paste TSV / CSV / multi-row at the current cell. Multi-row pastes
    // overwrite from the focus row downward, extending the table if needed.
    const handlePaste = (ri, ci, e) => {
        const txt = e.clipboardData?.getData('text') || '';
        if (!/[\n;,\t]/.test(txt)) return;
        const parsed = parseSpectrumCSV(txt);
        if (parsed.length === 0) return;
        e.preventDefault();
        setRows(rs => {
            const next = rs.map(r => [...r]);
            for (let k = 0; k < parsed.length; k++) {
                const idx = ri + k;
                if (idx < next.length) next[idx] = parsed[k];
                else next.push(parsed[k]);
            }
            return next;
        });
    };

    const importCsv = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = parseSpectrumCSV(String(reader.result || ''));
                if (parsed.length < 2) { setErr(iv.tableNeedTwoRows); return; }
                setRows(parsed);
                setErr(null);
            } catch (er) { setErr(er.message || String(er)); }
        };
        reader.onerror = () => setErr(iv.csvErrorRead);
        reader.readAsText(file);
        e.target.value = '';
    };

    const exportCsv = () => {
        const text = '# λ_nm, value\n' +
                     rows.filter(r => Number.isFinite(r[0]) && Number.isFinite(r[1]))
                         .map(r => `${r[0]}, ${r[1]}`).join('\n') + '\n';
        const blob = new Blob([text], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (label || 'spectrum') + '.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    const apply = () => {
        const clean = rows
            .map(r => [parseFloat(r[0]), parseFloat(r[1])])
            .filter(r => Number.isFinite(r[0]) && Number.isFinite(r[1]))
            .sort((a, b) => a[0] - b[0]);
        if (clean.length < 2) { setErr(iv.tableNeedTwoRows); return; }
        onApply(clean);
    };

    const styles = {
        overlay: {
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        modal: {
            background: c.panel, color: c.text, border: `1px solid ${c.border}`,
            borderRadius: 6, width: 520, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
            boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
        },
        header: {
            padding: '8px 12px', borderBottom: `1px solid ${c.border}`,
            background: c.bg, fontWeight: 600,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
        body: { padding: '8px 12px', overflow: 'auto', flex: 1 },
        footer: {
            padding: '8px 12px', borderTop: `1px solid ${c.border}`, background: c.bg,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        },
        btn: {
            padding: '4px 12px', fontSize: 12, cursor: 'pointer',
            border: `1px solid ${c.border}`, borderRadius: 3,
            background: 'transparent', color: c.text, outline: 'none',
        },
        btnPrimary: {
            padding: '4px 14px', fontSize: 12, cursor: 'pointer',
            border: `1px solid ${c.accent}`, borderRadius: 3,
            background: c.accent + '33', color: c.text, outline: 'none', fontWeight: 600,
        },
        cellInput: {
            backgroundColor: 'transparent', color: c.text, border: 'none',
            fontSize: 12, padding: '2px 4px', fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none', width: '100%', boxSizing: 'border-box',
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
        },
        th: {
            padding: '3px 6px', textAlign: 'left', fontSize: 11,
            color: c.textDim, fontWeight: 600, letterSpacing: '0.03em',
            borderBottom: `1px solid ${c.border}`, userSelect: 'none',
            position: 'sticky', top: 0, background: c.panel, zIndex: 1,
        },
    };

    const tdStyle = (ri, ci) => {
        const isFocused = focusCell?.ri === ri && focusCell?.ci === ci;
        return {
            padding: 0,
            border: `1px solid ${isFocused ? c.accent : c.border}`,
            background: isFocused ? c.accent + '14'
                       : (ri % 2 === 0 ? 'transparent' : c.panel + 'aa'),
            outline: isFocused ? `1px solid ${c.accent}` : 'none',
            outlineOffset: -1,
        };
    };

    const cellKeyDown = (ri, ci) => (e) => {
        if (e.key === 'Enter')      { e.preventDefault(); navigate(ri, ci, 'down'); return; }
        if (e.key === 'Tab')        { e.preventDefault(); navigate(ri, ci, e.shiftKey ? 'left' : 'right'); return; }
        if (e.key === 'ArrowDown')  { e.preventDefault(); navigate(ri, ci, 'down'); return; }
        if (e.key === 'ArrowUp')    { e.preventDefault(); navigate(ri, ci, 'up'); return; }
        if (e.key === 'ArrowRight' && (e.target.selectionStart ?? 0) === (e.target.value?.length ?? 0)) {
            e.preventDefault(); navigate(ri, ci, 'right'); return;
        }
        if (e.key === 'ArrowLeft' && (e.target.selectionStart ?? 0) === 0) {
            e.preventDefault(); navigate(ri, ci, 'left'); return;
        }
        if (e.ctrlKey && e.key === 'Delete') { e.preventDefault(); delRow(ri); return; }
        if (e.ctrlKey && e.key === 'c') {
            const sel = window.getSelection?.()?.toString();
            if (!sel) {
                e.preventDefault();
                copyRowsTsv(ri);
            }
        }
    };

    // Hooks above are unconditional. The early bail-out for the closed modal
    // happens HERE, after all hooks have been called for this render.
    if (!open) return null;

    return h('div', { style: styles.overlay, onClick: e => { if (e.target === e.currentTarget) onCancel(); } },
        h('div', { style: styles.modal },
            h('div', { style: styles.header },
                h('span', null, `${iv.tableEditorTitle}${label ? ` — ${label}` : ''}`),
                h('button', { onClick: onCancel, style: { ...styles.btn, padding: '2px 8px' } }, '×'),
            ),
            h('div', { style: styles.body },
                h('div', { style: { color: c.textDim, fontSize: 11, marginBottom: 6 } }, iv.tableEditorHint),
                h('div', { style: { color: c.textDim, fontSize: 10, marginBottom: 8 } }, iv.tablePasteHint),
                h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 3, overflow: 'hidden' } },
                    h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 } },
                        h('colgroup', null,
                            h('col', { style: { width: '47%' } }),
                            h('col', { style: { width: '47%' } }),
                            h('col', { style: { width: '6%' } }),
                        ),
                        h('thead', null,
                            h('tr', null,
                                h('th', { style: styles.th }, iv.tableColLam),
                                h('th', { style: styles.th }, iv.tableColValue),
                                h('th', { style: styles.th }, ''),
                            ),
                        ),
                        h('tbody', null,
                            rows.map((r, ri) =>
                                h('tr', { key: ri },
                                    [0, 1].map(ci => h('td', { key: ci, style: tdStyle(ri, ci) },
                                        h('input', {
                                            ref: el => { if (el) inputRefs.current[refKey(ri, ci)] = el; else delete inputRefs.current[refKey(ri, ci)]; },
                                            type: 'number', step: 'any', value: r[ci],
                                            onChange: e => updateCell(ri, ci, e.target.value),
                                            onFocus: () => setFocusCell({ ri, ci }),
                                            onKeyDown: cellKeyDown(ri, ci),
                                            onPaste: e => handlePaste(ri, ci, e),
                                            style: styles.cellInput,
                                        })
                                    )),
                                    h('td', { style: { ...tdStyle(ri, 2), textAlign: 'center' } },
                                        h('button', {
                                            onClick: () => delRow(ri), tabIndex: -1, title: iv.tableDelRow,
                                            style: { background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }
                                        }, '×')
                                    ),
                                )
                            )
                        )
                    )
                ),
                h('div', { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    h('button', { onClick: addRow, style: styles.btn }, iv.tableAddRow),
                    h('button', { onClick: clear,  style: styles.btn }, iv.tableClear),
                    h('button', { onClick: () => fileRef.current?.click(), style: styles.btn }, iv.tableImport),
                    h('button', { onClick: exportCsv, style: styles.btn }, iv.tableExport),
                    h('input', { ref: fileRef, type: 'file', accept: '.csv,.txt,.tsv',
                                 onChange: importCsv, style: { display: 'none' } }),
                ),
                err && h('div', { style: { marginTop: 6, color: '#ef5350', fontSize: 11 } }, err),
            ),
            h('div', { style: styles.footer },
                h('span', { style: { color: c.textDim, fontSize: 10 } },
                    `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}  ·  Enter/↓ next  ·  Tab → next col  ·  paste CSV/TSV anywhere`),
                h('div', null,
                    h('button', { onClick: onCancel, style: { ...styles.btn, marginRight: 6 } }, iv.tableCancel),
                    h('button', { onClick: apply,    style: styles.btnPrimary }, iv.tableApply),
                ),
            ),
        ),
    );
}

// ── Custom-integral builder bar ───────────────────────────────────────────────

function CustomBuilder({
    builder, setBuilder, onAdd, openEditor, c, t,
}) {
    const iv = t.integralValues;
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel + 'aa', flexShrink: 0,
        }
    },
        h('span', { style: { ...labelStyle, color: c.text, fontWeight: 600 } }, iv.customBuilderTitle),

        // Channel
        h('label', { style: labelStyle }, iv.channel,
            h('select', {
                value: builder.char,
                onChange: e => setBuilder({ ...builder, char: e.target.value }),
                style: { ...inputStyle, marginLeft: 4, width: 50 },
            },
                h('option', { value: 'T' }, 'T'),
                h('option', { value: 'R' }, 'R'),
                h('option', { value: 'A' }, 'A'),
            ),
        ),

        // Source
        h('label', { style: labelStyle }, iv.source,
            h('select', {
                value: builder.source.id,
                onChange: e => setBuilder({ ...builder, source: { ...builder.source, id: e.target.value } }),
                style: { ...inputStyle, marginLeft: 4, width: 160 },
            },
                BUILTIN_SOURCES.map(s =>
                    h('option', { key: s.id, value: s.id }, s.label)),
            ),
        ),
        builder.source.id === 'blackbody' && h('label', { style: labelStyle },
            iv.sourceT,
            h('input', {
                type: 'number', value: builder.source.T ?? 5778,
                min: 100, max: 30000, step: 50,
                onChange: e => setBuilder({
                    ...builder,
                    source: { ...builder.source, T: parseFloat(e.target.value) || 5778 },
                }),
                style: { ...inputStyle, marginLeft: 4, width: 60 },
            }),
            h('span', { style: { marginLeft: 2, color: c.textDim } }, iv.sourceT_K),
        ),
        builder.source.id === 'custom' && h('button', {
            onClick: () => openEditor('source'),
            style: {
                padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                border: `1px solid ${c.border}`, borderRadius: 3,
                background: 'transparent', color: c.text, outline: 'none',
            },
        }, `${iv.editTable}${builder.source.table?.length ? ` (${builder.source.table.length})` : ''}`),

        // Detector
        h('label', { style: labelStyle }, iv.detector,
            h('select', {
                value: builder.detector.id,
                onChange: e => setBuilder({ ...builder, detector: { ...builder.detector, id: e.target.value } }),
                style: { ...inputStyle, marginLeft: 4, width: 180 },
            },
                BUILTIN_DETECTORS.map(d =>
                    h('option', { key: d.id, value: d.id }, d.label)),
            ),
        ),
        builder.detector.id === 'custom' && h('button', {
            onClick: () => openEditor('detector'),
            style: {
                padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                border: `1px solid ${c.border}`, borderRadius: 3,
                background: 'transparent', color: c.text, outline: 'none',
            },
        }, `${iv.editTable}${builder.detector.table?.length ? ` (${builder.detector.table.length})` : ''}`),

        // Band
        h('label', { style: labelStyle }, iv.band,
            h('input', {
                type: 'number', value: builder.bandMin, min: 0, max: 30000, step: 10,
                onChange: e => setBuilder({ ...builder, bandMin: parseFloat(e.target.value) || 0 }),
                style: { ...inputStyle, marginLeft: 4, width: 60 },
            }),
            h('span', { style: { margin: '0 4px', color: c.textDim } }, iv.bandTo),
            h('input', {
                type: 'number', value: builder.bandMax, min: 0, max: 30000, step: 10,
                onChange: e => setBuilder({ ...builder, bandMax: parseFloat(e.target.value) || 0 }),
                style: { ...inputStyle, width: 60 },
            }),
            h('span', { style: { marginLeft: 4, color: c.textDim } }, iv.bandNm),
        ),

        h('button', {
            onClick: onAdd, title: iv.addCustomTitle,
            style: {
                padding: '3px 12px', fontSize: 11, cursor: 'pointer',
                border: `1px solid ${c.accent}`, borderRadius: 3,
                background: c.accent + '22', color: c.text, outline: 'none',
                fontFamily: 'system-ui', fontWeight: 600,
            },
        }, iv.addCustom),
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function IntegralValues({ c, theme, t }) {
    const iv = t.integralValues;
    const { design, evalMode } = useDesign();

    const [params, setParams] = useState({
        lambdaStart: 300, lambdaEnd: 2500, lambdaStep: 5,
        theta: 0, polarization: 'avg',
    });

    // Custom integrals the user has added. Each entry:
    //   { key, label, char, sourceSpec, detectorSpec, band: [lamMin, lamMax] }
    // Persisted as one JSON per preset in Documents\TFStudio\IntegralPresets\.
    const [customDefs, setCustomDefs] = useState([]);
    const [presetsLoaded, setPresetsLoaded] = useState(false);

    // Load on mount
    useEffect(() => {
        let mounted = true;
        if (window?.electronAPI?.loadIntegralPresets) {
            window.electronAPI.loadIntegralPresets().then(r => {
                if (!mounted) return;
                if (r?.success && Array.isArray(r.presets)) {
                    setCustomDefs(r.presets);
                    // Bump counter past loaded keys so new presets don't collide
                    let maxN = 0;
                    for (const p of r.presets) {
                        const m = /^custom_(\d+)$/.exec(p.key || '');
                        if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
                    }
                    customCounterRef.current = maxN;
                }
                setPresetsLoaded(true);
            }).catch(() => { if (mounted) setPresetsLoaded(true); });
        } else {
            setPresetsLoaded(true);
        }
        return () => { mounted = false; };
    }, []);

    const persistPreset = useCallback((preset) => {
        if (!window?.electronAPI?.saveIntegralPreset) return;
        window.electronAPI.saveIntegralPreset(preset).catch(() => {});
    }, []);
    const dropPreset = useCallback((key) => {
        if (!window?.electronAPI?.deleteIntegralPreset) return;
        window.electronAPI.deleteIntegralPreset(key).catch(() => {});
    }, []);

    // Builder bar state
    const [builder, setBuilder] = useState({
        char: 'T',
        source:   { id: 'D65',      T: 5778, table: null },
        detector: { id: 'photopic', table: null },
        bandMin:  380,
        bandMax:  780,
    });

    // Modal editor state
    const [editor, setEditor] = useState({ open: false, target: null }); // target = 'source'|'detector'

    const [selKey, setSelKey] = useState('Tvis');
    const customCounterRef = useRef(0);

    const spectrum = useMemo(() => {
        if (!design) return null;
        try { return computeSpectrumForMode(design, params, evalMode); }
        catch (e) { return null; }
    }, [design, params, evalMode]);

    // Build the integrals list (built-in + custom)
    const integrals = useMemo(() => {
        const list = [...DEFAULT_INTEGRALS.map(d => ({ ...d, builtin: true }))];
        for (const cd of customDefs) {
            const weighting = composeWeighting({
                source:   cd.sourceSpec,
                detector: cd.detectorSpec,
                band:     cd.band,
                label:    cd.label + ' weight',
            });
            list.push({
                key:      cd.key,
                label:    cd.label,
                char:     cd.char,
                weighting,
                builtin:  false,
                _custom:  cd,
            });
        }
        return list;
    }, [customDefs]);

    const results = useMemo(() => {
        if (!spectrum) return null;
        return computeIntegralValueBatch(spectrum, integrals);
    }, [spectrum, integrals]);

    const selected = integrals.find(i => i.key === selKey) || integrals[0];
    const selectedResult = results && selected ? results[selected.key] : null;

    // ── Custom integral add / remove ──────────────────────────────────────────

    const onAddCustom = () => {
        const n = ++customCounterRef.current;
        const srcLbl = builder.source.id === 'blackbody'
            ? `BB${Math.round(builder.source.T || 5778)}K`
            : (builder.source.id === 'custom' ? 'srcTbl' : builder.source.id);
        const detLbl = builder.detector.id === 'custom' ? 'detTbl'
                     : builder.detector.id === 'photopic' ? 'V(λ)' : 'flat';
        const baseLabel = `${builder.char}·${srcLbl}·${detLbl}`;
        const def = {
            key:          `custom_${n}`,
            label:        `${baseLabel} #${n}`,
            char:         builder.char,
            sourceSpec:   { ...builder.source, table: builder.source.table ? [...builder.source.table] : null },
            detectorSpec: { ...builder.detector, table: builder.detector.table ? [...builder.detector.table] : null },
            band:         [builder.bandMin, builder.bandMax],
        };
        setCustomDefs(d => [...d, def]);
        setSelKey(def.key);
        persistPreset(def);
    };

    const onRemoveCustom = (key) => {
        setCustomDefs(d => d.filter(x => x.key !== key));
        if (selKey === key) setSelKey('Tvis');
        dropPreset(key);
    };

    // Patch one field on a saved custom preset (band / channel / label).
    const onPatchCustom = (key, patch) => {
        setCustomDefs(d => d.map(cd => {
            if (cd.key !== key) return cd;
            const next = { ...cd, ...patch };
            persistPreset(next);
            return next;
        }));
    };

    // ── Table editor open/apply ───────────────────────────────────────────────
    const openEditor = (target) => setEditor({ open: true, target });
    const applyTable = (table) => {
        if (editor.target === 'source') {
            setBuilder(b => ({ ...b, source: { ...b.source, table } }));
        } else if (editor.target === 'detector') {
            setBuilder(b => ({ ...b, detector: { ...b.detector, table } }));
        }
        setEditor({ open: false, target: null });
    };

    // ── Render guards ─────────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);

    if (!design) return placeholder(iv.noDesign);
    // Mode-aware guard: 'back' needs back layers, 'front' needs front layers,
    // 'total' accepts either side (the missing side is just a bare interface).
    const hasFront = !!design.frontLayers?.length;
    const hasBack  = !!design.backLayers?.length;
    const hasLayers = evalMode === 'back' ? hasBack
                    : evalMode === 'front' ? hasFront
                    : (hasFront || hasBack);
    if (!hasLayers) return placeholder(iv.noLayers);

    // ── Styles ────────────────────────────────────────────────────────────────
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const thBase = {
        padding: '4px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        textAlign: 'right', whiteSpace: 'nowrap', color: c.textDim,
    };
    const tdBase = {
        padding: '3px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right',
    };

    const editorInitial =
        editor.open && editor.target === 'source'   ? builder.source.table :
        editor.open && editor.target === 'detector' ? builder.detector.table : null;
    const editorLabel =
        editor.target === 'source'   ? iv.source :
        editor.target === 'detector' ? iv.detector : '';

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        // ── Top controls (λ grid + AOI/pol) ───────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
            }
        },
            h('label', { style: labelStyle }, iv.lambdaRange,
                h('input', {
                    type: 'number', value: params.lambdaStart, min: 100, max: 3000, step: 10,
                    onChange: e => setParams(p => ({ ...p, lambdaStart: parseFloat(e.target.value) || 100 })),
                    style: { ...inputStyle, marginLeft: 6, width: 60 }
                }),
                h('span', { style: { margin: '0 4px', color: c.textDim } }, '–'),
                h('input', {
                    type: 'number', value: params.lambdaEnd, min: 100, max: 3000, step: 10,
                    onChange: e => setParams(p => ({ ...p, lambdaEnd: parseFloat(e.target.value) || 2500 })),
                    style: { ...inputStyle, width: 60 }
                })
            ),
            h('label', { style: labelStyle }, iv.step,
                h('input', {
                    type: 'number', value: params.lambdaStep, min: 0.5, max: 50, step: 0.5,
                    onChange: e => setParams(p => { const v = parseFloat(e.target.value); return { ...p, lambdaStep: v > 0 ? v : 5 }; }),
                    style: { ...inputStyle, marginLeft: 6, width: 50 }
                })
            ),
            h('label', { style: labelStyle }, iv.aoi,
                h('input', {
                    type: 'number', value: params.theta, min: 0, max: 89, step: 1,
                    onChange: e => setParams(p => ({ ...p, theta: parseFloat(e.target.value) || 0 })),
                    style: { ...inputStyle, marginLeft: 6, width: 50 }
                })
            ),
            h('label', { style: labelStyle }, iv.pol,
                h('select', {
                    value: params.polarization,
                    onChange: e => setParams(p => ({ ...p, polarization: e.target.value })),
                    style: { ...inputStyle, marginLeft: 6, width: 70 }
                },
                    h('option', { value: 'avg' }, 'avg'),
                    h('option', { value: 's' }, 's'),
                    h('option', { value: 'p' }, 'p')
                )
            ),
        ),

        // ── Custom integral builder ──────────────────────────────────────────
        h(CustomBuilder, {
            builder, setBuilder, onAdd: onAddCustom, openEditor, c, t,
        }),

        // ── Body: table + overlay ────────────────────────────────────────────
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' } },
            // Left: results table
            h('div', {
                style: {
                    flex: '0 0 660px', minHeight: 0, overflow: 'auto',
                    background: c.bg, borderRight: `1px solid ${c.border}`,
                }
            },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null,
                        h('tr', null,
                            h('th', { style: { ...thBase, textAlign: 'left' } }, iv.col_integral),
                            h('th', { style: thBase }, iv.col_value),
                            h('th', { style: thBase }, '%'),
                            h('th', { style: thBase }, iv.col_min),
                            h('th', { style: thBase }, iv.col_max),
                            h('th', { style: { ...thBase, textAlign: 'left' } }, iv.col_band),
                            h('th', { style: { ...thBase, width: 28 } }, iv.col_actions),
                        )
                    ),
                    h('tbody', null,
                        results
                            ? integrals.map((def, i) => {
                                const r = results[def.key];
                                const sel = def.key === selKey;
                                const bandStr = (def.weighting.lamMin === def.weighting.lamMax)
                                    ? '—'
                                    : `${def.weighting.lamMin.toFixed(0)}–${def.weighting.lamMax.toFixed(0)} nm`;
                                const fmtMM = (v, lam) => (Number.isFinite(v) && Number.isFinite(lam))
                                    ? `${(v * 100).toFixed(2)}% @${lam.toFixed(0)}`
                                    : '—';
                                const stopRow = (e) => e.stopPropagation();
                                // Custom rows: name/channel/band are inline-editable.
                                const isCustom = !def.builtin;
                                const cd = isCustom ? def._custom : null;
                                const editInputStyle = {
                                    background: 'transparent', color: c.text,
                                    border: `1px solid transparent`, borderRadius: 2,
                                    padding: '0 2px', fontSize: 11, width: 60,
                                    fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                                    outline: 'none',
                                };
                                const editInputHover = (e) => { e.target.style.border = `1px solid ${c.border}`; };
                                const editInputBlur  = (e) => { e.target.style.border = `1px solid transparent`; };
                                return h('tr', {
                                    key: def.key,
                                    onClick: () => setSelKey(def.key),
                                    style: {
                                        cursor: 'pointer',
                                        background: sel ? c.accent + '22'
                                                        : (i % 2 === 0 ? 'transparent' : c.panel + '55'),
                                    },
                                    title: def.weighting.reference,
                                },
                                    h('td', { style: { ...tdBase, textAlign: 'left',
                                                       color: sel ? c.accent : c.text,
                                                       fontWeight: sel ? 600 : 400 } },
                                        isCustom
                                            ? h('input', {
                                                type: 'text', value: cd.label,
                                                onClick: stopRow,
                                                onChange: e => onPatchCustom(cd.key, { label: e.target.value }),
                                                onFocus: editInputHover, onBlur: editInputBlur,
                                                style: { ...editInputStyle, width: 'calc(100% - 4px)', textAlign: 'left',
                                                         color: sel ? c.accent : c.text,
                                                         fontWeight: sel ? 600 : 400 },
                                            })
                                            : def.label
                                    ),
                                    h('td', { style: { ...tdBase, color: c.text } },
                                        r ? r.value.toFixed(5) : '—'),
                                    h('td', { style: { ...tdBase, color: c.textDim } },
                                        r ? (r.value * 100).toFixed(3) : '—'),
                                    h('td', { style: { ...tdBase, color: c.textDim } },
                                        r ? fmtMM(r.min, r.lamAtMin) : '—'),
                                    h('td', { style: { ...tdBase, color: c.textDim } },
                                        r ? fmtMM(r.max, r.lamAtMax) : '—'),
                                    h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim,
                                                       padding: '2px 4px' } },
                                        isCustom
                                            ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
                                                h('select', {
                                                    value: cd.char, onClick: stopRow,
                                                    onChange: e => onPatchCustom(cd.key, { char: e.target.value }),
                                                    style: { ...editInputStyle, width: 38, textAlign: 'left' },
                                                    onFocus: editInputHover, onBlur: editInputBlur,
                                                },
                                                    h('option', { value: 'T' }, 'T'),
                                                    h('option', { value: 'R' }, 'R'),
                                                    h('option', { value: 'A' }, 'A'),
                                                ),
                                                h('input', {
                                                    type: 'number', value: cd.band[0],
                                                    onClick: stopRow,
                                                    onChange: e => {
                                                        const v = parseFloat(e.target.value);
                                                        if (Number.isFinite(v)) onPatchCustom(cd.key, { band: [v, cd.band[1]] });
                                                    },
                                                    onFocus: editInputHover, onBlur: editInputBlur,
                                                    style: { ...editInputStyle, width: 56 },
                                                }),
                                                h('span', { style: { color: c.textDim } }, '–'),
                                                h('input', {
                                                    type: 'number', value: cd.band[1],
                                                    onClick: stopRow,
                                                    onChange: e => {
                                                        const v = parseFloat(e.target.value);
                                                        if (Number.isFinite(v)) onPatchCustom(cd.key, { band: [cd.band[0], v] });
                                                    },
                                                    onFocus: editInputHover, onBlur: editInputBlur,
                                                    style: { ...editInputStyle, width: 56 },
                                                }),
                                                h('span', { style: { color: c.textDim, fontSize: 10 } }, 'nm'),
                                              )
                                            : bandStr
                                    ),
                                    h('td', { style: { ...tdBase, textAlign: 'center', padding: '0 4px' } },
                                        isCustom
                                            ? h('button', {
                                                onClick: (e) => { e.stopPropagation(); onRemoveCustom(def.key); },
                                                title: iv.removeRow,
                                                style: {
                                                    padding: '0 6px', fontSize: 11, cursor: 'pointer',
                                                    border: `1px solid ${c.border}`, borderRadius: 3,
                                                    background: 'transparent', color: c.textDim,
                                                    outline: 'none',
                                                },
                                            }, '×')
                                            : null
                                    ),
                                );
                              })
                            : h('tr', null,
                                h('td', { colSpan: 7, style: { ...tdBase, color: c.textDim, padding: 16, textAlign: 'center' } },
                                    iv.computing)
                            )
                    )
                )
            ),
            // Right: overlay chart
            h('div', {
                style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
            },
                h('div', {
                    style: {
                        padding: '4px 10px', fontSize: 11, color: c.textDim,
                        borderBottom: `1px solid ${c.border}`, background: c.panel + '55',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }
                }, selected
                    ? `${selected.label}: ${selected.char}(λ) × ${selected.weighting.label}  — ${selected.weighting.reference}`
                    : ''
                ),
                h('div', { style: { flex: 1, minHeight: 0 } },
                    spectrum && selected
                        ? h(OverlayChart, {
                            spectrum, char: selected.char, weighting: selected.weighting,
                            minMaxMarks: selectedResult, c, theme,
                          })
                        : placeholder(iv.computing)
                )
            )
        ),

        // ── Bottom status ─────────────────────────────────────────────────────
        h('div', {
            style: {
                padding: '3px 10px', borderTop: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 12,
                fontSize: 11, color: c.textDim,
            }
        },
            h('span', null, design.name),
            spectrum && h('span', null,
                `${spectrum.lambda.length} λ samples, ${params.lambdaStart}–${params.lambdaEnd} nm @ ${params.lambdaStep} nm`),
            h(EvalModeBadge, { design, c, t }),
            h(ConeBadge, { design, c, t }),
            customDefs.length > 0 && h('span', null,
                `· ${customDefs.length} custom`),
        ),

        // ── Modal table editor ────────────────────────────────────────────────
        h(SpectrumTableEditor, {
            open:         editor.open,
            initialTable: editorInitial,
            label:        editorLabel,
            onApply:      applyTable,
            onCancel:     () => setEditor({ open: false, target: null }),
            c, t,
        }),
    );
}
