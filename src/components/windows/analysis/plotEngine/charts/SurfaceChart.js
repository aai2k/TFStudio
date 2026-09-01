/**
 * The Plot Engine's surface, and everything about drawing it that needs the
 * live chart: the colour bar sized to the pane, the band selected on that bar,
 * and the readout the flat map draws for itself.
 */

import { disposeChart, drawChart, useChartTeardown } from '../../../../ui/plotSurface.js';
import { chartColors, tooltipContainer } from '../../../../ui/chartOptions.js';
import { plotMargin } from '../../chrome/plot.js';
import { rasteriseHeatmap } from '../heatmapImage.js';
import { colorScale } from './colorScales.js';
import {
    buildSurfaceOption, DEFAULT_BAR_HEIGHT, heatmapExtent, heatmapScale,
    isPercentQuantity, readoutLines, surfacePlotAxisLabel,
} from './surfaceOption.js';

const { createElement: h, useMemo, useEffect, useRef, useState } = React;

function surfacePrompt(message, c) {
    return h('div', { style: {
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.textDim, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: 20,
    } }, message);
}

function surfaceError(message, c) {
    return h('div', { style: {
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.danger || '#ef5350', fontSize: 13, textAlign: 'center', padding: 20,
    } }, message);
}

// What the bar cannot have: the grid's own top and bottom margins, plus the
// caption above the bar and the readout under it.
const BAR_INSET = plotMargin().top + plotMargin().bottom + 32;
// Quantised, so a size that settles a few pixels from where it was does not
// count as a change. Rounded down, so a bar never grows past its own plot.
const BAR_STEP = 40;
// How long the size has to hold still before the bar is resized to match.
//
// The bar is the one part of the option that depends on how big the chart is,
// and an option that changes is an option that gets applied: a chart redrawn
// mid-drag is discarded and rebuilt, which is the flicker the whole option
// comparison in plotSurface.js exists to avoid. Waiting for the drag to stop
// keeps the option identical for every frame of it, so the drag redraws
// nothing and the bar is resized once, at the end.
const BAR_SETTLE_MS = 200;

function barHeightFor(element) {
    const available = (element?.clientHeight || 0) - BAR_INSET;
    if (available <= 0) return DEFAULT_BAR_HEIGHT;
    return Math.max(80, Math.floor(available / BAR_STEP) * BAR_STEP);
}

// How far the readout sits from the pointer.
const READOUT_GAP = 14;

/**
 * The value under the pointer.
 *
 * The flat map is one image, so there is no per-cell element for ECharts to
 * hover. The grid is already here, and the chart converts a pixel to the two
 * axis indices, so the readout is looked up directly.
 *
 * Drawn into the same container the charts give their own tooltips, for the
 * same reason: the plot pane clips what leaves it, and a readout near its edge
 * would lose the values it is there to show.
 */
function HeatmapReadout({ at, c, container }) {
    if (!container) return null;
    const palette = chartColors(c);
    return ReactDOM.createPortal(h('div', {
        style: {
            position: 'fixed',
            left: at.clientX + READOUT_GAP, top: at.clientY + READOUT_GAP,
            pointerEvents: 'none', zIndex: 9999999, whiteSpace: 'nowrap',
            padding: '5px 7px', borderRadius: 4,
            backgroundColor: palette.paper, color: palette.text,
            border: `1px solid ${palette.grid}`,
            boxShadow: '0 3px 10px rgba(0,0,0,.18)',
            fontSize: 11, lineHeight: '16px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    }, at.lines.map((line, index) => h('div', { key: index }, line))), container);
}

/**
 * The axis indices under a pixel of the plot, or null when it is outside one.
 *
 * The conversion throws while the chart is between options, which is a pointer
 * that has landed nowhere rather than a failure worth reporting.
 */
function gridIndexAt(chart, left, top) {
    try {
        if (!chart.containPixel({ gridIndex: 0 }, [left, top])) return null;
        const point = chart.convertFromPixel({ gridIndex: 0 }, [left, top]);
        return point ? { column: Math.round(point[0]), row: Math.round(point[1]) } : null;
    } catch (_) {
        return null;
    }
}

/** Pixel inside the plot to the grid cell under it, or null when outside. */
function cellAt(chart, result, spec, event, element) {
    if (!chart || !result?.ok || spec.render !== 'heatmap') return null;
    const box = element.getBoundingClientRect();
    const left = event.clientX - box.left;
    const top = event.clientY - box.top;
    const at = gridIndexAt(chart, left, top);
    const value = at ? result.z?.[at.row]?.[at.column] : undefined;
    if (!Number.isFinite(value)) return null;
    return { left, top, clientX: event.clientX, clientY: event.clientY, ...at, value };
}

/**
 * The colour bar's height, measured from the pane and held still during a drag.
 *
 * The observer reports the first size as soon as it starts. That one is taken
 * straight away, so the bar is right on the first paint rather than opening at
 * the fallback and jumping; every size after it is a resize in progress and
 * waits for the drag to stop.
 */
function useBarHeight(divRef, chartRef) {
    const [barHeight, setBarHeight] = useState(DEFAULT_BAR_HEIGHT);
    const barTimerRef = useRef(null);
    const measuredRef = useRef(false);
    useChartTeardown(divRef, chartRef, () => {
        clearTimeout(barTimerRef.current);
        if (!measuredRef.current) {
            measuredRef.current = true;
            setBarHeight(barHeightFor(divRef.current));
            return;
        }
        barTimerRef.current = setTimeout(
            () => setBarHeight(barHeightFor(divRef.current)), BAR_SETTLE_MS);
    });
    useEffect(() => () => clearTimeout(barTimerRef.current), []);
    return barHeight;
}

/** The readout the flat map draws for itself, as the pointer moves over it. */
function useHeatmapReadout(divRef, chartRef, { result, spec, design, tracking }) {
    const [readout, setReadout] = useState(null);
    const clear = () => setReadout(null);
    const onPointer = (event) => {
        const cell = cellAt(chartRef.current, result, spec, event, divRef.current);
        setReadout(cell && {
            ...cell,
            lines: readoutLines([
                [surfacePlotAxisLabel(spec.xVar, design), result.x[cell.column]],
                [surfacePlotAxisLabel(spec.yVar, design), result.y[cell.row]],
                [`${result.zLabel}${isPercentQuantity(spec) ? ' (%)' : ''}`,
                    cell.value * heatmapScale(spec)],
            ]),
        });
    };
    return {
        readout,
        handlers: tracking ? { onMouseMove: onPointer, onMouseLeave: clear } : {},
    };
}

/** The stand-in shown instead of the chart when there is no grid to draw. */
function surfaceOverlay(result, prompt, labels, c) {
    if (!result) {
        return surfacePrompt(
            prompt || labels.surfacePrompt
                || 'Configure the axes and quantity, then press Compute.', c);
    }
    if (!result.ok) return surfaceError(result.error || 'Cannot compute surface.', c);
    return null;
}

// `prompt` replaces the stand-in shown before a grid exists, for a window that
// sweeps on its own instead of waiting for a Compute press.
export function SurfaceChart({ result, spec, design, c, t, prompt }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    // The band selected on the colour bar. Null is the whole range.
    const [range, setRange] = useState(null);
    const barHeight = useBarHeight(divRef, chartRef);
    // Rasterised when the grid or its colours change, not when the chart is
    // merely redrawn, which is what makes a resize cheap.
    const image = useMemo(
        () => (result?.ok && spec.render === 'heatmap'
            ? rasteriseHeatmap(result, colorScale(spec.colorscale),
                heatmapExtent(result, spec), heatmapScale(spec), range)
            : null),
        [result, spec.render, spec.colorscale, spec.z, range]);
    const option = useMemo(
        () => buildSurfaceOption(result, spec, design, c, { barHeight, image, range }),
        [result, spec, design, c, barHeight, image, range]);
    // A new grid, or a different quantity, spans a different set of values, so
    // a band chosen against the old one would mean nothing against this one.
    useEffect(() => setRange(null), [result, spec.z, spec.render]);
    useEffect(() => {
        if (option) drawChart(divRef.current, chartRef, option);
        else disposeChart(divRef.current, chartRef);
        // The colour bar maps no series here, so narrowing it is applied by
        // rasterising again rather than by ECharts filtering anything.
        const chart = chartRef.current;
        if (!chart || chart.isDisposed?.()) return undefined;
        const onSelect = (event) => {
            const picked = event?.selected;
            setRange(Array.isArray(picked) ? [picked[0], picked[1]] : null);
        };
        chart.on('datarangeselected', onSelect);
        return () => { if (!chart.isDisposed?.()) chart.off('datarangeselected', onSelect); };
    }, [option]);
    // Only the image map reads itself out; the 3D surface keeps the tooltip
    // ECharts gives its own mesh.
    const { readout, handlers } = useHeatmapReadout(divRef, chartRef,
        { result, spec, design, tracking: !!image });
    const overlay = surfaceOverlay(result, prompt, t?.plotEngine || {}, c);
    return h('div', {
        style: { width: '100%', height: '100%', position: 'relative', overflow: 'hidden' },
        ...handlers,
    },
        h('div', { ref: divRef, style: { width: '100%', height: '100%', visibility: overlay ? 'hidden' : 'visible' } }),
        !overlay && readout && h(HeatmapReadout, {
            at: readout, c, container: tooltipContainer(divRef.current),
        }),
        overlay && h('div', { style: { position: 'absolute', inset: 0 } }, overlay));
}
