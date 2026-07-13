/**
 * Generic T/R/A curve and parameter-surface plot builder.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useCurvePlot } from './curveState.js';
import { useSurfacePlot } from './surfaceState.js';
import { PlotEngineView } from './PlotEngineView.js';

const { createElement: h } = React;

function placeholder(message, c) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        },
    }, message);
}

function unavailableMessage(design, pe) {
    if (!design) return pe.noDesign || 'No design selected.';
    if (!design.frontLayers?.length && !design.backLayers?.length) return pe.noLayers || 'No layers in design.';
    return null;
}

export function PlotEngine({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const pe = (t && t.plotEngine) || {};
    const curvePlot = useCurvePlot(design, evalMode);
    const surfacePlot = useSurfacePlot(design, evalMode);
    const message = unavailableMessage(design, pe);
    return message
        ? placeholder(message, c)
        : h(PlotEngineView, { curvePlot, surfacePlot, design, c, t, pe });
}
