import { displayLayerLabel } from './viewModel.js';

export function buildSensitivityFigure({ rows, matColorMap, scale, frontCount, c }) {
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
            color: rows.map(row => matColorMap[row.materialId] || '#4fc3f7'),
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
        margin: { l: 60, r: 16, t: 16, b: 36 },
        xaxis: {
            title: { text: 'Layer', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 10 },
            automargin: true,
        },
        yaxis: {
            title: { text: isAbs ? '|ΔOMF|' : 'Sensitivity (%)', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 10 },
            rangemode: 'tozero',
            type: isAbs ? 'log' : 'linear',
        },
        bargap: 0.2,
    };
    return { data, layout };
}
