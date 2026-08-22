import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { squareGrid } from '../../../ui/chartOptions.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { plotMargin } from '../chrome/plot.js';
import { buildAdmittanceOption } from './chartFigure.js';

const { createElement: h, useEffect, useRef } = React;

export function AdmittanceChart({ series, matColorMap, matName, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = {
        bg: c.bg || '#1e1e1e', panel: c.panel || '#252526',
        border: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    const marks = useAnalysisColors('admittanceDiagram');
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildAdmittanceOption(series, matColorMap, matName, colors, marks,
            squareGrid(divRef.current, plotMargin()))); });
    useChartTeardown(divRef, chartRef, () => {
        drawChart(divRef.current, chartRef,
            buildAdmittanceOption(series, matColorMap, matName, colors, marks,
                squareGrid(divRef.current, plotMargin())));
    });
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
