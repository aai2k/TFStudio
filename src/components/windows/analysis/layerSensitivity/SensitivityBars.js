import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { buildSensitivityFigure } from './figure.js';

const { createElement: h, useEffect, useRef } = React;

export function SensitivityBars(props) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const colors = useAnalysisColors('layerSensitivity');

    // No dependency list, and the figure is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        const figure = buildSensitivityFigure({ ...props, colors });
        drawPlot(divRef.current, initRef, figure.data, figure.layout,
            { responsive: true, displayModeBar: false });
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
