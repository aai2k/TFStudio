import { lineChartSVG } from './lineChart.js';

// Small filled-step n(z) staircase (refractive-index profile).
export function stepChartSVG(cfg) {
  const { z = [], n = [] } = cfg;
  const series = [{ x: z, y: n, color: '#6a1b9a', label: cfg.label || 'n' }];
  return lineChartSVG({ ...cfg, series });
}
