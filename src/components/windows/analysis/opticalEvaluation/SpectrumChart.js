import { buildEditableTargetGeometry } from '../../../../utils/physics/spectrumTargets.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { TargetEditorOverlay } from '../../../ui/TargetEditorOverlay.js';
import { buildChartOption, curveColorFor, readableTargets } from './model.js';
import { logAxisZoomTicks } from './yScale.js';
import { plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useCallback, useEffect, useMemo, useRef } = React;

const AXES = { xAxisIndex: 0, yAxisIndex: 0 };

export function SpectrumChart(props) {
    const {
        data, designId, showCurves, targets, showTargets, c,
        editMode = false, editTool = 'draw', editCurve = 'R', lamRange, yRange, yScale,
        spectralUnit = 'nm', overlays = [], materialBands,
    } = props;
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const designIdRef = useRef(designId);
    const optionRef = useRef(null);
    const yScaleRef = useRef(yScale);
    const zoomListenerRef = useRef(null);
    const zoomRulingRef = useRef(null);
    yScaleRef.current = yScale;
    const curveColors = useAnalysisColors('opticalEvaluation');
    const colors = {
        bgColor: c.bg || '#1e1e1e', paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a', textColor: c.text || '#cccccc',
    };
    // The editor offers the targets the plot can draw in the chosen unit, so
    // nothing can be picked up or drawn that vanishes when editing ends.
    const editableGeometry = useMemo(
        () => editMode ? buildEditableTargetGeometry(readableTargets(targets, yScale), lamRange) : [],
        [editMode, targets, yScale, lamRange],
    );

    // The ruling in the option is chosen for the whole span. After a rectangle
    // zoom the axis shows a fraction of it, and ECharts keeps the spacing it was
    // given, so the visible span is read back through the axes and ruled
    // afresh; once the view returns to the full span the option's own ruling is
    // put back. Applied by merge, which is what keeps the zoom alive. A redraw
    // carries the option's ruling, so after one the check starts from there.
    const syncZoomRuling = useCallback(afterRedraw => {
        const chart = chartRef.current;
        const base = optionRef.current;
        if (!chart || chart.isDisposed?.() || base?.yAxis?.type !== 'log') return;
        const margin = plotMargin();
        const x = margin.left + 1;
        const top = chart.convertFromPixel(AXES, [x, margin.top]);
        const bottom = chart.convertFromPixel(AXES, [x, chart.getHeight() - margin.bottom]);
        const ticks = logAxisZoomTicks(yScaleRef.current, bottom?.[1], top?.[1]);
        const wanted = ticks && ticks.interval !== base.yAxis.interval ? ticks : null;
        const applied = afterRedraw ? null : zoomRulingRef.current;
        if ((wanted?.interval ?? null) === applied) return;
        chart.setOption({
            yAxis: wanted || {
                interval: base.yAxis.interval,
                axisLabel: { formatter: base.yAxis.axisLabel.formatter },
            },
        }, { notMerge: false, lazyUpdate: false });
        zoomRulingRef.current = wanted?.interval ?? null;
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (chart && designIdRef.current !== designId) {
            chart.dispatchAction({
                type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: false,
            });
            chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        }
        designIdRef.current = designId;
        const option = buildChartOption({
            data, showCurves, targets, targetsVisible: showTargets || editMode,
            overlays, curveColors, ...colors, editMode, editTool, yRange, yScale,
            spectralUnit, lamRange, materialBands,
        });
        optionRef.current = option;
        const drawn = drawChart(divRef.current, chartRef, option);
        if (drawn && zoomListenerRef.current !== drawn) {
            drawn.on('datazoom', () => syncZoomRuling(false));
            zoomListenerRef.current = drawn;
        }
        syncZoomRuling(true);
    });
    useChartTeardown(divRef, chartRef);

    if (typeof echarts === 'undefined') return h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
    }, 'ECharts not loaded — check index.html');

    return h('div', { style: { position: 'relative', width: '100%', height: '100%', minHeight: 200, overflow: 'hidden' } },
        h('div', { ref: divRef, style: { position: 'absolute', inset: 0 } }),
        h(TargetEditorOverlay, {
            chartRef,
            geometry: editableGeometry,
            enabled: editMode,
            tool: editTool,
            drawColor: curveColorFor(editCurve, curveColors),
            handleFill: colors.paperColor,
            onCreate: props.onCreateTarget,
            onEdit: props.onEditTarget,
            onDelete: props.onDeleteTarget,
        }),
    );
}
