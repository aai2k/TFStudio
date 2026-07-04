/**
 * Layer Sensitivity — rank each variable layer by its merit-function
 * sensitivity to small thickness variations.
 *
 *     ΔMF_j = MF(…, d_j ± Δd, …)        (central difference)
 *
 * Layers are scaled so the most sensitive layer = 100 %.
 */

import { useDesign }              from '../../state/DesignContext.js';
import { LockIcon }               from '../ui/LockIcon.js';
import { getMaterialById, resolveColor }        from '../../utils/materials/catalogManager.js';
import { getMaterial }            from '../../utils/materials/materialDatabase.js';
import { computeLayerSensitivity } from '../../utils/physics/errorAnalysis.js';
import { EvalModeBadge } from '../SurfaceModeBar.js';
import { SpecVerdict } from '../SpecVerdict.js';
import { DebouncedInput } from '../ui/DebouncedInput.js';

const { createElement: h, useState, useEffect, useMemo, useCallback, useRef } = React;

// Free-editing number field (DebouncedInput): clearable while typing, commits the
// parsed value on blur/Enter, empty/invalid -> fallback.
function numField(value, onNum, style, { fallback = 0 } = {}) {
    return h(DebouncedInput, {
        value: String(value),
        onChange: (v) => {
            const t = String(v).trim();
            const n = t === '' ? fallback : parseFloat(v);
            onNum(Number.isFinite(n) ? n : fallback);
        },
        style,
    });
}

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Layer numbering — match the Design Editor convention ──────────────────────
// In the Design Editor, layer 1 is the one **touching the substrate** (the
// front stack is shown reversed for this reason; see DesignEditor.js). The
// front array is stored incident→substrate, so the substrate-touching layer is
// the *last* index → display no. = frontCount − layerIndex. The back array is
// stored substrate→exit, so backLayers[0] already touches the substrate →
// display no. = layerIndex + 1.
function dispLayerNo(r, frontCount) {
    return r.side === 'back' ? r.layerIndex + 1 : frontCount - r.layerIndex;
}
function dispLayerLabel(r, frontCount) {
    return (r.side === 'back' ? 'B' : 'F') + dispLayerNo(r, frontCount);
}
// Substrate-first ordering, matching the Design Editor stack top-to-bottom:
// front group first, then back; within each side ascending display number.
function orderSubstrateFirst(rows, frontCount) {
    return [...rows].sort((a, b) => {
        if (a.side !== b.side) return a.side === 'back' ? 1 : -1;
        return dispLayerNo(a, frontCount) - dispLayerNo(b, frontCount);
    });
}

// ── Plotly bar chart ──────────────────────────────────────────────────────────

function SensitivityBars({ rows, matColorMap, scale, frontCount, c }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    const buildData = useCallback(() => {
        if (!rows?.length) return { data: [], layout: {} };

        const isAbs = scale === 'absolute';

        // Bars are pre-ordered substrate-first (matching the Design Editor);
        // labels use the DE layer numbering (layer 1 touches the substrate).
        const xLabels = rows.map(r => dispLayerLabel(r, frontCount));
        const yVals = rows.map(r => isAbs ? r.deltaMFAbs : r.sensitivity);
        const colors = rows.map(r => matColorMap[r.materialId] || '#4fc3f7');
        const text = rows.map(r =>
            isAbs ? r.deltaMFAbs.toExponential(2) : r.sensitivity.toFixed(0)
        );

        const data = [{
            x: xLabels,
            y: yVals,
            type: 'bar',
            marker: { color: colors, line: { color: gridColor, width: 1 } },
            text,
            textposition: 'outside',
            hovertemplate: isAbs
                ? '%{x}<br>|ΔOMF|: %{y:.3e}<br><extra></extra>'
                : '%{x}<br>Sensitivity: %{y:.2f}%<br><extra></extra>'
        }];

        const yAxisTitle = isAbs ? '|ΔOMF|' : 'Sensitivity (%)';

        const layout = {
            paper_bgcolor: paperColor,
            plot_bgcolor:  bgColor,
            margin: { l: 60, r: 16, t: 16, b: 36 },
            xaxis: {
                title: { text: 'Layer', font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 10 },
                automargin: true,
            },
            yaxis: {
                title: { text: yAxisTitle, font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 10 },
                rangemode: 'tozero',
                // |ΔOMF| can vary by orders of magnitude across layers — log
                // scale keeps small-but-non-trivial layers visible. Optional
                // anyway since the user can re-scale interactively.
                type: isAbs ? 'log' : 'linear',
            },
            bargap: 0.2,
        };
        return { data, layout };
    }, [rows, matColorMap, scale, frontCount, bgColor, paperColor, gridColor, textColor]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildData();
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, data, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, data, layout);
        }
    }, [buildData]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Sensitivity table ─────────────────────────────────────────────────────────

function SensitivityTable({ rows, matColorMap, frontCount, c }) {
    const ranked = useMemo(() => {
        const idx = rows.map((r, i) => ({ ...r, _orig: i }));
        idx.sort((a, b) => b.deltaMFAbs - a.deltaMFAbs);
        for (let i = 0; i < idx.length; i++) idx[i].rank = i + 1;
        // Re-sort back to original layer order so it's easy to map row → layer
        idx.sort((a, b) => a._orig - b._orig);
        return idx;
    }, [rows]);

    const thBase = {
        padding: '3px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        textAlign: 'right', whiteSpace: 'nowrap', color: c.textDim,
    };
    const tdBase = {
        padding: '2px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right',
    };

    return h('div', {
        style: {
            height: '100%', overflowY: 'auto',
            background: c.bg, borderRight: `1px solid ${c.border}`,
            minWidth: 340,
        }
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...thBase, textAlign: 'left' } }, '#'),
                    h('th', { style: { ...thBase, textAlign: 'left' } }, 'Layer'),
                    h('th', { style: { ...thBase, textAlign: 'left' } }, 'Material'),
                    h('th', { style: thBase }, 'd (nm)'),
                    h('th', { style: thBase }, 'Δd (nm)'),
                    h('th', { style: thBase }, '|ΔOMF|'),
                    h('th', { style: thBase }, 'Sens. (%)'),
                    h('th', { style: thBase }, 'Rank'),
                )
            ),
            h('tbody', null,
                ranked.map((r, i) => h('tr', {
                    key: i,
                    style: { backgroundColor: i % 2 === 0 ? 'transparent' : c.panel + '55' }
                },
                    h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim } }, i + 1),
                    h('td', { style: { ...tdBase, textAlign: 'left', color: c.text } },
                        dispLayerLabel(r, frontCount),
                        (r.locked ? h('span', { style: { marginLeft: 5, display: 'inline-flex', verticalAlign: 'middle', color: c.accent } }, h(LockIcon, { locked: true, size: 11 })) : null)
                    ),
                    h('td', { style: { ...tdBase, textAlign: 'left', display: 'flex', gap: 4, alignItems: 'center', maxWidth: 130, overflow: 'hidden' } },
                        h('div', { style: {
                            width: 8, height: 8, borderRadius: 2,
                            background: matColorMap[r.materialId] || '#888',
                            flexShrink: 0
                        }}),
                        h('span', { title: r.materialId || '', style: { color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, r.materialId || '—')
                    ),
                    h('td', { style: { ...tdBase, color: c.text } }, r.thickness.toFixed(2)),
                    h('td', { style: { ...tdBase, color: c.textDim } }, r.deltaNm.toFixed(3)),
                    h('td', { style: { ...tdBase, color: c.text } },
                        r.deltaMFAbs.toExponential(3)),
                    h('td', { style: { ...tdBase, color: c.text, fontWeight: 600 } },
                        r.sensitivity.toFixed(1)),
                    h('td', {
                        style: {
                            ...tdBase,
                            color: r.rank === 1 ? c.accent : c.textDim,
                            fontWeight: r.rank === 1 ? 700 : 400
                        }
                    }, r.rank),
                ))
            )
        )
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LayerSensitivity({ c, theme, t }) {
    const ls = t.layerSensitivity;
    const { design } = useDesign();

    const [mode,        setMode]        = useState('relative'); // 'relative' | 'absolute' — probe Δd type
    const [relPct,      setRelPct]      = useState(1.0);
    const [absDeltaNm,  setAbsDeltaNm]  = useState(1.0);
    const [includeLocked, setIncludeLocked] = useState(false);
    const [view,        setView]        = useState('chart'); // 'chart' | 'table' | 'both'
    const [scale,       setScale]       = useState('normalized'); // 'normalized' | 'absolute' — chart Y axis
    const operands = design?.meritOperands || [];

    // M11: which side(s) hold the optimization variables depends on surfaceMode
    // (computeLayerSensitivity already follows this) — back_only designs have no
    // front layers but are perfectly analysable.
    const sensHasLayers = (() => {
        const sm = design?.surfaceMode || 'front_only';
        const hasFront = !!design?.frontLayers?.length;
        const hasBack  = !!design?.backLayers?.length;
        return sm === 'back_only' ? hasBack
             : sm === 'both_independent' ? (hasFront || hasBack)
             : hasFront;   // front_only / symmetric
    })();

    const result = useMemo(() => {
        if (!sensHasLayers) return null;
        if (!operands.length) return { rows: [], mf0: 0, noOperands: true };
        try {
            return computeLayerSensitivity(design, operands, resolveMat, {
                mode,
                relPct,
                absDeltaNm,
                includeLocked,
            });
        } catch (e) {
            // Return the error as data instead of setState-during-render: a
            // transient failure no longer sticks (the memo recomputes clean on
            // the next input change) and we don't mutate state in render.
            return { error: e.message || String(e) };
        }
    }, [design, operands, mode, relPct, absDeltaNm, includeLocked]);
    const error = result?.error || null;

    const matColorMap = useMemo(() => {
        const map = {};
        for (const l of (design?.frontLayers || [])) {
            const m = resolveMat(l.material);
            if (l.material && !map[l.material]) map[l.material] = resolveColor(m);
        }
        for (const l of (design?.backLayers || [])) {
            const m = resolveMat(l.material);
            if (l.material && !map[l.material]) map[l.material] = resolveColor(m);
        }
        return map;
    }, [design]);

    // Worst-case Specification check under a uniform ±Δd applied to every layer,
    // so the badge tracks the current probe magnitude (relative or absolute).
    const specDesigns = useMemo(() => {
        if (!design) return [];
        const perturb = (sign) => {
            const pj = (l) => {
                const t0 = l.thickness || 0;
                const nt = mode === 'absolute'
                    ? Math.max(0, t0 + sign * absDeltaNm)
                    : Math.max(0, t0 * (1 + sign * relPct / 100));
                return { ...l, thickness: nt };
            };
            return {
                ...design,
                frontLayers: (design.frontLayers || []).map(pj),
                backLayers:  (design.backLayers  || []).map(pj),
            };
        };
        return [perturb(1), perturb(-1)];
    }, [design, mode, relPct, absDeltaNm]);

    // ── Render guards ─────────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);

    if (!design) return placeholder(ls.noDesign);
    if (!sensHasLayers) return placeholder(ls.noLayers);   // M11: mode-aware
    if (!operands.length) return placeholder(ls.noOperands);

    // ── Toolbar ───────────────────────────────────────────────────────────────
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
    const segBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const rows = result?.rows || [];
    const frontCount = design?.frontLayers?.length || 0;
    const orderedRows = orderSubstrateFirst(rows, frontCount);
    const peakRank1 = rows.reduce((m, r) => r.deltaMFAbs > (m?.deltaMFAbs ?? -1) ? r : m, null);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        // ── Controls bar ───────────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
            }
        },
            h('div', { style: { display: 'flex', gap: 2 } },
                h('button', { onClick: () => setMode('relative'), style: segBtnStyle(mode === 'relative') }, ls.modeRelative),
                h('button', { onClick: () => setMode('absolute'), style: segBtnStyle(mode === 'absolute') }, ls.modeAbsolute),
            ),
            mode === 'relative' && h('label', { style: labelStyle }, ls.relLabel,
                numField(relPct, setRelPct, { ...inputStyle, marginLeft: 6 }),
                h('span', { style: { marginLeft: 2 } }, '%')
            ),
            mode === 'absolute' && h('label', { style: labelStyle }, ls.absLabel,
                numField(absDeltaNm, setAbsDeltaNm, { ...inputStyle, marginLeft: 6 }),
                h('span', { style: { marginLeft: 2 } }, 'nm')
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.text, fontSize: 11 } },
                h('input', {
                    type: 'checkbox', checked: includeLocked, onChange: e => setIncludeLocked(e.target.checked),
                    style: { cursor: 'pointer', accentColor: c.accent }
                }),
                ls.includeLocked
            ),
            h('div', { style: { width: 1, height: 20, background: c.border } }),
            h('div', { style: { display: 'flex', gap: 2 } },
                h('button', { onClick: () => setView('chart'), style: segBtnStyle(view === 'chart') }, ls.viewChart),
                h('button', { onClick: () => setView('table'), style: segBtnStyle(view === 'table') }, ls.viewTable),
                h('button', { onClick: () => setView('both'),  style: segBtnStyle(view === 'both')  }, ls.viewBoth),
            ),
            (view === 'chart' || view === 'both') && h('div', { style: { display: 'flex', gap: 2 } },
                h('button', {
                    onClick: () => setScale('normalized'),
                    style: segBtnStyle(scale === 'normalized'),
                    title: ls.scaleNormalizedTip,
                }, ls.scaleNormalized),
                h('button', {
                    onClick: () => setScale('absolute'),
                    style: segBtnStyle(scale === 'absolute'),
                    title: ls.scaleAbsoluteTip,
                }, ls.scaleAbsolute),
            ),
            design && h(EvalModeBadge, { design, c, t }),
            (design && design.qualifiers && design.qualifiers.length > 0) && h(SpecVerdict, { designs: specDesigns, resolveMat, c, t, label: 'Spec @ ±Δd:' }),
            h('span', { style: { marginLeft: 'auto', color: c.textDim, fontSize: 11 } },
                (result && !result.error && result.mf0 != null) ? `${ls.mfNow}: ${result.mf0.toFixed(6)}  |  ${ls.peakLayer}: ${
                    peakRank1
                        ? dispLayerLabel(peakRank1, frontCount)
                        : '—'
                }  |  ${rows.length} ${ls.layers}` : ''
            )
        ),

        // ── Body ───────────────────────────────────────────────────────────────
        error
            ? placeholder(`Error: ${error}`)
            : h('div', {
                style: {
                    flex: 1, minHeight: 0, display: 'flex',
                    flexDirection: view === 'both' ? 'row' : 'column',
                }
            },
                (view === 'table' || view === 'both') && h('div', {
                    style: { flex: view === 'both' ? '0 0 380px' : 1, minHeight: 0, overflow: 'hidden' }
                }, h(SensitivityTable, { rows: orderedRows, matColorMap, frontCount, c })),
                (view === 'chart' || view === 'both') && h('div', {
                    style: { flex: 1, minHeight: 0, overflow: 'hidden', background: c.bg }
                }, h(SensitivityBars, { rows: orderedRows, matColorMap, scale, frontCount, c })),
            )
    );
}
