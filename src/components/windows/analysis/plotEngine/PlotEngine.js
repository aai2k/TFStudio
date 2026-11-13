/**
 * Any quantity against any other along one sweep, and one quantity over two
 * swept parameters as a heatmap or a 3D surface.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { BASE_ENVIRONMENT, environmentDesign } from '../../../../utils/environments/environments.js';
import { rangeMaterials } from '../../../../utils/materials/materialRange.js';
import { SWEEP, parseAxisVar } from '../../../../utils/physics/plotQuantities.js';
import { useMaterialsRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { currentEnvironmentOf, useCurrentEnvironment } from '../../design/environments/currentEnvironment.js';
import { CenteredMessage } from '../chrome/layout.js';
import { useCurvePlot } from './curveState.js';
import { useSurfacePlot } from './surfaceState.js';
import { PlotEngineView } from './PlotEngineView.js';

const { createElement: h, useCallback, useMemo } = React;

function unavailableMessage(design, pe) {
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
 * The wavelengths a curve evaluates at, or null for one that reads none of its
 * own: the merit function takes each operand's wavelengths, and the swept value
 * alone is no evaluation.
 */
function curveLambdaEnds(curve) {
    const quantities = [curve.x.quantity, curve.y.quantity].filter(quantity => quantity !== SWEEP);
    if (quantities.every(quantity => quantity === 'MF')) return null;
    return parseAxisVar(curve.sweep).kind === 'lambda'
        ? [curve.rangeFrom, curve.rangeTo]
        : [curve.lambdaFixed_nm, curve.lambdaFixed_nm];
}

/**
 * The wavelengths the plot as configured will evaluate at.
 *
 * A curve run along anything but wavelength still sits at one wavelength, and so
 * does a surface with wavelength on neither axis, so those count as the single
 * wavelength they hold. In 2D the span covers every visible curve at once: they
 * are drawn on one chart and the warning is about the chart.
 */
function evaluatedLambdaSpan(plotMode, curves, spec) {
    if (plotMode !== '2d') {
        const axis = lambdaAxis(spec);
        if (axis === 'x') return [spec.xFrom, spec.xTo];
        if (axis === 'y') return [spec.yFrom, spec.yTo];
        return [spec.fixedLambda_nm, spec.fixedLambda_nm];
    }
    let low = Infinity;
    let high = -Infinity;
    for (const curve of curves) {
        const ends = curve.visible ? curveLambdaEnds(curve) : null;
        if (!ends) continue;
        low = Math.min(low, ends[0], ends[1]);
        high = Math.max(high, ends[0], ends[1]);
    }
    return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : null;
}

/**
 * The materials the plot as configured evaluates, for the range notice: those
 * of each environment it computes in. In 2D that is the environment of every
 * visible curve that evaluates at a wavelength of its own; a surface computes
 * in its own. A map of the merit function, which takes each operand's own
 * wavelengths, keeps the design's own materials. An environment the design no
 * longer has reads as environment 1. `curves` and `spec` are as computed
 * (environmentField.js).
 */
export function evaluatedMaterials(design, plotMode, curves, spec) {
    let ids;
    if (plotMode === '2d') {
        ids = curves.filter(curve => curve.visible && curveLambdaEnds(curve)).map(curve => curve.env ?? BASE_ENVIRONMENT);
    } else {
        ids = [spec.z === 'MF' ? BASE_ENVIRONMENT : spec.env ?? BASE_ENVIRONMENT];
    }
    return [...new Set(ids)].flatMap(id => rangeMaterials(environmentDesign(design, currentEnvironmentOf(design, id).id)));
}

export function PlotEngine({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const pe = t.plotEngine;
    const current = useCurrentEnvironment(design);
    const curvePlot = useCurvePlot(design, evalMode, t, current.id);
    const surfacePlot = useSurfacePlot(design, evalMode, current.id);

    const span = useMemo(
        () => evaluatedLambdaSpan(surfacePlot.plotMode, curvePlot.curves, surfacePlot.surfaceSpec),
        [surfacePlot.plotMode, curvePlot.curves, surfacePlot.surfaceSpec]);
    const materials = useMemo(
        () => evaluatedMaterials(design, surfacePlot.plotMode, curvePlot.computed, surfacePlot.computedSpec),
        [design, surfacePlot.plotMode, curvePlot.computed, surfacePlot.computedSpec]);
    // Only the surface offers to widen its own range, and only while wavelength
    // is on an axis: that is the one place the window holds a single range the
    // user owns. A fixed wavelength has no range to set, and the 2D curves each
    // carry their own, so those warn without offering to change anything.
    const surfaceLambdaAxis = surfacePlot.plotMode !== '2d'
        ? lambdaAxis(surfacePlot.surfaceSpec) : null;
    const { updateSurface } = surfacePlot;
    const fixRange = useCallback(([from, to]) => {
        if (surfaceLambdaAxis === 'x') updateSurface({ xFrom: from, xTo: to });
        else if (surfaceLambdaAxis === 'y') updateSurface({ yFrom: from, yTo: to });
    }, [surfaceLambdaAxis, updateSurface]);
    const rangeNotice = useMaterialsRangeNotice(
        materials, span?.[0], span?.[1], t, surfaceLambdaAxis ? fixRange : undefined);

    const message = unavailableMessage(design, pe);
    return message
        ? h(CenteredMessage, { c, message })
        : h(PlotEngineView, {
            curvePlot, surfacePlot, design, c, t, pe,
            notices: [rangeNotice].filter(Boolean),
        });
}
