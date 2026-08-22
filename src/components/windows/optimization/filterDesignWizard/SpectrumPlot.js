import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { materialIndexFn, embeddedT, spectrumT } from '../../../../utils/filter/filterDesign.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

function computeSpectrumData({ layersFn, analyticT, p, mode, windowNm }) {
    try {
        const width = windowNm || Math.max(p.stopHalf_nm * 1.5, p.passHalf_nm * 2.5, 5);
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
            ? embeddedT(layers, value, substrateIndex)
            : spectrumT(layers, value, incidentIndex, substrateIndex)) * 100);
        return { x, transmittance };
    } catch (error) { return { error: error.message }; }
}

export function SpectrumPlot({ layersFn, analyticT = null, p, mode = 'embedded', c, height = 280, levelLines = [], windowNm = null }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const data = useMemo(() => computeSpectrumData({ layersFn, analyticT, p, mode, windowNm }),
        [layersFn, analyticT, p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.substrateMaterial, p.incidentMedium, mode, windowNm]);
    useEffect(() => {
        if (data.error || data.empty) return;
        const series = lineSeries({ x: data.x, y: data.transmittance, name: 'T', color: '#4fc3f7', width: 1.7 });
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
        drawChart(divRef.current, chartRef, cartesianOption({
            colors: c,
            grid: { left: 46, right: 12, top: 8, bottom: 36 },
            tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
            xAxis: valueAxis({ name: 'λ (nm)', color: c.text, gridColor: c.border, nameGap: 26 }),
            yAxis: valueAxis({ name: '%', color: c.text, gridColor: c.border, min: 0, max: 100, interval: 10, nameGap: 30 }),
            series: [series],
        }));
    });
    useChartTeardown(divRef, chartRef);
    if (data.error) return h('div', { style: { color: c.warning || '#ef5350', fontSize: 12, padding: 10 } }, data.error);
    return h('div', { ref: divRef, style: { width: '100%', height } });
}
