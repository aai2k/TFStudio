import { efieldLayout, efieldTraces } from './chartModel.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { chartConfig } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

const CHART_CONFIG = chartConfig('efield');

export function EFieldChart({ profileData, pol, matColorMap, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('eFieldEvaluation');
    const colors = {
        bgColor: c.bg || '#1e1e1e',
        paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a',
        textColor: c.text || '#cccccc',
        accentColor: c.accent || '#007acc',
    };

    // No dependency list: see plotSurface.js for why every render redraws.
    useEffect(() => {
        drawPlot(divRef.current, initRef,
            efieldTraces(profileData, pol, curve),
            efieldLayout(profileData, pol, matColorMap, colors),
            CHART_CONFIG);
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
