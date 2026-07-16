/**
 * Material Editor — read-only material view (builtin/AGF/RII materials).
 *
 * Renders the property grid, dispersion-formula block, sampled/stored n,k
 * table, and the n/k preview chart for a material that isn't a user-catalog
 * draft (those get the editable UserMaterialForm instead).
 */

import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { FORMULA_LATEX } from '../../../../utils/materials/dispersionFormulas.js';
import { KaTeXSpan, dotStyle, statusBadge, propRow, formatCoeff, smallBtn } from './materialEditorUI.js';

const { createElement: h } = React;

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
export function sampleReadOnlyChart(chartEl, selectedMat, c, me) {
    const curves = computeReadOnlyCurves(selectedMat);
    drawReadOnlyFigure(chartEl, curves, c, me);
    return sampleReadOnlyTable(curves.lambdas, selectedMat);
}

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

export function renderReadOnlyMaterial({ selectedMat, sampledTable, chartRef, openCopyPicker, me, t, c }) {
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
