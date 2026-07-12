import { useDesign } from '../../../state/DesignContext.js';
import { evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal } from '../../../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../utils/materials/materialDatabase.js';
import {
    buildTargetTraces, buildTargetShapes,
    buildEditableTargetShapes, applyHandleEdit, operandOverridesFromDrawnLine,
    snapDrawnLine,
} from '../../../utils/physics/spectrumTargets.js';
import { makeOperand, makeConeSpec, coneAverageResult } from '../../../utils/physics/optimizer.js';
import { EvalModeBadge, ConeBadge } from '../../SurfaceModeBar.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { spectralAxisProps, SPECTRAL_UNITS, SPECTRAL_UNIT_IDS } from '../../../utils/physics/spectralAxis.js';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Human-readable material name for the info strip: prefer the catalog material's
// display name, else strip the catalog prefix from the compound id
// (e.g. "lzos:LZ_K8" → "LZ_K8") so it never shows a raw key.
function mediumName(id) {
    if (!id) return '';
    const m = getMaterialById(id);
    if (m && m.name) return m.name;
    const i = id.indexOf(':');
    return i >= 0 ? id.slice(i + 1) : id;
}

const { createElement: h, useState, useEffect, useCallback, useMemo, useRef } = React;

// ── Curve definitions ─────────────────────────────────────────────────────────

const CURVES = [
    { key: 'T',  label: 'T avg',   color: '#2196f3', dash: 'solid', group: 'avg' },
    { key: 'R',  label: 'R avg',   color: '#ef5350', dash: 'solid', group: 'avg' },
    { key: 'A',  label: 'A avg',   color: '#66bb6a', dash: 'solid', group: 'avg' },
    { key: 'Ts', label: 'T (s)',   color: '#64b5f6', dash: 'dot',   group: 's'   },
    { key: 'Rs', label: 'R (s)',   color: '#ef9a9a', dash: 'dot',   group: 's'   },
    { key: 'Tp', label: 'T (p)',   color: '#1565c0', dash: 'dash',  group: 'p'   },
    { key: 'Rp', label: 'R (p)',   color: '#c62828', dash: 'dash',  group: 'p'   },
];

const CURVE_BY_KEY = Object.fromEntries(CURVES.map(cv => [cv.key, cv]));

// Curve toggles grouped by quantity (T / R / A), each holding its avg/s/p
// members. A carries no resolved s/p split, so only its average is offered.
const CURVE_GROUPS = [
    { q: 'T', members: [{ pol: 'avg', key: 'T' }, { pol: 's', key: 'Ts' }, { pol: 'p', key: 'Tp' }] },
    { q: 'R', members: [{ pol: 'avg', key: 'R' }, { pol: 's', key: 'Rs' }, { pol: 'p', key: 'Rp' }] },
    { q: 'A', members: [{ pol: 'avg', key: 'A' }] },
];

// Accent colour for a drawn target, keyed by its R/T/A family.
function CURVE_COLOR_FOR(curve) {
    return curve === 'T' ? '#2196f3' : curve === 'A' ? '#66bb6a' : '#ef5350';
}

// Imported measured-spectrum overlays. design.measuredCurves carry
// { x:nm[], y:fraction[], quantity, color, visible }. Rendered as dotted
// lines+open-circle markers to read as "measured data" vs the computed curves.
function buildMeasuredTraces(overlays) {
    const out = [];
    (overlays || []).forEach(cv => {
        if (!cv || cv.visible === false || !cv.x?.length) return;
        out.push({
            x: cv.x,
            y: cv.y.map(v => v * 100),
            name: `${cv.name} (${cv.quantity} meas)`,
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: cv.color, width: 1.4, dash: 'dot' },
            marker: { color: cv.color, size: 4, symbol: 'circle-open' },
            hovertemplate: `%{x:.1f} nm<br>${cv.name}: %{y:.3f}%<extra></extra>`,
        });
    });
    return out;
}

// Multi-AOI cap and opacity ramp. Index 0 is fully opaque so single-AOI
// behaviour is visually identical to the previous (one-AOI) design.
const AOI_MAX = 6;
const AOI_ALPHA = [1.0, 0.72, 0.56, 0.45, 0.36, 0.30];

function aoiAlpha(i, n) { return n <= 1 ? 1.0 : (AOI_ALPHA[i] ?? 0.30); }

// Cone-angle averaging for the spectrum plot: the plotted angle is
// the cone AXIS; the curve is the weighted Σ over the cone's quadrature nodes
// (coneAverageResult), averaged element-wise across the shared λ grid. The
// spectrum result arrays to average:
const CONE_SPEC_KEYS = ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp', 'As', 'Ap'];

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function formatTheta(t) {
    return Number.isInteger(t) ? String(t) : t.toFixed(1);
}

// ── Plotly chart wrapper ──────────────────────────────────────────────────────

function PlotlyChart({
    data, showCurves, targets, showTargets, c,
    editMode = false, editTool = 'draw', editCurve = 'R', editPol = 'avg', lamRange, yRange,
    spectralUnit = 'nm', overlays = [],
    onCreateTarget, onEditTarget, onDeleteTarget,
}) {
    const divRef = useRef(null);
    const initializedRef = useRef(false);

    const bgColor    = c.bg    || '#1e1e1e';
    const paperColor = c.panel || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text  || '#cccccc';

    // In edit mode, targets are always shown (you can't edit what you can't see).
    const targetsVisible = showTargets || editMode;

    // Editable drag handles + their index→operand mapping. Empty unless
    // editing. Kept in a ref so the (once-bound) relayout listener always sees
    // the current mapping without re-binding on every render.
    // Draggable handles only in the Draw tool — in Delete mode they'd sit on
    // top of the line trace and swallow the click meant to delete it.
    const handlesActive = editMode && editTool === 'draw';
    const editable = useMemo(
        () => (handlesActive ? buildEditableTargetShapes(targets, lamRange) : { shapes: [], meta: [] }),
        [handlesActive, targets, lamRange]
    );
    const editRef = useRef({});
    useEffect(() => {
        editRef.current = {
            editMode, editTool,
            meta: editable.meta,
            shapes: editable.shapes,
            metaCount: editable.shapes.length,
            onCreateTarget, onEditTarget, onDeleteTarget,
        };
    }, [editMode, editTool, editable, onCreateTarget, onEditTarget, onDeleteTarget]);

    const buildTraces = useCallback(() => {
        const overlayTraces = buildMeasuredTraces(overlays);
        if (!data?.lambda || !data?.series?.length) {
            return [...overlayTraces, ...(targetsVisible ? buildTargetTraces(targets) : [])];
        }
        const N = data.series.length;
        const enabled = CURVES.filter(cv => showCurves[cv.key]);
        const curveTraces = [];
        data.series.forEach((s, sIdx) => {
            const alpha = aoiAlpha(sIdx, N);
            const suffix = N > 1 ? ` @ ${formatTheta(s.theta)}°` : '';
            enabled.forEach(cv => {
                const ys = s[cv.key];
                if (!ys) return;
                curveTraces.push({
                    x: data.lambda,
                    y: ys.map(v => v * 100),
                    name: cv.label + suffix,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: hexToRgba(cv.color, alpha), width: 1.5, dash: cv.dash },
                    hovertemplate: `%{x:.1f} nm<br>${cv.label}${suffix}: %{y:.3f}%<extra></extra>`
                });
            });
        });
        const targetTraces = targetsVisible ? buildTargetTraces(targets) : [];
        return [...curveTraces, ...overlayTraces, ...targetTraces];
    }, [data, showCurves, targets, targetsVisible, overlays]);

    const layout = useMemo(() => ({
        margin: { l: 52, r: 16, t: 16, b: 44 },
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            // Display-only unit relabel: tick positions stay in nm, labels show
            // the chosen spectral unit. x DATA + target shapes remain nm.
            ...spectralAxisProps(spectralUnit, lamRange?.min, lamRange?.max),
            gridcolor: gridColor, gridwidth: 1,
            zerolinecolor: gridColor,
            tickfont: { size: 10 }
        },
        yaxis: {
            title: { text: '(%)', standoff: 8 },
            ...(yRange?.auto
                ? { autorange: true }
                : { range: [yRange?.min ?? 0, yRange?.max ?? 100] }),
            gridcolor: gridColor, gridwidth: 1,
            zerolinecolor: gridColor,
            tickfont: { size: 10 }
        },
        legend: {
            bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1,
            font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top'
        },
        hovermode: editMode ? 'closest' : 'x unified',
        // Edit mode, Draw tool: drag to add a target (drawline). Delete tool:
        // zoom dragmode so a plain click on a target's X marker registers (and
        // existing handles still drag via edits.shapePosition). Read-only mode:
        // tinted band zones.
        dragmode: (editMode && editTool === 'draw') ? 'drawline' : 'zoom',
        newshape: editMode
            ? { line: { color: CURVE_COLOR_FOR(editCurve), width: 3 }, opacity: 0.9, drawdirection: 'diagonal' }
            : undefined,
        autosize: true,
        // Draw tool: editable handles. Delete/read-only: static band zones
        // (never draggable, so they don't intercept the line's hover/click).
        shapes: handlesActive
            ? editable.shapes
            : ((targetsVisible || editMode) ? buildTargetShapes(targets) : [])
    }), [paperColor, bgColor, gridColor, textColor, targets, targetsVisible, editMode, editTool, editCurve, editable, handlesActive, yRange, spectralUnit, lamRange]);

    const config = useMemo(() => ({
        displaylogo: false,
        responsive: true,
        displayModeBar: true,
        editable: false,
        // Shape dragging only in the Draw tool — read-only band shading and the
        // Delete-tool zones must never be draggable.
        edits: { shapePosition: editMode && editTool === 'draw' },
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
        modeBarButtonsToAdd: (editMode && editTool === 'draw') ? ['drawline'] : [],
        toImageButtonOptions: { format: 'png', filename: 'TFStudio_spectrum', scale: 2 }
    }), [editMode, editTool]);

    // Single relayout listener (bound once at init), reads the live edit state
    // from editRef so it survives re-renders without re-binding.
    const handleRelayout = useCallback((ev) => {
        const st = editRef.current;
        if (!st.editMode || !divRef.current) return;
        // (1) A new line was drawn → create a target operand from it.
        if (Array.isArray(ev.shapes) && ev.shapes.length > st.metaCount) {
            const drawn = ev.shapes[ev.shapes.length - 1];
            if (drawn && drawn.type === 'line' && st.onCreateTarget) {
                st.onCreateTarget({ x0: drawn.x0, y0: drawn.y0, x1: drawn.x1, y1: drawn.y1 });
            }
            return;
        }
        // (2) A handle was erased (Delete/Backspace on a selected handle, or the
        // eraser tool) → the shapes array shrank. Each handle carries name=opId,
        // so the operand whose id is no longer present is the deleted one.
        if (Array.isArray(ev.shapes) && ev.shapes.length < st.metaCount) {
            const present = new Set(ev.shapes.map(s => s && s.name).filter(Boolean));
            let goneId = null;
            if (present.size > 0 || ev.shapes.length === 0) {
                const gone = (st.meta || []).find(m => !present.has(m.opId));
                if (gone) goneId = gone.opId;
            } else {
                // name not echoed — fall back to first positional mismatch.
                const old = st.shapes || [];
                let idx = ev.shapes.length;   // default: last removed
                for (let i = 0; i < ev.shapes.length; i++) {
                    const a = ev.shapes[i], b = old[i];
                    const shapeChanged = !b || a.x0 !== b.x0 || a.x1 !== b.x1 || a.y0 !== b.y0 || a.y1 !== b.y1;
                    if (shapeChanged) { idx = i; break; }
                }
                if (st.meta && st.meta[idx]) goneId = st.meta[idx].opId;
            }
            if (goneId && st.onDeleteTarget) st.onDeleteTarget(goneId);
            return;
        }
        // (3) An existing handle was dragged → patch its operand. Read the
        // committed coords from the live layout (the event may carry only the
        // changed sub-keys).
        let idx = -1;
        for (const k in ev) {
            const m = /^shapes\[(\d+)\]\./.exec(k);
            if (m) { idx = +m[1]; break; }
        }
        if (idx >= 0 && idx < (st.meta?.length ?? 0)) {
            const sh = divRef.current.layout?.shapes?.[idx];
            if (sh && st.onEditTarget) {
                st.onEditTarget(st.meta[idx], { x0: sh.x0, x1: sh.x1, y0: sh.y0, y1: sh.y1 });
            }
        }
    }, []);

    // Delete tool: clicking a target's X marker removes that operand. The
    // marker traces carry customdata = operand id (see buildTargetTraces).
    const handlePlotClick = useCallback((ev) => {
        const st = editRef.current;
        const canDelete = st.editMode && st.editTool === 'delete' && ev?.points?.length && st.onDeleteTarget;
        if (!canDelete) return;
        const pt = ev.points.find(p => p?.customdata != null);
        if (pt && typeof pt.customdata === 'string') st.onDeleteTarget(pt.customdata);
    }, []);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const traces = buildTraces();
        Plotly.newPlot(divRef.current, traces, layout, config);
        initializedRef.current = true;
        divRef.current.on('plotly_relayout', handleRelayout);
        divRef.current.on('plotly_click', handlePlotClick);

        // Observe the PARENT, never the Plotly div itself. Plotly mutates the
        // size of its own div when it draws, so observing that div makes our
        // resize handler re-fire on every redraw — a ResizeObserver feedback
        // loop the browser breaks by deferring a frame, which is exactly the
        // intermittent "blank → redraw" flicker on design switch. We additionally
        // rAF-debounce and gate on a real size change so a redraw that doesn't
        // actually change the container can never trigger a resize.
        const parent = divRef.current.parentElement;
        let rafId = 0, lastW = 0, lastH = 0;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0] && entries[0].contentRect;
            if (!cr) return;
            const w = Math.round(cr.width), hh = Math.round(cr.height);
            if (w === lastW && hh === lastH) return;     // no real change → skip
            lastW = w; lastH = hh;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (divRef.current && initializedRef.current) Plotly.Plots.resize(divRef.current);
            });
        });
        if (parent) ro.observe(parent);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            ro.disconnect();
            if (divRef.current) Plotly.purge(divRef.current);
            initializedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        const traces = buildTraces();
        Plotly.react(divRef.current, traces, layout, config);
    }, [data, showCurves, buildTraces, layout, config]);

    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.relayout(divRef.current, {
            paper_bgcolor: paperColor, plot_bgcolor: bgColor,
            'font.color': textColor,
            'xaxis.gridcolor': gridColor, 'yaxis.gridcolor': gridColor,
            'legend.bgcolor': paperColor + 'cc', 'legend.bordercolor': gridColor
        });
    }, [bgColor, paperColor, gridColor, textColor]);

    if (typeof Plotly === 'undefined') {
        return h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim }
        }, 'Plotly not loaded — check index.html');
    }

    return h('div', {
        ref: divRef,
        style: { width: '100%', height: '100%', minHeight: 200 }
    });
}

// ── Toolbar primitives ────────────────────────────────────────────────────────

function FieldLabel({ children, c }) {
    return h('span', {
        style: {
            fontSize: 11, color: c.textDim,
            fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0
        }
    }, children);
}

function Divider({ c }) {
    return h('div', { style: { width: 1, height: 22, background: c.border, flexShrink: 0 } });
}

function NumInput({ value, onChange, min, max, step = 1, c, width = 60 }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const v = parseFloat(raw);
        if (!isNaN(v)) {
            onChange(Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity));
        } else {
            setRaw(String(value));
        }
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: (e) => setRaw(e.target.value),
        onBlur: commit,
        onKeyDown: (e) => { if (e.key === 'Enter') commit(); },
        style: {
            width, height: 22, backgroundColor: c.panel, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '0 4px', outline: 'none', textAlign: 'right'
        }
    });
}

// One quantity's toggle cluster: a bold T/R/A label followed by compact avg/s/p
// buttons, each tinted with that specific curve's plot colour. Denser than the
// old one-button-per-curve row and keeps every polarisation of a quantity
// together. `polLabels` supplies the localized avg / s / p captions.
function CurveGroup({ group, showCurves, onToggle, c, polLabels }) {
    return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 } },
        h('span', { style: { fontSize: 11, fontWeight: 700, color: c.textDim, marginRight: 1 } }, group.q),
        group.members.map(m => {
            const cv = CURVE_BY_KEY[m.key];
            const active = !!showCurves[m.key];
            return h('button', {
                key: m.key,
                onClick: () => onToggle(m.key),
                title: cv.label,
                style: {
                    padding: '2px 6px', cursor: 'pointer', outline: 'none',
                    border: `1px solid ${active ? cv.color : c.border}`,
                    borderRadius: 3, backgroundColor: active ? cv.color + '22' : 'transparent',
                    color: active ? c.text : c.textDim,
                    fontSize: 11, fontWeight: active ? 600 : 400,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            }, polLabels[m.pol]);
        }));
}

// ── AOI chip list ─────────────────────────────────────────────────────────────

function AoiChip({ value, onRemove, onEdit, canRemove, c, oe }) {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState('');

    const start = () => { setRaw(formatTheta(value)); setEditing(true); };
    const commit = () => { onEdit(raw); setEditing(false); };

    if (editing) {
        return h('input', {
            type: 'number', value: raw, min: 0, max: 89, step: 1, autoFocus: true,
            onFocus: (e) => e.target.select(),
            onChange: (e) => setRaw(e.target.value),
            onBlur: commit,
            onKeyDown: (e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
            },
            style: {
                width: 46, height: 22,
                border: `1px solid ${c.accent}`, borderRadius: 11,
                backgroundColor: c.bg, color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 6px', outline: 'none', textAlign: 'center'
            }
        });
    }

    return h('span', {
        style: {
            display: 'inline-flex', alignItems: 'center', height: 22,
            padding: canRemove ? '0 2px 0 7px' : '0 7px',
            border: `1px solid ${c.border}`, borderRadius: 11,
            fontSize: 11, lineHeight: '20px', backgroundColor: c.bg,
            fontVariantNumeric: 'tabular-nums', color: c.text, gap: 2,
            flexShrink: 0
        }
    },
        // Click the value to edit it in place. This is the primary way to change
        // a single AOI without having to add a second angle and delete the first.
        h('span', {
            onClick: start,
            title: oe.editAoiTooltip,
            style: { cursor: 'pointer' }
        }, `${formatTheta(value)}°`),
        canRemove && h('button', {
            onClick: onRemove,
            'aria-label': `Remove ${formatTheta(value)}°`,
            style: {
                background: 'transparent', border: 'none',
                color: c.textDim, cursor: 'pointer',
                padding: '0 3px', fontSize: 13, lineHeight: 1, outline: 'none'
            }
        }, '×')
    );
}

function AoiChips({ values, onChange, c, oe }) {
    const [draft, setDraft] = useState('');

    const addValue = () => {
        if (!draft.trim()) return;
        const v = parseFloat(draft);
        if (isNaN(v) || v < 0 || v >= 90) { setDraft(''); return; }
        const rounded = Math.round(v * 10) / 10;
        if (values.includes(rounded)) { setDraft(''); return; }
        if (values.length >= AOI_MAX)  { setDraft(''); return; }
        onChange([...values, rounded]);
        setDraft('');
    };

    const remove = (idx) => {
        if (values.length <= 1) return;
        onChange(values.filter((_, i) => i !== idx));
    };

    // Edit the angle at `idx` in place. Invalid / duplicate values are ignored
    // (the chip reverts to its previous value).
    const edit = (idx, rawStr) => {
        const v = parseFloat(rawStr);
        if (isNaN(v) || v < 0 || v >= 90) return;
        const rounded = Math.round(v * 10) / 10;
        if (values.some((x, i) => i !== idx && x === rounded)) return;
        if (values[idx] === rounded) return;
        onChange(values.map((x, i) => (i === idx ? rounded : x)));
    };

    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }
    },
        values.map((v, i) =>
            h(AoiChip, {
                key: `${v}-${i}`, value: v,
                onRemove: () => remove(i),
                onEdit: (rawStr) => edit(i, rawStr),
                canRemove: values.length > 1, c, oe
            })
        ),
        values.length < AOI_MAX && h('input', {
            type: 'number', value: draft,
            placeholder: oe.addAoiPlaceholder, title: oe.addAoiTooltip(AOI_MAX),
            min: 0, max: 89, step: 1,
            onChange: (e) => setDraft(e.target.value),
            onBlur: addValue,
            onKeyDown: (e) => { if (e.key === 'Enter') addValue(); },
            style: {
                width: 38, height: 22,
                border: `1px dashed ${c.border}`, borderRadius: 11,
                backgroundColor: 'transparent', color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 4px', outline: 'none', textAlign: 'center'
            }
        })
    );
}

// ── Data table ────────────────────────────────────────────────────────────────

function DataTable({ data, showCurves, c }) {
    const enabled = CURVES.filter(cv => showCurves[cv.key]);
    const series = data?.series || [];
    const multi = series.length > 1;

    const cols = [];
    series.forEach(s => {
        enabled.forEach(cv => {
            if (s[cv.key]) cols.push({
                cv, theta: s.theta, ys: s[cv.key],
                label: cv.label + (multi ? ` @ ${formatTheta(s.theta)}°` : '')
            });
        });
    });

    const thBase = {
        padding: '3px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        userSelect: 'none', whiteSpace: 'nowrap'
    };
    const tdBase = {
        padding: '2px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
    };
    return h('div', {
        style: {
            height: 200, overflowY: 'auto', overflowX: 'auto',
            borderTop: `1px solid ${c.border}`, backgroundColor: c.bg,
            flexShrink: 0
        }
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' } },
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...thBase, textAlign: 'left', color: c.textDim } }, 'λ (nm)'),
                    ...cols.map((col, i) =>
                        h('th', { key: i, style: { ...thBase, textAlign: 'right', color: col.cv.color } }, col.label)
                    )
                )
            ),
            h('tbody', null,
                data.lambda.map((lam, i) =>
                    h('tr', {
                        key: i,
                        style: { backgroundColor: i % 2 === 0 ? 'transparent' : c.panel + '55' }
                    },
                        h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim } }, lam.toFixed(1)),
                        ...cols.map((col, j) =>
                            h('td', { key: j, style: { ...tdBase, textAlign: 'right', color: c.text } },
                                (col.ys[i] * 100).toFixed(4)
                            )
                        )
                    )
                )
            )
        )
    );
}

function buildCSV(data, showCurves) {
    if (!data?.lambda || !data?.series?.length) return '';
    const enabled = CURVES.filter(cv => showCurves[cv.key]);
    const multi = data.series.length > 1;
    const cols = [];
    data.series.forEach(s => {
        enabled.forEach(cv => {
            if (!s[cv.key]) return;
            cols.push({
                name: cv.key + (multi ? `_${formatTheta(s.theta)}deg` : ''),
                ys: s[cv.key]
            });
        });
    });
    const header = ['lambda_nm', ...cols.map(c => c.name)].join(',');
    const rows = data.lambda.map((l, i) =>
        [l.toFixed(2), ...cols.map(c => (c.ys[i] * 100).toFixed(6))].join(',')
    );
    return [header, ...rows].join('\n');
}

// ── Main component ────────────────────────────────────────────────────────────

export function OpticalEvaluation({ c, theme, t }) {
    const { design, updateDesign, evalMode, evalParams, setEvalParams, isOptimizing } = useDesign();
    const oe = t.opticalEval;

    // λ range / step / AOI list live in DesignContext so they persist across
    // window close/switch (see DesignProvider.evalParams).
    const params = evalParams;
    const setParams = setEvalParams;

    const [showCurves, setShowCurves] = useState({
        T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false
    });

    const [autoCalc, setAutoCalc] = useState(true);
    // Manual-mode / optimization snapshot. In auto mode the spectrum is derived
    // synchronously (see `auto` below) so it never lags `design`; these hold the
    // result only when auto-derivation is off or suspended during optimization.
    const [manualData, setManualData] = useState(null);
    const [computing, setComputing] = useState(false);
    const [copied, setCopied] = useState(false);
    const [manualError, setManualError] = useState(null);
    const [showTable,   setShowTable]   = useState(false);
    const [showTargets, setShowTargets] = useState(true);

    // ── Visual target constructor ─────────────────────────────────────────────
    const [editMode,  setEditMode]  = useState(false);
    const [editTool,  setEditTool]  = useState('draw');      // 'draw' | 'delete'
    const [editCurve, setEditCurve] = useState('R');         // R/T/A family of new targets
    const [editPol,   setEditPol]   = useState('avg');       // s/p/avg of new targets
    const [editKind,  setEditKind]  = useState('average');   // 'average' (TAV) | 'continuous' (TGT)
    // CAD-style snapping for drawn / dragged targets.
    const [snapOn,  setSnapOn]  = useState(true);
    const [snapNm,  setSnapNm]  = useState(10);
    const [snapPct, setSnapPct] = useState(5);

    // Y-axis scaling. Default = fixed 0–100 % (the historical behaviour); Auto
    // lets Plotly fit the data, or set an explicit min/max to zoom a band.
    const [yAuto, setYAuto] = useState(false);
    const [yMin,  setYMin]  = useState(0);
    const [yMax,  setYMax]  = useState(100);

    // Spectral-axis display unit (display only — sampling stays in nm).
    const [spectralUnit, setSpectralUnit] = useState('nm');
    const yRange = useMemo(() => ({ auto: yAuto, min: yMin, max: yMax }), [yAuto, yMin, yMax]);

    // Pure spectrum compute — NO state writes, so it can run during render.
    // Throws on error. Keeping it pure lets auto mode derive the spectrum in the
    // SAME render as the design change (see `auto`), which is what fixes the
    // OE-plot flicker: previously `data` was written in an effect a frame later,
    // so switching designs drew the OLD curves with the NEW target shapes first
    // (one Plotly.react), then the new curves (a second Plotly.react).
    const computeSpectrum = useCallback(() => {
        const incMat = resolveMaterial(design.incidentMedium);
        const subMat = resolveMaterial(design.substrate.material);
        const exitMat = resolveMaterial(design.exitMedium);
        const subThick = design.substrate.thickness ?? 1.0;

        const frontLayersWithMat = (design.frontLayers || [])
            .filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
        const backLayersWithMat = (design.backLayers || [])
            .filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));

        const thetas = (params.thetas?.length ? params.thetas : [0]);
        const series = [];
        let lambda = null;

        // Cone-angle averaging: each plotted θ is the cone axis.
        const coneSpec = makeConeSpec(design.cone || {});
        const computeAt = (th) => {
            const p = { ...params, theta: th };
            if (evalMode === 'front') return evaluateSpectrum(p, incMat, subMat, frontLayersWithMat);
            if (evalMode === 'back')  return evaluateSpectrumBack(p, exitMat, subMat, backLayersWithMat);
            return evaluateSpectrumTotal(
                p, incMat, subMat, exitMat,
                frontLayersWithMat, backLayersWithMat, subThick
            );
        };

        for (const theta of thetas) {
            const r = coneAverageResult(coneSpec, theta, computeAt, CONE_SPEC_KEYS);
            if (!lambda) lambda = r.lambda;
            series.push({
                theta,
                T: r.T, R: r.R, A: r.A,
                Ts: r.Ts, Rs: r.Rs,
                Tp: r.Tp, Rp: r.Rp
            });
        }
        return { lambda: lambda || [], series };
    }, [design, params, evalMode]);

    // Auto mode: derive the spectrum synchronously so the plot stays in lock-step
    // with `design` (no stale-curve flash). Suspended during optimization — the
    // throttled effect below feeds the manual snapshot at ~4 Hz instead so a
    // synchronous TMM doesn't run on every ~12 Hz worker progress tick.
    const auto = useMemo(() => {
        if (!autoCalc || isOptimizing) return null;
        try { return { data: computeSpectrum(), error: null }; }
        catch (e) { console.error('TMM error:', e); return { data: null, error: e.message || 'Computation error' }; }
    }, [autoCalc, isOptimizing, computeSpectrum]);

    const data  = auto ? auto.data  : manualData;
    const error = auto ? auto.error : manualError;

    // Manual recompute (Calculate button + optimization throttle): writes the
    // snapshot used whenever auto-derivation is off or suspended.
    const compute = useCallback(() => {
        setComputing(true);
        try { setManualData(computeSpectrum()); setManualError(null); }
        catch (e) { console.error('TMM error:', e); setManualData(null); setManualError(e.message || 'Computation error'); }
        setComputing(false);
    }, [computeSpectrum]);

    // Clear the manual snapshot on eval-mode change so an old-mode spectrum can't
    // linger while auto-derivation is off.
    useEffect(() => { setManualData(null); setManualError(null); }, [evalMode]);

    // Throttled path during optimization (auto-derivation is suspended above).
    const computeRef = useRef(compute);
    useEffect(() => { computeRef.current = compute; }, [compute]);
    useEffect(() => {
        if (!autoCalc || !isOptimizing) return;
        computeRef.current();
        const intv = setInterval(() => computeRef.current(), 250);
        return () => clearInterval(intv);
    }, [autoCalc, isOptimizing]);

    const toggleCurve = (key) => setShowCurves(prev => ({ ...prev, [key]: !prev[key] }));

    const setThetas = useCallback((next) => {
        setParams(p => ({ ...p, thetas: next }));
    }, []);

    // ── Target create / drag handlers ─────────────────────────────────────────
    // Both write straight to design.meritOperands, so the Merit Function Editor
    // table stays in two-way sync (it reads the same array).
    const onCreateTarget = useCallback((line) => {
        const ln = snapOn
            ? snapDrawnLine(line, { operands: design.meritOperands || [], snapNm, snapPct })
            : line;
        const overrides = operandOverridesFromDrawnLine(ln, editCurve, editPol, editKind);
        const op = makeOperand(overrides);
        updateDesign({ meritOperands: [...(design.meritOperands || []), op] });
    }, [design, updateDesign, editCurve, editPol, editKind, snapOn, snapNm, snapPct]);

    const onEditTarget = useCallback((meta, coords) => {
        const cc = snapOn
            ? snapDrawnLine(coords, { operands: design.meritOperands || [], snapNm, snapPct, excludeId: meta.opId })
            : coords;
        updateDesign({
            meritOperands: (design.meritOperands || []).map(op =>
                op.id === meta.opId ? { ...op, ...applyHandleEdit(meta, op, cc) } : op
            )
        });
    }, [design, updateDesign, snapOn, snapNm, snapPct]);

    // Delete a target by id — fired when a handle is erased (Delete/Backspace
    // on a selected handle, or the eraser tool).
    const onDeleteTarget = useCallback((opId) => {
        updateDesign({
            meritOperands: (design.meritOperands || []).filter(op => op.id !== opId)
        });
    }, [design, updateDesign]);

    const lamRange = useMemo(
        () => ({ min: params.lambdaStart, max: params.lambdaEnd }),
        [params.lambdaStart, params.lambdaEnd]
    );

    const copyCSV = () => {
        const csv = buildCSV(data, showCurves);
        if (navigator.clipboard) navigator.clipboard.writeText(csv);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    // Save the currently-shown spectrum (respects shown curves / AOI / λ grid) to
    // a CSV file. Reuses the same column builder as the clipboard copy.
    const [saved, setSaved] = useState(false);
    const saveCSV = async () => {
        const csv = buildCSV(data, showCurves);
        if (!csv || !window.electronAPI?.spectrumSaveFile) return;
        const base = (design.name || 'spectrum').replace(/[^\w.-]+/g, '_');
        const res = await window.electronAPI.spectrumSaveFile(csv, `${base}_spectrum.csv`);
        if (res?.success) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
    };

    const frontCount = (design.frontLayers || []).length;
    const backCount  = (design.backLayers  || []).length;
    const frontNm    = (design.frontLayers || []).reduce((s, l) => s + (l.thickness || 0), 0);
    const backNm     = (design.backLayers  || []).reduce((s, l) => s + (l.thickness || 0), 0);
    const subThick   = design.substrate.thickness ?? 1.0;

    const showEmpty = evalMode === 'front' && frontCount === 0 && !data;

    const hasTargets = !!design.meritOperands?.length;

    // ── Toolbar field-block style ────────────────────────────────────────────
    // Each labelled group is wrapped in a light "card" so the eye groups
    // (label, inputs) together — fixes the prior "all over the place" feel
    // where mixed-width labels and inputs blended into one another.
    const fieldBlock = {
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 8px',
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        flexShrink: 0
    };

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
            overflow: 'hidden'
        }
    },
        // ── Row 1: Mode • Wavelength • AOI • Auto+Calc ───────────────────────
        h('div', {
            style: {
                display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                gap: 8, rowGap: 6,
                padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0
            }
        },
            // Evaluation target — read-only, set in the Design Editor.
            h(EvalModeBadge, { design, c, t }),
            // Cone-angle averaging indicator (only when active).
            h(ConeBadge, { design, c, t }),

            // Wavelength + step block
            h('div', { style: fieldBlock },
                h(FieldLabel, { c }, oe.wavelength),
                h(NumInput, {
                    value: params.lambdaStart, min: 100, max: 20000, step: 10, c, width: 56,
                    onChange: v => setParams(p => ({ ...p, lambdaStart: v }))
                }),
                h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
                h(NumInput, {
                    value: params.lambdaEnd, min: 100, max: 20000, step: 10, c, width: 56,
                    onChange: v => setParams(p => ({ ...p, lambdaEnd: v }))
                }),
                h('span', { style: { width: 8 } }),
                h(FieldLabel, { c }, oe.step),
                h(NumInput, {
                    value: params.lambdaStep, min: 0.1, max: 100, step: 0.5, c, width: 50,
                    onChange: v => setParams(p => ({ ...p, lambdaStep: v }))
                })
            ),

            // Spectral-axis display unit (display only; sampling stays in nm).
            h('div', { style: fieldBlock },
                h(FieldLabel, { c }, oe.axisUnit),
                h('select', {
                    value: spectralUnit,
                    onChange: (e) => setSpectralUnit(e.target.value),
                    style: {
                        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                        borderRadius: 3, fontSize: 11, padding: '2px 4px', cursor: 'pointer',
                    }
                }, SPECTRAL_UNIT_IDS.map(id => h('option', { key: id, value: id }, SPECTRAL_UNITS[id].short)))
            ),

            // AOI chip block
            h('div', { style: fieldBlock },
                h(FieldLabel, { c }, oe.aoiDeg),
                h(AoiChips, { values: params.thetas, onChange: setThetas, c, oe })
            ),

            // Auto + Calculate — pushed to the right
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 } },
                h('label', {
                    style: {
                        display: 'flex', alignItems: 'center', gap: 4,
                        fontSize: 11, cursor: 'pointer', color: c.text
                    }
                },
                    h(Checkbox, { c, checked: autoCalc, onChange: (e) => setAutoCalc(e.target.checked) }),
                    oe.autoLabel
                ),
                !autoCalc && h('button', {
                    onClick: compute, disabled: computing,
                    style: {
                        padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                        border: `1px solid ${c.accent}`, borderRadius: 3,
                        backgroundColor: c.accent + '33', color: c.accent,
                        outline: 'none', fontFamily: 'system-ui'
                    }
                }, computing ? oe.calculating : oe.calculate)
            )
        ),

        // ── Row 2: Curve visibility (avg / s-pol / p-pol) + Targets ──────────
        h('div', {
            style: {
                display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                gap: 6, rowGap: 4,
                padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel + 'aa', flexShrink: 0
            }
        },
            h(FieldLabel, { c }, oe.curves),
            CURVE_GROUPS.map((g, i) => [
                i > 0 ? h(Divider, { c, key: g.q + '-div' }) : null,
                h(CurveGroup, {
                    key: g.q, group: g, showCurves, onToggle: toggleCurve, c,
                    polLabels: { avg: oe.polAvg, s: oe.polSShort, p: oe.polPShort },
                }),
            ]),

            // Y-axis scaling (%) — Auto-fit or explicit min/max. Kept in ONE
            // nowrap group so the label + its controls always wrap as a unit
            // (never the label drifting away from its inputs on resize).
            h(Divider, { c }),
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'nowrap' } },
                h(FieldLabel, { c }, oe.yAxis),
                h('label', {
                    style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' }
                },
                    h(Checkbox, { c, checked: yAuto, onChange: (e) => setYAuto(e.target.checked) }),
                    oe.yAuto
                ),
                !yAuto && h(NumInput, {
                    value: yMin, min: -10, max: 200, step: 5, c, width: 48,
                    onChange: v => setYMin(Math.min(v, yMax - 1))
                }),
                !yAuto && h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
                !yAuto && h(NumInput, {
                    value: yMax, min: -10, max: 200, step: 5, c, width: 48,
                    onChange: v => setYMax(Math.max(v, yMin + 1))
                })
            ),

            h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 } },
                h('button', {
                    onClick: () => setEditMode(p => !p),
                    title: editMode ? oe.editTargetsTooltipOn : oe.editTargetsTooltipOff,
                    style: {
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px', cursor: 'pointer', outline: 'none',
                        border: `1px solid ${editMode ? c.accent : c.border}`,
                        borderRadius: 3,
                        backgroundColor: editMode ? c.accent + '22' : 'transparent',
                        color: editMode ? c.accent : c.textDim,
                        fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: editMode ? 600 : 400,
                    }
                }, '✎ ' + oe.editTargets),

                h(Divider, { c }),
                h('button', {
                    onClick: () => setShowTargets(p => !p),
                    disabled: !hasTargets || editMode,
                    title: hasTargets ? oe.targetsTooltipOn : oe.targetsTooltipOff,
                    style: {
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px', cursor: (hasTargets && !editMode) ? 'pointer' : 'default',
                        outline: 'none',
                        border: `1px solid ${(showTargets || editMode) ? '#ffd54f' : c.border}`,
                        borderRadius: 3,
                        backgroundColor: (showTargets || editMode) ? '#ffd54f22' : 'transparent',
                        color: (showTargets || editMode) ? c.text : c.textDim,
                        fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: (showTargets || editMode) ? 600 : 400,
                        opacity: (hasTargets && !editMode) ? 1 : 0.4
                    }
                },
                    h('div', { style: { width: 14, height: 0, borderTop: `2px dotted ${(showTargets || editMode) ? '#ffd54f' : c.textDim}` } }),
                    oe.targets
                )
            )
        ),

        // Edit-mode toolbar — its OWN row (left-aligned, wraps freely) so
        // toggling Draw/Delete never shoves other controls around and the panel
        // can't slide off-screen on a narrow window.
        editMode && h('div', {
            style: {
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, rowGap: 4,
                padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0
            }
        },
            // Tool selector (always present in edit mode) — fixed left position.
            [
                { id: 'draw',   label: '✏ ' + oe.editToolDraw,   tip: oe.editToolDrawTip },
                { id: 'delete', label: '🗑 ' + oe.editToolDelete, tip: oe.editToolDeleteTip },
            ].map(tl =>
                h('button', {
                    key: tl.id,
                    onClick: () => setEditTool(tl.id),
                    title: tl.tip,
                    style: {
                        padding: '2px 8px', cursor: 'pointer', outline: 'none',
                        border: `1px solid ${editTool === tl.id ? c.accent : c.border}`,
                        borderRadius: 3,
                        backgroundColor: editTool === tl.id ? c.accent + '22' : 'transparent',
                        color: editTool === tl.id ? c.accent : c.textDim,
                        fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: editTool === tl.id ? 600 : 400,
                    }
                }, tl.label)
            ),

            // Draw-only controls: kind (avg/cont) + family (R/T/A) + pol + snap.
            editTool === 'draw' && h(Divider, { c }),
            editTool === 'draw' && h(FieldLabel, { c }, oe.editAs),
            editTool === 'draw' && [
                { id: 'average',    label: oe.editKindAvg },
                { id: 'continuous', label: oe.editKindCont },
            ].map(k =>
                h('button', {
                    key: k.id,
                    onClick: () => setEditKind(k.id),
                    title: oe.editKindTooltip,
                    style: {
                        padding: '2px 8px', cursor: 'pointer', outline: 'none',
                        border: `1px solid ${editKind === k.id ? c.accent : c.border}`,
                        borderRadius: 3,
                        backgroundColor: editKind === k.id ? c.accent + '22' : 'transparent',
                        color: editKind === k.id ? c.accent : c.textDim,
                        fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: editKind === k.id ? 600 : 400,
                    }
                }, k.label)
            ),
            editTool === 'draw' && h(Divider, { c }),
            editTool === 'draw' && ['R', 'T', 'A'].map(fam =>
                h('button', {
                    key: fam,
                    onClick: () => setEditCurve(fam),
                    title: oe.editAsTooltip,
                    style: {
                        padding: '2px 8px', cursor: 'pointer', outline: 'none',
                        border: `1px solid ${editCurve === fam ? CURVE_COLOR_FOR(fam) : c.border}`,
                        borderRadius: 3,
                        backgroundColor: editCurve === fam ? CURVE_COLOR_FOR(fam) + '22' : 'transparent',
                        color: editCurve === fam ? c.text : c.textDim,
                        fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: editCurve === fam ? 600 : 400,
                    }
                }, fam)
            ),
            editTool === 'draw' && h('select', {
                value: editPol, onChange: (e) => setEditPol(e.target.value),
                title: oe.editPolTooltip,
                style: {
                    height: 22, backgroundColor: c.panel, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    fontSize: 11, padding: '0 4px', outline: 'none'
                }
            },
                h('option', { value: 'avg' }, 'avg'),
                h('option', { value: 's' }, 's'),
                h('option', { value: 'p' }, 'p')
            ),
            editTool === 'draw' && h(Divider, { c }),
            editTool === 'draw' && h('div', {
                style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'nowrap' }
            },
                h('label', {
                    style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' },
                    title: oe.snapTip
                },
                    h(Checkbox, { c, checked: snapOn, onChange: (e) => setSnapOn(e.target.checked) }),
                    oe.snap
                ),
                snapOn && h(NumInput, {
                    value: snapNm, min: 0, max: 100, step: 1, c, width: 40,
                    onChange: v => setSnapNm(v)
                }),
                snapOn && h('span', { style: { fontSize: 10, color: c.textDim } }, oe.snapNmUnit),
                snapOn && h(NumInput, {
                    value: snapPct, min: 0, max: 50, step: 1, c, width: 36,
                    onChange: v => setSnapPct(v)
                }),
                snapOn && h('span', { style: { fontSize: 10, color: c.textDim } }, oe.snapPctUnit)
            ),

            // Inline hint, right-aligned so it fills leftover space on wide rows.
            h('span', {
                style: { marginLeft: 'auto', fontSize: 11, color: c.textDim, fontStyle: 'italic' }
            }, editTool === 'delete' ? oe.editHintDelete : oe.editHintDraw)
        ),

        // ── Chart + table (shared middle container) ──────────────────────────
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                // PlotlyChart is ALWAYS mounted — error / empty states are
                // overlays, never branch swaps. Swapping it out unmounts the
                // chart (Plotly.purge → blank) and remounts it (newPlot →
                // redraw), which is the "appears → blank → appears" flicker seen
                // when switching designs (the two-phase selectedItem→activeDesignId
                // update can momentarily flip error/showEmpty).
                h(PlotlyChart, {
                    data, showCurves, targets: design.meritOperands, showTargets, c, theme,
                    editMode, editTool, editCurve, editPol, editKind, lamRange, yRange,
                    spectralUnit, overlays: design.measuredCurves,
                    onCreateTarget, onEditTarget, onDeleteTarget,
                }),
                error && h('div', {
                    style: {
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#ef5350', fontSize: 12, padding: 16, textAlign: 'center',
                        background: c.bg
                    }
                }, `Error: ${error}`),
                (!error && showEmpty) && h('div', {
                    style: {
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: c.textDim, fontSize: 12, fontStyle: 'italic',
                        background: c.bg
                    }
                }, oe.noFrontLayers)
            ),
            showTable && data && h(DataTable, { data, showCurves, c })
        ),

        // ── Bottom strip: info + CSV + Table toggle ──────────────────────────
        h('div', {
            style: {
                padding: '3px 10px', borderTop: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 12,
                fontSize: 11, color: c.textDim
            }
        },
            h('span', null, design.name),
            evalMode === 'front' && h('span', null, oe.frontSummary(frontCount, frontNm.toFixed(1))),
            evalMode === 'back'  && h('span', null, oe.backSummary(backCount, backNm.toFixed(1))),
            evalMode === 'total' && h('span', null, oe.totalSummary(frontCount, subThick, backCount)),
            evalMode === 'front' && h('span', null, `${mediumName(design.incidentMedium)} → ${mediumName(design.substrate.material)}`),
            evalMode === 'back'  && h('span', null, `${mediumName(design.exitMedium)} → ${mediumName(design.substrate.material)}`),
            evalMode === 'total' && h('span', null, `${mediumName(design.incidentMedium)} → ${mediumName(design.substrate.material)} → ${mediumName(design.exitMedium)}`),
            computing && h('span', { style: { color: c.accent } }, oe.calculating),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' } },
                h('button', {
                    onClick: copyCSV, disabled: !data,
                    style: {
                        padding: '2px 9px', fontSize: 11, cursor: data ? 'pointer' : 'default',
                        border: `1px solid ${c.border}`, borderRadius: 3,
                        backgroundColor: 'transparent', color: copied ? c.accent : c.textDim,
                        outline: 'none', fontFamily: 'system-ui', opacity: data ? 1 : 0.5
                    }
                }, copied ? oe.csvCopied : oe.csvButton),
                h('button', {
                    onClick: saveCSV, disabled: !data,
                    style: {
                        padding: '2px 9px', fontSize: 11, cursor: data ? 'pointer' : 'default',
                        border: `1px solid ${c.border}`, borderRadius: 3,
                        backgroundColor: 'transparent', color: saved ? c.accent : c.textDim,
                        outline: 'none', fontFamily: 'system-ui', opacity: data ? 1 : 0.5
                    }
                }, saved ? oe.csvSaved : oe.csvSave),
                h('button', {
                    onClick: () => setShowTable(p => !p),
                    style: {
                        padding: '2px 9px', fontSize: 11, cursor: 'pointer',
                        border: `1px solid ${showTable ? c.accent : c.border}`, borderRadius: 3,
                        backgroundColor: showTable ? c.accent + '22' : 'transparent',
                        color: showTable ? c.accent : c.textDim,
                        outline: 'none', fontFamily: 'system-ui'
                    }
                }, (showTable ? '▲ ' : '▼ ') + oe.tableToggle)
            )
        )
    );
}
