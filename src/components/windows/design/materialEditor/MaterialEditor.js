/**
 * Material Editor — browse, import, and create optical material catalogs.
 *
 * Layout:
 *   Left panel:   catalog filter + search + material list
 *   Right panel:  read-only details for builtin/AGF materials;
 *                 editable form (UserMaterialForm) for user-catalog materials
 *
 * This module hosts the top-level component and its catalog/import/save actions.
 * Supporting pieces live in sibling modules: the draft model and converters
 * (materialDraft.js), the editable form (userMaterialForm.js), the n/k grid
 * (nkDataGrid.js), and shared presentational atoms (materialEditorUI.js).
 */

import {
    getCatalogs, getMaterialById, searchMaterials,
    addCatalog, removeCatalog, resolveColor,
    createUserCatalog, saveUserMaterial, removeUserMaterial, generateMaterialId,
    duplicateCatalog, copyMaterialToCatalog, importMaterialsIntoCatalog,
} from '../../../../utils/materials/catalogManager.js';
import { parseAGF } from '../../../../utils/materials/agfParser.js';
import { buildOptiLayerCatalog } from '../../../../utils/materials/optilayerParser.js';
import { FORMULA_LATEX } from '../../../../utils/materials/dispersionFormulas.js';
import { RIIBrowser } from './RIIBrowser.js';
import { emptyDraft, materialToDraft, draftToMaterial, validateDraft } from './materialDraft.js';
import { KaTeXSpan, dotStyle, statusBadge, propRow, formatCoeff, smallBtn } from './materialEditorUI.js';
import { UserMaterialForm } from './userMaterialForm.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── Read-only n/k chart + sampled table (for builtin/AGF/formula materials) ───

// Sample selectedMat.getNK over its actual data range. lambdaMin/lambdaMax are
// in µm; the range is never clamped to a fixed visible/NIR window (EUV metals and
// far-IR materials live outside 200–5000 nm and would otherwise show blank).
function computeReadOnlyCurves(selectedMat) {
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
    return { lambdas, ns, ks, hasK: ks.some(k => k != null && k > 0) };
}

function drawReadOnlyFigure(chartEl, { lambdas, ns, ks, hasK }, c, me) {
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
    window.Plotly.react(chartEl, traces, layout, { responsive: true, displayModeBar: false });
}

// Compact [λ, n, k] table (≤80 evenly-spaced rows) from getNK, so materials with
// no stored tabData still expose tabulated numbers next to the curve.
function sampleReadOnlyTable(lambdas, selectedMat) {
    const stride = Math.max(1, Math.ceil(lambdas.length / 80));
    const tbl = [];
    for (let i = 0; i < lambdas.length; i += stride) {
        const lam = lambdas[i];
        try { const [n, k] = selectedMat.getNK(lam); if (isFinite(n)) tbl.push([lam, n, k || 0]); } catch (_) { /* skip */ }
    }
    return tbl;
}

// Draw the read-only n/k chart and return its sampled table.
function sampleReadOnlyChart(chartEl, selectedMat, c, me) {
    const curves = computeReadOnlyCurves(selectedMat);
    drawReadOnlyFigure(chartEl, curves, c, me);
    return sampleReadOnlyTable(curves.lambdas, selectedMat);
}

// ── Read-only material view (builtin/AGF/RII) ─────────────────────────────────

function readOnlyPropsBlock(selectedMat, me, c) {
    return h('div', { style: { padding: '8px 12px', flexShrink: 0 } },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 12 } },
            selectedMat.nd && propRow(me.nd, selectedMat.nd.toFixed(5), c),
            selectedMat.vd && propRow(me.vd, selectedMat.vd.toFixed(2), c),
            selectedMat.density && propRow(me.density, `${selectedMat.density.toFixed(3)} g/cm³`, c),
            selectedMat.lambdaMin && propRow(me.lambdaRange, `${(selectedMat.lambdaMin * 1000).toFixed(0)} – ${(selectedMat.lambdaMax * 1000).toFixed(0)} nm`, c),
            selectedMat.comment && propRow('Comment', selectedMat.comment, c)
        )
    );
}

function readOnlyFormulaBlock(selectedMat, me, c) {
    if (!(selectedMat.formulaNum > 0)) return null;
    const info = FORMULA_LATEX[selectedMat.formulaNum];
    return h('div', { style: { padding: '0 12px 8px', flexShrink: 0, borderTop: `1px solid ${c.border}`, paddingTop: 8 } },
        h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, me.formula),
        info && h('div', { style: { padding: '6px 8px', backgroundColor: c.panel, borderRadius: 4, border: `1px solid ${c.border}`, fontSize: 13, overflowX: 'auto', color: c.text, fontStyle: 'italic', marginBottom: 6 } },
            h('div', { style: { marginBottom: 2, fontSize: 11, color: c.textDim } }, info.name),
            h(KaTeXSpan, { latex: info.template, displayMode: true })
        ),
        selectedMat.coefficients?.length > 0 && h('div', null,
            h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } }, me.coefficients),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 11 } },
                info?.coeffNames.map((name, i) => {
                    const v = selectedMat.coefficients[i];
                    if (v == null || v === 0) return null;
                    return h('div', { key: i, style: { padding: '2px 6px', backgroundColor: c.panel, borderRadius: 3, border: `1px solid ${c.border}` } },
                        h('span', { style: { color: c.textDim } }, name + ' = '),
                        h('span', { style: { color: c.text, fontFamily: 'monospace' } }, formatCoeff(v))
                    );
                }).filter(Boolean)
            )
        )
    );
}

// Scrollable table of [λ, n, k] rows — shared by the stored-tabData and the
// sampled views (title + row source differ, structure is identical).
function readOnlyNkTable(title, rows, c) {
    return h('div', { style: { flexShrink: 0, borderTop: `1px solid ${c.border}`, padding: '8px 12px 4px' } },
        h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } }, title),
        h('div', { style: { maxHeight: 150, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' } },
                h('thead', null, h('tr', { style: { position: 'sticky', top: 0, backgroundColor: c.panel } },
                    ['λ (nm)', 'n', 'k'].map((hd, i) =>
                        h('th', { key: i, style: { textAlign: i === 0 ? 'left' : 'right', padding: '3px 8px', color: c.textDim, borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, hd))
                )),
                h('tbody', null, rows.map((row, i) =>
                    h('tr', { key: i },
                        h('td', { style: { padding: '2px 8px', color: c.text } }, (+row[0]).toFixed(1)),
                        h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.text } }, (+row[1]).toFixed(5)),
                        h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.textDim } }, (+(row[2] || 0)).toFixed(5))
                    )
                ))
            )
        )
    );
}

function renderReadOnlyMaterial({ selectedMat, sampledTable, chartRef, openCopyPicker, me, t, c }) {
    const hasStoredTab = selectedMat.formulaNum === -1 && selectedMat.tabData?.length > 0;
    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } },
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
            readOnlyPropsBlock(selectedMat, me, c),
            readOnlyFormulaBlock(selectedMat, me, c),
            // Tabulated n,k data (for table-type materials, incl. OptiLayer nType 0)
            hasStoredTab && readOnlyNkTable(`${me.nkTable} (${selectedMat.tabData.length})`, selectedMat.tabData, c),
            // Sampled n,k table — for materials with no stored tabData (built-in
            // functions, AGF/OptiLayer dispersion formulas), computed from getNK.
            !hasStoredTab && sampledTable.length > 0 && readOnlyNkTable(`${me.nkTableSampled} (${sampledTable.length})`, sampledTable, c),
            // n/k chart
            h('div', { style: { flex: 1, minHeight: 160, padding: '4px 0', flexShrink: 0 } },
                h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, margin: '0 12px 2px' } }, me.chartTitle),
                h('div', { ref: chartRef, style: { height: 200, padding: '0 4px' } })
            )
        )
    );
}

// ── Left panel (toolbar + catalog selector + search + material list) ──────────

function renderCatalogToolbar(s) {
    const { c, me, handleImport, importing, handleImportOptiLayer, setShowRii,
            showNewCatalog, setShowNewCatalog, newCatalogName, setNewCatalogName, handleCreateCatalog } = s;
    return h('div', { style: { padding: '6px 8px', borderBottom: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: 3 } },
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
            h('button', { onClick: () => setShowRii(true), style: { ...smallBtn(c), flex: 1, padding: '4px 0' } }, me.browseRii)
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
    );
}

function renderCatalogSelector(s) {
    const { c, me, catFilter, setCatFilter, setEditDraft, catalogs, currentCatalog,
            isUserCatalog, handleNewMaterial, handleDuplicateCatalog, handleRemoveCatalog } = s;
    return h('div', { style: { padding: '4px 8px 6px', borderBottom: `1px solid ${c.border}` } },
        h('div', { style: { fontSize: 10, color: c.textDim, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 } }, me.catalogsLabel || 'Catalogs'),
        // Selector gets the full panel width so long catalog names are readable;
        // `title` surfaces the complete name on hover for any extra-long case.
        h('select', {
            value: catFilter,
            onChange: e => { setCatFilter(e.target.value); setEditDraft(null); },
            title: catFilter === 'all' ? me.allCatalogs : (currentCatalog?.name || ''),
            style: { width: '100%', boxSizing: 'border-box', height: 24, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 4px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }
        },
            h('option', { value: 'all' },
                `${me.allCatalogs} (${catalogs.reduce((sum, cat) => sum + Object.keys(cat.materials || {}).length, 0)})`),
            catalogs.map(cat => {
                const count = Object.keys(cat.materials || {}).length;
                const badge = cat.source === 'user' ? ` ${me.userCatalogBadge}` : '';
                return h('option', { key: cat.id, value: cat.id }, `${cat.name}${badge} (${count})`);
            })
        ),
        // Action row: New material (user catalogs) + duplicate / remove.
        (currentCatalog || isUserCatalog) && h('div', { style: { display: 'flex', gap: 4, marginTop: 5, alignItems: 'center' } },
            isUserCatalog && h('button', {
                onClick: handleNewMaterial,
                style: { ...smallBtn(c), flex: 1, padding: '4px 0',
                    backgroundColor: c.accent + '22', color: c.accent, borderColor: c.accent + '66' }
            }, me.newMaterial),
            !isUserCatalog && h('div', { style: { flex: 1 } }),  // spacer → right-align buttons
            currentCatalog && h('button', {
                onClick: () => handleDuplicateCatalog(currentCatalog.id),
                title: me.duplicateCatalog,
                style: smallBtn(c, { padding: '3px 8px', flexShrink: 0 })
            }, '⎘'),
            currentCatalog && currentCatalog.id !== 'builtin' && h('button', {
                onClick: () => handleRemoveCatalog(currentCatalog.id),
                title: me.removeCatalog,
                style: smallBtn(c, { padding: '3px 8px', flexShrink: 0, color: '#ec7063', borderColor: '#ec7063' + '66' })
            }, '×')
        )
    );
}

function renderMaterialList(s) {
    const { c, me, results, editDraft, selectedId, handleSelectMaterial } = s;
    if (results.length === 0) {
        return h('div', { style: { padding: 12, color: c.textDim, fontSize: 12, textAlign: 'center' } }, me.noMaterials);
    }
    return results.map(({ catalogId, material }) => {
        const compId = `${catalogId}:${material.id}`;
        const isActive = editDraft
            ? (editDraft.catalogId === catalogId && (editDraft.id === material.id || editDraft.originalId === material.id))
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
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, material.name || material.id)
        );
    });
}

function renderLeftPanel(s) {
    const { c, me, notification, query, setQuery } = s;
    return h('div', {
        style: { width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${c.border}`, backgroundColor: c.panel }
    },
        renderCatalogToolbar(s),
        notification && h('div', {
            style: { padding: '4px 8px', fontSize: 11, color: notification.type === 'ok' ? '#58d68d' : '#ec7063', borderBottom: `1px solid ${c.border}` }
        }, notification.msg),
        renderCatalogSelector(s),
        // Search
        h('div', { style: { padding: '4px 8px', borderBottom: `1px solid ${c.border}` } },
            h('input', {
                value: query, onChange: e => setQuery(e.target.value),
                placeholder: me.searchPlaceholder,
                style: { width: '100%', height: 22, boxSizing: 'border-box', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 6px', outline: 'none' }
            })
        ),
        // Material list
        h('div', { style: { flex: 1, overflowY: 'auto' } }, renderMaterialList(s))
    );
}

// ── Destination-catalog modals ────────────────────────────────────────────────

// A dismissible overlay with a title and a list of clickable catalog rows.
function catalogPickerOverlay({ onDismiss, title, children, c, minWidth = 240, maxWidth = 360, extraStyle }) {
    return h('div', {
        onClick: onDismiss,
        style: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
        h('div', {
            onClick: e => e.stopPropagation(),
            style: { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', minWidth, maxWidth, padding: '10px 0', ...extraStyle }
        },
            h('div', { style: { padding: '2px 14px 8px', fontSize: 13, fontWeight: 600, color: c.text } }, title),
            children
        )
    );
}

function catalogPickerRow(cat, onClick, c, ellipsis) {
    // OptiLayer-import rows can carry long catalog names → ellipsis + non-shrinking
    // count; the copy-picker rows use plain spans. `ellipsis` selects the variant.
    const nameStyle = ellipsis ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined;
    const countStyle = ellipsis ? { color: c.textDim, flexShrink: 0 } : { color: c.textDim };
    return h('div', {
        key: cat.id,
        onClick,
        style: { padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: c.text, display: 'flex', justifyContent: 'space-between', gap: 12 },
        onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
    },
        h('span', nameStyle ? { style: nameStyle } : null, cat.name),
        h('span', { style: countStyle }, `(${Object.keys(cat.materials || {}).length})`)
    );
}

function renderCopyPickerModal({ copyPickerFor, catalogs, doCopyToCatalog, setCopyPickerFor, me, c }) {
    return catalogPickerOverlay({
        onDismiss: () => setCopyPickerFor(null),
        title: me.copyToCatalogTitle(copyPickerFor.name || copyPickerFor.id),
        c,
        children: catalogs.filter(cat => cat.source === 'user').map(cat =>
            catalogPickerRow(cat, () => doCopyToCatalog(copyPickerFor, cat.id), c, false)),
    });
}

function renderOptiLayerImportModal({ olImport, catalogs, doImportOptiLayer, setOlImport, me, c }) {
    return catalogPickerOverlay({
        onDismiss: () => setOlImport(null),
        title: me.importTargetTitle(olImport.count),
        c, minWidth: 280, maxWidth: 380,
        extraStyle: { maxHeight: '70vh', display: 'flex', flexDirection: 'column' },
        children: [
            h('div', { key: 'list', style: { overflowY: 'auto' } },
                catalogs.filter(cat => cat.id !== 'builtin').map(cat =>
                    catalogPickerRow(cat, () => doImportOptiLayer(cat.id), c, true))
            ),
            h('div', {
                key: 'new',
                onClick: () => doImportOptiLayer('__new__'),
                style: { padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: c.accent, fontWeight: 600, borderTop: `1px solid ${c.border}`, marginTop: 4 },
                onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
                onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
            }, me.importTargetNew)
        ],
    });
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
        const cat = catalogs.find(cc => cc.id === catId);
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
        } else if (window.confirm(me.deleteCatalogConfirm(cat.name))) {
            doDelete();
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
        const src = catalogs.find(cc => cc.id === srcId);
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
        const cat = catalogs.find(cc => cc.id === catalogId);
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
            const cat = getCatalogs().find(cc => cc.id === draft.catalogId);
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
        const cat = getCatalogs().find(cc => cc.id === targetCatId);
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
        } else if (window.confirm(me.deleteConfirm(editDraft.name || editDraft.id))) {
            doDelete();
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
        setSampledTable(sampleReadOnlyChart(chartRef.current, selectedMat, c, me));
    }, [selectedMat, c, editDraft]);

    const handleRiiAdded = useCallback((catId) => {
        loadCatalogs();
        setCatFilter(catId);
    }, [loadCatalogs]);

    const leftPanelState = {
        c, me, notification, query, setQuery,
        handleImport, importing, handleImportOptiLayer, setShowRii,
        showNewCatalog, setShowNewCatalog, newCatalogName, setNewCatalogName, handleCreateCatalog,
        catFilter, setCatFilter, setEditDraft, catalogs, currentCatalog, isUserCatalog,
        handleNewMaterial, handleDuplicateCatalog, handleRemoveCatalog,
        results, editDraft, selectedId, handleSelectMaterial,
    };

    const rightPanel = h('div', {
        style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: c.bg }
    },
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
            : !selectedMat
                ? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim, fontSize: 13, fontStyle: 'italic' } }, me.selectMaterial)
                : renderReadOnlyMaterial({ selectedMat, sampledTable, chartRef, openCopyPicker, me, t, c })
    );

    return h('div', {
        style: { display: 'flex', height: '100%', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13, color: c.text }
    },
        renderLeftPanel(leftPanelState),
        rightPanel,
        showRii && h(RIIBrowser, { c, t, onClose: () => setShowRii(false), onAdded: handleRiiAdded }),
        // Destination-catalog picker (shown when there are ≥2 user catalogs).
        copyPickerFor && renderCopyPickerModal({ copyPickerFor, catalogs, doCopyToCatalog, setCopyPickerFor, me, c }),
        // OptiLayer import: choose destination catalog (any non-builtin) or create new.
        olImport && renderOptiLayerImportModal({ olImport, catalogs, doImportOptiLayer, setOlImport, me, c })
    );
}
