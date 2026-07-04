/**
 * Needle Manual insertion window.
 *
 * The companion to "Needle Automatic" (the scan→insert→DLS→repeat loop in
 * NeedleVariation.js). Here the designer drives the insertion by hand:
 *
 *   1. Compute the P-function profile ∂MF/∂d_needle along the stack depth z,
 *      one curve per candidate material (Tikhonravov 1996; Sullivan &
 *      Dobrowolski 1996). Curves below zero mark depths where a thin needle of
 *      that material lowers the merit function.
 *   2. Click a point on a curve to pick a position (z) + material.
 *   3. Preview the resulting split-layer geometry and the predicted ΔMF, and
 *      tune the inserted thickness d_new with a slider.
 *   4. Apply — a single insertion (optionally followed by one DLS refinement
 *      pass), recorded as a normal history entry.
 *
 * Reuses the validated math from optimizer.js verbatim:
 *   • scanNeedlesPFunction   — analytic P-function (FD fallback)
 *   • insertNeedle / insertNeedleIntra — gap / intra-layer insertion (auto-mirror in symmetric)
 *   • findOptimalNeedleThickness       — golden-section thickness for the initial d_new
 *
 * Reference: Tikhonravov et al., Applied Optics 35(28), 5493 (1996);
 *            Sullivan & Dobrowolski, Applied Optics 35(28), 5484 (1996).
 */

import { useDesign } from '../../state/DesignContext.js';
import { OptimizeBadge, EvalModeBadge } from '../SurfaceModeBar.js';
import { getMaterialById, getCatalogs } from '../../utils/materials/catalogManager.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import {
    scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, mirrorLayers,
    DLSOptimizer, resolveScanSide, isConstraint,
    buildEvalContext, evaluateOperands, calcMF,
} from '../../utils/physics/optimizer.js';
import { WARN_BADGE_STYLE } from './synthesisHelpers.js';

const { createElement: h, useState, useEffect, useRef, useCallback, useMemo } = React;

// ── Helpers (mirrors the small ones in NeedleVariation, kept local) ───────────

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function matDisplayName(id) {
    if (!id) return '';
    const parts = id.split(':');
    return parts[parts.length - 1];
}

const MAT_COLORS = {
    TiO2: '#e53935', SiO2: '#1e88e5', Ta2O5: '#8e24aa', Nb2O5: '#43a047',
    HfO2: '#fb8c00', Al2O3: '#00acc1', ZnS:   '#fdd835', ZnSe:  '#f06292',
    Si:   '#546e7a', Ge:    '#78909c', MgF2:  '#80cbc4', ITO:   '#aed581',
    Au:   '#ffd54f', Ag:    '#b0bec5', Cr:    '#8d6e63', BK7:   '#ab47bc',
};

function matColor(id) {
    const name = matDisplayName(id);
    if (MAT_COLORS[name]) return MAT_COLORS[name];
    let hsh = 0;
    for (let i = 0; i < id.length; i++) hsh = (hsh * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${(hsh * 137) % 360}, 65%, 55%)`;
}

const NEEDLE_MANUAL_CATS_KEY = 'tfstudio_needleManual_selectedCats';

function loadSavedCatSelection() {
    try {
        const raw = localStorage.getItem(NEEDLE_MANUAL_CATS_KEY);
        if (raw) return new Set(JSON.parse(raw));
    } catch (_) {}
    return null;
}
function saveCatSelection(set) {
    try { localStorage.setItem(NEEDLE_MANUAL_CATS_KEY, JSON.stringify([...set])); } catch (_) {}
}

// Candidate materials from the selected catalogs (skips Air/Vacuum + anything
// with n < 1.05 at 550 nm — same gate as NeedleVariation's getPoolMaterials).
function getPoolMaterials(selectedCatalogIds) {
    const result = [];
    for (const cat of getCatalogs()) {
        if (!selectedCatalogIds.has(cat.id)) continue;
        for (const [matKey] of Object.entries(cat.materials || {})) {
            if (matKey === 'Air' || matKey === 'Vacuum') continue;
            const fullId = cat.id === 'builtin' ? matKey : `${cat.id}:${matKey}`;
            const mat    = getMaterialById(fullId);
            if (!mat) continue;
            try {
                const nk = mat.getNK(550);
                const n  = Array.isArray(nk) ? nk[0] : (nk?.n ?? 1);
                if (typeof n === 'number' && n < 1.05) continue;
            } catch (_) { continue; }
            result.push({ id: fullId, mat, name: matDisplayName(fullId) });
        }
    }
    return result;
}

// Which layer array a side maps to.
const sideKey = (side) => (side === 'back' ? 'backLayers' : 'frontLayers');

// Cumulative depth boundaries for a layer array: returns z[0..N] with z[0]=0,
// z[k+1]=z[k]+d_k. z is the physical depth (nm) into the stack in storage order.
function depthBoundaries(layers) {
    const z = [0];
    for (const l of layers) z.push(z[z.length - 1] + (l.thickness || 0));
    return z;
}

// Map a scan candidate to its physical depth z (nm) within the side stack.
function candidateDepth(cand, zb) {
    if (cand.intra) {
        const z0 = zb[cand.layerK] ?? 0;
        const z1 = zb[cand.layerK + 1] ?? z0;
        return z0 + cand.frac * (z1 - z0);
    }
    return zb[cand.pos] ?? 0;   // gap index → boundary depth
}

// ── P-function profile plot ───────────────────────────────────────────────────

function PFunctionPlot({ traces, boundaries, bands, totalZ, selected, onPick, c, theme }) {
    const divRef   = useRef(null);
    const initRef  = useRef(false);
    const pickRef  = useRef(onPick);
    const mapRef   = useRef([]);           // curveNumber → candidate[]
    useEffect(() => { pickRef.current = onPick; }, [onPick]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const bg    = c.bg     || '#1e1e1e';
        const panel = c.panel  || '#252526';
        const grid  = c.border || '#3a3a3a';
        const txt   = c.text   || '#ccc';

        // Material traces FIRST so curveNumber == trace index in `traces`.
        mapRef.current = traces.map(t => t.cands);
        const matTraces = traces.map(t => ({
            x: t.xs, y: t.ys,
            type: 'scatter', mode: 'lines+markers',
            name: t.name,
            line:   { color: t.color, width: 1.5 },
            marker: { color: t.color, size: 5 },
            hovertemplate: `${t.name}<br>z = %{x:.1f} nm<br>∂MF/∂d = %{y:.3e}<extra></extra>`,
        }));

        // Zero reference line (after material traces → higher curveNumber, ignored on click).
        const zeroTrace = {
            x: [0, totalZ || 1], y: [0, 0],
            type: 'scatter', mode: 'lines',
            line: { color: '#888', dash: 'dot', width: 1 },
            hoverinfo: 'skip', showlegend: false,
        };

        // Selected-point marker.
        const selTraces = [];
        if (selected) {
            selTraces.push({
                x: [selected.z], y: [selected.grad],
                type: 'scatter', mode: 'markers',
                marker: { color: '#fff', size: 11, symbol: 'circle-open', line: { width: 2.5, color: matColor(selected.materialId) } },
                hoverinfo: 'skip', showlegend: false,
            });
        }

        // Layer boundaries (vertical guides) + material bands (paper-y strip at bottom).
        const shapes = [];
        for (const zb of boundaries) {
            shapes.push({
                type: 'line', x0: zb, x1: zb, yref: 'paper', y0: 0, y1: 1,
                line: { color: grid, width: 0.6, dash: 'dot' },
            });
        }
        for (const b of bands) {
            shapes.push({
                type: 'rect', x0: b.z0, x1: b.z1, yref: 'paper', y0: 0, y1: 0.05,
                fillcolor: b.color, opacity: 0.55, line: { width: 0 }, layer: 'below',
            });
        }

        const layout = {
            margin: { l: 56, r: 8, t: 6, b: 34 },
            paper_bgcolor: panel, plot_bgcolor: bg,
            font: { color: txt, family: 'system-ui, sans-serif', size: 10 },
            xaxis: { title: { text: 'Stack depth z (nm)', standoff: 4 }, gridcolor: grid, range: [0, totalZ || 1], zeroline: false },
            yaxis: { title: { text: '∂MF/∂d  (< 0 improves)', standoff: 4 }, gridcolor: grid, zeroline: false },
            shapes,
            showlegend: true,
            legend: { orientation: 'h', y: -0.18, font: { size: 9 } },
            hovermode: 'closest',
        };

        const data = [...matTraces, zeroTrace, ...selTraces];

        if (!initRef.current) {
            Plotly.newPlot(divRef.current, data, layout, { responsive: true, displayModeBar: false })
                .then((gd) => {
                    if (!gd || !gd.on) return;
                    gd.on('plotly_click', (ev) => {
                        const pt = ev?.points?.[0];
                        if (!pt) return;
                        const cands = mapRef.current[pt.curveNumber];
                        if (!cands) return;        // clicked the zero line / selected marker
                        const cand = cands[pt.pointNumber];
                        if (cand && pickRef.current) pickRef.current(cand);
                    });
                })
                .catch(() => {});
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, data, layout);
        }
    }, [traces, boundaries, bands, totalZ, selected, theme]);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Left sidebar (material pool + settings) ───────────────────────────────────

function LeftSidebar({
    catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
    deltaNm, dMin, nIntra, refineAfter, dlsIter,
    onDeltaNm, onDMin, onNIntra, onRefineAfter, onDlsIter,
    showSideRadio, requestedSide, onRequestedSide,
    busy, c, t,
}) {
    const tn = t.needleManual;

    const miniBtn = (label, onClick) => h('button', {
        onClick, disabled: busy,
        style: {
            padding: '1px 8px', fontSize: 10, borderRadius: 2,
            background: 'transparent', color: busy ? c.textDim : c.text,
            border: `1px solid ${c.border}`, cursor: busy ? 'default' : 'pointer',
            fontFamily: 'inherit', opacity: busy ? 0.5 : 1,
        }
    }, label);

    const numRow = (label, value, onChange, min, step = 1) =>
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 } },
            h('span', { style: { fontSize: 11, color: c.textDim } }, label),
            h('input', {
                type: 'number', value, min, step, disabled: busy,
                onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); },
                style: {
                    width: 58, padding: '1px 4px', fontSize: 11, textAlign: 'right',
                    background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                    borderRadius: 2, opacity: busy ? 0.5 : 1,
                }
            })
        );

    return h('div', {
        style: {
            width: 200, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', background: c.panel, overflow: 'hidden',
        }
    },
        // Material pool
        h('div', {
            style: { padding: '6px 8px', borderBottom: `1px solid ${c.border}`, flex: 1, overflow: 'auto' }
        },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 } },
                h('div', { style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' } }, tn.materialPool),
                h('div', { style: { display: 'flex', gap: 4 } },
                    miniBtn(tn.poolAll,   () => !busy && onSelectAllCats && onSelectAllCats()),
                    miniBtn(tn.poolClear, () => !busy && onClearCats && onClearCats()),
                )
            ),
            catalogs.map(cat => {
                const matCount = Object.keys(cat.materials || {}).length;
                const checked  = selectedCats.has(cat.id);
                return h('label', {
                    key: cat.id,
                    style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: busy ? 'default' : 'pointer', fontSize: 12, userSelect: 'none' }
                },
                    h('input', { type: 'checkbox', checked, disabled: busy, onChange: () => !busy && onToggleCat(cat.id) }),
                    h('span', { style: { color: checked ? c.text : c.textDim } },
                        cat.name, ' ', h('span', { style: { color: c.textDim, fontSize: 10 } }, `(${matCount})`))
                );
            })
        ),
        // Settings
        h('div', { style: { padding: '6px 8px', flexShrink: 0 } },
            h('div', { style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 } }, tn.settings),
            showSideRadio && h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 } },
                h('span', { style: { fontSize: 11, color: c.textDim } }, tn.side),
                ['front', 'back'].map(sd => h('label', {
                    key: sd, style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: busy ? 'default' : 'pointer' }
                },
                    h('input', { type: 'radio', name: 'nm-side', checked: requestedSide === sd, disabled: busy, onChange: () => onRequestedSide(sd) }),
                    sd === 'front' ? tn.front : tn.back
                ))
            ),
            numRow(tn.deltaNm, deltaNm, v => onDeltaNm(Math.max(0.05, v)), 0.05, 0.1),
            numRow(tn.dMin,    dMin,    v => onDMin(Math.max(0.1, v)),     0.1,  1.0),
            numRow(tn.profileRes, nIntra, v => onNIntra(Math.max(2, Math.min(60, Math.round(v)))), 2, 1),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: c.textDim, margin: '4px 0 3px' } },
                h('input', { type: 'checkbox', checked: refineAfter, disabled: busy, onChange: e => onRefineAfter(e.target.checked) }),
                tn.refineAfter),
            refineAfter && numRow(tn.dlsIter, dlsIter, v => onDlsIter(Math.max(10, Math.round(v))), 10)
        )
    );
}

// ── Insertion preview / apply panel ───────────────────────────────────────────

function PreviewPanel({ selected, hostInfo, dNew, dRange, predictedMF, mf0, onDNew, onApply, busy, c, t }) {
    const tn = t.needleManual;
    if (!selected) {
        return h('div', { style: { padding: '12px 12px', color: c.textDim, fontSize: 12, fontStyle: 'italic' } }, tn.clickHint);
    }

    const name  = matDisplayName(selected.materialId);
    const dMF   = (predictedMF != null && mf0 != null) ? (predictedMF - mf0) : null;
    const dMFColor = dMF == null ? c.text : (dMF < 0 ? c.success : c.error);

    const geom = selected.intra
        ? tn.geomIntra(name, selected.layerK + 1, matDisplayName(hostInfo.hostMat),
            hostInfo.d1.toFixed(1), dNew.toFixed(1), hostInfo.d2.toFixed(1))
        : tn.geomGap(name, selected.z.toFixed(1), hostInfo.gapLabel);

    return h('div', { style: { padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 7 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { width: 12, height: 12, borderRadius: 2, background: matColor(selected.materialId), display: 'inline-block' } }),
            h('span', { style: { fontSize: 13, fontWeight: 700, color: c.text } }, name),
            h('span', { style: { fontSize: 11, color: c.textDim } }, `z = ${selected.z.toFixed(1)} nm`),
        ),
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.4 } }, geom),
        // Thickness slider
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' } }, tn.dNew),
            h('input', {
                type: 'range', min: dRange[0], max: dRange[1], step: 0.5, value: dNew, disabled: busy,
                onChange: e => onDNew(parseFloat(e.target.value)),
                style: { flex: 1 }
            }),
            h('input', {
                type: 'number', min: dRange[0], max: dRange[1], step: 0.5, value: +dNew.toFixed(2), disabled: busy,
                onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onDNew(v); },
                style: { width: 64, padding: '1px 4px', fontSize: 11, textAlign: 'right', background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2 }
            }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, 'nm'),
        ),
        // Predicted MF block (full MF — includes thickness constraints)
        h('div', { style: { display: 'flex', gap: 16, fontSize: 11, color: c.textDim } },
            h('span', null, tn.mf0, ' ', h('b', { style: { color: c.text } }, mf0 == null ? '—' : mf0.toFixed(6))),
            h('span', null, tn.mfPred, ' ', h('b', { style: { color: c.text } }, predictedMF == null ? '—' : predictedMF.toFixed(6))),
            h('span', null, tn.dMF, ' ', h('b', { style: { color: dMFColor } }, dMF == null ? '—' : (dMF < 0 ? '' : '+') + dMF.toFixed(6))),
        ),
        h('div', null,
            h('button', {
                onClick: onApply, disabled: busy,
                style: {
                    padding: '4px 16px', fontSize: 12, border: 'none', borderRadius: 3,
                    background: busy ? c.border : c.success, color: '#fff',
                    cursor: busy ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
                }
            }, tn.apply)
        )
    );
}

// ── Main window ───────────────────────────────────────────────────────────────

export function NeedleManual({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();
    const tn = t.needleManual;

    // Settings
    const [deltaNm,     setDeltaNm]     = useState(0.5);
    const [dMin,        setDMin]        = useState(1.0);
    const [nIntra,      setNIntra]      = useState(16);
    const [refineAfter, setRefineAfter] = useState(true);
    const [dlsIter,     setDlsIter]     = useState(80);
    const [requestedSide, setRequestedSide] = useState('front');
    const [selectedCats, setSelectedCats] = useState(() => {
        const saved  = loadSavedCatSelection();
        const allIds = new Set(getCatalogs().map(cat => cat.id));
        if (!saved) return allIds;
        const filtered = new Set([...allIds].filter(id => saved.has(id)));
        return filtered.size > 0 ? filtered : allIds;
    });

    // Scan + selection state
    const [scan,      setScan]      = useState(null);   // { candidates, mf0, side, zb, layers }
    const [scanning,  setScanning]  = useState(false);
    const [refining,  setRefining]  = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [selected,  setSelected]  = useState(null);   // { ...candidate, z, grad }
    const [dNew,      setDNew]       = useState(1.0);
    const [predictedMF, setPredictedMF] = useState(null);   // full MF after insert
    const [mfNow,  setMfNow]  = useState(null);             // full MF of current design

    const busy = scanning || refining;
    const surfaceMode = design?.surfaceMode || 'front_only';
    const effSide = resolveScanSide(surfaceMode, requestedSide);
    const showSideRadio = surfaceMode === 'both_independent';

    const operands = useMemo(() => (design?.meritOperands || []).filter(op => op.enabled), [design]);

    // Flip the global isOptimizing flag while a DLS refine runs (throttles live
    // previews in other windows, matches NeedleVariation).
    useEffect(() => {
        if (!refining) return;
        beginOptimization();
        return () => endOptimization();
    }, [refining, beginOptimization, endOptimization]);

    // Clear selection + scan when the design or active side changes.
    useEffect(() => {
        setScan(null); setSelected(null); setPredictedMF(null); setStatusMsg('');
    }, [design?.id, effSide]);

    // ── Compute the P-function profile ──────────────────────────────────────────
    const computeProfile = useCallback(() => {
        if (!design) return;
        const ops = operands.filter(op => !isConstraint(op.type));   // synthesis = unconstrained
        if (ops.length === 0) { setStatusMsg(tn.noOperands); return; }
        const pool = getPoolMaterials(selectedCats);
        if (!pool.length) { setStatusMsg(tn.noMaterials); return; }

        setScanning(true); setStatusMsg(tn.scanning); setSelected(null); setPredictedMF(null);
        // Defer so the "Scanning…" status paints before the (synchronous) scan.
        setTimeout(() => {
            try {
                const res = scanNeedlesPFunction({
                    operands: ops, design, resolveMat, candidateMats: pool,
                    deltaNm, nIntra, side: requestedSide,
                });
                if (!res || !res.candidates || !res.candidates.length) {
                    setScan(null);
                    setStatusMsg(tn.alreadyOptimal);
                } else {
                    const layers = design[sideKey(effSide)] || [];
                    const zb = depthBoundaries(layers);
                    setScan({ ...res, side: effSide, zb, layers });
                    const improving = res.candidates.filter(cc => cc.grad < 0).length;
                    setStatusMsg(tn.scanDone(res.candidates.length, improving));
                }
            } catch (err) {
                console.error('[NeedleManual] scan failed:', err);
                setStatusMsg(tn.scanError);
                setScan(null);
            } finally {
                setScanning(false);
            }
        }, 0);
    }, [design, operands, selectedCats, deltaNm, nIntra, requestedSide, effSide, tn]);

    // ── Build plot traces (one per candidate material) ──────────────────────────
    const plotData = useMemo(() => {
        if (!scan) return { traces: [], boundaries: [], bands: [], totalZ: 1 };
        const zb = scan.zb;
        const totalZ = zb[zb.length - 1] || 1;

        // Group candidates by material, attach depth z, sort by z.
        const byMat = new Map();
        for (const cand of scan.candidates) {
            const z = candidateDepth(cand, zb);
            const entry = byMat.get(cand.materialId) || [];
            entry.push({ ...cand, z });
            byMat.set(cand.materialId, entry);
        }
        const traces = [];
        for (const [matId, cands] of byMat) {
            cands.sort((a, b) => a.z - b.z);
            traces.push({
                materialId: matId, name: matDisplayName(matId), color: matColor(matId),
                xs: cands.map(cc => cc.z), ys: cands.map(cc => cc.grad), cands,
            });
        }
        traces.sort((a, b) => (a.name < b.name ? -1 : 1));

        const bands = (scan.layers || []).map((l, k) => ({
            z0: zb[k], z1: zb[k + 1], color: matColor(l.material),
        }));
        return { traces, boundaries: zb, bands, totalZ };
    }, [scan]);

    // ── Selection → host geometry + initial d_new ───────────────────────────────
    const hostInfo = useMemo(() => {
        if (!selected || !scan) return null;
        if (selected.intra) {
            const layers = scan.layers;
            const host = layers[selected.layerK];
            const dk = host?.thickness || 0;
            return {
                hostMat: host?.material,
                d1: Math.max(selected.frac * dk, dMin),
                d2: Math.max((1 - selected.frac) * dk, dMin),
                hostThickness: dk,
            };
        }
        // gap → describe neighbours
        const layers = scan.layers, p = selected.pos, N = layers.length;
        let gapLabel;
        if (p === 0)      gapLabel = tn.gapIncident(matDisplayName(layers[0]?.material) || '—');
        else if (p === N) gapLabel = tn.gapSubstrate(matDisplayName(layers[N - 1]?.material) || '—');
        else              gapLabel = tn.gapBetween(p, matDisplayName(layers[p - 1]?.material), p + 1, matDisplayName(layers[p]?.material));
        return { gapLabel, hostThickness: 0 };
    }, [selected, scan, dMin, tn]);

    const dRange = useMemo(() => {
        if (!selected) return [dMin, 200];
        if (selected.intra && hostInfo) {
            const hi = Math.max(dMin * 2, hostInfo.hostThickness - dMin);
            return [dMin, Math.max(hi, dMin + 1)];
        }
        return [dMin, 200];
    }, [selected, hostInfo, dMin]);

    const handlePick = useCallback((cand) => {
        const zb = scan?.zb || [0];
        const z = candidateDepth(cand, zb);
        setSelected({ ...cand, z, grad: cand.grad });
        // Initial d_new = golden-section optimum, clamped to the slider range.
        const pool = getPoolMaterials(selectedCats);
        const mat  = pool.find(p => p.id === cand.materialId)?.mat || resolveMat(cand.materialId);
        let d0 = dMin;
        try {
            const ops = operands.filter(op => !isConstraint(op.type));
            d0 = findOptimalNeedleThickness({
                operands: ops, design, resolveMat,
                candidate: { ...cand, _mat: mat }, deltaNm: dMin, maxNm: 200, tol: 0.5, side: requestedSide,
            });
            if (!(d0 >= dMin)) d0 = dMin;
        } catch (_) { d0 = dMin; }
        setDNew(d0);
    }, [scan, selectedCats, operands, design, dMin, requestedSide]);

    // Clamp d_new into range when the selection / range changes.
    useEffect(() => {
        if (!selected) return;
        setDNew(prev => Math.min(Math.max(prev, dRange[0]), dRange[1]));
    }, [dRange[0], dRange[1], selected]);

    // ── Predicted MF/OMF at d_new (exact, via calcMF on the inserted design) ─────
    // We surface BOTH the full MF (with MNT/MXT/TT constraints) and the optical
    // OMF (skipConstraints) for the current design and the post-insert design.
    useEffect(() => {
        if (!selected || !scan || !design) {
            setPredictedMF(null); setMfNow(null);
            return;
        }
        const id = setTimeout(() => {
            try {
                const ops = operands;   // full enabled set (mf0 from scan also used all enabled ops)
                // Current design (now).
                const compNow = evaluateOperands(ops, buildEvalContext(design, resolveMat));
                setMfNow(calcMF(ops, compNow));
                // Post-insert design (after).
                const inserted = selected.intra
                    ? insertNeedleIntra(design, selected.layerK, selected.frac, selected.materialId, dNew, requestedSide)
                    : insertNeedle(design, selected.pos, selected.materialId, dNew, requestedSide);
                const compIns = evaluateOperands(ops, buildEvalContext(inserted, resolveMat));
                setPredictedMF(calcMF(ops, compIns));
            } catch (_) { setPredictedMF(null); setMfNow(null); }
        }, 30);
        return () => clearTimeout(id);
    }, [selected, dNew, scan, design, operands, requestedSide]);

    // ── Apply the insertion ─────────────────────────────────────────────────────
    const refineTimerRef = useRef(null);
    useEffect(() => () => clearTimeout(refineTimerRef.current), []);

    const handleApply = useCallback(() => {
        if (!selected || !design || busy) return;
        checkpoint && checkpoint();   // one undo step covers insert (+ refine)

        const inserted = selected.intra
            ? insertNeedleIntra(design, selected.layerK, selected.frac, selected.materialId, dNew, requestedSide)
            : insertNeedle(design, selected.pos, selected.materialId, dNew, requestedSide);

        const commitPatch = (d) => {
            const patch = { frontLayers: d.frontLayers, backLayers: d.backLayers };
            updateDesign(patch);
        };

        if (!refineAfter) {
            commitPatch(inserted);
            setStatusMsg(tn.inserted(matDisplayName(selected.materialId)));
            setScan(null); setSelected(null); setPredictedMF(null);
            return;
        }

        // Single DLS refinement pass, async-ticked so the UI stays responsive.
        let dls;
        try {
            dls = new DLSOptimizer(operands, inserted, resolveMat, { dMin });
        } catch (err) {
            console.error('[NeedleManual] DLS init failed, committing un-refined:', err);
            commitPatch(inserted);
            setStatusMsg(tn.inserted(matDisplayName(selected.materialId)));
            setScan(null); setSelected(null); setPredictedMF(null);
            return;
        }
        setRefining(true);
        setStatusMsg(tn.refining);

        const tick = () => {
            dls.step();
            const done = dls.isConverged() || dls.iter >= dlsIter;
            // Live preview of the refining stack.
            const cur = dls.applyToDesign(inserted);
            updateDesign({ frontLayers: cur.frontLayers, backLayers: cur.backLayers }, { transient: true });
            if (!done) { refineTimerRef.current = setTimeout(tick, 0); return; }

            let finalD = dls.applyToDesign(inserted);
            if (surfaceMode === 'symmetric') {
                finalD = { ...finalD, backLayers: mirrorLayers(finalD.frontLayers) };
            }
            updateDesign({ frontLayers: finalD.frontLayers, backLayers: finalD.backLayers });
            setRefining(false);
            setStatusMsg(tn.insertedRefined(matDisplayName(selected.materialId), dls.mf.toFixed(6)));
            setScan(null); setSelected(null); setPredictedMF(null);
        };
        refineTimerRef.current = setTimeout(tick, 0);
    }, [selected, design, busy, dNew, refineAfter, requestedSide, operands, dMin, dlsIter, surfaceMode, checkpoint, updateDesign, tn]);

    // ── Catalog toggle ──────────────────────────────────────────────────────────
    const handleToggleCat = useCallback((catId) => {
        setSelectedCats(prev => {
            const next = new Set(prev);
            if (next.has(catId)) next.delete(catId); else next.add(catId);
            saveCatSelection(next);
            return next;
        });
    }, []);

    const handleSelectAllCats = useCallback(() => {
        const next = new Set(getCatalogs().map(cat => cat.id));
        saveCatSelection(next);
        setSelectedCats(next);
    }, []);

    const handleClearCats = useCallback(() => {
        const next = new Set();
        saveCatSelection(next);
        setSelectedCats(next);
    }, []);

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tn.noDesign);
    }

    const catalogs = getCatalogs();

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
        }
    },
        // Top action bar
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
            }
        },
            h('button', {
                onClick: computeProfile, disabled: busy,
                style: {
                    padding: '3px 14px', fontSize: 12, border: 'none', borderRadius: 3,
                    background: busy ? c.border : '#0288d1', color: '#fff',
                    cursor: busy ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
                }
            }, scanning ? tn.scanningBtn : tn.compute),
            h(OptimizeBadge, { design, c, t }),
            h(EvalModeBadge, { design, c, t }),
            h('div', { style: { flex: 1 } }),
            statusMsg && h('span', {
                style: statusMsg === tn.noOperands
                    ? { ...WARN_BADGE_STYLE }
                    : { fontSize: 11, color: busy ? (c.accent || '#ffa726') : c.textDim, fontStyle: 'italic' }
            }, statusMsg)
        ),

        h('div', { style: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 } },
            h(LeftSidebar, {
                catalogs, selectedCats, onToggleCat: handleToggleCat,
                onSelectAllCats: handleSelectAllCats, onClearCats: handleClearCats,
                deltaNm, dMin, nIntra, refineAfter, dlsIter,
                onDeltaNm: setDeltaNm, onDMin: setDMin, onNIntra: setNIntra,
                onRefineAfter: setRefineAfter, onDlsIter: setDlsIter,
                showSideRadio, requestedSide, onRequestedSide: setRequestedSide,
                busy, c, t,
            }),

            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                // P-function plot (upper)
                h('div', {
                    style: { flex: 1, borderBottom: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }
                },
                    h('div', {
                        style: { padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
                    }, tn.profileTitle),
                    h('div', { style: { flex: 1, overflow: 'hidden' } },
                        !scan
                            ? h('div', {
                                style: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: 20 }
                              }, tn.noProfile)
                            : h(PFunctionPlot, {
                                traces: plotData.traces, boundaries: plotData.boundaries,
                                bands: plotData.bands, totalZ: plotData.totalZ,
                                selected, onPick: handlePick, c, theme,
                            })
                    )
                ),
                // Preview / apply panel (lower)
                h('div', { style: { flexShrink: 0, maxHeight: 220, overflow: 'auto' } },
                    h('div', {
                        style: { padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${c.border}` }
                    }, tn.previewTitle),
                    h(PreviewPanel, {
                        selected, hostInfo: hostInfo || {}, dNew, dRange,
                        predictedMF, mf0: mfNow,
                        onDNew: setDNew, onApply: handleApply, busy, c, t,
                    })
                )
            )
        )
    );
}
