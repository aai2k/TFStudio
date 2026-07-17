import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { materialIndexFn, embeddedT, spectrumT } from '../../../../utils/filter/filterDesign.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

// layers: engine layers; mode 'embedded'|'air'. analyticT: optional λ→T fraction
// (bypasses TMM — used for the step-2 ideal-target schematic).
function computeSpectrumData({ layersFn, analyticT, p, mode, windowNm }) {
    try {
        // focus on the passband + skirts (not the whole QW-mirror HR zone)
        const win = windowNm || Math.max(p.stopHalf_nm * 1.5, p.passHalf_nm * 2.5, 5);
        const lo = p.lambda0_nm - win, hi = p.lambda0_nm + win;
        const lams = new Set();
        const coarse = Math.max((hi - lo) / 500, 0.02);
        for (let l = lo; l <= hi; l += coarse) lams.add(Math.round(l * 1e4) / 1e4);
        const fineW = Math.max(p.passHalf_nm * 4, 1), fs = Math.max(fineW / 300, 0.003);
        for (let l = p.lambda0_nm - fineW; l <= p.lambda0_nm + fineW; l += fs) lams.add(Math.round(l * 1e4) / 1e4);
        const xs = [...lams].sort((a, b) => a - b);
        if (analyticT) {
            return { xs, T: xs.map(x => analyticT(x) * 100) };
        }
        const layers = layersFn();
        if (!layers || !layers.length) return { empty: true };
        const nSub = materialIndexFn(p.substrateMaterial, getMaterialById);
        const nInc = mode === 'embedded' ? nSub : materialIndexFn(p.incidentMedium, getMaterialById);
        const T = xs.map(x => (mode === 'embedded' ? embeddedT(layers, x, nSub) : spectrumT(layers, x, nInc, nSub)) * 100);
        return { xs, T };
    } catch (err) { return { error: err.message }; }
}

// levelLines: [{y,color,x0,x1}]
export function SpectrumPlot({ layersFn, analyticT = null, p, mode = 'embedded', c, height = 280, levelLines = [], windowNm = null }) {
    const divRef = useRef(null);
    const data = useMemo(() => computeSpectrumData({ layersFn, analyticT, p, mode, windowNm }),
        [layersFn, analyticT, p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.substrateMaterial, p.incidentMedium, mode, windowNm]);

    useEffect(() => {
        if (!divRef.current || !window.Plotly || data.error || data.empty) return;
        const traces = [{ x: data.xs, y: data.T, type: 'scatter', mode: 'lines', name: 'T', line: { color: '#4fc3f7', width: 1.7 } }];
        const shapes = [
            { type: 'line', xref: 'x', yref: 'paper', x0: p.lambda0_nm, x1: p.lambda0_nm, y0: 0, y1: 1, line: { color: c.textDim, width: 1, dash: 'dot' } },
            ...levelLines.map(L => ({ type: 'line', xref: 'x', yref: 'y', x0: L.x0, x1: L.x1, y0: L.y, y1: L.y, line: { color: L.color, width: 2 } })),
        ];
        const layout = {
            margin: { l: 46, r: 12, t: 8, b: 36 },
            xaxis: { title: { text: 'λ (nm)', font: { size: 11, color: c.textDim } }, color: c.text, gridcolor: c.border, tickfont: { size: 10 } },
            yaxis: { title: { text: 'T (%)', font: { size: 11, color: c.textDim } }, color: c.text, gridcolor: c.border, tickfont: { size: 10 }, range: [-2, 105] },
            paper_bgcolor: c.panel, plot_bgcolor: c.bg, font: { color: c.text, size: 11 }, shapes, showlegend: false,
        };
        window.Plotly.react(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
    }, [data, c, levelLines]);

    // Purge the Plotly graph on unmount (leak per docking tab switch).
    useEffect(() => () => {
        if (divRef.current && window.Plotly) window.Plotly.purge(divRef.current);
    }, []);

    if (data.error) return h('div', { style: { color: c.warning || '#ef5350', fontSize: 12, padding: 10 } }, data.error);
    return h('div', { ref: divRef, style: { width: '100%', height } });
}
