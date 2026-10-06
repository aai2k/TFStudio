/**
 * Material Editor — read-only material view (builtin/AGF/RII materials).
 *
 * Renders the property grid, dispersion-formula block, sampled/stored n,k
 * table, and the n/k preview chart for a material that isn't a user-catalog
 * draft (those get the editable UserMaterialForm instead).
 */

import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { drawIndexChart } from './materialChart.js';
import { FORMULA_LATEX, coefficientNames, formulaLatex } from '../../../../utils/materials/dispersionFormulas.js';
import { MECHANICAL_FIELDS, MECHANICAL_UNITS, mechanicalToDisplay } from '../../../../utils/materials/mechanical.js';
import {
    KaTeXSpan, NkProbe, detailTabStrip, dotStyle, statusBadge, propRow,
    coefficientChips, formatNm, formatK, formatN, smallBtn, unitLabel,
} from './materialEditorUI.js';
import { useVirtualRows, virtualBody } from '../../../ui/virtualRows.js';

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
    drawIndexChart(chartEl, {
        wavelengths: lambdas, n: ns, k: ks, hasK, c,
        xLabel: me.wavelengthNm, nLabel: me.chartN, kLabel: me.chartK,
    });
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

// Said of a material the design computes with its own copy, which can be
// copied into a catalog but not edited: no catalog here holds it, or the
// catalog named in `designOnly.conflict` holds another material under its id.
function designOriginBlock(designOnly, me, c) {
    if (!designOnly) return null;
    return h('div', {
        style: {
            margin: '8px 12px 0', padding: '6px 8px', fontSize: 11, lineHeight: 1.45,
            borderRadius: 4, backgroundColor: c.panel, color: c.textDim,
            border: `1px solid ${c.border}`,
        },
    }, designOnly.conflict ? me.designMaterialConflict(designOnly.conflict) : me.designMaterialAbsent);
}

function readOnlyPropsBlock(selectedMat, me, c) {
    return h('div', { style: { padding: '8px 12px', flexShrink: 0 } },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 12 } },
            selectedMat.nd && propRow(me.nd, selectedMat.nd.toFixed(5), c),
            selectedMat.vd && propRow(me.vd, selectedMat.vd.toFixed(2), c),
            selectedMat.density && propRow(me.density, `${selectedMat.density.toFixed(3)} g/cm³`, c),
            selectedMat.lambdaMin && propRow(me.lambdaRange, `${formatNm(selectedMat.lambdaMin * 1000)} – ${formatNm(selectedMat.lambdaMax * 1000)} nm`, c),
            selectedMat.comment && propRow(me.comment, selectedMat.comment, c)
        )
    );
}

// The thermo-mechanical constants a catalog brought with it. Only the fields
// the material actually states are listed, the way every row above behaves;
// a material that states none says so rather than showing seven blanks.
function readOnlyMechanicalBlock(selectedMat, me, c) {
    const block = selectedMat.mechanical;
    const stated = MECHANICAL_FIELDS.filter(field => Number.isFinite(block?.[field]));
    if (!stated.length) {
        return h('div', { style: { padding: '10px 12px', fontSize: 12, color: c.textDim, fontStyle: 'italic' } },
            me.mechanicalNone);
    }
    return h('div', { style: { padding: '8px 12px', flexShrink: 0 } },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 12 } },
            stated.map(field => propRow(
                unitLabel(me.mechanicalFields[field], MECHANICAL_UNITS[field]),
                String(mechanicalToDisplay(field, block[field])),
                c,
            )))
    );
}

export function readOnlyFormulaBlock(selectedMat, me, c) {
    if (!(selectedMat.formulaNum > 0)) return null;
    const info = FORMULA_LATEX[selectedMat.formulaNum];
    return h('div', { style: { padding: '0 12px 8px', flexShrink: 0, borderTop: `1px solid ${c.border}`, paddingTop: 8 } },
        h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, me.formula),
        info && h('div', { style: { padding: '6px 8px 8px', backgroundColor: c.panel, borderRadius: 4, border: `1px solid ${c.border}`, fontSize: 13, overflowX: 'auto', overflowY: 'hidden', color: c.text, fontStyle: 'italic', marginBottom: 6 } },
            h('div', { style: { marginBottom: 2, fontSize: 11, color: c.textDim } }, info.name),
            h(KaTeXSpan, { latex: formulaLatex(selectedMat.formulaNum, selectedMat.coefficients?.length ?? 0), displayMode: true })
        ),
        selectedMat.coefficients?.length > 0 && h('div', null,
            h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } }, me.coefficients),
            coefficientChips(coefficientNames(selectedMat.formulaNum, selectedMat.coefficients.length), selectedMat.coefficients, c)
        )
    );
}

const NK_ROW_HEIGHT = 18;

// Only the rows in view are drawn (ui/virtualRows.js): a refractiveindex.info
// page can run to 60,000 rows.
function NkTable({ title, rows, c, wrapStyle, fill }) {
    const { paneRef, onScroll, first, end } = useVirtualRows(rows.length, NK_ROW_HEIGHT);
    const cell = { padding: '0 8px', height: NK_ROW_HEIGHT, whiteSpace: 'nowrap' };
    return h('div', {
        style: {
            flexShrink: 0, borderTop: `1px solid ${c.border}`, padding: '8px 12px 4px',
            ...(fill && { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }), ...wrapStyle,
        },
    },
        h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 } }, title),
        h('div', {
            ref: paneRef, onScroll,
            style: { ...(fill ? { flex: 1, minHeight: 0 } : { maxHeight: 150 }), overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 },
        },
            h('table', { style: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' } },
                h('thead', null, h('tr', { style: { position: 'sticky', top: 0, backgroundColor: c.panel } },
                    ['λ (nm)', 'n', 'k'].map((hd, i) =>
                        h('th', { key: i, style: { textAlign: i === 0 ? 'left' : 'right', padding: '3px 8px', color: c.textDim, borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, hd))
                )),
                h('tbody', null, virtualBody(rows, { first, end }, NK_ROW_HEIGHT, 3, (row, i) =>
                    h('tr', { key: i },
                        h('td', { style: { ...cell, color: c.text } }, (+row[0]).toFixed(1)),
                        h('td', { style: { ...cell, textAlign: 'right', color: c.text } }, formatN(+row[1])),
                        h('td', { style: { ...cell, textAlign: 'right', color: c.textDim } }, formatK(+(row[2] || 0)))
                    )
                ))
            )
        )
    );
}

// Scrollable table of [λ, n, k] rows, shared by the stored-tabData and the
// sampled views (title and row source differ, structure is identical).
// `wrapStyle` lets a host with its own gutter override the outer padding.
// With `fill` the table takes the height its host gives it instead of a
// 150 px box.
export function readOnlyNkTable(title, rows, c, wrapStyle, fill) {
    return h(NkTable, { title, rows, c, wrapStyle, fill });
}

export function renderReadOnlyMaterial({
    selectedMat, sampledTable, chartRef, openCopyPicker, designOnly,
    detailTab, setDetailTab, me, t, c,
}) {
    const hasStoredTab = selectedMat.formulaNum === -1 && selectedMat.tabData?.length > 0;
    const tab = detailTab || 'nk';
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
        // Where the material came from and what identifies it stay above the
        // tabs. The cap is for a catalog comment long enough to push the strip
        // out of the pane.
        h('div', { style: { flexShrink: 0, maxHeight: 180, overflowY: 'auto' } },
            designOriginBlock(designOnly, me, c),
            readOnlyPropsBlock(selectedMat, me, c)
        ),
        detailTabStrip({ tab, setTab: setDetailTab, me, c, wrapStyle: { padding: '0 8px' } }),
        tab === 'mechanical' && h('div', { style: { flex: 1, overflowY: 'auto' } },
            readOnlyMechanicalBlock(selectedMat, me, c)),
        tab === 'nk' && h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
            readOnlyFormulaBlock(selectedMat, me, c),
            // n/k chart, then the numbers under it: a probe at one wavelength and
            // the table (stored rows for table materials, sampled from getNK for
            // built-in functions and dispersion formulas).
            h('div', { style: { padding: '4px 0', flexShrink: 0, borderTop: `1px solid ${c.border}` } },
                h('div', { style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, margin: '4px 12px 2px' } }, me.chartTitle),
                h('div', { ref: chartRef, style: { height: 200, padding: '0 4px' } })
            ),
            selectedMat.getNK && h('div', { style: { padding: '2px 12px 8px', flexShrink: 0 } },
                h(NkProbe, {
                    key: selectedMat.id,
                    getNK: selectedMat.getNK,
                    rangeNm: selectedMat.lambdaMin ? [selectedMat.lambdaMin * 1000, selectedMat.lambdaMax * 1000] : null,
                    c, me,
                })
            ),
            hasStoredTab && readOnlyNkTable(`${me.nkTable} (${selectedMat.tabData.length})`, selectedMat.tabData, c),
            !hasStoredTab && sampledTable.length > 0 && readOnlyNkTable(`${me.nkTableSampled} (${sampledTable.length})`, sampledTable, c)
        )
    );
}
