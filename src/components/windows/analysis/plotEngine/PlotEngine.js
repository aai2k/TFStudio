/**
 * Generic T/R/A curve and parameter-surface plot builder.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { parseAxisVar } from '../../../../utils/physics/plotQuantities.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { CenteredMessage } from '../chrome/layout.js';
import { useCurvePlot } from './curveState.js';
import { useSurfacePlot } from './surfaceState.js';
import { PlotEngineView } from './PlotEngineView.js';

const { createElement: h, useCallback, useMemo } = React;

function unavailableMessage(design, pe) {
    if (!design) return pe.noDesign;
    if (!design.frontLayers?.length && !design.backLayers?.length) return pe.noLayers;
    return null;
}

/** Which surface axis sweeps wavelength, or null when neither does. */
function lambdaAxis(spec) {
    if (parseAxisVar(spec.xVar).kind === 'lambda') return 'x';
    if (parseAxisVar(spec.yVar).kind === 'lambda') return 'y';
    return null;
}

/**
 * The wavelengths the plot as configured will evaluate at.
 *
 * A curve sweeping angle still sits at one wavelength, and so does a surface
 * with wavelength on neither axis, so those count as the single wavelength they
 * hold. In 2D the span covers every visible curve at once: they are drawn on one
 * chart and the warning is about the chart.
 */
function evaluatedLambdaSpan(plotMode, curves, spec) {
    if (plotMode === '3d') {
        const axis = lambdaAxis(spec);
        if (axis === 'x') return [spec.xFrom, spec.xTo];
        if (axis === 'y') return [spec.yFrom, spec.yTo];
        return [spec.fixedLambda_nm, spec.fixedLambda_nm];
    }
    let low = Infinity;
    let high = -Infinity;
    for (const curve of curves) {
        if (!curve.visible) continue;
        const ends = curve.xAxis === 'wavelength'
            ? [curve.rangeFrom, curve.rangeTo]
            : [curve.lambdaFixed_nm, curve.lambdaFixed_nm];
        low = Math.min(low, ends[0], ends[1]);
        high = Math.max(high, ends[0], ends[1]);
    }
    return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : null;
}

export function PlotEngine({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const pe = t.plotEngine;
    const curvePlot = useCurvePlot(design, evalMode);
    const surfacePlot = useSurfacePlot(design, evalMode);

    const span = useMemo(
        () => evaluatedLambdaSpan(surfacePlot.plotMode, curvePlot.curves, surfacePlot.surfaceSpec),
        [surfacePlot.plotMode, curvePlot.curves, surfacePlot.surfaceSpec]);
    // Only the surface offers to widen its own range, and only while wavelength
    // is on an axis: that is the one place the window holds a single range the
    // user owns. A fixed wavelength has no range to set, and the 2D curves each
    // carry their own, so those warn without offering to change anything.
    const surfaceLambdaAxis = surfacePlot.plotMode === '3d'
        ? lambdaAxis(surfacePlot.surfaceSpec) : null;
    const { updateSurface } = surfacePlot;
    const fixRange = useCallback(([from, to]) => {
        if (surfaceLambdaAxis === 'x') updateSurface({ xFrom: from, xTo: to });
        else if (surfaceLambdaAxis === 'y') updateSurface({ yFrom: from, yTo: to });
    }, [surfaceLambdaAxis, updateSurface]);
    const rangeNotice = useMaterialRangeNotice(
        design, span?.[0], span?.[1], t, surfaceLambdaAxis ? fixRange : undefined);

    const message = unavailableMessage(design, pe);
    return message
        ? h(CenteredMessage, { c, message })
        : h(PlotEngineView, {
            curvePlot, surfacePlot, design, c, t, pe,
            notices: [rangeNotice].filter(Boolean),
        });
}
