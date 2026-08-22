import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useRef, useEffect } = React;

/** Shared lifecycle for synthesis trend charts. Callers provide a native option. */
export function ChartSurface({ buildOption, hasData, empty, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => {
        if (hasData) drawChart(divRef.current, chartRef, buildOption());
        else disposeChart(divRef.current, chartRef);
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height: '100%' } },
        h('div', { ref: divRef, style: { width: '100%', height: '100%' } }),
        !hasData && empty && h('div', {
            style: {
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: c?.textDim || '#888', fontSize: 11,
                fontStyle: 'italic', pointerEvents: 'none',
            },
        }, empty),
    );
}
