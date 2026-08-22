import { buildSpectrumOption } from './spectrumFigure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

export function SpectrumPlot({ baseline, deviated, channel, showBaseline, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('systematicDeviations');
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildSpectrumOption(baseline, deviated, channel, showBaseline, colors, c)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
