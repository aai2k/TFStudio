import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { chartConfig } from '../chrome/plot.js';
import { admittanceLayout, admittanceTraces } from './chartFigure.js';

const { createElement: h, useEffect, useRef } = React;

// No dependency list: see plotSurface.js for why every render redraws.
function usePlotData({ divRef, initializedRef, series, matColorMap, matName, colors, marks, config }) {
    useEffect(() => {
        drawPlot(divRef.current, initializedRef,
            admittanceTraces(series, matColorMap, matName, colors, marks),
            admittanceLayout(series, colors), config);
    });
}

function usePlotTheme({ divRef, initializedRef, colors, c }) {
    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.relayout(divRef.current, {
            paper_bgcolor: colors.panel, plot_bgcolor: colors.bg,
            'font.color': colors.text,
            'xaxis.gridcolor': colors.border, 'yaxis.gridcolor': colors.border,
            'legend.bgcolor': colors.panel + 'cc', 'legend.bordercolor': colors.border,
        });
    }, [c]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function AdmittanceChart({ series, matColorMap, matName, c, theme, t }) {
    const divRef = useRef(null);
    const initializedRef = useRef(false);
    const colors = {
        bg: c.bg || '#1e1e1e',
        panel: c.panel || '#252526',
        border: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
    };
    const marks = useAnalysisColors('admittanceDiagram');
    const config = chartConfig('admittance');

    usePlotData({ divRef, initializedRef, series, matColorMap, matName, colors, marks, config });
    usePlotTeardown(divRef, initializedRef);
    usePlotTheme({ divRef, initializedRef, colors, c });

    if (typeof Plotly === 'undefined') {
        return h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
        }, 'Plotly not loaded — check index.html');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
