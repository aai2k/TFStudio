import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTitle, plotMargin, TICK_FONT } from '../chrome/plot.js';
import { displayLayerLabel } from './viewModel.js';

/**
 * @param {object} [colors] configured curve colours; factory defaults when absent
 */
export function buildSensitivityFigure({
    rows, matColorMap, scale, frontCount, c, xTitle, yTitle,
    colors = ANALYSIS_DEFAULTS.layerSensitivity.colors,
}) {
    if (!rows?.length) return { data: [], layout: {} };

    const isAbs = scale === 'absolute';
    const bgColor = c.bg || '#1e1e1e';
    const paperColor = c.panel || '#252526';
    const gridColor = c.border || '#3a3a3a';
    const textColor = c.text || '#cccccc';
    const data = [{
        x: rows.map(row => displayLayerLabel(row, frontCount)),
        y: rows.map(row => isAbs ? row.deltaMFAbs : row.sensitivity),
        type: 'bar',
        marker: {
            color: rows.map(row => matColorMap[row.materialId] || colors.fallback),
            line: { color: gridColor, width: 1 },
        },
        text: rows.map(row => isAbs
            ? row.deltaMFAbs.toExponential(2)
            : row.sensitivity.toFixed(0)),
        textposition: 'outside',
        hovertemplate: isAbs
            ? '%{x}<br>|ΔOMF|: %{y:.3e}<br><extra></extra>'
            : '%{x}<br>Sensitivity: %{y:.2f}%<br><extra></extra>',
    }];
    const layout = {
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        margin: plotMargin(),
        xaxis: {
            title: axisTitle(xTitle, { color: textColor }),
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, ...TICK_FONT },
            automargin: true,
        },
        yaxis: {
            title: axisTitle(isAbs ? '|ΔOMF|' : yTitle, { color: textColor }),
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, ...TICK_FONT },
            rangemode: 'tozero',
            type: isAbs ? 'log' : 'linear',
        },
        bargap: 0.2,
    };
    return { data, layout };
}
