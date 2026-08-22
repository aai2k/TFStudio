import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import {
  THIN_X_SYMBOL, cartesianOption, itemTooltip, lineSeries, scatterSeries,
  squareGrid, valueAxis,
} from '../../../ui/chartOptions.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { spectralLocusXy } from '../../../../utils/physics/colorimetry.js';
import { legendAbove } from '../chrome/plot.js';

const { createElement: h, useEffect, useRef } = React;
// Leave just enough room for the legend and toolbox; the swatches use the
// naturally empty upper-right part of the chromaticity grid.
const MARGIN = { left: 48, right: 12, top: 64, bottom: 42 };

export function buildChromaticitySeries(report, observer, c,
                                        colors = ANALYSIS_DEFAULTS.colorEvaluation.colors) {
  const text = c.text || '#cccccc';
  const locus = spectralLocusXy(observer);
  const closed = [...locus.map(point => [point.x, point.y]), [locus[0].x, locus[0].y]];
  const labels = locus.filter(point => point.lam % 20 === 0 && point.lam >= 460 && point.lam <= 620);
  const ticks = scatterSeries({
    name: '', color: c.textDim, symbolSize: 3, silent: true,
    data: labels.map(point => ({ value: [point.x, point.y], wavelength: point.lam })),
  });
  ticks.label = {
    show: true, position: 'top', color: c.textDim, fontSize: 9,
    formatter: params => String(params.data.wavelength),
  };
  const series = [
    lineSeries({ data: closed, name: 'Spectrum locus', color: text, width: 1.3, showSymbol: false }),
    ticks,
  ];
  if (report) {
    const white = scatterSeries({
      data: [[report.whiteXy.x, report.whiteXy.y]], name: 'White point',
      color: colors.whitePoint, symbol: THIN_X_SYMBOL, symbolSize: 11,
    });
    white.itemStyle.color = 'transparent';
    white.itemStyle.borderColor = colors.whitePoint;
    white.itemStyle.borderWidth = 2;
    series.push(white);
    const coating = scatterSeries({
      data: [[report.xy.x, report.xy.y]], name: 'Coating', color: report.rgb,
      symbol: 'circle', symbolSize: 13,
    });
    coating.itemStyle.borderColor = colors.coating;
    coating.itemStyle.borderWidth = 1.5;
    series.push(coating);
  }
  return series;
}

export function buildChromaticityOption(report, observer, c, colors, grid) {
  const text = c.text || '#cccccc';
  const gridColor = c.border || '#3a3a3a';
  return cartesianOption({
    colors: c,
    grid: grid || MARGIN,
    fileName: 'chromaticity',
    tooltip: itemTooltip(),
    legend: legendAbove({ color: text }),
    xAxis: valueAxis({
      name: 'x', color: text, gridColor, min: 0, max: 0.8, interval: 0.1, nameGap: 24,
    }),
    yAxis: valueAxis({
      name: 'y', color: text, gridColor, min: 0, max: 0.9, interval: 0.1, nameGap: 28,
    }),
    series: buildChromaticitySeries(report, observer, c, colors),
  });
}

export function ChromaticityChart({ report, observer, c }) {
  const divRef = useRef(null);
  const chartRef = useRef(null);
  const colors = useAnalysisColors('colorEvaluation');
  const redraw = () => {
    drawChart(divRef.current, chartRef,
      buildChromaticityOption(report, observer, c, colors, squareGrid(divRef.current, MARGIN)));
  };
  useEffect(redraw);
  useChartTeardown(divRef, chartRef, redraw);
  if (typeof echarts === 'undefined') return h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
  }, 'ECharts not loaded');
  return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 220 } });
}
