import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { buildOverlayOption } from './overlayFigure.js';

const { createElement: h, useEffect, useRef } = React;

function chartColors(c) {
    return { bg: c.bg || '#1e1e1e', panel: c.panel || '#252526', grid: c.border || '#3a3a3a', text: c.text || '#cccccc' };
}

export function OverlayChart(props) {
    const { spectrum, char, weighting, c, minMaxMarks, title } = props;
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('integralValues');
    useEffect(() => { drawChart(divRef.current, chartRef, buildOverlayOption({
        spectrum, char, weighting, minMaxMarks, colors: chartColors(c), curve, title,
    })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
