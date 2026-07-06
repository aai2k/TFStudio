/**
 * Plot Engine — generic XY plot builder.
 *
 * Lets the user define an arbitrary number of "curves" — each curve picks
 * an x-axis (λ or AOI), a y-channel (T/R/A), a polarization, a surface mode,
 * and fixed/range values for the relevant parameters. All visible curves
 * are drawn on a single Plotly chart.
 *
 * v1 scope is T/R/A vs (λ | AOI). The compute pipeline in
 * `plotQuantities.js` is dispatch-table-shaped so extending to GD/GDD,
 * Ψ/Δ, |E|², admittance, per-layer quantities, etc. only needs new entries.
 */

import { useDesign }       from '../../state/DesignContext.js';
import { getMaterialById } from '../../utils/materials/catalogManager.js';
import { getMaterial }     from '../../utils/materials/materialDatabase.js';
import {
    makeDefaultCurve, computeCurve,
    X_AXES, Y_CHANNELS, POLARIZATIONS, SURFACE_MODES, DASHES,
    xAxisLabel,
    makeDefaultSurfaceSpec, computeSurface, requiredSurfaceLambdas,
    isLayerVar, surfaceAxisLabel, parseAxisVar,
    Z_QUANTITIES, SURFACE_RENDERS, COLORSCALES,
    buildAxisTargetOptions, AXIS_PROPS, axisTarget, axisProp, composeAxisVar,
    defaultAxisRange,
} from '../../utils/physics/plotQuantities.js';
import { WorkerPool } from '../../utils/workers/workerPool.js';
import { PLOT_SURFACE_WORKER_URL } from '../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../utils/workers/tmmWasm.js';
import { collectDesignMaterialIds, buildPresampledTable } from '../../utils/physics/optimizer.js';
import { Checkbox } from '../ui/Checkbox.js';

function poolSize() {
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return Math.max(2, Math.min(8, hw - 1));
}

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Per-design caches — survive docking switches (component unmount/remount).
const _plotCache = new Map();        // curve list (2D)
const _surfaceCache = new Map();     // 3D surface spec
const _resultCache = new Map();      // last computed 3D surface result
const _modeCache = new Map();        // '2d' | '3d' view mode

// ── Plotly chart ─────────────────────────────────────────────────────────────

function MultiCurveChart({ curves, results, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const traces = useMemo(() => {
        return curves
            .filter(cv => cv.visible && results[cv.id])
            .map(cv => ({
                x: results[cv.id].x,
                y: results[cv.id].y,
                type: 'scatter',
                mode: 'lines',
                name: cv.label || cv.id,
                line: { color: cv.color, dash: cv.dash, width: cv.width || 2 },
                hovertemplate: `${cv.label}<br>${cv.xAxis === 'aoi' ? 'AOI=%{x:.1f}°' : 'λ=%{x:.1f} nm'}<br>${cv.yChannel}=%{y:.4f}<extra></extra>`,
            }));
    }, [curves, results]);

    // Determine the dominant x-axis label (use the first visible curve's axis;
    // if curves are mixed, fall back to "X" — Plotly only supports a single x-axis
    // type per plot in this simple v1).
    const xAxisType = useMemo(() => {
        const cv = curves.find(x => x.visible);
        return cv ? cv.xAxis : 'wavelength';
    }, [curves]);

    const layout = useMemo(() => ({
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor:  c.bg    || '#1e1e1e',
        margin: { l: 56, r: 16, t: 16, b: 44 },
        xaxis: {
            title: { text: xAxisLabel(xAxisType), font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'T / R / A', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 1.02],
        },
        legend: { orientation: 'h', x: 0, y: 1.08, font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
        hovermode: 'x unified',
    }), [c, xAxisType]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [traces, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── 3D surface chart ───────────────────────────────────────────────────────────

function SurfaceChart({ result, spec, design, c, t }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const pe = (t && t.plotEngine) || {};

    const figure = useMemo(() => {
        if (!result || !result.ok) return null;
        const common = {
            x: result.x, y: result.y, z: result.z,
            colorscale: spec.colorscale || 'Viridis',
            colorbar: { title: { text: result.zLabel, side: 'right', font: { color: c.text, size: 11 } },
                        tickfont: { color: c.text, size: 9 },
                        thickness: 14, len: 0.9, x: 1.0, xpad: 4 },
        };
        const trace = spec.render === 'heatmap'
            ? { type: 'heatmap', ...common,
                hovertemplate: `%{x}<br>%{y}<br>${result.zLabel}=%{z:.4g}<extra></extra>` }
            : { type: 'surface', ...common, contours: { z: { show: false } },
                hovertemplate: `%{x}<br>%{y}<br>${result.zLabel}=%{z:.4g}<extra></extra>` };

        const xTitle = surfaceAxisLabel(spec.xVar, design);
        const yTitle = surfaceAxisLabel(spec.yVar, design);
        const axisFont = { color: c.text, size: 11 };
        const tickFont = { color: c.text, size: 9 };

        const layout = {
            paper_bgcolor: c.panel || '#252526',
            plot_bgcolor:  c.bg || '#1e1e1e',
            margin: spec.render === 'heatmap' ? { l: 60, r: 16, t: 16, b: 50 } : { l: 0, r: 0, t: 0, b: 0 },
            font: { color: c.text },
        };
        if (spec.render === 'heatmap') {
            layout.xaxis = { title: { text: xTitle, font: axisFont }, color: c.text, tickfont: tickFont, gridcolor: c.border };
            layout.yaxis = { title: { text: yTitle, font: axisFont }, color: c.text, tickfont: tickFont, gridcolor: c.border };
        } else {
            layout.scene = {
                // 'cube' fills the plotting box regardless of the data ranges
                // (thickness ~100 nm vs index ~1 vs MF ~0.3 differ by orders of
                // magnitude — the default 'data' aspect squishes the surface into
                // a sliver). domain spans the full width so it doesn't leave a gap.
                aspectmode: 'cube',
                domain: { x: [0, 1], y: [0, 1] },
                xaxis: { title: { text: xTitle, font: axisFont }, color: c.text, tickfont: tickFont,
                         backgroundcolor: c.bg, gridcolor: c.border, showbackground: true },
                yaxis: { title: { text: yTitle, font: axisFont }, color: c.text, tickfont: tickFont,
                         backgroundcolor: c.bg, gridcolor: c.border, showbackground: true },
                zaxis: { title: { text: result.zLabel, font: axisFont }, color: c.text, tickfont: tickFont,
                         backgroundcolor: c.bg, gridcolor: c.border, showbackground: true },
                // Pulled back from Plotly's default so the cube isn't clipped/over-
                // zoomed on first paint.
                camera: { eye: { x: 1.9, y: -1.9, z: 1.35 } },
            };
        }
        return { traces: [trace], layout };
    }, [result, spec, design, c]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!figure) {
            if (initRef.current) { Plotly.purge(divRef.current); initRef.current = false; }
            return;
        }
        Plotly.react(divRef.current, figure.traces, figure.layout, { responsive: true, displayModeBar: true });
        initRef.current = true;
        // Snap the (WebGL) canvas to the container's settled size — on first paint
        // the flex cell may not have its final width yet, which otherwise leaves
        // the gl scene oversized / overflowing.
        requestAnimationFrame(() => { if (divRef.current && initRef.current) Plotly.Plots.resize(divRef.current); });
    }, [figure]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    if (!result) {
        return h('div', {
            style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                     color: c.textDim, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: 20 }
        }, pe.surfacePrompt || 'Configure the axes and quantity, then press Compute.');
    }
    if (!result.ok) {
        return h('div', {
            style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                     color: c.danger || '#ef5350', fontSize: 13, textAlign: 'center', padding: 20 }
        }, result.error || 'Cannot compute surface.');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', overflow: 'hidden' } });
}

// ── Curve editor row ─────────────────────────────────────────────────────────

function CurveRow({ curve, onUpdate, onDelete, c, t }) {
    const pe = (t && t.plotEngine) || {};
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const selStyle  = { ...inputStyle, width: 'auto' };
    const numStyle  = { ...inputStyle, width: 64 };

    const fieldRow = { display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, alignItems: 'center', marginBottom: 3 };
    const lbl = { color: c.textDim, fontSize: 10 };

    return h('div', {
        style: {
            padding: '8px',
            borderBottom: `1px solid ${c.border}`,
            background: curve.visible ? c.panel : c.bg,
            opacity: curve.visible ? 1 : 0.55,
        }
    },
        // Header row: visibility, label, color, delete
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
            h(Checkbox, {
                c, checked: curve.visible,
                onChange: (e) => onUpdate({ visible: e.target.checked }),
                title: pe.visible || 'Visible',
            }),
            h('input', {
                type: 'color', value: curve.color,
                onChange: (e) => onUpdate({ color: e.target.value }),
                title: pe.color || 'Color',
                style: { width: 22, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }
            }),
            h('input', {
                type: 'text', value: curve.label,
                onChange: (e) => onUpdate({ label: e.target.value }),
                style: { ...inputStyle, flex: 1 }
            }),
            h('button', {
                onClick: onDelete,
                title: pe.delete || 'Delete curve',
                style: {
                    width: 22, height: 18, padding: 0,
                    background: 'transparent', color: c.textDim,
                    border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1,
                }
            }, '×'),
        ),
        // X axis
        h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.xAxis || 'X axis'),
            h('select', {
                value: curve.xAxis,
                onChange: (e) => onUpdate({ xAxis: e.target.value }),
                style: selStyle
            }, X_AXES.map(v => h('option', { key: v, value: v }, v === 'aoi' ? 'AOI' : (pe.xWavelength || 'wavelength')))),
        ),
        // Range
        h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.range || 'Range'),
            h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
                h('input', { type: 'number', value: curve.rangeFrom, step: curve.xAxis === 'aoi' ? 5 : 10, style: numStyle,
                    onChange: (e) => onUpdate({ rangeFrom: parseFloat(e.target.value) || 0 }) }),
                h('span', null, '–'),
                h('input', { type: 'number', value: curve.rangeTo, step: curve.xAxis === 'aoi' ? 5 : 10, style: numStyle,
                    onChange: (e) => onUpdate({ rangeTo: parseFloat(e.target.value) || 0 }) }),
                h('span', { style: { color: c.textDim, fontSize: 10 } }, curve.xAxis === 'aoi' ? '°' : 'nm'),
            ),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.step || 'Step'),
            h('input', { type: 'number', value: curve.rangeStep, step: 1, min: 0.1, style: numStyle,
                onChange: (e) => { const v = parseFloat(e.target.value); onUpdate({ rangeStep: v > 0 ? v : 1 }); } }),
        ),
        // Fixed param (the non-x one)
        curve.xAxis === 'wavelength' && h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.fixedAOI || 'AOI fixed'),
            h('input', { type: 'number', value: curve.aoiFixed_deg, step: 5, min: 0, max: 89, style: numStyle,
                onChange: (e) => onUpdate({ aoiFixed_deg: parseFloat(e.target.value) || 0 }) }),
        ),
        curve.xAxis === 'aoi' && h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.fixedLambda || 'λ fixed'),
            h('input', { type: 'number', value: curve.lambdaFixed_nm, step: 10, min: 100, style: numStyle,
                onChange: (e) => onUpdate({ lambdaFixed_nm: parseFloat(e.target.value) || 550 }) }),
        ),
        // Y channel + polarization + surface
        h('div', { style: { ...fieldRow, gridTemplateColumns: '70px 1fr 1fr' } },
            h('span', { style: lbl }, pe.channel || 'Y'),
            h('select', { value: curve.yChannel, onChange: (e) => onUpdate({ yChannel: e.target.value }), style: selStyle },
                Y_CHANNELS.map(v => h('option', { key: v, value: v }, v))),
            h('select', { value: curve.polarization, onChange: (e) => onUpdate({ polarization: e.target.value }), style: selStyle },
                POLARIZATIONS.map(v => h('option', { key: v, value: v }, v))),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.surface || 'Surface'),
            h('select', { value: curve.surfaceMode, onChange: (e) => onUpdate({ surfaceMode: e.target.value }), style: selStyle },
                SURFACE_MODES.map(v => h('option', { key: v, value: v }, v))),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, pe.dash || 'Dash'),
            h('div', { style: { display: 'flex', gap: 4 } },
                h('select', { value: curve.dash, onChange: (e) => onUpdate({ dash: e.target.value }), style: selStyle },
                    DASHES.map(v => h('option', { key: v, value: v }, v))),
                h('input', { type: 'number', value: curve.width, step: 0.5, min: 0.5, max: 5,
                    style: { ...numStyle, width: 40 },
                    onChange: (e) => onUpdate({ width: parseFloat(e.target.value) || 2 }) }),
            ),
        ),
    );
}

// ── 3D surface config panel ────────────────────────────────────────────────────

function SurfacePanel({ spec, onUpdate, onCompute, computing, progress, design, result, c, t }) {
    const pe = (t && t.plotEngine) || {};
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '2px 4px', fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const selStyle = { ...inputStyle, width: '100%' };
    const numStyle = { ...inputStyle, width: 60 };
    const lbl = { color: c.textDim, fontSize: 10, marginBottom: 2 };
    const block = { padding: '8px 10px', borderBottom: `1px solid ${c.border}` };
    const sectionTitle = { fontSize: 10, fontWeight: 600, color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 };

    const isMF = spec.z === 'MF';
    const optical = !isMF;
    const targetOptions = buildAxisTargetOptions(design, optical);

    // Which fixed params are needed (optical only, when not an axis).
    const xk = parseAxisVar(spec.xVar).kind, yk = parseAxisVar(spec.yVar).kind;
    const needFixedLambda = optical && xk !== 'lambda' && yk !== 'lambda';
    const needFixedAOI    = optical && xk !== 'aoi'    && yk !== 'aoi';

    const axisGroup = (which) => {
        const v   = which === 'x' ? spec.xVar  : spec.yVar;
        const fr  = which === 'x' ? spec.xFrom : spec.yFrom;
        const to  = which === 'x' ? spec.xTo   : spec.yTo;
        const st  = which === 'x' ? spec.xSteps : spec.ySteps;
        const tgt = axisTarget(v);          // 'wavelength' | 'aoi' | 'layer:<i>'
        const prp = axisProp(v) || 'thk';   // 'thk' | 'n' | 'k'
        const isLayer = tgt.startsWith('layer:');

        // Patch the token + auto-default the range to suit the new variable.
        const setVar = (token) => {
            const rng = defaultAxisRange(design, token);
            onUpdate(which === 'x'
                ? { xVar: token, xFrom: rng.from, xTo: rng.to }
                : { yVar: token, yFrom: rng.from, yTo: rng.to });
        };
        const setRange = (patch) => onUpdate(which === 'x'
            ? { xFrom: patch.from ?? fr, xTo: patch.to ?? to, xSteps: patch.steps ?? st }
            : { yFrom: patch.from ?? fr, yTo: patch.to ?? to, ySteps: patch.steps ?? st });

        return h('div', { style: { marginBottom: 8 } },
            h('div', { style: lbl }, which === 'x' ? (pe.xAxisVar || 'X axis') : (pe.yAxisVar || 'Y axis')),
            // 1) Pick the layer (or λ / AOI) …
            h('select', {
                value: tgt, onChange: (e) => setVar(composeAxisVar(e.target.value, prp)), style: selStyle,
            }, targetOptions.map(o => h('option', { key: o.value, value: o.value },
                o.value === 'wavelength' ? (pe.varWavelength || o.label)
                : o.value === 'aoi'      ? (pe.varAOI || o.label)
                : o.label))),
            // 2) … then the property (only when a layer is selected).
            isLayer && h('select', {
                value: prp, onChange: (e) => setVar(composeAxisVar(tgt, e.target.value)),
                style: { ...selStyle, marginTop: 4 },
            }, AXIS_PROPS.map(o => h('option', { key: o.value, value: o.value },
                o.value === 'thk' ? (pe.propThickness || o.label)
                : o.value === 'n' ? (pe.propN || o.label)
                : (pe.propK || o.label)))),
            h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 } },
                h('input', { type: 'number', value: fr, style: numStyle,
                    onChange: (e) => setRange({ from: parseFloat(e.target.value) || 0 }) }),
                h('span', { style: { color: c.textDim } }, '–'),
                h('input', { type: 'number', value: to, style: numStyle,
                    onChange: (e) => setRange({ to: parseFloat(e.target.value) || 0 }) }),
                h('span', { style: { color: c.textDim, fontSize: 10, marginLeft: 4 } }, pe.steps || 'steps'),
                h('input', { type: 'number', value: st, min: 2, max: 400, style: { ...numStyle, width: 46 },
                    onChange: (e) => setRange({ steps: parseInt(e.target.value, 10) || 2 }) }),
            ),
        );
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            // Quantity
            h('div', { style: block },
                h('div', { style: sectionTitle }, pe.quantity || 'Quantity (Z)'),
                h('select', { value: spec.z, onChange: (e) => onUpdate({ z: e.target.value }), style: selStyle },
                    Z_QUANTITIES.map(v => h('option', { key: v, value: v },
                        v === 'MF' ? (pe.zMF || 'Merit Function')
                        : v))),
                optical && h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                    h('div', { style: { flex: 1 } },
                        h('div', { style: lbl }, pe.channel || 'Polarization'),
                        h('select', { value: spec.polarization, onChange: (e) => onUpdate({ polarization: e.target.value }), style: selStyle },
                            POLARIZATIONS.map(v => h('option', { key: v, value: v }, v)))),
                    h('div', { style: { flex: 1 } },
                        h('div', { style: lbl }, pe.surface || 'Surface'),
                        h('select', { value: spec.surfaceMode, onChange: (e) => onUpdate({ surfaceMode: e.target.value }), style: selStyle },
                            SURFACE_MODES.map(v => h('option', { key: v, value: v }, v)))),
                ),
                isMF && h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 6, lineHeight: 1.4 } },
                    (pe.mfHint || 'MF is plotted over two layer parameters — the optimizer landscape. Axes must be layer thickness / n / k.')),
            ),
            // Axes
            h('div', { style: block },
                h('div', { style: sectionTitle }, pe.axes || 'Axes'),
                axisGroup('x'),
                axisGroup('y'),
            ),
            // Fixed params (optical)
            (needFixedLambda || needFixedAOI) && h('div', { style: block },
                h('div', { style: sectionTitle }, pe.fixed || 'Fixed parameters'),
                needFixedLambda && h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
                    h('span', { style: { ...lbl, marginBottom: 0, width: 60 } }, pe.fixedLambda || 'λ (nm)'),
                    h('input', { type: 'number', value: spec.fixedLambda_nm, step: 10, min: 100, style: numStyle,
                        onChange: (e) => onUpdate({ fixedLambda_nm: parseFloat(e.target.value) || 550 }) })),
                needFixedAOI && h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h('span', { style: { ...lbl, marginBottom: 0, width: 60 } }, pe.fixedAOI || 'AOI (°)'),
                    h('input', { type: 'number', value: spec.fixedAOI_deg, step: 5, min: 0, max: 89, style: numStyle,
                        onChange: (e) => onUpdate({ fixedAOI_deg: parseFloat(e.target.value) || 0 }) })),
            ),
            // Appearance
            h('div', { style: block },
                h('div', { style: sectionTitle }, pe.appearance || 'Appearance'),
                h('div', { style: { display: 'flex', gap: 6 } },
                    h('div', { style: { flex: 1 } },
                        h('div', { style: lbl }, pe.render || 'Render'),
                        h('select', { value: spec.render, onChange: (e) => onUpdate({ render: e.target.value }), style: selStyle },
                            SURFACE_RENDERS.map(v => h('option', { key: v, value: v },
                                v === 'surface' ? (pe.renderSurface || '3D surface') : (pe.renderHeatmap || 'Heatmap'))))),
                    h('div', { style: { flex: 1 } },
                        h('div', { style: lbl }, pe.colorscale || 'Colors'),
                        h('select', { value: spec.colorscale, onChange: (e) => onUpdate({ colorscale: e.target.value }), style: selStyle },
                            COLORSCALES.map(v => h('option', { key: v, value: v }, v)))),
                ),
            ),
        ),
        // Compute footer
        h('div', { style: { padding: '8px 10px', borderTop: `1px solid ${c.border}`, background: c.panel } },
            h('button', {
                onClick: onCompute, disabled: computing,
                style: {
                    width: '100%', padding: '6px 10px', background: computing ? c.border : c.accent,
                    color: '#fff', border: 'none', borderRadius: 3, fontSize: 12, fontWeight: 600,
                    cursor: computing ? 'default' : 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }, computing
                ? (progress && progress.total
                    ? `${pe.computing || 'Computing…'} ${progress.done}/${progress.total}`
                    : (pe.computing || 'Computing…'))
                : (pe.compute || '▶ Compute surface')),
            h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 5, textAlign: 'center' } },
                (() => {
                    const nx = Math.max(2, Math.min(400, Math.round(spec.xSteps || 2)));
                    const ny = Math.max(2, Math.min(400, Math.round(spec.ySteps || 2)));
                    return (pe.gridSize || 'Grid') + `: ${nx} × ${ny} = ${nx * ny} ${pe.points || 'points'}`;
                })()
            ),
            result && !result.ok && h('div', { style: { fontSize: 10, color: c.danger || '#ef5350', marginTop: 4, textAlign: 'center', lineHeight: 1.3 } },
                result.error),
        ),
    );
}

// ── Main window ──────────────────────────────────────────────────────────────

export function PlotEngine({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const pe = (t && t.plotEngine) || {};

    const [curves, setCurves] = useState(() => {
        const cached = design && _plotCache.get(design.id);
        return cached?.length ? cached.map(x => ({ ...x })) : [makeDefaultCurve({ surfaceMode: evalMode || 'front' })];
    });

    // Rehydrate per design
    useEffect(() => {
        if (!design) return;
        const cached = _plotCache.get(design.id);
        setCurves(cached?.length ? cached.map(x => ({ ...x })) : [makeDefaultCurve({ surfaceMode: evalMode || 'front' })]);
    }, [design?.id]);

    // Persist
    useEffect(() => {
        if (!design) return;
        _plotCache.set(design.id, curves.map(x => ({ ...x })));
    }, [curves, design?.id]);

    // ── Build the evaluation context once per design change ─────────────────
    const ctx = useMemo(() => {
        if (!design) return null;
        const incMat  = resolveMaterial(design.incidentMedium);
        const subMat  = resolveMaterial(design.substrate?.material);
        const exitMat = resolveMaterial(design.exitMedium);
        const frontLayers = (design.frontLayers || [])
            .filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
        const backLayers = (design.backLayers || [])
            .filter(l => l.thickness > 0)
            .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
        return {
            incMat, subMat, exitMat, frontLayers, backLayers,
            subThickness_mm: design.substrate?.thickness ?? 1.0,
        };
    }, [design]);

    // ── Compute every visible curve's data ──────────────────────────────────
    const results = useMemo(() => {
        if (!ctx) return {};
        const out = {};
        for (const cv of curves) {
            if (!cv.visible) continue;
            try {
                out[cv.id] = computeCurve(cv, ctx);
            } catch (e) {
                console.error('PlotEngine curve error:', cv.id, e);
                out[cv.id] = { x: [], y: [] };
            }
        }
        return out;
    }, [curves, ctx]);

    // ── Add / update / delete curve ─────────────────────────────────────────
    const addCurve = useCallback(() => {
        setCurves(prev => [...prev, makeDefaultCurve({ surfaceMode: evalMode || 'front' })]);
    }, [evalMode]);

    const updateCurve = useCallback((id, patch) => {
        setCurves(prev => prev.map(cv => cv.id === id ? { ...cv, ...patch } : cv));
    }, []);

    const deleteCurve = useCallback((id) => {
        setCurves(prev => prev.filter(cv => cv.id !== id));
    }, []);

    // ── 3D surface mode ─────────────────────────────────────────────────────
    // plotMode + the computed result are cached per design so the window state
    // survives docking switches (the component unmounts/remounts).
    const [plotMode, setPlotMode] = useState(() => (design && _modeCache.get(design.id)) || '2d');
    const [surfaceSpec, setSurfaceSpec] = useState(() => {
        const cached = design && _surfaceCache.get(design.id);
        return cached ? { ...cached } : makeDefaultSurfaceSpec(design, { surfaceMode: evalMode || 'front' });
    });
    const [surfaceResult, setSurfaceResult] = useState(() => (design && _resultCache.get(design.id)) || null);
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState(null);   // { done, total } during a sweep
    const poolRef = useRef(null);

    // Rehydrate spec / mode / last result per design.
    useEffect(() => {
        if (!design) return;
        const cached = _surfaceCache.get(design.id);
        setSurfaceSpec(cached ? { ...cached } : makeDefaultSurfaceSpec(design, { surfaceMode: evalMode || 'front' }));
        setPlotMode(_modeCache.get(design.id) || '2d');
        setSurfaceResult(_resultCache.get(design.id) || null);
    }, [design?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { if (design) _surfaceCache.set(design.id, { ...surfaceSpec }); }, [surfaceSpec, design?.id]);
    useEffect(() => { if (design) _modeCache.set(design.id, plotMode); }, [plotMode, design?.id]);
    useEffect(() => {
        if (!design) return;
        if (surfaceResult) _resultCache.set(design.id, surfaceResult);
        else _resultCache.delete(design.id);
    }, [surfaceResult, design?.id]);

    // Terminate any running pool on unmount / design switch.
    useEffect(() => () => { try { poolRef.current?.terminate(); } catch (_) {} poolRef.current = null; }, []);

    const updateSurface = useCallback((patch) => {
        setSurfaceSpec(prev => {
            const next = { ...prev, ...patch };
            // Switching Z to MF: λ/AOI axes are invalid → snap them to layer
            // params (default to the first two layers' thickness).
            if (patch.z === 'MF') {
                const nLayers = (design?.frontLayers || []).length;
                if (!isLayerVar(next.xVar)) {
                    next.xVar = 'thk:0';
                    const r = defaultAxisRange(design, next.xVar); next.xFrom = r.from; next.xTo = r.to;
                }
                if (!isLayerVar(next.yVar)) {
                    next.yVar = nLayers > 1 ? 'thk:1' : 'n:0';
                    const r = defaultAxisRange(design, next.yVar); next.yFrom = r.from; next.yTo = r.to;
                }
            }
            return next;
        });
        setSurfaceResult(null);   // spec changed → previous surface is stale
    }, [design]);

    // Synchronous main-thread compute — used as the fallback if the worker pool
    // can't start (e.g. WASM/worker URL unavailable in a degraded environment).
    const computeMainThread = useCallback(() => {
        try {
            return computeSurface(surfaceSpec, design, resolveMaterial);
        } catch (e) {
            return { ok: false, error: String(e && e.message || e), x: [], y: [], z: [] };
        }
    }, [surfaceSpec, design]);

    // Worker-pool sweep — fan the grid's Y-rows across a pool of plotSurface
    // workers so the UI never freezes. Each eval is already WASM-fast; the pool
    // adds multi-core parallelism + responsiveness.
    const computeSurfaceNow = useCallback(() => {
        if (!design || computing) return;
        setComputing(true);
        setProgress(null);

        (async () => {
            // Cheap validate + size (rowFrom=rowTo=0 runs the guards without any
            // grid work, and returns x/y/zLabel for assembly).
            const meta = computeSurface(surfaceSpec, design, resolveMaterial, { rowFrom: 0, rowTo: 0 });
            if (!meta.ok) { setSurfaceResult(meta); setComputing(false); return; }
            const ny = meta.y.length;

            let pool = null;
            try {
                const lambdas   = requiredSurfaceLambdas(surfaceSpec, design);
                const pairs     = collectDesignMaterialIds(design).map(id => ({ id, mat: resolveMaterial(id) }));
                const materials = buildPresampledTable(lambdas, pairs);
                const wasmBytes = getTmmWasmBytesForWorker();
                const K = poolSize();
                pool = new WorkerPool(PLOT_SURFACE_WORKER_URL, K,
                    { type: 'init', wasmBytes, materials, spec: surfaceSpec, design });
                poolRef.current = pool;

                // ~3 chunks per worker for load balance.
                const chunk = Math.max(1, Math.ceil(ny / (K * 3)));
                const jobs = [];
                for (let from = 0; from < ny; from += chunk)
                    jobs.push({ type: 'rows', id: jobs.length, rowFrom: from, rowTo: Math.min(ny, from + chunk) });

                const z = new Array(ny);
                let done = 0;
                setProgress({ done: 0, total: jobs.length });
                await Promise.all(jobs.map(job => pool.run(job).then(res => {
                    if (poolRef.current !== pool) return;          // superseded
                    if (!res.ok) throw new Error(res.error || 'surface worker failed');
                    for (let j = res.rowFrom; j < res.rowTo; j++) z[j] = res.rows[j - res.rowFrom];
                    setProgress({ done: ++done, total: jobs.length });
                })));

                if (poolRef.current === pool) {
                    setSurfaceResult({ ok: true, x: meta.x, y: meta.y, z, zLabel: meta.zLabel, nPoints: meta.nPoints });
                }
            } catch (err) {
                console.error('PlotEngine surface pool failed, main-thread fallback:', err);
                setSurfaceResult(computeMainThread());
            } finally {
                try { pool?.terminate(); } catch (_) {}
                if (poolRef.current === pool) poolRef.current = null;
                setComputing(false);
                setProgress(null);
            }
        })();
    }, [surfaceSpec, design, computing, computeMainThread]);

    // ── Render guards ───────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);
    if (!design) return placeholder(pe.noDesign || 'No design selected.');
    if (!design.frontLayers?.length && !design.backLayers?.length) {
        return placeholder(pe.noLayers || 'No layers in design.');
    }

    // ── Layout ──────────────────────────────────────────────────────────────
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'row', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        // ── Sidebar ─────────────────────────────────────────────────────────
        h('div', {
            style: {
                width: 320, flexShrink: 0, borderRight: `1px solid ${c.border}`,
                background: c.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }
        },
            // Mode toggle (2D curves / 3D surface)
            h('div', {
                style: {
                    padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                    background: c.panel, display: 'flex', alignItems: 'center', gap: 6,
                }
            },
                ['2d', '3d'].map(m => h('button', {
                    key: m,
                    onClick: () => setPlotMode(m),
                    style: {
                        flex: 1, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                        borderRadius: 3, fontFamily: 'system-ui, -apple-system, sans-serif',
                        border: `1px solid ${plotMode === m ? c.accent : c.border}`,
                        background: plotMode === m ? c.accent : 'transparent',
                        color: plotMode === m ? '#fff' : c.text, fontWeight: plotMode === m ? 600 : 400,
                    }
                }, m === '2d' ? (pe.mode2D || '2D Curves') : (pe.mode3D || '3D Surface'))),
            ),
            // Body: curve list (2D) or surface config (3D)
            plotMode === '2d'
                ? h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                    h('div', {
                        style: {
                            padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                            background: c.panel, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }
                    },
                        h('span', { style: { fontSize: 11, fontWeight: 600, color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4 } },
                            pe.curves || `Curves (${curves.length})`),
                        h('button', {
                            onClick: addCurve,
                            style: {
                                padding: '2px 10px', background: c.accent, color: '#fff',
                                border: 'none', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                                fontFamily: 'system-ui, -apple-system, sans-serif',
                            }
                        }, pe.addCurve || '+ Add curve'),
                    ),
                    h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
                        curves.map(cv =>
                            h(CurveRow, {
                                key: cv.id,
                                curve: cv,
                                onUpdate: (patch) => updateCurve(cv.id, patch),
                                onDelete: () => deleteCurve(cv.id),
                                c, t,
                            })
                        )
                    ),
                )
                : h(SurfacePanel, {
                    spec: surfaceSpec, onUpdate: updateSurface,
                    onCompute: computeSurfaceNow, computing, progress, design, result: surfaceResult, c, t,
                }),
        ),
        // ── Plot ────────────────────────────────────────────────────────────
        // minWidth:0 + overflow:hidden keep the (WebGL) plot strictly inside its
        // flex cell — without minWidth:0 a flex child won't shrink below its
        // content's intrinsic size, so the gl canvas could spill under the
        // settings panel.
        h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' } },
            plotMode === '2d'
                ? h(MultiCurveChart, { curves, results, c })
                : h(SurfaceChart, { result: surfaceResult, spec: surfaceSpec, design, c, t })
        ),
    );
}
