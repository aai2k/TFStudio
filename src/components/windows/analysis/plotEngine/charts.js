import { xAxisLabel, surfaceAxisLabel } from '../../../../utils/physics/plotQuantities.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

export function buildCurveTraces(curves, results) {
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
}

function dominantXAxis(curves) {
    const curve = curves.find(item => item.visible);
    return curve ? curve.xAxis : 'wavelength';
}

function buildCurveLayout(c, xAxisType) {
    return {
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor: c.bg || '#1e1e1e',
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
    };
}

function useCurveFigure(divRef, initRef, traces, layout) {
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [traces, layout]);
}

function usePlotResize(divRef, initRef) {
    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
}

export function MultiCurveChart({ curves, results, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const traces = useMemo(() => buildCurveTraces(curves, results), [curves, results]);
    const xAxisType = useMemo(() => dominantXAxis(curves), [curves]);
    const layout = useMemo(() => buildCurveLayout(c, xAxisType), [c, xAxisType]);
    useCurveFigure(divRef, initRef, traces, layout);
    usePlotResize(divRef, initRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

export function buildSurfaceFigure(result, spec, design, c) {
    if (!result || !result.ok) return null;
    const common = {
        x: result.x, y: result.y, z: result.z,
        colorscale: spec.colorscale || 'Viridis',
        colorbar: {
            title: { text: result.zLabel, side: 'right', font: { color: c.text, size: 11 } },
            tickfont: { color: c.text, size: 9 },
            thickness: 14, len: 0.9, x: 1.0, xpad: 4,
        },
    };
    const trace = spec.render === 'heatmap'
        ? {
            type: 'heatmap', ...common,
            hovertemplate: `%{x}<br>%{y}<br>${result.zLabel}=%{z:.4g}<extra></extra>`,
        }
        : {
            type: 'surface', ...common, contours: { z: { show: false } },
            hovertemplate: `%{x}<br>%{y}<br>${result.zLabel}=%{z:.4g}<extra></extra>`,
        };
    const xTitle = surfaceAxisLabel(spec.xVar, design);
    const yTitle = surfaceAxisLabel(spec.yVar, design);
    const axisFont = { color: c.text, size: 11 };
    const tickFont = { color: c.text, size: 9 };
    const layout = {
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor: c.bg || '#1e1e1e',
        margin: spec.render === 'heatmap' ? { l: 60, r: 16, t: 16, b: 50 } : { l: 0, r: 0, t: 0, b: 0 },
        font: { color: c.text },
    };
    if (spec.render === 'heatmap') {
        layout.xaxis = { title: { text: xTitle, font: axisFont }, color: c.text, tickfont: tickFont, gridcolor: c.border };
        layout.yaxis = { title: { text: yTitle, font: axisFont }, color: c.text, tickfont: tickFont, gridcolor: c.border };
    } else {
        layout.scene = {
            // Cube aspect keeps thickness, index, and merit-function ranges legible together.
            aspectmode: 'cube',
            domain: { x: [0, 1], y: [0, 1] },
            xaxis: {
                title: { text: xTitle, font: axisFont }, color: c.text, tickfont: tickFont,
                backgroundcolor: c.bg, gridcolor: c.border, showbackground: true,
            },
            yaxis: {
                title: { text: yTitle, font: axisFont }, color: c.text, tickfont: tickFont,
                backgroundcolor: c.bg, gridcolor: c.border, showbackground: true,
            },
            zaxis: {
                title: { text: result.zLabel, font: axisFont }, color: c.text, tickfont: tickFont,
                backgroundcolor: c.bg, gridcolor: c.border, showbackground: true,
            },
            camera: { eye: { x: 1.9, y: -1.9, z: 1.35 } },
        };
    }
    return { traces: [trace], layout };
}

function useSurfaceFigure(divRef, initRef, renderRef, figure) {
    useEffect(() => {
        const gd = divRef.current;
        if (!gd || typeof Plotly === 'undefined') return;
        if (!figure) {
            if (initRef.current) {
                Plotly.purge(gd);
                initRef.current = false;
                renderRef.current = null;
            }
            return;
        }
        // A graph div cannot be morphed between a cartesian subplot (heatmap)
        // and a WebGL one (3D surface): the container is built without the
        // layer the other kind needs. Switching render mode therefore rebuilds
        // the plot from scratch rather than reusing the existing figure.
        const renderKind = figure.traces[0].type;
        if (initRef.current && renderRef.current !== renderKind) {
            Plotly.purge(gd);
            initRef.current = false;
        }
        const config = { responsive: true, displayModeBar: true };
        if (initRef.current) Plotly.react(gd, figure.traces, figure.layout, config);
        else Plotly.newPlot(gd, figure.traces, figure.layout, config);
        initRef.current = true;
        renderRef.current = renderKind;
        requestAnimationFrame(() => {
            if (divRef.current && initRef.current) Plotly.Plots.resize(divRef.current);
        });
    }, [figure]);

    // Release the WebGL context and Plotly's internal state when the chart goes
    // away. The element is captured here because React clears the ref before
    // effect cleanup runs.
    useEffect(() => {
        const gd = divRef.current;
        return () => {
            if (gd && initRef.current && typeof Plotly !== 'undefined') Plotly.purge(gd);
        };
    }, []);
}

function surfacePrompt(message, c) {
    return h('div', {
        style: {
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: 20,
        },
    }, message);
}

function surfaceError(message, c) {
    return h('div', {
        style: {
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.danger || '#ef5350', fontSize: 13, textAlign: 'center', padding: 20,
        },
    }, message);
}

export function SurfaceChart({ result, spec, design, c, t }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const renderRef = useRef(null);
    const pe = (t && t.plotEngine) || {};
    const figure = useMemo(() => buildSurfaceFigure(result, spec, design, c), [result, spec, design, c]);
    useSurfaceFigure(divRef, initRef, renderRef, figure);
    usePlotResize(divRef, initRef);

    let overlay = null;
    if (!result) {
        overlay = surfacePrompt(pe.surfacePrompt || 'Configure the axes and quantity, then press Compute.', c);
    } else if (!result.ok) {
        overlay = surfaceError(result.error || 'Cannot compute surface.', c);
    }

    // The graph div is always mounted, even while a prompt or an error is
    // showing. Swapping it out would detach the ref and the resize observer
    // that the plot is bound to, so the next computed surface would have
    // nowhere to draw.
    return h('div', { style: { width: '100%', height: '100%', position: 'relative', overflow: 'hidden' } },
        h('div', {
            ref: divRef,
            style: { width: '100%', height: '100%', visibility: overlay ? 'hidden' : 'visible' },
        }),
        overlay && h('div', { style: { position: 'absolute', inset: 0 } }, overlay));
}
