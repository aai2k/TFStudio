// Refined proposals that come back to the current design. Most perturbs and
// many needles refine into the basin they started from; such a result carries
// no structural change, so the accept test must not spend an iteration on it.
// When it comes back lower, it is the current design converged further.
import { tidyLayers } from '../../../../../utils/synthesis/structuralOptimizer.js';
import { normalizeResult } from './refine.js';

// A refined proposal whose layers all sit within this distance of the current
// design's, in the same material order, is the current design again (nm).
const SAME_DESIGN_NM = 0.5;

export function isCurrentDesign(S, result) {
    const raw = S.layerKey === 'frontLayers' ? result.frontLayers : result.backLayers;
    const next = tidyLayers(raw || [], S.cfg.dMin);
    const cur = tidyLayers(S.current[S.layerKey] || [], S.cfg.dMin);
    return next.length === cur.length && next.every((layer, i) =>
        layer.material === cur[i].material
        && Math.abs(layer.thickness - cur[i].thickness) <= SAME_DESIGN_NM);
}

// Splits a batch of refined results into `best`, the lowest that changed the
// design, and `polish`, the lowest that came back to it.
export function splitRefined(S, results) {
    let best = null;
    let polish = null;
    for (const item of results) {
        if (!item || item.result.mf == null) continue;
        if (isCurrentDesign(S, item.result)) {
            if (!polish || item.result.mf < polish.result.mf) polish = item;
        } else if (!best || item.result.mf < best.result.mf) {
            best = item;
        }
    }
    return { best, polish };
}

// The current design takes a result that came back lower. It is not a move: it
// counts no attempt, and when it is a new best the count of iterations without
// improvement keeps running, so refining one design alone cannot hold a run
// open. Returns true when the target merit is reached.
export function adoptPolish(ctx, S, polish, recordBest) {
    const candidate = normalizeResult(S, polish.result);
    if (!(candidate.mf < S.current.mf - 1e-12)) return false;
    S.current = candidate;
    if (!(candidate.mf < S.best.mf - 1e-12)) return false;
    const stalled = S.noImprove;
    const reached = recordBest(ctx, S, candidate, { kind: 'perturb', insertMat: null });
    S.noImprove = stalled;
    return reached;
}
