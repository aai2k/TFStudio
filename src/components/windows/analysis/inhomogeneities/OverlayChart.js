import { buildOverlayOption } from './figure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

export function OverlayChart({ baseline, perturbed, showCurves, c, t }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('inhomogeneities');
    const names = { homogeneous: t.inhomogeneities.traceHomogeneous, graded: t.inhomogeneities.traceWithInterlayers };
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildOverlayOption(baseline, perturbed, showCurves, colors, names, c)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
