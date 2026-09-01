import {
    buildSpectraOption, spectraColors, stretchContextImage, syncContextImage,
} from './figure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

export function SpectraChart({ c, data, t }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const argsRef = useRef(null);
    const settleRef = useRef(null);
    const staleRef = useRef(false);
    argsRef.current = { data, colors: spectraColors(c), labels: t.processSim };
    // Depends on the actual chart inputs: a render caused by anything else
    // must not rebuild and re-diff the option.
    useEffect(() => {
        const chart = drawChart(divRef.current, chartRef,
            buildSpectraOption(data, spectraColors(c), t.processSim));
        // drawChart declines while the pane has no drawable room; remember
        // that so the resize path below can retry once room comes back.
        staleRef.current = !chart;
        if (chart) syncContextImage(chart, data, spectraColors(c));
    }, [data, c, t]);
    // A resize in progress stretches the haze bitmap so the drag stays fluid;
    // it is re-rasterized crisp once the size has settled. Rebuilding it per
    // resize event is exactly the cost the bitmap exists to avoid. A draw the
    // effect had to decline for lack of room is retried here instead: the
    // ResizeObserver is the only signal that arrives without a render.
    useChartTeardown(divRef, chartRef, (chart) => {
        if (staleRef.current) {
            const { data: current, colors, labels } = argsRef.current;
            const created = drawChart(divRef.current, chartRef,
                buildSpectraOption(current, colors, labels));
            if (created) {
                staleRef.current = false;
                syncContextImage(created, current, colors);
            }
            return;
        }
        stretchContextImage(chart);
        clearTimeout(settleRef.current);
        settleRef.current = setTimeout(() => {
            const { data: current, colors } = argsRef.current;
            if (chartRef.current) syncContextImage(chartRef.current, current, colors);
        }, 150);
    });
    if (typeof echarts === 'undefined') return h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
    }, 'ECharts not loaded');
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
