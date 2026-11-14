import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

const toPercent = values => Array.from(values, value => value * 100);

/**
 * ECharts option: one trial's curve `{ lambda, values, design }` in %, named
 * `name`, in `color`, and the design's own curve dashed beside it, named
 * `designName`.
 */
export function buildTrialOption({ curve, name, designName, color, c, lambdaAxis }) {
    const colors = { background: c.bg, paper: c.panel, grid: c.border, text: c.text };
    return cartesianOption({
        colors,
        grid: plotMargin(),
        legend: legendAbove({ color: c.text }),
        fileName: 'montecarlo_trial',
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: lambdaAxis, color: c.text, gridColor: c.border, wavelength: true }),
        yAxis: valueAxis({ name: '%', color: c.text, gridColor: c.border, min: 0, splitNumber: 10 }),
        series: [
            lineSeries({ x: curve.lambda, y: toPercent(curve.values), name, color, width: 2 }),
            lineSeries({ x: curve.lambda, y: toPercent(curve.design), name: designName, color: c.textDim, width: 1.5, dash: 'dash' }),
        ],
    });
}

/**
 * The curve of the trial selected beside the design's own, computed on the
 * analysis worker from the trial's record (errorAnalysis/mcTrial.js
 * trialCurve) with `inputs`, `{ design, params, char, evalMode, environment }`,
 * the window's. The last curves stay drawn while the next are computed.
 * Nothing is drawn without inputs.
 */
export function TrialPlot({ trial, inputs, c, name, designName, lambdaAxis }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const shown = useRef(null);
    const colors = useAnalysisColors('errorAnalysis') || ANALYSIS_DEFAULTS.errorAnalysis.colors;
    const payload = useMemo(() => (trial && inputs ? { ...inputs, record: trial } : null), [trial, inputs]);
    const { data } = useAnalysisEvaluation(!!payload, 'trialCurve', payload);
    if (data) shown.current = { curve: data, name };
    useEffect(() => {
        const drawn = shown.current;
        if (!drawn) {
            disposeChart(divRef.current, chartRef);
            return;
        }
        const color = colors[inputs.char] || colors.A;
        drawChart(divRef.current, chartRef, buildTrialOption({ ...drawn, designName, color, c, lambdaAxis }));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
