import { spectralLocusXy } from '../../../../utils/physics/colorimetry.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export const CHROMATICITY_CONFIG = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
  toImageButtonOptions: {
    format: 'png',
    filename: 'TFStudio_chromaticity',
    scale: 2
  }
};

export function chromaticityTraces(report, observer, c) {
  const txt = c.text || '#cccccc';
  const loc = spectralLocusXy(observer);
  const lx = loc.map(p => p.x), ly = loc.map(p => p.y);
  // Closing the locus connects its endpoints with the line of purples.
  const locusTrace = {
    x: [...lx, lx[0]], y: [...ly, ly[0]],
    type: 'scatter', mode: 'lines', name: 'Spectrum locus',
    line: { color: txt, width: 1.3 },
    hovertemplate: 'x %{x:.4f}<br>y %{y:.4f}<extra>locus</extra>'
  };
  const labelEvery = loc.filter(p => p.lam % 20 === 0 && p.lam >= 460 && p.lam <= 620);
  const tickTrace = {
    x: labelEvery.map(p => p.x), y: labelEvery.map(p => p.y),
    type: 'scatter', mode: 'markers+text',
    text: labelEvery.map(p => `${p.lam}`), textposition: 'top center',
    textfont: { size: 9, color: c.textDim },
    marker: { size: 3, color: c.textDim }, showlegend: false,
    hoverinfo: 'skip'
  };
  const t = [locusTrace, tickTrace];
  if (report) {
    t.push({
      x: [report.whiteXy.x], y: [report.whiteXy.y],
      type: 'scatter', mode: 'markers', name: 'White point',
      marker: { symbol: 'cross-thin', size: 11,
                line: { color: '#bbbbbb', width: 2 } },
      hovertemplate: 'White x %{x:.4f}, y %{y:.4f}<extra></extra>'
    });
    t.push({
      x: [report.xy.x], y: [report.xy.y],
      type: 'scatter', mode: 'markers', name: 'Coating',
      marker: { symbol: 'circle', size: 13, color: report.rgb,
                line: { color: '#ffffff', width: 1.5 } },
      hovertemplate: 'Coating x %{x:.4f}, y %{y:.4f}<extra></extra>'
    });
  }
  return t;
}

export function chromaticityLayout(c) {
  const bg = c.bg || '#1e1e1e';
  const paper = c.panel || '#252526';
  const grid = c.border || '#3a3a3a';
  const txt = c.text || '#cccccc';
  return {
    margin: { l: 48, r: 12, t: 12, b: 42 },
    paper_bgcolor: paper, plot_bgcolor: bg,
    font: { color: txt, family: 'system-ui, -apple-system, sans-serif', size: 11 },
    xaxis: { title: { text: 'x', standoff: 6 }, range: [-0.05, 0.8],
             gridcolor: grid, zerolinecolor: grid, tickfont: { size: 10 },
             constrain: 'domain' },
    yaxis: { title: { text: 'y', standoff: 6 }, range: [-0.05, 0.9],
             gridcolor: grid, zerolinecolor: grid, tickfont: { size: 10 },
             scaleanchor: 'x', scaleratio: 1 },
    legend: { bgcolor: paper + 'cc', bordercolor: grid, borderwidth: 1,
              font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top' },
    showlegend: true
  };
}

function useChromaticityPlot(divRef, traces, layout) {
  const initRef = useRef(false);

  useEffect(() => {
    if (!divRef.current || typeof Plotly === 'undefined') return;
    Plotly.newPlot(divRef.current, traces, layout, CHROMATICITY_CONFIG);
    initRef.current = true;
    const ro = new ResizeObserver(() => {
      if (divRef.current && initRef.current) Plotly.Plots.resize(divRef.current);
    });
    ro.observe(divRef.current);
    return () => { ro.disconnect();
      if (divRef.current) Plotly.purge(divRef.current); initRef.current = false; };
  }, []);

  useEffect(() => {
    if (!divRef.current || !initRef.current || typeof Plotly === 'undefined') return;
    Plotly.react(divRef.current, traces, layout, CHROMATICITY_CONFIG);
  }, [traces, layout]);
}

export function ChromaticityChart({ report, observer, c }) {
  const divRef = useRef(null);
  const txt = c.text || '#cccccc';
  const traces = useMemo(
    () => chromaticityTraces(report, observer, c),
    [report, observer, txt, c.textDim]
  );
  const layout = useMemo(
    () => chromaticityLayout(c),
    [c.bg, c.panel, c.border, txt]
  );
  useChromaticityPlot(divRef, traces, layout);

  if (typeof Plotly === 'undefined')
    return h('div', { style: { display: 'flex', alignItems: 'center',
      justifyContent: 'center', height: '100%', color: c.textDim } },
      'Plotly not loaded');
  return h('div', { ref: divRef,
    style: { width: '100%', height: '100%', minHeight: 220 } });
}
