import { buildGDChartModel } from './chartModel.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

// Matches Optical Evaluation's modebar, minus the box/lasso selection tools that
// have nothing to select here. Plotly's own autoscale is deliberately kept: the
// panel's Auto range is a robust one that can clip a divergence spike, and this
// is how a user reaches the full extent of the data when they want it.
const CHART_CONFIG = {
    displaylogo: false,
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d'],
    toImageButtonOptions: { format: 'png', filename: 'TFStudio_dispersion', scale: 2 },
};

export function GDChart({ data, meta, refLambda, showRef, targets = [], yRange, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const background = c.bg || '#1e1e1e';
    const paper = c.panel || '#252526';
    const grid = c.border || '#3a3a3a';
    const text = c.text || '#cccccc';

    // No dependency list: see plotSurface.js for why every render redraws.
    useEffect(() => {
        if (!data) return;
        const { traces, layout } = buildGDChartModel({
            data, meta, referenceLambda: refLambda, showReference: showRef,
            targets, yRange,
            colors: { background, paper, grid, text },
        });
        drawPlot(divRef.current, initRef, traces, layout, CHART_CONFIG);
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
