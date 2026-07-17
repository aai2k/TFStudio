// P-function profile plot: ∂MF/∂d_needle vs stack depth z, one curve per
// candidate material. Clicking a point picks a (z, material) candidate.

import { matColor } from '../synthesisShared/synthesisHelpers.js';

const { createElement: h, useEffect, useRef } = React;

export function PFunctionPlot({ traces, boundaries, bands, totalZ, selected, onPick, c, theme }) {
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
