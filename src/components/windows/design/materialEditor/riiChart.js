/**
 * RIIBrowser — n/k preview chart for the currently-selected refractiveindex.info
 * material. Pure DOM/Plotly drawing, no React.
 */

import { sampleMaterial } from '../../../../utils/materials/riiDatabase.js';

export function drawRiiChart(chartEl, mat, c) {
    if (!chartEl || !window.Plotly) return;
    if (!mat) { window.Plotly.purge(chartEl); return; }
    // Wide range so IR materials aren't truncated; the material's own
    // wavelengthRange still bounds the actual samples (built-ins span to ~20 µm).
    const samples = sampleMaterial(mat, 200, 20000, 10);
    if (!samples.length) return;
    const lams = samples.map(r => r[0]);
    const ns   = samples.map(r => r[1]);
    const ks   = samples.map(r => r[2]);
    const hasK = ks.some(k => k > 1e-8);
    const traces = [
        { x: lams, y: ns, name: 'n(λ)', type: 'scatter', mode: 'lines',
          line: { color: '#5dade2', width: 2 } },
    ];
    if (hasK) traces.push({
        x: lams, y: ks, name: 'k(λ)', type: 'scatter', mode: 'lines',
        line: { color: '#e74c3c', width: 1.5, dash: 'dash' }, yaxis: 'y2',
    });
    const layout = {
        paper_bgcolor: c.bg, plot_bgcolor: c.bg,
        margin: { t: 6, b: 32, l: 48, r: hasK ? 48 : 12 },
        xaxis: { title: { text: 'Wavelength (nm)', font: { size: 10 } },
                 color: c.textDim, gridcolor: c.border, tickfont: { size: 9 } },
        yaxis: { color: '#5dade2', gridcolor: c.border, tickfont: { size: 9 } },
        legend: { font: { size: 10, color: c.text }, bgcolor: 'transparent', x: 0.01, y: 0.99 },
        font: { family: 'system-ui, -apple-system, sans-serif' },
    };
    if (hasK) layout.yaxis2 = { color: '#e74c3c', overlaying: 'y', side: 'right', tickfont: { size: 9 } };
    window.Plotly.react(chartEl, traces, layout, { responsive: true, displayModeBar: false });
}
