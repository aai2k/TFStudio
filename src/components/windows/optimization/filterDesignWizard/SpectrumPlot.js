import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { materialIndexFn, embeddedT, spectrumT } from '../../../../utils/filter/filterDesign.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

/**
 * Floor of the logarithmic axis, in percent. Two decades below the stop level
 * the user specified, so the rejection edge the whole design turns on is
 * visible and the noise far below it is not.
 */
function logFloor(stopLevel) {
    return Math.max(1e-8, (stopLevel > 0 ? stopLevel : 0.1) / 100);
}

function computeSpectrumData({ layersFn, analyticT, p, mode, windowNm, targetReach, aoi, pol }) {
    try {
        // The target points reach further out than the curve's own window would
        // go, so the window covers them: otherwise the axis stretches to the
        // outermost cross and the curve stops short of the frame.
        const width = windowNm || Math.max(p.stopHalf_nm * 1.5, p.passHalf_nm * 2.5, targetReach, 5);
        const low = p.lambda0_nm - width, high = p.lambda0_nm + width;
        const wavelengths = new Set();
        const coarse = Math.max((high - low) / 500, 0.02);
        for (let value = low; value <= high; value += coarse) wavelengths.add(Math.round(value * 1e4) / 1e4);
        const fineWidth = Math.max(p.passHalf_nm * 4, 1);
        const fineStep = Math.max(fineWidth / 300, 0.003);
        for (let value = p.lambda0_nm - fineWidth; value <= p.lambda0_nm + fineWidth; value += fineStep) wavelengths.add(Math.round(value * 1e4) / 1e4);
        const x = [...wavelengths].sort((a, b) => a - b);
        if (analyticT) return { x, transmittance: x.map(value => analyticT(value) * 100) };
        const layers = layersFn();
        if (!layers?.length) return { empty: true };
        const substrateIndex = materialIndexFn(p.substrateMaterial, getMaterialById);
        const incidentIndex = mode === 'embedded' ? substrateIndex : materialIndexFn(p.incidentMedium, getMaterialById);
        const transmittance = x.map(value => (mode === 'embedded'
            ? embeddedT(layers, value, substrateIndex, aoi, pol)
            : spectrumT(layers, value, [incidentIndex, substrateIndex], aoi, pol)) * 100);
        return { x, transmittance };
    } catch (error) { return { error: error.message }; }
}

/** The target points, as a scatter series of crosses over the curve. */
function targetSeries(targetPoints, floor) {
    return {
        type: 'scatter', name: 'target', symbol: 'diamond', symbolSize: 7,
        itemStyle: { color: '#ffb300' }, z: 5, silent: true,
        data: targetPoints.map(pt => [pt.lambda, Math.max(pt.target, floor)]),
    };
}

/**
 * `aoi` is the angle of the curve, in degrees, measured in whichever medium the
 * mode makes incident: the substrate for 'embedded', the real incident medium for
 * 'air'. A caller that wants the response at a working angle passes the angle for
 * its own mode.
 */
export function SpectrumPlot({
    layersFn, analyticT = null, p, mode = 'embedded', c, height = 280,
    levelLines = [], windowNm = null, lambdaAxis, logAxis = false, targetPoints = null,
    aoi = 0, pol = 's',
}) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const targetReach = useMemo(() => (targetPoints || []).reduce(
        (w, pt) => Math.max(w, Math.abs(pt.lambda - p.lambda0_nm)), 0), [targetPoints, p.lambda0_nm]);
    const data = useMemo(() => computeSpectrumData({ layersFn, analyticT, p, mode, windowNm, targetReach, aoi, pol }),
        [layersFn, analyticT, p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.substrateMaterial, p.incidentMedium, mode, windowNm, targetReach, aoi, pol]);
    useEffect(() => {
        if (data.error || data.empty) return;
        const floor = logFloor(p.stopLevel);
        // A log axis cannot carry a zero, and a lossless stopband reaches values
        // no instrument would resolve, so the curve is clamped to the floor.
        const y = logAxis ? data.transmittance.map(v => Math.max(v, floor)) : data.transmittance;
        const series = lineSeries({ x: data.x, y, name: 'T', color: '#4fc3f7', width: 1.7 });
        series.markLine = {
            silent: true, symbol: 'none', label: { show: false },
            data: [
                { xAxis: p.lambda0_nm, lineStyle: { color: c.textDim, width: 1, type: 'dotted' } },
                ...levelLines.map(line => [
                    { coord: [line.x0, line.y], lineStyle: { color: line.color, width: 2 } },
                    { coord: [line.x1, line.y] },
                ]),
            ],
        };
        const all = targetPoints?.length ? [series, targetSeries(targetPoints, floor)] : [series];
        drawChart(divRef.current, chartRef, cartesianOption({
            colors: c,
            grid: { left: 52, right: 12, top: 8, bottom: 36 },
            tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
            // Pinned to the sampled range so the curve fills the frame whatever
            // else is plotted over it.
            xAxis: valueAxis({ name: lambdaAxis, color: c.text, gridColor: c.border, nameGap: 26,
                min: data.x[0], max: data.x[data.x.length - 1] }),
            yAxis: logAxis
                ? { ...valueAxis({ name: '%', color: c.text, gridColor: c.border, nameGap: 38 }), type: 'log', min: floor, max: 100 }
                : valueAxis({ name: '%', color: c.text, gridColor: c.border, min: 0, max: 100, interval: 10, nameGap: 30 }),
            series: all,
        }));
    });
    useChartTeardown(divRef, chartRef);
    if (data.error) return h('div', { style: { color: c.warning || '#ef5350', fontSize: 12, padding: 10 } }, data.error);
    return h('div', { ref: divRef, style: { width: '100%', height } });
}
