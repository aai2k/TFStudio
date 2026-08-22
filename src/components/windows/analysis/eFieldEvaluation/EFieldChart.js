import { efieldOption } from './chartModel.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

export function EFieldChart({ profileData, pol, matColorMap, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('eFieldEvaluation');
    const colors = {
        bgColor: c.bg || '#1e1e1e',
        paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a',
        textColor: c.text || '#cccccc',
        accentColor: c.accent || '#007acc',
    };

    useEffect(() => {
        drawChart(divRef.current, chartRef,
            efieldOption(profileData, pol, matColorMap, colors, curve));
    });

    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
