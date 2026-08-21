/**
 * Generic T/R/A curve and parameter-surface plot builder.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { CenteredMessage } from '../chrome/layout.js';
import { useCurvePlot } from './curveState.js';
import { useSurfacePlot } from './surfaceState.js';
import { PlotEngineView } from './PlotEngineView.js';

const { createElement: h } = React;

function unavailableMessage(design, pe) {
    if (!design) return pe.noDesign;
    if (!design.frontLayers?.length && !design.backLayers?.length) return pe.noLayers;
    return null;
}

export function PlotEngine({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const pe = t.plotEngine;
    const curvePlot = useCurvePlot(design, evalMode);
    const surfacePlot = useSurfacePlot(design, evalMode);
    const message = unavailableMessage(design, pe);
    return message
        ? h(CenteredMessage, { c, message })
        : h(PlotEngineView, { curvePlot, surfacePlot, design, c, t, pe });
}
