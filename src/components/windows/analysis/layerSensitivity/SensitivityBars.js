import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { buildSensitivityOption } from './figure.js';

const { createElement: h, useEffect, useRef } = React;

export function SensitivityBars(props) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('layerSensitivity');
    useEffect(() => { drawChart(divRef.current, chartRef, buildSensitivityOption({ ...props, colors })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
