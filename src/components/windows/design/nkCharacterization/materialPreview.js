/**
 * What the material will contain, shown before it is written.
 *
 * The preview is built from the material record itself rather than from the fit
 * a second time, so the curve and the table on screen are the numbers that go
 * into the catalog and cannot drift from them.
 */

import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../../analysis/chrome/plot.js';
import { characterizedMaterial } from './model.js';

const INDEX_COLOR = '#4fc3f7';
const EXTINCTION_COLOR = '#ff8a65';

/** The material a save would write, under a placeholder id and name. */
export function previewMaterial(result) {
    return characterizedMaterial(result, { id: 'preview' });
}

/** Its stored table, as rows for a results grid. */
export function previewRows(material) {
    return (material.tabData || []).map(([lambda, n, k]) => ({ lambda, n, k }));
}

export function previewColumns(labels) {
    return [
        { key: 'lambda', label: labels.lambda, align: 'right', fmt: value => value.toFixed(1) },
        { key: 'n', label: 'n', fmt: value => value.toFixed(5) },
        {
            key: 'k',
            label: 'k',
            fmt: value => (value > 0 ? value.toExponential(3) : '0'),
        },
    ];
}

export function buildPreviewOption(material, palette) {
    const rows = material.tabData || [];
    const lambda = rows.map(row => row[0]);
    const absorbing = rows.some(row => row[2] > 0);
    const series = [
        lineSeries({
            x: lambda, y: rows.map(row => row[1]), name: 'n',
            color: INDEX_COLOR, width: 2, yAxisIndex: 0,
        }),
        absorbing && lineSeries({
            x: lambda, y: rows.map(row => row[2]), name: 'k',
            color: EXTINCTION_COLOR, width: 2, yAxisIndex: 1,
        }),
    ].filter(Boolean);

    return cartesianOption({
        colors: palette,
        grid: { ...plotMargin({ rightAxis: absorbing }), top: 26, bottom: 34 },
        legend: legendAbove({ color: palette.text }),
        tooltip: axisTooltip({ colors: palette }),
        xAxis: valueAxis({ name: 'λ (nm)', color: palette.text, gridColor: palette.grid }),
        yAxis: [
            valueAxis({
                name: 'n', color: INDEX_COLOR, gridColor: palette.grid,
                position: 'left', scale: true,
            }),
            {
                ...valueAxis({
                    name: 'k', color: EXTINCTION_COLOR, gridColor: palette.grid,
                    position: 'right', splitLine: false, min: 0, scale: true,
                }),
                show: absorbing,
            },
        ],
        series,
    });
}
