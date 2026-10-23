import { computeCurve } from '../../../../utils/physics/plotQuantities.js';
import { buildEvaluationContext } from './materialContext.js';

/**
 * Each visible curve's { x, y } for `design`, by curve id. A curve that cannot
 * be computed is drawn empty. Shared by the window and the analysis worker,
 * which computes the curves of a design under a cone of incidence.
 */
export function computeCurveResults(curves, design) {
    const ctx = buildEvaluationContext(design);
    if (!ctx) return {};
    const out = {};
    for (const cv of curves) {
        if (!cv.visible) continue;
        try {
            out[cv.id] = computeCurve(cv, ctx);
        } catch (e) {
            console.error('PlotEngine curve error:', cv.id, e);
            out[cv.id] = { x: [], y: [] };
        }
    }
    return out;
}
