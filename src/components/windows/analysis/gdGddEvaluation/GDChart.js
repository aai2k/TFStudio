import { buildGDChartOption } from './chartModel.js';
import { buildEditableGdGddTargetGeometry } from './gdTargets.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { TargetEditorOverlay } from '../../../ui/TargetEditorOverlay.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function GDChart(props) {
    const {
        data, sets, meta, refLambda, showRef, targets = [], yRange, yInterval, c, xLabel,
        editMode = false, editTool = 'draw', lamRange, drawColor, onCreate, onEdit, onDelete,
        materialBands,
    } = props;
    const divRef = useRef(null);
    const chartRef = useRef(null);
    // Under All each environment's curve takes its colour from this palette.
    const curveColors = useAnalysisColors('gdGddEvaluation');
    const colors = {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
    const editableGeometry = useMemo(
        () => editMode ? buildEditableGdGddTargetGeometry(targets, lamRange) : [],
        [editMode, targets, lamRange],
    );
    useEffect(() => {
        if (data) drawChart(divRef.current, chartRef, buildGDChartOption({
            data, sets, meta, referenceLambda: refLambda, showReference: showRef,
            targets, yRange, yInterval, colors, curveColors, xLabel, editMode, editTool, materialBands,
        }));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' } },
        h('div', { ref: divRef, style: { position: 'absolute', inset: 0 } }),
        // A click places a target at one wavelength: the pointwise operands
        // have no width to drag out.
        h(TargetEditorOverlay, {
            chartRef, geometry: editableGeometry, enabled: editMode, tool: editTool,
            drawColor, handleFill: colors.paper, createOnClick: true,
            onCreate, onEdit, onDelete,
        }),
    );
}
