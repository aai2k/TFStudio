import { buildEditableTargetGeometry } from '../../../../utils/physics/spectrumTargets.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { TargetEditorOverlay } from '../../../ui/TargetEditorOverlay.js';
import { buildChartOption, curveColorFor } from './model.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function SpectrumChart(props) {
    const {
        data, designId, showCurves, targets, showTargets, c,
        editMode = false, editTool = 'draw', editCurve = 'R', lamRange, yRange, yScale,
        spectralUnit = 'nm', overlays = [], materialBands,
    } = props;
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const designIdRef = useRef(designId);
    const curveColors = useAnalysisColors('opticalEvaluation');
    const colors = {
        bgColor: c.bg || '#1e1e1e', paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a', textColor: c.text || '#cccccc',
    };
    const editableGeometry = useMemo(
        () => editMode ? buildEditableTargetGeometry(targets, lamRange) : [],
        [editMode, targets, lamRange],
    );
    useEffect(() => {
        const chart = chartRef.current;
        if (chart && designIdRef.current !== designId) {
            chart.dispatchAction({
                type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: false,
            });
            chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        }
        designIdRef.current = designId;
        drawChart(divRef.current, chartRef, buildChartOption({
            data, showCurves, targets, targetsVisible: showTargets || editMode,
            overlays, curveColors, ...colors, editMode, editTool, yRange, yScale,
            spectralUnit, lamRange, materialBands,
        }));
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
