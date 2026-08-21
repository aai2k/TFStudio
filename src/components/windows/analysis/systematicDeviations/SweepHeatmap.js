import { buildSweepFigure } from './sweepFigure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { chartConfig } from '../chrome/plot.js';

const { createElement: h, useEffect, useRef } = React;

export function SweepHeatmap({ sweepData, channel, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    // No dependency list, and the figure is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        const { data, layout } = buildSweepFigure(sweepData, channel,
            { text: c.text, border: c.border, panel: c.panel, bg: c.bg });
        drawPlot(divRef.current, initRef, data, layout, chartConfig('deviation_sweep'));
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
