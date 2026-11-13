import { BASE_ENVIRONMENT } from '../../../../utils/environments/environments.js';
import { SWEEP, computeCurve, normalizeCurve } from '../../../../utils/physics/plotQuantities.js';
import { buildEvaluationContext } from './materialContext.js';

/**
 * Each visible curve's { x, y } for `design`, by curve id. A curve that cannot
 * be computed, one naming an environment `design` lacks among them, is drawn
 * empty. Quick curves are computed where the window runs,
 * the rest in the analysis worker (curveState.js). On a design with
 * environments a curve is computed in the environment its `env` names,
 * environment 1 without one, and reads the merit function as its `meritEnv`
 * says (meritSurface.js).
 */
export function computeCurveResults(curves, design) {
    const base = buildEvaluationContext(design);
    if (!base) return {};
    const contexts = new Map([[BASE_ENVIRONMENT, base]]);
    const contextIn = (env = BASE_ENVIRONMENT) => {
        if (!contexts.has(env)) contexts.set(env, buildEvaluationContext(design, env));
        return contexts.get(env);
    };
    const out = {};
    for (const cv of curves) {
        if (!cv.visible) continue;
        try {
            out[cv.id] = computeCurve(cv, contextIn(cv.env));
        } catch (e) {
            console.error('PlotEngine curve error:', cv.id, e);
            out[cv.id] = { x: [], y: [] };
        }
    }
    return out;
}

/**
 * The settings that decide a curve's numbers, as one string: all of it but its
 * name and how it is drawn. Two curves with the same key draw the same line.
 */
export function curveKey(curve) {
    const { id, label, color, dash, width, visible, ...computed } = normalizeCurve(curve);
    return JSON.stringify(computed);
}

/**
 * The curves still to compute, by key: one visible curve for each key `byKey`
 * holds no result under.
 */
export function curvesToCompute(curves, byKey) {
    const pending = new Map();
    for (const curve of curves) {
        if (!curve.visible) continue;
        const key = curveKey(curve);
        if (!byKey?.[key] && !pending.has(key)) pending.set(key, curve);
    }
    return pending;
}

/**
 * What a curve's line is drawn against, as one string: each axis's quantity in
 * its polarization and on its side, the swept value by what is swept.
 */
function axesOf(curve) {
    const { x, y, sweep } = normalizeCurve(curve);
    const axis = ({ quantity, polarization, side }) =>
        (quantity === SWEEP ? [quantity, sweep] : [quantity, polarization, side]);
    return JSON.stringify([axis(x), axis(y)]);
}

/**
 * What the window keeps once `computed` (by curve id, for the curves `sent`)
 * comes back for `design`: each result by key, for that design, and the line
 * each curve last drew, by its id, with the axes it was drawn on. Both hold the
 * curves in `curves` and no others.
 */
export function mergeCurveResults(kept, design, sent, computed, curves) {
    const previous = kept?.design === design ? kept.byKey : {};
    const fresh = {};
    for (const curve of sent) {
        if (computed[curve.id]) fresh[curveKey(curve)] = computed[curve.id];
    }
    const byKey = {};
    const byId = {};
    for (const curve of curves) {
        const key = curveKey(curve);
        const result = fresh[key] || previous[key];
        if (result) byKey[key] = result;
        const last = result ? { line: result, axes: axesOf(curve) } : kept?.byId?.[curve.id];
        if (last) byId[curve.id] = last;
    }
    return { design, byKey, byId };
}

// The line a curve drew last, while it still plots what that line shows.
function lastLine(kept, curve) {
    const last = kept?.byId?.[curve.id];
    return last?.axes === axesOf(curve) ? last.line : null;
}

/**
 * What each visible curve draws, by id: its result for `design`, or while one
 * is `waiting` to come back, the line it drew last, if that line plots the
 * same quantities. A curve moved onto another quantity draws nothing until its
 * own line comes back.
 */
export function shownCurveResults(curves, kept, design, waiting) {
    const byKey = kept?.design === design ? kept.byKey : null;
    const shown = {};
    for (const curve of curves) {
        if (!curve.visible) continue;
        const result = byKey?.[curveKey(curve)] || (waiting ? lastLine(kept, curve) : null);
        if (result) shown[curve.id] = result;
    }
    return shown;
}
