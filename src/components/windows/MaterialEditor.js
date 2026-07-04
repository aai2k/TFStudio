/**
 * Material Editor — browse, import, and create optical material catalogs.
 *
 * Layout:
 *   Left panel:   catalog filter tabs + search + material list
 *   Right panel:  read-only details for builtin/AGF materials;
 *                 editable form for user-catalog materials
 *
 * User catalogs support two material types:
 *   tabular   — wavelength / n / k table (formulaNum === -1)
 *   formula   — one of 13 Zemax dispersion formulas + optional k table
 */

import {
    getCatalogs, getMaterialById, searchMaterials,
    addCatalog, removeCatalog, ndColor, resolveColor,
    createUserCatalog, saveUserMaterial, removeUserMaterial, generateMaterialId,
    duplicateCatalog, copyMaterialToCatalog, importMaterialsIntoCatalog,
} from '../../utils/materials/catalogManager.js';
import { parseAGF } from '../../utils/materials/agfParser.js';
import { buildOptiLayerCatalog } from '../../utils/materials/optilayerParser.js';
import { FORMULA_LATEX, evalN } from '../../utils/materials/dispersionFormulas.js';
import { RIIBrowser } from './RIIBrowser.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── KaTeX renderer ────────────────────────────────────────────────────────────

function KaTeXSpan({ latex, displayMode }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || !window.katex) return;
        try {
            window.katex.render(latex, ref.current, { displayMode: !!displayMode, throwOnError: false, strict: false });
        } catch (_) { if (ref.current) ref.current.textContent = latex; }
    }, [latex, displayMode]);
    return h('span', { ref });
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function dotStyle(color, size = 10) {
    return { width: size, height: size, borderRadius: '50%', backgroundColor: color || '#888', flexShrink: 0, display: 'inline-block' };
}

function statusBadge(status, t) {
    const colors = ['#5dade2','#58d68d','#ec7063','#f39c12','#a569bd'];
    return h('span', {
        style: { fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: (colors[status] || '#888') + '33', color: colors[status] || '#888', fontWeight: 600 }
    }, t.materialEditor.status(status));
}

function propRow(label, value, c) {
    return [
        h('span', { key: label + 'L', style: { color: c.textDim, whiteSpace: 'nowrap', paddingBottom: 2 } }, label),
        h('span', { key: label + 'V', style: { color: c.text, paddingBottom: 2 } }, value)
    ];
}

function formatCoeff(v) {
    if (Math.abs(v) >= 0.001 && Math.abs(v) < 10000) return v.toPrecision(7).replace(/\.?0+$/, '');
    return v.toExponential(4);
}

function catTabStyle(active, c) {
    return {
        padding: '2px 7px', fontSize: 11,
        border: `1px solid ${active ? c.accent : c.border}`, borderRadius: 3,
        backgroundColor: active ? c.accent + '33' : 'transparent',
        color: active ? c.accent : c.textDim,
        cursor: 'pointer', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
}

function smallBtn(c, extra) {
    return {
        padding: '2px 7px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3,
        backgroundColor: c.panel, color: c.text, cursor: 'pointer', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif', ...extra
    };
}

// ── Preset dot colors for user materials ──────────────────────────────────────

const PRESET_COLORS = [
    '#c39bd3','#85c1e9','#82e0aa','#f8c471','#f1948a',
    '#aab7b8','#5dade2','#58d68d','#eb984e','#ec7063',
    '#a569bd','#45b39d','#d4ac0d','#ba4a00','#148f77',
];

function nextPresetColor(current) {
    const idx = PRESET_COLORS.indexOf(current);
    return PRESET_COLORS[(idx + 1) % PRESET_COLORS.length];
}

// ── Draft ↔ material converters ───────────────────────────────────────────────

function emptyDraft(catalogId) {
    return {
        catalogId,
        isNew: true,
        idAuto: true,
        id: '',
        name: '',
        color: 'auto',
        lambdaMinNm: '300',
        lambdaMaxNm: '2500',
        type: 'tabular',
        rows: [],
        formulaNum: 2,
        coeffs: Array(10).fill(''),
        kRows: [],
        _rowSeq: 0,
    };
}

function materialToDraft(catalogId, mat) {
    const isTab = mat.formulaNum === -1;
    // formulaNum === 0 means "built-in JS function" — no stored formula/tabular data,
    // must sample getNK to produce tabular data when copying to a user catalog.
    const isBuiltin = mat.formulaNum === 0 && typeof mat.getNK === 'function';

    // Sanitize legacy RII IDs that contain colons (old separator before the fix).
    // originalId tracks the stored key so save/delete can find and remove the old entry.
    // A catalog material's id should always be set (the registry backfills it
    // from the map key), but guard anyway so a malformed entry can never crash
    // the click handler — fall back to originalId / name / 'material'.
    const rawId = mat.id || mat.originalId || mat.name || 'material';
    const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_');
    let seq = 0;

    // Sample builtin getNK over the material's wavelength range
    let builtinRows = [];
    if (isBuiltin) {
        const smin = Math.max(100, Math.round((mat.lambdaMin || 0.2) * 1000));
        const smax = Math.min(25000, Math.round((mat.lambdaMax || 2.5) * 1000));
        const N = 200;
        for (let i = 0; i < N; i++) {
            const lam = Math.round(smin + (i / (N - 1)) * (smax - smin));
            try {
                const [n, k] = mat.getNK(lam);
                if (isFinite(n)) builtinRows.push({ _key: seq++, lam: String(lam), n: String(+n.toFixed(6)), k: String(+(k || 0).toFixed(8)) });
            } catch (_) { /* skip invalid points */ }
        }
    }

    return {
        catalogId,
        isNew: false,
        idAuto: false,
        id: safeId,
        originalId: mat.id,         // actual key in catalog.materials (may differ from safeId)
        dataPath:  mat.dataPath  || null,
        sourceUrl: mat.sourceUrl || null,
        name: mat.name || mat.id,
        color: mat.color || 'auto',   // no stored color → automatic (index-derived)
        lambdaMinNm: String(Math.round((mat.lambdaMin || 0.3) * 1000)),
        lambdaMaxNm: String(Math.round((mat.lambdaMax || 2.5) * 1000)),
        type: (isTab || isBuiltin) ? 'tabular' : 'formula',
        isRii: !!mat.dataPath,   // true for refractiveindex.info imports — hides Zemax formula UI
        rows: isTab
            ? (mat.tabData || []).map(r => ({ _key: seq++, lam: String(r[0]), n: String(r[1]), k: String(r[2] || 0) }))
            : builtinRows,
        formulaNum: (isTab || isBuiltin) ? 2 : (mat.formulaNum || 2),
        coeffs: (isTab || isBuiltin) ? Array(10).fill('') : padCoeffs(mat.coefficients || []),
        kRows: (!isTab && !isBuiltin && mat.kTable)
            ? mat.kTable.map(r => ({ _key: seq++, lam: String(Math.round(r.lam_um * 1000)), k: String(r.k) }))
            : [],
        _rowSeq: seq,
    };
}

function padCoeffs(arr) {
    const r = arr.map(String);
    while (r.length < 10) r.push('');
    return r;
}

function draftToMaterial(draft) {
    const id = draft.id.trim() || 'material';
    const lambdaMin = Math.max(0.1, (parseFloat(draft.lambdaMinNm) || 300) / 1000);
    const lambdaMax = Math.max(lambdaMin + 0.1, (parseFloat(draft.lambdaMaxNm) || 2500) / 1000);

    if (draft.type === 'tabular') {
        const tabData = draft.rows
            .map(r => [parseFloat(r.lam), parseFloat(r.n), parseFloat(r.k) || 0])
            .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
            .sort((a, b) => a[0] - b[0]);
        const lMin = tabData.length > 0 ? tabData[0][0] / 1000 : lambdaMin;
        const lMax = tabData.length > 1 ? tabData[tabData.length - 1][0] / 1000 : lambdaMax;
        return {
            id, name: draft.name.trim() || id, formulaNum: -1,
            tabData, lambdaMin: lMin, lambdaMax: lMax,
            coefficients: [], kTable: [],
            color: draft.color, group: 'User', comment: '',
            nd: null, vd: null, density: null,
            ...(draft.dataPath  ? { dataPath:  draft.dataPath  } : {}),
            ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {}),
        };
    } else {
        const coefficients = draft.coeffs.map(v => parseFloat(v) || 0);
        const kTable = draft.kRows
            .map(r => ({ lam_um: (parseFloat(r.lam) || 0) / 1000, k: parseFloat(r.k) || 0 }))
            .filter(r => r.lam_um > 0)
            .sort((a, b) => a.lam_um - b.lam_um);
        return {
            id, name: draft.name.trim() || id, formulaNum: draft.formulaNum,
            coefficients, kTable, tabData: [],
            lambdaMin, lambdaMax,
            color: draft.color, group: 'User', comment: '',
            nd: null, vd: null, density: null,
        };
    }
}

function validateDraft(draft, catalogs, me) {
    if (!draft.name.trim()) return me.validationNoName;
    const idTrimmed = draft.id.trim();
    if (!idTrimmed || !/^[a-zA-Z0-9_-]+$/.test(idTrimmed)) return me.validationBadId;
    if (draft.isNew) {
        const cat = catalogs.find(c => c.id === draft.catalogId);
        if (cat?.materials?.[idTrimmed]) return me.validationDuplicateId(idTrimmed);
    }
    return null;
}

// ── Build a live getNK function from a draft (for preview chart) ──────────────

function buildNKFromDraft(draft) {
    if (draft.type === 'tabular') {
        const data = draft.rows
            .map(r => [parseFloat(r.lam), parseFloat(r.n), parseFloat(r.k) || 0])
            .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
            .sort((a, b) => a[0] - b[0]);
        if (data.length === 0) return null;
        if (data.length === 1) return () => [data[0][1], data[0][2]];
        return (lam) => {
            if (lam <= data[0][0]) return [data[0][1], data[0][2]];
            const last = data[data.length - 1];
            if (lam >= last[0]) return [last[1], last[2]];
            let lo = 0, hi = data.length - 1;
            while (hi - lo > 1) { const m = (lo + hi) >> 1; if (data[m][0] <= lam) lo = m; else hi = m; }
            const frac = (lam - data[lo][0]) / (data[hi][0] - data[lo][0]);
            return [data[lo][1] + frac * (data[hi][1] - data[lo][1]), data[lo][2] + frac * (data[hi][2] - data[lo][2])];
        };
    } else {
        const coefficients = draft.coeffs.map(v => parseFloat(v) || 0);
        const kTable = draft.kRows
            .map(r => ({ lam_um: (parseFloat(r.lam) || 0) / 1000, k: parseFloat(r.k) || 0 }))
            .filter(r => r.lam_um > 0)
            .sort((a, b) => a.lam_um - b.lam_um);
        function interpK(lam_um) {
            if (!kTable.length) return 0;
            if (lam_um <= kTable[0].lam_um) return kTable[0].k;
            const last = kTable[kTable.length - 1];
            if (lam_um >= last.lam_um) return last.k;
            let lo = 0, hi = kTable.length - 1;
            while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kTable[m].lam_um <= lam_um) lo = m; else hi = m; }
            const frac = (lam_um - kTable[lo].lam_um) / (kTable[hi].lam_um - kTable[lo].lam_um);
            return kTable[lo].k + frac * (kTable[hi].k - kTable[lo].k);
        }
        try {
            const testN = evalN(draft.formulaNum, coefficients, 0.55);
            if (!isFinite(testN) || testN <= 0) return null;
        } catch (_) { return null; }
        return (lam_nm) => {
            const lum = lam_nm / 1000;
            const n = evalN(draft.formulaNum, coefficients, lum);
            return [isFinite(n) ? Math.max(0, n) : 1.5, interpK(lum)];
        };
    }
}

// ── Excel-like grid for tabular n/k data ─────────────────────────────────────

/**
 * cols: [{key, label, width}]
 * rows: [{_key, ...values}]
 * onEdit(key, field, value)
 * onDelete(key)
 * onAdd()
 * onPasteRows([{...values}])   — called with parsed TSV rows
 */
function NKDataGrid({ cols, rows, onEdit, onDelete, onAdd, onPasteRows, c, addLabel, sortBtn }) {
    // focusCell: {rowIdx, colIdx} — which cell is active
    const [focusCell, setFocusCell] = useState(null);
    const inputRefs   = useRef({}); // key: `${rowIdx}_${colIdx}` → input DOM node
    const containerRef = useRef(null);

    const refKey = (ri, ci) => `${ri}_${ci}`;

    const focusInput = useCallback((ri, ci) => {
        const el = inputRefs.current[refKey(ri, ci)];
        if (el) { el.focus(); el.select(); }
        setFocusCell({ rowIdx: ri, colIdx: ci });
    }, []);

    // Navigate to adjacent cell
    const navigate = useCallback((ri, ci, dir) => {
        if (dir === 'down' || dir === 'up') {
            const nr = ri + (dir === 'down' ? 1 : -1);
            if (nr >= 0 && nr < rows.length) focusInput(nr, ci);
            else if (dir === 'down') onAdd(); // add row when Enter past last row
            return;
        }
        const dc = dir === 'right' ? 1 : -1;
        const nc = ci + dc;
        if (nc >= 0 && nc < cols.length) { focusInput(ri, nc); return; }
        // wrap to next/prev row
        const nr = ri + dc;
        if (nr >= 0 && nr < rows.length) {
            focusInput(nr, dc > 0 ? 0 : cols.length - 1);
        }
    }, [rows, cols, focusInput, onAdd]);

    // Container keydown — handles Delete and Ctrl+C/V when no input is focused
    const onContainerKeyDown = useCallback((e) => {
        // Only act when the container itself (not a child input) is focused
        if (e.target !== containerRef.current) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && focusCell) {
            e.preventDefault();
            const row = rows[focusCell.rowIdx];
            if (row) onDelete(row._key);
        }
        if (e.ctrlKey && e.key === 'c' && focusCell) {
            e.preventDefault();
            const row = rows[focusCell.rowIdx];
            if (row) {
                const tsv = cols.map(col => row[col.key] ?? '').join('\t');
                navigator.clipboard?.writeText(tsv).catch(() => {});
            }
        }
        if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            navigator.clipboard?.readText().then(text => {
                const lines = text.trim().split(/\r?\n/);
                const parsed = lines.map(line => {
                    const parts = line.split('\t');
                    const obj = {};
                    cols.forEach((col, i) => { obj[col.key] = parts[i] ?? ''; });
                    return obj;
                });
                onPasteRows(parsed);
            }).catch(() => {});
        }
    }, [focusCell, rows, cols, onDelete, onPasteRows]);

    const inputStyle = {
        backgroundColor: 'transparent', color: c.text, border: 'none',
        fontSize: 11, padding: '1px 3px', fontFamily: 'system-ui, -apple-system, sans-serif',
        outline: 'none', width: '100%', boxSizing: 'border-box',
    };

    const thStyle = {
        padding: '2px 4px', textAlign: 'left', fontSize: 10,
        color: c.textDim, fontWeight: 600, letterSpacing: '0.04em',
        borderBottom: `1px solid ${c.border}`, userSelect: 'none',
        position: 'sticky', top: 0, background: c.panel, zIndex: 1,
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('button', { onClick: onAdd, style: { padding: '2px 8px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3, background: c.panel, color: c.text, cursor: 'pointer', fontFamily: 'inherit' } }, addLabel || '+ Add'),
            sortBtn,
        ),
        rows.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11, fontStyle: 'italic', padding: '2px 0' } }, 'No data. Click Add or paste (Ctrl+V).')
            : h('div', {
                ref: containerRef,
                tabIndex: 0,
                onKeyDown: onContainerKeyDown,
                style: { outline: 'none', border: `1px solid ${c.border}`, borderRadius: 3, overflow: 'hidden', fontSize: 11 }
              },
                h('table', { style: { borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%' } },
                    h('colgroup', null,
                        cols.map(col => h('col', { key: col.key, style: { width: col.width } })),
                        h('col', { style: { width: 22 } })
                    ),
                    h('thead', null,
                        h('tr', null,
                            cols.map(col => h('th', { key: col.key, style: thStyle }, col.label)),
                            h('th', { style: thStyle })
                        )
                    ),
                    h('tbody', null,
                        rows.map((row, ri) =>
                            h('tr', {
                                key: row._key,
                                style: { backgroundColor: focusCell?.rowIdx === ri ? c.accent + '18' : (ri % 2 === 0 ? 'transparent' : c.panel + 'aa') }
                            },
                                cols.map((col, ci) => {
                                    const isFocused = focusCell?.rowIdx === ri && focusCell?.colIdx === ci;
                                    return h('td', {
                                        key: col.key,
                                        style: {
                                            padding: 0,
                                            border: `1px solid ${isFocused ? c.accent : c.border}`,
                                            outline: isFocused ? `1px solid ${c.accent}` : 'none',
                                            outlineOffset: -1,
                                        }
                                    },
                                        h('input', {
                                            ref: el => { if (el) inputRefs.current[refKey(ri, ci)] = el; else delete inputRefs.current[refKey(ri, ci)]; },
                                            value: row[col.key] ?? '',
                                            onChange: e => onEdit(row._key, col.key, e.target.value),
                                            onFocus: () => setFocusCell({ rowIdx: ri, colIdx: ci }),
                                            onKeyDown: e => {
                                                if (e.key === 'Enter')     { e.preventDefault(); navigate(ri, ci, 'down'); }
                                                if (e.key === 'Tab')       { e.preventDefault(); navigate(ri, ci, e.shiftKey ? 'left' : 'right'); }
                                                if (e.key === 'ArrowDown') { e.preventDefault(); navigate(ri, ci, 'down'); }
                                                if (e.key === 'ArrowUp')   { e.preventDefault(); navigate(ri, ci, 'up'); }
                                                if (e.key === 'Delete' && e.ctrlKey) { e.preventDefault(); onDelete(row._key); }
                                                if (e.ctrlKey && e.key === 'c') {
                                                    // let browser copy selection; if no selection, copy row
                                                    const sel = window.getSelection?.()?.toString();
                                                    if (!sel) {
                                                        e.preventDefault();
                                                        const tsv = cols.map(c2 => row[c2.key] ?? '').join('\t');
                                                        navigator.clipboard?.writeText(tsv).catch(() => {});
                                                    }
                                                }
                                                if (e.ctrlKey && e.key === 'v') {
                                                    e.preventDefault();
                                                    navigator.clipboard?.readText().then(text => {
                                                        const lines = text.trim().split(/\r?\n/);
                                                        const parsed = lines.map(line => {
                                                            const parts = line.split('\t');
                                                            const obj = {};
                                                            cols.forEach((col2, i2) => { obj[col2.key] = parts[i2] ?? ''; });
                                                            return obj;
                                                        });
                                                        onPasteRows(parsed);
                                                    }).catch(() => {});
                                                }
                                            },
                                            style: inputStyle,
                                        })
                                    );
                                }),
                                h('td', { style: { padding: 0, border: `1px solid ${c.border}`, textAlign: 'center', width: 22 } },
                                    h('button', {
                                        onClick: () => onDelete(row._key),
                                        tabIndex: -1,
                                        style: { background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', fontSize: 13, padding: '0 3px', lineHeight: 1 }
                                    }, '×')
                                )
                            )
                        )
                    )
                )
              )
    );
}

// ── UserMaterialForm ──────────────────────────────────────────────────────────

function UserMaterialForm({ draft, onChange, onSave, onDelete, onCopy, catalogs, c, t }) {
    const me = t.materialEditor;
    const chartRef = useRef(null);
    const seqRef = useRef(draft._rowSeq || (draft.rows.length + draft.kRows.length + 100));

    function nextKey() { return ++seqRef.current; }

    // Live n/k chart
    useEffect(() => {
        if (!chartRef.current || !window.Plotly) return;
        const getNK = buildNKFromDraft(draft);
        if (!getNK) { window.Plotly.purge(chartRef.current); return; }

        // Follow the material's actual range (in nm here) — no fixed visible/NIR clamp,
        // so EUV (<200 nm) and far-IR (>10 µm) materials plot correctly. Guarantee order.
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
        window.Plotly.react(chartRef.current, traces, layout, { responsive: true, displayModeBar: false });
    }, [draft, c]);

    // Helpers for draft field updates
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

    // Material color: an explicit picked preset, or "automatic" (derived from
    // the refractive index — the same rule applied everywhere else). Computed
    // live from the draft so the Auto swatch previews exactly what the Design
    // Editor / synthesis history will show.
    const colorIsAuto = !draft.color || draft.color === 'auto';
    const autoColor = (() => {
        const fn = buildNKFromDraft(draft);
        if (!fn) return ndColor(null);
        try { const nk = fn(550); const n = Array.isArray(nk) ? nk[0] : nk; return ndColor(n); }
        catch (_) { return ndColor(null); }
    })();
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

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '0 12px' } },

        // ── Header: name + delete ─────────────────────────────────────────────
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${c.border}`, flexShrink: 0 } },
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
        ),

        // ── Scrollable body ───────────────────────────────────────────────────
        h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } },

            // Properties row
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', paddingTop: 8 } },
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
                // Color
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
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
                ),
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
            ),

            // Type toggle — hidden for RII imports (they are always tabular, Zemax formula UI is irrelevant).
            // Mutually exclusive by construction: 'tabular' stores ONLY a λ/n/k table;
            // 'formula' stores ONLY a dispersion formula (n) + an optional λ/k table (absorption).
            // Saving discards the other mode's data — a material is never both.
            !draft.isRii && h('div', null,
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
            ),

            // ── Tabular editor ────────────────────────────────────────────────
            draft.type === 'tabular' && h('div', null,
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
            ),

            // ── Formula editor ────────────────────────────────────────────────
            draft.type === 'formula' && h('div', null,
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
            ),

            // ── n/k preview chart ─────────────────────────────────────────────
            h('div', { style: { flexShrink: 0, marginTop: 8, borderTop: `1px solid ${c.border}` } },
                sectionLabel(me.chartTitle),
                h('div', { ref: chartRef, style: { height: 160 } })
            )
        ),

        // ── Footer: Save button ───────────────────────────────────────────────
        h('div', { style: { flexShrink: 0, padding: '8px 0', borderTop: `1px solid ${c.border}` } },
            h('button', {
                onClick: onSave,
                style: {
                    width: '100%', padding: '5px 0', fontSize: 12,
                    backgroundColor: c.accent, color: '#fff', border: 'none',
                    borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'system-ui, -apple-system, sans-serif'
                }
            }, me.saveMaterial)
        )
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MaterialEditor({ c, t, setInputDialog }) {
    const [catalogs,         setCatalogs]        = useState([]);
    const [catFilter,        setCatFilter]        = useState('all');
    const [query,            setQuery]            = useState('');
    const [selectedId,       setSelectedId]       = useState(null);
    const [importing,        setImporting]        = useState(false);
    const [showRii,          setShowRii]          = useState(false);
    const [notification,     setNotification]     = useState(null);
    const [showNewCatalog,   setShowNewCatalog]   = useState(false);
    const [newCatalogName,   setNewCatalogName]   = useState('');
    const [editDraft,        setEditDraft]        = useState(null);

    const me = t.materialEditor;

    const loadCatalogs = useCallback(() => { setCatalogs(getCatalogs()); }, []);
    useEffect(() => {
        loadCatalogs();
        window.addEventListener('catalogs-loaded', loadCatalogs);
        return () => window.removeEventListener('catalogs-loaded', loadCatalogs);
    }, [loadCatalogs]);

    const results = searchMaterials(query, catFilter === 'all' ? null : catFilter);
    const selectedMat = (!editDraft && selectedId) ? getMaterialById(selectedId) : null;

    const currentCatalog = catFilter !== 'all' ? catalogs.find(cat => cat.id === catFilter) : null;
    const isUserCatalog = currentCatalog?.source === 'user';

    function notify(type, msg) {
        setNotification({ type, msg });
    }

    // Auto-clear notification
    useEffect(() => {
        if (!notification) return;
        const tid = setTimeout(() => setNotification(null), 3000);
        return () => clearTimeout(tid);
    }, [notification]);

    // ── Import AGF ────────────────────────────────────────────────────────────
    const handleImport = async () => {
        if (importing) return;
        setImporting(true);
        try {
            const result = await window.electronAPI.importCatalogAgf();
            if (result.canceled) return;
            if (!result.success) { notify('error', me.importError(result.error || 'Unknown error')); return; }
            const catalog = parseAGF(result.text, result.fileName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
            addCatalog(catalog);
            loadCatalogs();
            setCatFilter(catalog.id);
            notify('ok', me.importSuccess(catalog.name) + ` (${Object.keys(catalog.materials).length} materials)`);
        } catch (err) {
            notify('error', me.importError(err.message));
        } finally {
            setImporting(false);
        }
    };

    // ── Import OptiLayer (.lm / .sub) ─────────────────────────────────────────
    // Parse the selected files, then ask the user which catalog to import into
    // (the picker is rendered below). Nothing is created until they choose.
    const handleImportOptiLayer = async () => {
        if (importing) return;
        setImporting(true);
        try {
            const result = await window.electronAPI.importCatalogOptiLayer();
            if (result.canceled) return;
            if (!result.success) { notify('error', me.importError(result.error || 'Unknown error')); return; }
            const { catalog, errors } = buildOptiLayerCatalog(result.files, {
                id: '__import__', name: 'OptiLayer', source: 'optilayer',
            });
            const count = Object.keys(catalog.materials).length;
            if (count === 0) {
                notify('error', me.importError(errors[0]?.error || 'No materials parsed'));
                return;
            }
            setOlImport({ materials: catalog.materials, count, errors });
        } catch (err) {
            notify('error', me.importError(err.message));
        } finally {
            setImporting(false);
        }
    };

    // Commit a parsed OptiLayer import into the chosen catalog ('__new__' = create one).
    const doImportOptiLayer = (targetCatId) => {
        const imp = olImport;
        if (!imp) return;
        try {
            let catId = targetCatId, catName;
            if (catId === '__new__') {
                const cat = createUserCatalog('Imported OptiLayer');
                catId = cat.id; catName = cat.name;
            } else {
                catName = catalogs.find(cat => cat.id === catId)?.name || catId;
            }
            const added = importMaterialsIntoCatalog(catId, imp.materials);
            loadCatalogs();
            setCatFilter(catId);
            setOlImport(null);
            notify('ok', imp.errors.length
                ? me.importOptiLayerErrors(added, imp.errors.length)
                : me.importOptiLayerSuccess(added, catName));
        } catch (err) {
            notify('error', me.importError(err.message));
            setOlImport(null);
        }
    };

    // ── Remove catalog ────────────────────────────────────────────────────────
    const handleRemoveCatalog = (catId) => {
        const cat = catalogs.find(c => c.id === catId);
        if (!cat) return;
        const doDelete = () => {
            removeCatalog(catId);
            loadCatalogs();
            if (catFilter === catId) setCatFilter('all');
            if (selectedId?.startsWith(catId + ':')) setSelectedId(null);
            if (editDraft?.catalogId === catId) setEditDraft(null);
        };
        if (setInputDialog) {
            setInputDialog({
                confirm: true, danger: true,
                title: me.removeCatalog,
                message: me.deleteCatalogConfirm(cat.name),
                confirmLabel: me.deleteMaterial,
                onConfirm: () => { doDelete(); setInputDialog(null); },
                onCancel:  () => setInputDialog(null),
            });
        } else {
            if (window.confirm(me.deleteCatalogConfirm(cat.name))) doDelete();
        }
    };

    // ── Create user catalog ───────────────────────────────────────────────────
    const handleCreateCatalog = () => {
        const name = newCatalogName.trim();
        if (!name) return;
        const cat = createUserCatalog(name);
        loadCatalogs();
        setCatFilter(cat.id);
        setShowNewCatalog(false);
        setNewCatalogName('');
    };

    // ── Duplicate a whole catalog into a new user catalog ─────────────────────
    const handleDuplicateCatalog = (srcId) => {
        const src = catalogs.find(c => c.id === srcId);
        if (!src) return;
        const doDup = (name) => {
            const cat = duplicateCatalog(srcId, name);
            if (!cat) { notify('error', me.duplicateError || 'Duplicate failed'); return; }
            loadCatalogs();
            setCatFilter(cat.id);
            setEditDraft(null);
            notify('ok', me.duplicateSuccess(cat.name, Object.keys(cat.materials).length));
        };
        const defName = src.name + ' copy';
        if (setInputDialog) {
            setInputDialog({
                title: me.duplicateCatalogPrompt(src.name),
                defaultValue: defName,
                confirmLabel: me.duplicateCatalog,
                onConfirm: (val) => { doDup((val || '').trim() || defName); setInputDialog(null); },
                onCancel: () => setInputDialog(null),
            });
        } else {
            doDup(defName);
        }
    };

    // ── Copy the currently-edited USER material into another catalog ──────────
    const handleCopyUserMaterial = () => {
        if (!editDraft) return;
        openCopyPicker(draftToMaterial(editDraft));
    };

    // ── New user material ─────────────────────────────────────────────────────
    const handleNewMaterial = () => {
        setSelectedId(null);
        setEditDraft(emptyDraft(catFilter));
    };

    // ── Select material ───────────────────────────────────────────────────────
    const handleSelectMaterial = (compId, catalogId, mat) => {
        setCopyPickerFor(null);
        const cat = catalogs.find(c => c.id === catalogId);
        if (cat?.source === 'user') {
            setEditDraft(materialToDraft(catalogId, mat));
            setSelectedId(null);
        } else {
            setEditDraft(null);
            setSelectedId(compId);
        }
    };

    // ── Save user material ────────────────────────────────────────────────────
    const handleSaveMaterial = () => {
        if (!editDraft) return;
        const err = validateDraft(editDraft, catalogs, me);
        if (err) { notify('error', err); return; }
        try {
            // Auto-generate ID from name if still empty
            let draft = editDraft;
            if (!draft.id.trim()) {
                draft = { ...draft, id: generateMaterialId(draft.catalogId, draft.name) };
            }
            const mat = draftToMaterial(draft);
            saveUserMaterial(draft.catalogId, mat);
            // If the ID was sanitized from a legacy colon ID, remove the old entry
            if (draft.originalId && draft.originalId !== mat.id) {
                removeUserMaterial(draft.catalogId, draft.originalId);
            }
            loadCatalogs();
            // Refresh draft with saved data (marks isNew=false)
            const cat = getCatalogs().find(c => c.id === draft.catalogId);
            if (cat?.materials?.[mat.id]) {
                setEditDraft(materialToDraft(draft.catalogId, { ...cat.materials[mat.id] }));
            }
            notify('ok', me.saveSuccess(mat.name));
        } catch (err) {
            notify('error', err.message);
        }
    };

    // ── Copy a material into another (user) catalog ───────────────────────────
    // Works for any source material — builtin/AGF/RII (from `selectedMat`) or a
    // user material reconstructed from the edit draft. `copyPickerFor` holds the
    // source while the destination-catalog modal is open.
    const [copyPickerFor, setCopyPickerFor] = useState(null);
    // Parsed OptiLayer import awaiting a target-catalog choice ({ materials, count, errors }).
    const [olImport, setOlImport] = useState(null);

    const openCopyPicker = (srcMat) => {
        if (!srcMat) return;
        const userCats = catalogs.filter(cat => cat.source === 'user');
        if (userCats.length === 0) { notify('error', me.copyToCatalogNoTarget); return; }
        if (userCats.length === 1) { doCopyToCatalog(srcMat, userCats[0].id); return; }
        setCopyPickerFor(srcMat);
    };

    const doCopyToCatalog = (srcMat, targetCatId) => {
        setCopyPickerFor(null);
        const saved = copyMaterialToCatalog(srcMat, targetCatId);
        if (!saved) { notify('error', me.duplicateError || 'Copy failed'); return; }
        loadCatalogs();
        setSelectedId(null);
        setCatFilter(targetCatId);
        const cat = getCatalogs().find(c => c.id === targetCatId);
        if (cat?.materials?.[saved.id]) setEditDraft(materialToDraft(targetCatId, { ...cat.materials[saved.id] }));
        notify('ok', me.copyMaterialDone(saved.name, cat?.name || targetCatId));
    };

    // ── Delete user material ──────────────────────────────────────────────────
    const handleDeleteMaterial = () => {
        if (!editDraft || editDraft.isNew) return;
        const doDelete = () => {
            // Use originalId if the ID was sanitized from a legacy colon ID
            removeUserMaterial(editDraft.catalogId, editDraft.originalId || editDraft.id);
            loadCatalogs();
            setEditDraft(null);
        };
        if (setInputDialog) {
            setInputDialog({
                confirm: true, danger: true,
                title: me.deleteMaterial,
                message: me.deleteConfirm(editDraft.name || editDraft.id),
                confirmLabel: me.deleteMaterial,
                onConfirm: () => { doDelete(); setInputDialog(null); },
                onCancel:  () => setInputDialog(null),
            });
        } else {
            if (window.confirm(me.deleteConfirm(editDraft.name || editDraft.id))) doDelete();
        }
    };

    // ── Read-only n/k chart (for builtin/AGF materials) ───────────────────────
    const chartRef = useRef(null);
    // Sampled n,k table built from getNK over the plotted range — shown for materials
    // that carry no stored tabData (built-in functions, AGF/OptiLayer formulas) so the
    // user always gets numbers next to the curve, not just a picture.
    const [sampledTable, setSampledTable] = useState([]);
    useEffect(() => {
        if (editDraft) return;
        if (!chartRef.current || !window.Plotly || !selectedMat?.getNK) { setSampledTable([]); return; }
        // Plot the material's ACTUAL data range — do not clamp to a fixed visible/NIR
        // window. EUV metals (e.g. Ag 2.4–121.6 nm) and far-IR materials (e.g. CdTe out
        // to ~27 µm) live entirely outside 200–5000 nm and would otherwise show blank or
        // clipped. lambdaMin/lambdaMax are in µm. Guarantee a positive, ordered span.
        const lmin = Math.max(1, (selectedMat.lambdaMin || 0.3) * 1000);
        const lmax = Math.max(lmin + 1, (selectedMat.lambdaMax || 2.5) * 1000);
        const step = Math.max(1e-3, (lmax - lmin) / 300);
        const lambdas = [];
        for (let l = lmin; l <= lmax; l += step) lambdas.push(l);
        const ns = [], ks = [];
        for (const lam of lambdas) {
            try { const [n, k] = selectedMat.getNK(lam); ns.push(isFinite(n) ? n : null); ks.push(isFinite(k) && k > 1e-10 ? k : null); }
            catch (_) { ns.push(null); ks.push(null); }
        }
        const hasK = ks.some(k => k != null && k > 0);
        const traces = [{ x: lambdas, y: ns, name: me.chartN, type: 'scatter', mode: 'lines', line: { color: '#5dade2', width: 2 }, yaxis: 'y' }];
        if (hasK) traces.push({ x: lambdas, y: ks, name: me.chartK, type: 'scatter', mode: 'lines', line: { color: '#e74c3c', width: 1.5, dash: 'dash' }, yaxis: 'y2' });
        const layout = {
            paper_bgcolor: c.bg, plot_bgcolor: c.bg,
            margin: { t: 10, b: 36, l: 50, r: hasK ? 50 : 16 },
            xaxis: { title: { text: me.wavelengthNm, font: { size: 11 } }, color: c.textDim, gridcolor: c.border, tickfont: { size: 10 } },
            yaxis: { title: { text: me.chartN, font: { size: 11 } }, color: '#5dade2', gridcolor: c.border, tickfont: { size: 10 } },
            legend: { font: { size: 11, color: c.text }, bgcolor: 'transparent', x: 0.01, y: 0.99 },
            font: { family: 'system-ui, -apple-system, sans-serif' },
        };
        if (hasK) layout.yaxis2 = { title: { text: me.chartK, font: { size: 11 } }, color: '#e74c3c', overlaying: 'y', side: 'right', tickfont: { size: 10 } };
        window.Plotly.react(chartRef.current, traces, layout, { responsive: true, displayModeBar: false });

        // Compact sampled n,k table (≤80 evenly-spaced rows) from the same getNK, so
        // formula/function materials still expose tabulated numbers.
        const maxRows = 80;
        const stride = Math.max(1, Math.ceil(lambdas.length / maxRows));
        const tbl = [];
        for (let i = 0; i < lambdas.length; i += stride) {
            const lam = lambdas[i];
            try { const [n, k] = selectedMat.getNK(lam); if (isFinite(n)) tbl.push([lam, n, k || 0]); } catch (_) { /* skip */ }
        }
        setSampledTable(tbl);
    }, [selectedMat, c, editDraft]);

    // ── Left panel ────────────────────────────────────────────────────────────
    const leftPanel = h('div', {
        style: { width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${c.border}`, backgroundColor: c.panel }
    },
        // Toolbar
        h('div', { style: { padding: '6px 8px', borderBottom: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: 3 } },
            // Import row — file-based importers (AGF, OptiLayer)
            h('div', { style: { display: 'flex', gap: 4 } },
                h('button', {
                    onClick: handleImport, disabled: importing,
                    style: { ...smallBtn(c), flex: 1, padding: '4px 0', opacity: importing ? 0.5 : 1, cursor: importing ? 'default' : 'pointer' }
                }, importing ? '…' : me.importAgf),
                h('button', {
                    onClick: handleImportOptiLayer, disabled: importing,
                    style: { ...smallBtn(c), flex: 1, padding: '4px 0', opacity: importing ? 0.5 : 1, cursor: importing ? 'default' : 'pointer' }
                }, importing ? '…' : me.importOptiLayer),
            ),
            // Browse online database
            h('div', { style: { display: 'flex', gap: 4 } },
                h('button', {
                    onClick: () => setShowRii(true),
                    style: { ...smallBtn(c), flex: 1, padding: '4px 0' }
                }, me.browseRii)
            ),
            // Catalog management row
            h('div', { style: { display: 'flex', gap: 4 } },
                h('button', {
                    onClick: () => { setShowNewCatalog(v => !v); setNewCatalogName(''); },
                    style: { ...smallBtn(c), flex: 1, padding: '4px 0',
                        backgroundColor: showNewCatalog ? c.accent + '22' : c.panel,
                        color: showNewCatalog ? c.accent : c.textDim,
                        borderColor: showNewCatalog ? c.accent + '88' : c.border }
                }, me.newCatalog)
            ),

            showNewCatalog && h('div', { style: { display: 'flex', gap: 4 } },
                h('input', {
                    value: newCatalogName, onChange: e => setNewCatalogName(e.target.value),
                    placeholder: me.catalogNamePlaceholder,
                    onKeyDown: e => { if (e.key === 'Enter') handleCreateCatalog(); if (e.key === 'Escape') { setShowNewCatalog(false); setNewCatalogName(''); } },
                    autoFocus: true,
                    style: { flex: 1, height: 22, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 5px', outline: 'none', boxSizing: 'border-box' }
                }),
                h('button', { onClick: handleCreateCatalog, style: smallBtn(c, { backgroundColor: c.accent, color: '#fff', borderColor: c.accent }) }, me.create)
            )
        ),

        // Notification
        notification && h('div', {
            style: { padding: '4px 8px', fontSize: 11, color: notification.type === 'ok' ? '#58d68d' : '#ec7063', borderBottom: `1px solid ${c.border}` }
        }, notification.msg),

        // Catalog dropdown (with per-catalog material counts) + manage buttons
        h('div', { style: { padding: '4px 8px 6px', borderBottom: `1px solid ${c.border}` } },
            h('div', { style: { fontSize: 10, color: c.textDim, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 } }, me.catalogsLabel || 'Catalogs'),
            // Selector gets the full panel width so long catalog names are readable.
            // `title` surfaces the complete name on hover for any extra-long case.
            h('select', {
                value: catFilter,
                onChange: e => { setCatFilter(e.target.value); setEditDraft(null); },
                title: catFilter === 'all' ? me.allCatalogs : (currentCatalog?.name || ''),
                style: { width: '100%', boxSizing: 'border-box', height: 24, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 4px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }
            },
                h('option', { value: 'all' },
                    `${me.allCatalogs} (${catalogs.reduce((s, cat) => s + Object.keys(cat.materials || {}).length, 0)})`),
                catalogs.map(cat => {
                    const count = Object.keys(cat.materials || {}).length;
                    const badge = cat.source === 'user' ? ` ${me.userCatalogBadge}` : '';
                    return h('option', { key: cat.id, value: cat.id }, `${cat.name}${badge} (${count})`);
                })
            ),
            // Action row beneath the selector: New material (user catalogs) + duplicate / remove.
            (currentCatalog || isUserCatalog) && h('div', { style: { display: 'flex', gap: 4, marginTop: 5, alignItems: 'center' } },
                isUserCatalog && h('button', {
                    onClick: handleNewMaterial,
                    style: { ...smallBtn(c), flex: 1, padding: '4px 0',
                        backgroundColor: c.accent + '22', color: c.accent, borderColor: c.accent + '66' }
                }, me.newMaterial),
                !isUserCatalog && h('div', { style: { flex: 1 } }),  // spacer → right-align buttons
                // Duplicate the selected catalog (any source) → new user catalog
                currentCatalog && h('button', {
                    onClick: () => handleDuplicateCatalog(currentCatalog.id),
                    title: me.duplicateCatalog,
                    style: smallBtn(c, { padding: '3px 8px', flexShrink: 0 })
                }, '⎘'),
                // Remove the selected catalog (not builtin)
                currentCatalog && currentCatalog.id !== 'builtin' && h('button', {
                    onClick: () => handleRemoveCatalog(currentCatalog.id),
                    title: me.removeCatalog,
                    style: smallBtn(c, { padding: '3px 8px', flexShrink: 0, color: '#ec7063', borderColor: '#ec7063' + '66' })
                }, '×')
            )
        ),

        // Search
        h('div', { style: { padding: '4px 8px', borderBottom: `1px solid ${c.border}` } },
            h('input', {
                value: query, onChange: e => setQuery(e.target.value),
                placeholder: me.searchPlaceholder,
                style: { width: '100%', height: 22, boxSizing: 'border-box', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 6px', outline: 'none' }
            })
        ),

        // Material list
        h('div', { style: { flex: 1, overflowY: 'auto' } },
            results.length === 0
                ? h('div', { style: { padding: 12, color: c.textDim, fontSize: 12, textAlign: 'center' } }, me.noMaterials)
                : results.map(({ catalogId, material }) => {
                    const compId = `${catalogId}:${material.id}`;
                    const isActive = editDraft
                        ? (editDraft.catalogId === catalogId &&
                           (editDraft.id === material.id || editDraft.originalId === material.id))
                        : selectedId === compId;
                    const mc = resolveColor(material);
                    return h('div', {
                        key: compId,
                        onClick: () => handleSelectMaterial(compId, catalogId, material),
                        style: {
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '3px 8px', cursor: 'pointer',
                            backgroundColor: isActive ? c.accent + '33' : 'transparent',
                            borderLeft: `2px solid ${isActive ? c.accent : 'transparent'}`,
                            color: isActive ? c.accent : c.text, fontSize: 12
                        }
                    },
                        h('span', { style: dotStyle(mc) }),
                        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                            material.name || material.id)
                    );
                })
        )
    );

    // ── Right panel ───────────────────────────────────────────────────────────
    const rightPanel = h('div', {
        style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: c.bg }
    },
        // User material edit form
        editDraft
            ? h(UserMaterialForm, {
                draft: editDraft,
                onChange: setEditDraft,
                onSave: handleSaveMaterial,
                onDelete: handleDeleteMaterial,
                onCopy: handleCopyUserMaterial,
                catalogs,
                c,
                t
            })
            // Read-only view for builtin/AGF
            : !selectedMat
                ? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim, fontSize: 13, fontStyle: 'italic' } }, me.selectMaterial)
                : h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } },
                    // Header
                    h('div', { style: { padding: '8px 12px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, position: 'relative' } },
                        h('span', { style: { ...dotStyle(resolveColor(selectedMat)), width: 14, height: 14 } }),
                        h('span', { style: { fontSize: 15, fontWeight: 600 } }, selectedMat.name || selectedMat.id),
                        selectedMat.status != null && statusBadge(selectedMat.status, t),
                        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 } },
                            selectedMat.nd && h('span', { style: { fontSize: 12, color: c.textDim } }, `n_d = ${selectedMat.nd.toFixed(5)}`),
                            h('button', {
                                onClick: () => openCopyPicker(selectedMat),
                                style: smallBtn(c, { whiteSpace: 'nowrap' })
                            }, me.copyToCatalog)
                        )
                    ),
                    h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
                        // Properties
                        h('div', { style: { padding: '8px 12px', flexShrink: 0 } },
                            h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 12 } },
                                selectedMat.nd && propRow(me.nd, selectedMat.nd.toFixed(5), c),
                                selectedMat.vd && propRow(me.vd, selectedMat.vd.toFixed(2), c),
                                selectedMat.density && propRow(me.density, `${selectedMat.density.toFixed(3)} g/cm³`, c),
                                selectedMat.lambdaMin && propRow(me.lambdaRange, `${(selectedMat.lambdaMin * 1000).toFixed(0)} – ${(selectedMat.lambdaMax * 1000).toFixed(0)} nm`, c),
                                selectedMat.comment && propRow('Comment', selectedMat.comment, c)
                            )
                        ),
                        // Dispersion formula
                        selectedMat.formulaNum > 0 && h('div', { style: { padding: '0 12px 8px', flexShrink: 0, borderTop: `1px solid ${c.border}`, paddingTop: 8 } },
                            h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, me.formula),
                            FORMULA_LATEX[selectedMat.formulaNum] && h('div', { style: { padding: '6px 8px', backgroundColor: c.panel, borderRadius: 4, border: `1px solid ${c.border}`, fontSize: 13, overflowX: 'auto', color: c.text, fontStyle: 'italic', marginBottom: 6 } },
                                h('div', { style: { marginBottom: 2, fontSize: 11, color: c.textDim } }, FORMULA_LATEX[selectedMat.formulaNum].name),
                                h(KaTeXSpan, { latex: FORMULA_LATEX[selectedMat.formulaNum].template, displayMode: true })
                            ),
                            selectedMat.coefficients?.length > 0 && h('div', null,
                                h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } }, me.coefficients),
                                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 11 } },
                                    FORMULA_LATEX[selectedMat.formulaNum]?.coeffNames.map((name, i) => {
                                        const v = selectedMat.coefficients[i];
                                        if (v == null || v === 0) return null;
                                        return h('div', { key: i, style: { padding: '2px 6px', backgroundColor: c.panel, borderRadius: 3, border: `1px solid ${c.border}` } },
                                            h('span', { style: { color: c.textDim } }, name + ' = '),
                                            h('span', { style: { color: c.text, fontFamily: 'monospace' } }, formatCoeff(v))
                                        );
                                    }).filter(Boolean)
                                )
                            )
                        ),
                        // Tabulated n,k data (for table-type materials, incl. OptiLayer nType 0)
                        selectedMat.formulaNum === -1 && selectedMat.tabData?.length > 0 && h('div', {
                            style: { flexShrink: 0, borderTop: `1px solid ${c.border}`, padding: '8px 12px 4px' }
                        },
                            h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } },
                                `${me.nkTable} (${selectedMat.tabData.length})`),
                            h('div', { style: { maxHeight: 150, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
                                h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' } },
                                    h('thead', null, h('tr', { style: { position: 'sticky', top: 0, backgroundColor: c.panel } },
                                        ['λ (nm)', 'n', 'k'].map((hd, i) =>
                                            h('th', { key: i, style: { textAlign: i === 0 ? 'left' : 'right', padding: '3px 8px', color: c.textDim, borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, hd))
                                    )),
                                    h('tbody', null, selectedMat.tabData.map((row, i) =>
                                        h('tr', { key: i },
                                            h('td', { style: { padding: '2px 8px', color: c.text } }, (+row[0]).toFixed(1)),
                                            h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.text } }, (+row[1]).toFixed(5)),
                                            h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.textDim } }, (+(row[2] || 0)).toFixed(5))
                                        )
                                    ))
                                )
                            )
                        ),
                        // Sampled n,k table — for materials with no stored tabData (built-in
                        // functions, AGF/OptiLayer dispersion formulas). Computed from getNK
                        // over the valid range so the user always gets numbers, not just a curve.
                        !(selectedMat.formulaNum === -1 && selectedMat.tabData?.length > 0) && sampledTable.length > 0 && h('div', {
                            style: { flexShrink: 0, borderTop: `1px solid ${c.border}`, padding: '8px 12px 4px' }
                        },
                            h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } },
                                `${me.nkTableSampled} (${sampledTable.length})`),
                            h('div', { style: { maxHeight: 150, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
                                h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' } },
                                    h('thead', null, h('tr', { style: { position: 'sticky', top: 0, backgroundColor: c.panel } },
                                        ['λ (nm)', 'n', 'k'].map((hd, i) =>
                                            h('th', { key: i, style: { textAlign: i === 0 ? 'left' : 'right', padding: '3px 8px', color: c.textDim, borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, hd))
                                    )),
                                    h('tbody', null, sampledTable.map((row, i) =>
                                        h('tr', { key: i },
                                            h('td', { style: { padding: '2px 8px', color: c.text } }, (+row[0]).toFixed(1)),
                                            h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.text } }, (+row[1]).toFixed(5)),
                                            h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.textDim } }, (+(row[2] || 0)).toFixed(5))
                                        )
                                    ))
                                )
                            )
                        ),
                        // n/k chart
                        h('div', { style: { flex: 1, minHeight: 160, padding: '4px 0', flexShrink: 0 } },
                            h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, margin: '0 12px 2px' } }, me.chartTitle),
                            h('div', { ref: chartRef, style: { height: 200, padding: '0 4px' } })
                        )
                    )
                )
    );

    const handleRiiAdded = useCallback((catId) => {
        loadCatalogs();
        setCatFilter(catId);
    }, [loadCatalogs]);

    return h('div', {
        style: { display: 'flex', height: '100%', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13, color: c.text }
    },
        leftPanel,
        rightPanel,
        showRii && h(RIIBrowser, { c, t, onClose: () => setShowRii(false), onAdded: handleRiiAdded }),

        // Destination-catalog picker (shown when there are ≥2 user catalogs to
        // choose from). Works for any source material — builtin/AGF/RII or user.
        copyPickerFor && h('div', {
            onClick: () => setCopyPickerFor(null),
            style: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        },
            h('div', {
                onClick: e => e.stopPropagation(),
                style: { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', minWidth: 240, maxWidth: 360, padding: '10px 0' }
            },
                h('div', { style: { padding: '2px 14px 8px', fontSize: 13, fontWeight: 600, color: c.text } },
                    me.copyToCatalogTitle(copyPickerFor.name || copyPickerFor.id)),
                catalogs.filter(cat => cat.source === 'user').map(cat =>
                    h('div', {
                        key: cat.id,
                        onClick: () => doCopyToCatalog(copyPickerFor, cat.id),
                        style: { padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: c.text, display: 'flex', justifyContent: 'space-between', gap: 12 },
                        onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
                        onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
                    },
                        h('span', null, cat.name),
                        h('span', { style: { color: c.textDim } }, `(${Object.keys(cat.materials || {}).length})`)
                    )
                )
            )
        ),

        // OptiLayer import: choose destination catalog (any non-builtin) or create new.
        olImport && h('div', {
            onClick: () => setOlImport(null),
            style: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        },
            h('div', {
                onClick: e => e.stopPropagation(),
                style: { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', minWidth: 280, maxWidth: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column', padding: '10px 0' }
            },
                h('div', { style: { padding: '2px 14px 8px', fontSize: 13, fontWeight: 600, color: c.text } },
                    me.importTargetTitle(olImport.count)),
                h('div', { style: { overflowY: 'auto' } },
                    catalogs.filter(cat => cat.id !== 'builtin').map(cat =>
                        h('div', {
                            key: cat.id,
                            onClick: () => doImportOptiLayer(cat.id),
                            style: { padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: c.text, display: 'flex', justifyContent: 'space-between', gap: 12 },
                            onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
                            onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
                        },
                            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cat.name),
                            h('span', { style: { color: c.textDim, flexShrink: 0 } }, `(${Object.keys(cat.materials || {}).length})`)
                        )
                    )
                ),
                h('div', {
                    onClick: () => doImportOptiLayer('__new__'),
                    style: { padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: c.accent, fontWeight: 600, borderTop: `1px solid ${c.border}`, marginTop: 4 },
                    onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
                    onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
                }, me.importTargetNew)
            )
        )
    );
}
