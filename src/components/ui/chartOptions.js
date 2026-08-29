/** Small native-ECharts option factories shared by TFStudio charts. */

export const THIN_X_SYMBOL = 'path://M-5,-4L-4,-5L0,-1L4,-5L5,-4L1,0L5,4L4,5L0,1L-4,5L-5,4L-1,0Z';
export const LINE_LEGEND_ICON = 'path://M0,4L24,4L24,6L0,6Z';
const RECTANGLE_ZOOM_ICON = 'path://M0,13.5h26.9 M13.5,26.9V0 M32.1,13.5H58V58H13.5 V32.1';

export function dashType(dash) {
    if (!dash || dash === 'solid') return 'solid';
    if (dash === 'dot' || dash === 'dotted') return 'dotted';
    return 'dashed';
}

export function xyData(x = [], y = [], extra) {
    const size = Math.min(x.length, y.length);
    return Array.from({ length: size }, (_, index) => {
        const value = [x[index], y[index]];
        return extra ? { value, ...extra(index) } : value;
    });
}

export function lineSeries({
    x, y, data, name, color, width = 2, dash = 'solid', symbol = 'none',
    symbolSize = 4, showSymbol = symbol !== 'none', yAxisIndex = 0,
    xAxisIndex = 0, connectNulls = false, areaStyle, stack, z = 2,
    silent = false, emphasis, tooltip, sampling, encode, step,
    lineCap, lineJoin,
} = {}) {
    return {
        name,
        type: 'line',
        data: data || xyData(x, y),
        xAxisIndex,
        yAxisIndex,
        showSymbol,
        symbol,
        symbolSize,
        connectNulls,
        lineStyle: {
            color, width, type: dashType(dash),
            ...(lineCap ? { lineCap } : {}),
            ...(lineJoin ? { lineJoin } : {}),
        },
        itemStyle: { color },
        areaStyle,
        stack,
        z,
        silent,
        emphasis,
        tooltip,
        sampling,
        encode,
        step,
        animation: false,
    };
}

export function scatterSeries({
    x, y, data, name, color, symbol = 'circle', symbolSize = 7,
    yAxisIndex = 0, xAxisIndex = 0, z = 4, silent = false, tooltip,
} = {}) {
    return {
        name,
        type: 'scatter',
        data: data || xyData(x, y),
        xAxisIndex,
        yAxisIndex,
        symbol,
        symbolSize,
        itemStyle: { color },
        z,
        silent,
        tooltip,
        animation: false,
    };
}

export function valueAxis({
    name, color = '#cccccc', gridColor = '#3a3a3a', min, max,
    position = 'bottom', inverse = false, axisLabel, nameGap = 30,
    splitLine = true, scale = false, formatter, interval, splitNumber,
} = {}) {
    return {
        type: 'value',
        name,
        nameLocation: 'middle',
        nameGap,
        nameTextStyle: { color, fontSize: 11 },
        position,
        inverse,
        min,
        max,
        interval,
        splitNumber,
        scale,
        axisLine: { show: true, lineStyle: { color } },
        axisTick: { show: true },
        axisLabel: {
            color,
            fontSize: 10,
            formatter: formatChartNumber,
            hideOverlap: true,
            ...(axisLabel || {}),
            ...(formatter ? { formatter } : {}),
        },
        splitLine: { show: splitLine, lineStyle: { color: gridColor, width: 1 } },
    };
}

export function chartToolbox(fileName, {
    dataZoom = true, restore = true, colors, resetView,
} = {}) {
    const palette = chartColors(colors);
    const feature = {
        saveAsImage: { name: `TFStudio_${fileName}`, pixelRatio: 2, backgroundColor: palette.paper },
    };
    // ECharts 6.1's native `restore` action recreates the toolbox model but
    // leaves the previous dataZoom brush controller active. The next rectangle
    // is then handled twice: once against the full axes and immediately again
    // against the first result. Every later restore accumulates another stale
    // controller and collapses the range farther.
    //
    // Reset the zoom models directly instead. This leaves the toolbox instance
    // intact and explicitly exits rectangle mode. Most plots use the full
    // 0–100 dataZoom range. A plot whose opening view is a viewport inside a
    // larger raw domain can supply `resetView`; the same shared action then
    // restores its axes and viewport together rather than inventing a private
    // reset path.
    if (restore) feature.myZoomRestore = {
        show: true,
        title: 'Reset zoom',
        icon: 'path://M3.8,33.4 M47,18.9h9.8V8.7 M56.3,20.1 C52.1,9,40.5,0.6,26.8,2.1C12.6,3.7,1.6,16.2,2.1,30.6 M13,41.1H3.1v10.2 M3.7,39.9c4.2,11.1,15.8,19.5,29.5,18 c14.2-1.6,25.2-14.1,24.7-28.5',
        onclick: (_model, api) => {
            api.dispatchAction({
                type: 'takeGlobalCursor',
                key: 'dataZoomSelect',
                dataZoomSelectActive: false,
            });
            if (resetView) {
                const chart = globalThis.echarts?.getInstanceByDom?.(api.getDom?.());
                if (chart) {
                    chart.setOption(resetView, { notMerge: false, lazyUpdate: false });
                    return;
                }
                const zooms = (Array.isArray(resetView.dataZoom)
                    ? resetView.dataZoom : [resetView.dataZoom]).filter(Boolean);
                const batch = zooms.map(zoom => ({
                    ...(zoom.id != null ? { dataZoomId: zoom.id } : {}),
                    start: zoom.start ?? 0,
                    end: zoom.end ?? 100,
                }));
                api.dispatchAction(batch.length > 1
                    ? { type: 'dataZoom', batch }
                    : { type: 'dataZoom', ...(batch[0] || { start: 0, end: 100 }) });
                return;
            }
            api.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        },
    };
    // The rectangle tool covers both axes, so dragging a box zooms to that box.
    //
    // `filterMode: 'none'` is what makes that safe. ECharts' default for this
    // tool is 'filter', which drops every point outside the window: on a Y axis
    // that discards the whole curve the moment the box does not span it, and
    // the plot comes back empty. With 'none' the data is left alone and the
    // grid clips it, which is also how the wheel zoom behaves.
    //
    // ECharts pairs the tool with a second icon that steps back through its own
    // zoom history. That history is written only by the rectangle tool, so after
    // a wheel zoom the icon has nothing to undo and does nothing at all. It is
    // drawn as an empty path to keep it off the strip, leaving Reset zoom and a
    // double-click inside the plot as the ways back to the full range.
    if (dataZoom) feature.dataZoom = {
        filterMode: 'none',
        // Declare zoom before the empty back path. ECharts merges defaults into
        // this object without changing existing key order; declaring only back
        // put the zero-width icon first and left a visible blank slot before
        // zoom. The unavoidable zero-width entry now sits after the last icon.
        icon: { zoom: RECTANGLE_ZOOM_ICON, back: 'path://' },
    };
    return {
        show: true,
        right: 8,
        top: 6,
        itemSize: 11,
        itemGap: 7,
        padding: [3, 5],
        backgroundColor: palette.paper,
        borderColor: palette.grid,
        borderWidth: 1,
        borderRadius: 4,
        iconStyle: { borderColor: palette.text, borderWidth: 1.25 },
        emphasis: { iconStyle: { borderColor: palette.accent, borderWidth: 1.75 } },
        feature,
    };
}

function themedTooltip(tooltip, colors) {
    if (!tooltip) return tooltip;
    const palette = chartColors(colors);
    const axisPointer = tooltip.axisPointer ? {
        ...tooltip.axisPointer,
        lineStyle: {
            color: palette.text, opacity: 0.5, width: 1,
            ...(tooltip.axisPointer.lineStyle || {}),
        },
        crossStyle: {
            color: palette.text, opacity: 0.5, width: 1,
            ...(tooltip.axisPointer.crossStyle || {}),
        },
        label: {
            ...(tooltip.axisPointer.label || {}),
            color: palette.text,
            backgroundColor: palette.paper,
            borderColor: palette.grid,
            borderWidth: 1,
            padding: [2, 4],
        },
    } : undefined;
    return {
        ...tooltip,
        backgroundColor: palette.paper,
        borderColor: palette.grid,
        borderWidth: tooltip.borderWidth ?? 1,
        textStyle: { ...(tooltip.textStyle || {}), color: palette.text },
        ...(axisPointer ? { axisPointer } : {}),
        extraCssText: tooltip.extraCssText
            ?? 'border-radius:4px;box-shadow:0 3px 10px rgba(0,0,0,.18);',
    };
}

function themedToolbox(toolbox, colors) {
    if (!toolbox) return toolbox;
    const palette = chartColors(colors);
    const saveAsImage = toolbox.feature?.saveAsImage;
    return {
        ...toolbox,
        backgroundColor: palette.paper,
        borderColor: palette.grid,
        borderWidth: 1,
        borderRadius: 4,
        iconStyle: { ...(toolbox.iconStyle || {}), borderColor: palette.text, borderWidth: 1.25 },
        emphasis: {
            ...(toolbox.emphasis || {}),
            iconStyle: {
                ...(toolbox.emphasis?.iconStyle || {}),
                borderColor: palette.accent,
                borderWidth: 1.75,
            },
        },
        feature: saveAsImage ? {
            ...toolbox.feature,
            saveAsImage: { ...saveAsImage, backgroundColor: palette.paper },
        } : toolbox.feature,
    };
}

/**
 * Reproduce the native axis-tooltip layout for a chosen subset of the series.
 *
 * A chart that draws a large family of context curves, one per layer of a
 * stack, would otherwise list every one of them: sixty rows that run off the
 * window and name curves nobody can pick out of the plot anyway.
 */
function axisRows(params, include, formatValue, valueSuffix) {
    const rows = (Array.isArray(params) ? params : [params]).filter(include);
    if (!rows.length) return '';
    return [
        `<div style="margin-bottom:3px">${formatChartReadout(rows[0].axisValue)}</div>`,
        ...rows.map(row => [
            '<div style="display:flex;gap:14px;align-items:baseline">',
            `<span style="flex:1">${row.marker}${row.seriesName}</span>`,
            `<span style="font-weight:600">${formatValue(
                Array.isArray(row.value) ? row.value[1] : row.value)}${valueSuffix}</span>`,
            '</div>',
        ].join('')),
    ].join('');
}

/**
 * Tooltip that reads every series at the wavelength under the pointer.
 *
 *   include  optional predicate over the tooltip's own params; only the series
 *            it accepts are listed. Use it where the plot carries more curves
 *            than a tooltip can show.
 */
export function axisTooltip({
    cross = true, colors, valueSuffix = '', formatValue = formatChartReadout, include,
} = {}) {
    return themedTooltip({
        trigger: 'axis',
        ...(include ? { formatter: params => axisRows(params, include, formatValue, valueSuffix) } : {}),
        appendToBody: true,
        confine: true,
        transitionDuration: 0,
        enterable: false,
        padding: [5, 7],
        textStyle: { fontSize: 11, fontWeight: 'normal', lineHeight: 16 },
        axisPointer: {
            type: cross ? 'cross' : 'line', snap: false, animation: false,
            label: {
                fontSize: 10,
                fontWeight: 'normal',
                    formatter: params => `${params.axisDimension === 'y'
                        ? formatValue(params.value)
                        : formatChartReadout(params.value)}${
                        params.axisDimension === 'y' ? valueSuffix : ''}`,
                },
            },
            valueFormatter: value => `${formatValue(value)}${valueSuffix}`,
        order: 'seriesAsc',
    }, colors);
}

export function itemTooltip(colors) {
    return themedTooltip({
        trigger: 'item', appendToBody: true, confine: true,
        transitionDuration: 0, enterable: false, padding: [5, 7],
        textStyle: { fontSize: 11, fontWeight: 'normal', lineHeight: 16 },
        valueFormatter: value => formatChartReadout(value),
    }, colors);
}

function compactExponential(number, significantDigits) {
    return number.toExponential(Math.max(0, significantDigits - 1))
        .replace(/(\.\d*?[1-9])0+(?=e)/, '$1')
        .replace(/\.0+(?=e)/, '')
        .replace('e+', 'e');
}

/** Compact axis-tick formatting, including distinct labels for small decades. */
export function formatChartNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    const magnitude = Math.abs(number);
    if (magnitude > 0 && (magnitude < 1e-3 || magnitude >= 1e6)) {
        return compactExponential(number, 3);
    }
    const decimals = magnitude >= 100 ? 1 : magnitude >= 1 ? 2 : 4;
    return number.toFixed(decimals).replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

/** Higher-precision scientific readout used by tooltips and crosshair labels. */
export function formatChartReadout(value, significantDigits = 5) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    if (number === 0) return '0';
    const digits = Math.max(1, Math.floor(significantDigits));
    const magnitude = Math.abs(number);
    if (magnitude < 1e-4 || magnitude >= 1e6) return compactExponential(number, digits);
    const precise = number.toPrecision(digits);
    return precise.includes('e')
        ? compactExponential(number, digits)
        : precise.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

/** Percentage readout with a stable, plot-wide number of decimal places. */
export function formatPercentReadout(value, decimals = 3) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    const digits = Math.max(0, Math.floor(decimals));
    return number.toFixed(digits);
}

function cleanTickValue(value) {
    return Number(Number(value).toPrecision(12));
}

/** Select a readable 1/2/2.5/5 decade interval for a numeric span. */
export function niceTickInterval(span, { targetTicks = 10, min = 0 } = {}) {
    if (!(Number.isFinite(span) && span > 0)) return Math.max(min, 1);
    const rough = span / Math.max(1, targetTicks);
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const step = [1, 2, 2.5, 5, 10].find(value => value >= normalized) || 10;
    return cleanTickValue(Math.max(min, step * magnitude));
}

/** Round data bounds outward onto the same readable tick grid. */
export function niceAxisBounds(low, high, options = {}) {
    if (!(Number.isFinite(low) && Number.isFinite(high))) return null;
    if (low === high) {
        const pad = Math.max(Math.abs(low) * 0.05, options.minInterval || 1);
        low -= pad;
        high += pad;
    }
    if (low > high) [low, high] = [high, low];
    const interval = niceTickInterval(high - low, {
        targetTicks: options.targetTicks,
        min: options.minInterval,
    });
    let min = Math.floor(low / interval) * interval;
    let max = Math.ceil(high / interval) * interval;
    if (options.includeZero) {
        min = Math.min(0, min);
        max = Math.max(0, max);
    }
    return {
        min: cleanTickValue(min),
        max: cleanTickValue(max),
        interval,
    };
}

export function chartGrid(margin = {}) {
    const { l, r, t, b, left, right, top, bottom, ...rest } = margin;
    const explicitBottom = bottom ?? b;
    return {
        ...rest,
        left: left ?? l ?? 58,
        right: right ?? r ?? 18,
        top: top ?? t ?? 38,
        ...(explicitBottom != null || margin.height == null
            ? { bottom: explicitBottom ?? 52 }
            : {}),
        containLabel: false,
    };
}

/** Pixel grid that preserves a true 1:1 data aspect inside a resizable host. */
export function squareGrid(element, margin = {}) {
    const base = chartGrid(margin);
    if (!element || !Number.isFinite(element.clientWidth) || !Number.isFinite(element.clientHeight)) return base;
    const availableWidth = Math.max(0, element.clientWidth - base.left - base.right);
    const availableHeight = Math.max(0, element.clientHeight - base.top - base.bottom);
    const size = Math.min(availableWidth, availableHeight);
    const { right: _right, bottom: _bottom, ...fixed } = base;
    return {
        ...fixed,
        left: base.left + Math.max(0, (availableWidth - size) / 2),
        top: base.top + Math.max(0, (availableHeight - size) / 2),
        width: size,
        height: size,
    };
}

/** Accept either raw theme tokens or an already-normalized chart palette. */
export function chartColors(colors = {}) {
    return {
        background: colors.background ?? colors.bg ?? colors.bgColor ?? '#1e1e1e',
        paper: colors.paper ?? colors.panel ?? colors.paperColor ?? '#252526',
        grid: colors.grid ?? colors.border ?? colors.gridColor ?? '#3a3a3a',
        text: colors.text ?? colors.textColor ?? '#cccccc',
        accent: colors.accent ?? colors.accentColor ?? '#007acc',
    };
}

function drawableGrid(grid, background) {
    const normalized = chartGrid(grid);
    return { ...normalized, show: true, backgroundColor: background, borderWidth: 0 };
}

// A wavelength axis reads best on round 50 nm ticks, which is what an optical
// spectrum sits on.
const WAVELENGTH_INTERVAL_NM = 50;

// Below two ticks there is no axis left to read, and past this many the labels
// collide, ECharts hides all of them, and the split lines go with them. Both
// ends are reached in practice: a wavelength axis re-read as micrometres spans
// hundreds of thousands and asks for ten thousand ticks, the same axis as
// photon energy spans a few units and gets none, and an infrared spectrum out
// to 25 µm asks for five hundred. The span decides the interval in those cases.
const MIN_TICKS = 2;
const MAX_TICKS = 40;

/** X extent across every series drawn as [x, y] pairs, or null. */
function seriesXSpan(series) {
    let low = Infinity;
    let high = -Infinity;
    for (const item of series || []) {
        for (const point of item?.data || []) {
            const x = Array.isArray(point) ? point[0] : null;
            if (!Number.isFinite(x)) continue;
            if (x < low) low = x;
            if (x > high) high = x;
        }
    }
    return high > low ? high - low : null;
}

function wavelengthInterval(span) {
    if (span == null) return WAVELENGTH_INTERVAL_NM;
    const ticks = span / WAVELENGTH_INTERVAL_NM;
    return ticks >= MIN_TICKS && ticks <= MAX_TICKS
        ? WAVELENGTH_INTERVAL_NM
        : niceTickInterval(span);
}

function dataBoundXAxis(axis, span) {
    if (Array.isArray(axis)) return axis.map(item => dataBoundXAxis(item, span));
    if (axis?.type !== 'value') return axis;
    const isNanometreWavelength = typeof axis.name === 'string'
        && /(?:wavelength|λ).*nm/i.test(axis.name);
    const pinTicks = axis.interval == null && axis.splitNumber == null && isNanometreWavelength;
    return {
        ...axis,
        scale: true,
        ...(pinTicks ? { interval: wavelengthInterval(span) } : {}),
    };
}

function standardYAxis(axis) {
    if (Array.isArray(axis)) return axis.map(standardYAxis);
    return axis?.type === 'value' && axis.interval == null && axis.splitNumber == null
        && axis.min === 0 && axis.max === 100
        ? { ...axis, interval: 10 }
        : axis;
}

function normalizedLegend(legend, series) {
    if (!legend?.show) return legend;
    const byName = new Map(series.filter(item => item?.name).map(item => [item.name, item]));
    const source = legend.data || [...byName.keys()];
    return {
        ...legend,
        itemWidth: legend.itemWidth ?? 24,
        itemHeight: legend.itemHeight ?? 8,
        data: source.map(item => {
            const name = typeof item === 'string' ? item : item.name;
            if (byName.get(name)?.type !== 'line') return item;
            return { ...(typeof item === 'string' ? {} : item), name, icon: LINE_LEGEND_ICON };
        }),
    };
}

/**
 * Compose the furniture common to native cartesian ECharts options.
 * Window models provide only their axes, series and meaningful exceptions.
 */
export function cartesianOption({
    colors, grid, xAxis, yAxis, series = [], legend = { show: false },
    tooltip = axisTooltip(), fileName, toolbox, title, dataZoom, visualMap,
    graphic, extra = {},
} = {}) {
    const palette = chartColors(colors);
    const grids = Array.isArray(grid)
        ? grid.map(item => drawableGrid(item, palette.background))
        : drawableGrid(grid, palette.background);
    return {
        backgroundColor: palette.paper,
        textStyle: { color: palette.text, fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 11 },
        grid: grids,
        // Scientific X axes represent the configured/sample domain. ECharts
        // otherwise expands positive-only value axes back toward zero.
        xAxis: dataBoundXAxis(xAxis, seriesXSpan(series)),
        yAxis: standardYAxis(yAxis),
        series,
        legend: normalizedLegend(legend, series),
        tooltip: themedTooltip(tooltip, palette),
        toolbox: themedToolbox(
            toolbox ?? (fileName ? chartToolbox(fileName, { colors: palette }) : undefined),
            palette,
        ),
        title,
        dataZoom,
        visualMap,
        graphic,
        animation: false,
        ...extra,
    };
}

export function horizontalLegend({ color = '#cccccc', top = 4, right = 104 } = {}) {
    return {
        show: true, type: 'scroll', orient: 'horizontal', left: 0, right, top,
        pageIconSize: 9, pageTextStyle: { color, fontSize: 9 },
        textStyle: { color, fontSize: 10 },
    };
}

export function verticalLegend({ color = '#cccccc', backgroundColor = 'transparent', borderColor = 'transparent' } = {}) {
    return {
        show: true, type: 'scroll', orient: 'vertical', left: 66, top: 42,
        textStyle: { color, fontSize: 10 }, backgroundColor, borderColor, borderWidth: 1,
    };
}
