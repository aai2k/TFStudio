import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { chartConfig } from '../chrome/plot.js';
import { buildOverlayFigure } from './overlayFigure.js';

const { createElement: h, useEffect, useRef } = React;

function chartColors(c) {
    return {
        bg: c.bg || '#1e1e1e',
        panel: c.panel || '#252526',
        grid: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
    };
}

export function OverlayChart(props) {
    const { spectrum, char, weighting, c, minMaxMarks, title } = props;
    const divRef = useRef(null);
    const initialized = useRef(false);
    const colors = chartColors(c);
    const curve = useAnalysisColors('integralValues');

    // No dependency list: see plotSurface.js for why every render redraws.
    useEffect(() => {
        const figure = buildOverlayFigure({
            spectrum, char, weighting, minMaxMarks, colors, curve, title,
        });
        drawPlot(divRef.current, initialized, figure.data, figure.layout,
            chartConfig('integral'));
    });

    usePlotTeardown(divRef, initialized);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
