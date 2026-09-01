import { buildWorksheetOption, ZOOM_ID } from './figure.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

// Where along the run the chart is currently scrolled to, as a percentage of
// the whole. ECharts keeps these up to date as the scrollbar is dragged.
function currentWindow(chart) {
    if (!chart || chart.isDisposed?.()) return null;
    const zoom = (chart.getOption()?.dataZoom || []).find(item => item.id === ZOOM_ID);
    return zoom ? { start: zoom.start, end: zoom.end } : null;
}

/**
 * Applying a new option resets the scrollbar to the opening window, which would
 * throw the view back to the first layer every time a wavelength is typed. The
 * position is carried across instead, and given up only when the run itself
 * changes length or the window size changes, since it no longer means the same
 * place.
 */
export function WorksheetChart({ rows, c, t, layersInView }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const shapeRef = useRef(null);
    const staleRef = useRef(false);
    const argsRef = useRef(null);
    const colors = useAnalysisColors('monitorWorksheet');
    argsRef.current = { rows, c, t, layersInView, colors };
    // Depends on the actual chart inputs: a render caused by anything else
    // must not rebuild and re-diff the option.
    useEffect(() => {
        const shape = `${rows.length}:${layersInView}`;
        const kept = shapeRef.current === shape ? currentWindow(chartRef.current) : null;
        shapeRef.current = shape;
        const chart = drawChart(divRef.current, chartRef,
            buildWorksheetOption({ rows, c, t, layersInView, colors }));
        // drawChart declines while the pane has no drawable room; remember
        // that so the resize path below can retry once room comes back.
        staleRef.current = !chart;
        if (chart && kept) {
            chart.dispatchAction({ type: 'dataZoom', dataZoomId: ZOOM_ID, ...kept });
        }
    }, [rows, layersInView, colors, c, t]);
    // A declined draw is retried when the pane is opened back up: the
    // ResizeObserver is the only signal that arrives without a render.
    useChartTeardown(divRef, chartRef, () => {
        if (!staleRef.current) return;
        if (drawChart(divRef.current, chartRef, buildWorksheetOption(argsRef.current))) {
            staleRef.current = false;
        }
    });
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
