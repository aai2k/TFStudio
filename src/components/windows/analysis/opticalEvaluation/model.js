import {
    buildTargetTraces, buildTargetShapes,
    operandOverridesFromDrawnLine, applyHandleEdit, snapDrawnLine,
} from '../../../../utils/physics/spectrumTargets.js';
import { makeOperand } from '../../../../utils/physics/optimizer.js';
import { spectralAxisProps } from '../../../../utils/physics/spectralAxis.js';

export const CURVES = [
    { key: 'T',  label: 'T avg', color: '#2196f3', dash: 'solid', group: 'avg' },
    { key: 'R',  label: 'R avg', color: '#ef5350', dash: 'solid', group: 'avg' },
    { key: 'A',  label: 'A avg', color: '#66bb6a', dash: 'solid', group: 'avg' },
    { key: 'Ts', label: 'T (s)', color: '#64b5f6', dash: 'dot',   group: 's' },
    { key: 'Rs', label: 'R (s)', color: '#ef9a9a', dash: 'dot',   group: 's' },
    { key: 'Tp', label: 'T (p)', color: '#1565c0', dash: 'dash',  group: 'p' },
    { key: 'Rp', label: 'R (p)', color: '#c62828', dash: 'dash',  group: 'p' },
];

export const CURVE_BY_KEY = Object.fromEntries(CURVES.map(cv => [cv.key, cv]));

export const CURVE_GROUPS = [
    { q: 'T', members: [{ pol: 'avg', key: 'T' }, { pol: 's', key: 'Ts' }, { pol: 'p', key: 'Tp' }] },
    { q: 'R', members: [{ pol: 'avg', key: 'R' }, { pol: 's', key: 'Rs' }, { pol: 'p', key: 'Rp' }] },
    { q: 'A', members: [{ pol: 'avg', key: 'A' }] },
];

export const AOI_MAX = 6;
const AOI_ALPHA = [1.0, 0.72, 0.56, 0.45, 0.36, 0.30];

export function curveColorFor(curve) {
    return curve === 'T' ? '#2196f3' : curve === 'A' ? '#66bb6a' : '#ef5350';
}

export function formatTheta(theta) {
    return Number.isInteger(theta) ? String(theta) : theta.toFixed(1);
}

function aoiAlpha(index, count) {
    return count <= 1 ? 1.0 : (AOI_ALPHA[index] ?? 0.30);
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function buildMeasuredTraces(overlays) {
    const out = [];
    (overlays || []).forEach(cv => {
        if (!cv || cv.visible === false || !cv.x?.length) return;
        out.push({
            x: cv.x,
            y: cv.y.map(v => v * 100),
            name: `${cv.name} (${cv.quantity} meas)`,
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: cv.color, width: 1.4, dash: 'dot' },
            marker: { color: cv.color, size: 4, symbol: 'circle-open' },
            hovertemplate: `%{x:.1f} nm<br>${cv.name}: %{y:.3f}%<extra></extra>`,
        });
    });
    return out;
}

function curveTrace(data, series, seriesIndex, curve, seriesCount) {
    const suffix = seriesCount > 1 ? ` @ ${formatTheta(series.theta)}°` : '';
    return {
        x: data.lambda,
        y: series[curve.key].map(v => v * 100),
        name: curve.label + suffix,
        type: 'scatter',
        mode: 'lines',
        line: { color: hexToRgba(curve.color, aoiAlpha(seriesIndex, seriesCount)), width: 1.5, dash: curve.dash },
        hovertemplate: `%{x:.1f} nm<br>${curve.label}${suffix}: %{y:.3f}%<extra></extra>`
    };
}

function buildCurveTraces(data, showCurves) {
    const enabled = CURVES.filter(cv => showCurves[cv.key]);
    const traces = [];
    data.series.forEach((series, seriesIndex) => {
        enabled.forEach(curve => {
            if (series[curve.key]) traces.push(curveTrace(data, series, seriesIndex, curve, data.series.length));
        });
    });
    return traces;
}

export function buildChartTraces({ data, showCurves, targets, targetsVisible, overlays }) {
    const overlayTraces = buildMeasuredTraces(overlays);
    const targetTraces = targetsVisible ? buildTargetTraces(targets) : [];
    if (!data?.lambda || !data?.series?.length) return [...overlayTraces, ...targetTraces];
    return [...buildCurveTraces(data, showCurves), ...overlayTraces, ...targetTraces];
}

export function buildChartLayout(opts) {
    const {
        paperColor, bgColor, gridColor, textColor, targets, targetsVisible,
        editMode, editTool, editCurve, editable, handlesActive, yRange,
        spectralUnit, lamRange,
    } = opts;
    return {
        margin: { l: 52, r: 16, t: 16, b: 44 },
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            ...spectralAxisProps(spectralUnit, lamRange?.min, lamRange?.max),
            gridcolor: gridColor, gridwidth: 1,
            zerolinecolor: gridColor,
            tickfont: { size: 10 }
        },
        yaxis: {
            title: { text: '(%)', standoff: 8 },
            ...(yRange?.auto
                ? { autorange: true }
                : { range: [yRange?.min ?? 0, yRange?.max ?? 100] }),
            gridcolor: gridColor, gridwidth: 1,
            zerolinecolor: gridColor,
            tickfont: { size: 10 }
        },
        legend: {
            bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1,
            font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top'
        },
        hovermode: editMode ? 'closest' : 'x unified',
        dragmode: (editMode && editTool === 'draw') ? 'drawline' : 'zoom',
        newshape: editMode
            ? { line: { color: curveColorFor(editCurve), width: 3 }, opacity: 0.9, drawdirection: 'diagonal' }
            : undefined,
        autosize: true,
        shapes: handlesActive
            ? editable.shapes
            : ((targetsVisible || editMode) ? buildTargetShapes(targets) : [])
    };
}

export function buildChartConfig(editMode, editTool) {
    return {
        displaylogo: false,
        responsive: true,
        displayModeBar: true,
        editable: false,
        edits: { shapePosition: editMode && editTool === 'draw' },
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
        modeBarButtonsToAdd: (editMode && editTool === 'draw') ? ['drawline'] : [],
        toImageButtonOptions: { format: 'png', filename: 'TFStudio_spectrum', scale: 2 }
    };
}

export function buildTableColumns(data, showCurves) {
    const enabled = CURVES.filter(cv => showCurves[cv.key]);
    const multi = data.series.length > 1;
    const columns = [];
    data.series.forEach(series => {
        enabled.forEach(curve => {
            if (series[curve.key]) columns.push({
                cv: curve,
                theta: series.theta,
                ys: series[curve.key],
                label: curve.label + (multi ? ` @ ${formatTheta(series.theta)}°` : '')
            });
        });
    });
    return columns;
}

export function buildCSV(data, showCurves) {
    if (!data?.lambda || !data?.series?.length) return '';
    const multi = data.series.length > 1;
    const cols = buildTableColumns(data, showCurves).map(col => ({
        name: col.cv.key + (multi ? `_${formatTheta(col.theta)}deg` : ''),
        ys: col.ys,
    }));
    const header = ['lambda_nm', ...cols.map(col => col.name)].join(',');
    const rows = data.lambda.map((lambda, index) =>
        [lambda.toFixed(2), ...cols.map(col => (col.ys[index] * 100).toFixed(6))].join(',')
    );
    return [header, ...rows].join('\n');
}

export function createTargetOperands(opts) {
    const { operands, line, editCurve, editPol, editKind, snapOn, snapNm, snapPct } = opts;
    const drawn = snapOn ? snapDrawnLine(line, { operands, snapNm, snapPct }) : line;
    return [...operands, makeOperand(operandOverridesFromDrawnLine(drawn, editCurve, editPol, editKind))];
}

export function editTargetOperands(opts) {
    const { operands, meta, coords, snapOn, snapNm, snapPct } = opts;
    const edited = snapOn
        ? snapDrawnLine(coords, { operands, snapNm, snapPct, excludeId: meta.opId })
        : coords;
    return operands.map(op => op.id === meta.opId ? { ...op, ...applyHandleEdit(meta, op, edited) } : op);
}

export function deleteTargetOperand(operands, opId) {
    return operands.filter(op => op.id !== opId);
}
