import { buildScatterOption } from './figure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

export function ScatterChart({ calc, showCurves, units, c, t }) {
    const rs = t.roughnessScattering;
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('roughnessScattering');
    useEffect(() => { drawChart(divRef.current, chartRef, buildScatterOption({
        calc, showCurves, units, colors, c,
        names: { ideal: rs.traceIdeal, specular: rs.traceSpecular },
        specularTitle: rs.axisSpecular,
    })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
