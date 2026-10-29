/**
 * The Needle Manual insertion window's model: its computation from
 * insertion.js, the P-function plot data builder, the selection's labels, and
 * the refine that polishes the stack after an insertion.
 */

import { mirrorLayers } from '../../../../utils/physics/optimizer.js';
import { DEFAULT_REFINE_METHOD } from '../../../../utils/optimizers/index.js';
import { densifyForRun } from '../../../../utils/refinement/workerInputs.js';
import { matFriendlyName, matColor } from '../synthesisShared/synthesisHelpers.js';
import { refineOffThread } from '../synthesisShared/workerRefine.js';
import { candidateDepth, scanLayerNumber, profileScan } from './insertion.js';

export {
    sideKey, enabledRows, runOperands, scanOperands, depthBoundaries, candidateDepth, insertForSelection, scanLayerNumber,
    resolveDRange, startingThickness, profileScan,
} from './insertion.js';

// The optional pass after Apply: the app's default refinement method on the
// inserted stack, at most `iters` steps, no layer below `dMin` (nm), its rows
// sampled as a Refinement run samples them at launch, so a feature narrower
// than a row's grid is seen.
export function insertionRefineJob(operands, design, dMin, iters) {
    return { method: DEFAULT_REFINE_METHOD, operands: densifyForRun(operands, design), design, iters, dMin };
}

// A symmetric design keeps its back stack the mirror of the front.
export function withMirroredBack(design) {
    return design.surfaceMode === 'symmetric'
        ? { ...design, backLayers: mirrorLayers(design.frontLayers) }
        : design;
}

// Commits the inserted stack, then runs `job` on it off the UI thread. The
// insertion is the edit: undo steps back over it, and the synthesis windows
// see it. The refine only moves thicknesses on top of it, as transient writes,
// the way a Refinement run does: one per progress report with the best point
// so far, then the result, or the inserted stack again when there is none.
// `write(patch, opts)` writes to the design the pass started on; once
// `isCurrent()` says that design is no longer the active one, nothing more is
// written and this resolves null. Aborting `signal` ends the pass on the best
// point so far. Resolves with { mfBest }, the refined stack's merit, or
// { mfBest: null } when the insertion stays unrefined: stopped before the
// first point, or the refine threw. `onProgress` gets { step, iters, mf } for
// each preview written.
export async function refineAndCommit({ inserted, job, resolveMat, signal, isCurrent, write, onProgress }) {
    write({ frontLayers: inserted.frontLayers, backLayers: inserted.backLayers });
    const preview = (p) => {
        if (!isCurrent()) return;
        write({ frontLayers: p.frontLayers, backLayers: p.backLayers }, { transient: true });
        if (onProgress) onProgress(p);
    };
    let res = null;
    try {
        res = await refineOffThread(job, resolveMat, { signal, onProgress: preview });
    } catch (err) {
        console.error('[NeedleManual] refine failed, the insertion is kept unrefined:', err);
    }
    if (!isCurrent()) return null;
    const result = res ? withMirroredBack(res.design) : inserted;
    write({ frontLayers: result.frontLayers, backLayers: result.backLayers }, { transient: true });
    return { mfBest: res ? res.mfBest : null };
}

// Run the P-function profile scan and package the result (or the "already
// optimal" status) for the caller to commit to state.
export function runNeedleScan({ operands, design, resolveMat, candidateMats, deltaNm, nIntra, side, tn }) {
    const scan = profileScan({ operands, design, resolveMat, candidateMats, deltaNm, nIntra, side });
    if (!scan) return { scan: null, statusMsg: tn.alreadyOptimal };
    const improving = scan.candidates.filter(cc => cc.grad < 0).length;
    return { scan, statusMsg: tn.scanDone(scan.candidates.length, improving) };
}

// Build renderer-neutral P-function material curves, layer boundaries
// and material bands from a completed scan result. Materials are named and
// coloured as `design` resolves them.
export function buildPlotData(scan, design = null) {
    if (!scan) return { materials: [], boundaries: [], bands: [], totalZ: 1 };
    const zb = scan.zb;
    const totalZ = zb[zb.length - 1] || 1;

    const byMat = new Map();
    for (const cand of scan.candidates) {
        const z = candidateDepth(cand, zb);
        const entry = byMat.get(cand.materialId) || [];
        entry.push({ ...cand, z });
        byMat.set(cand.materialId, entry);
    }
    const materials = [];
    for (const [matId, cands] of byMat) {
        cands.sort((a, b) => a.z - b.z);
        materials.push({
            materialId: matId, name: matFriendlyName(matId, design), color: matColor(matId, design),
            xs: cands.map(cc => cc.z), ys: cands.map(cc => cc.grad), cands,
        });
    }
    materials.sort((a, b) => (a.name < b.name ? -1 : 1));

    const bands = (scan.layers || []).map((l, k) => ({
        z0: zb[k], z1: zb[k + 1], color: matColor(l.material, design), k, materialId: l.material,
        number: scanLayerNumber(scan, k),
    }));
    return { materials, boundaries: zb, bands, totalZ };
}

// Selection → host geometry (intra-layer split or gap neighbours) + initial
// thickness range for the slider.
export function resolveHostInfo(selected, scan, dMin, tn, design = null) {
    if (!selected || !scan) return null;
    if (selected.intra) {
        const layers = scan.layers;
        const host = layers[selected.layerK];
        const dk = host?.thickness || 0;
        return {
            hostMat: host?.material,
            hostNumber: scanLayerNumber(scan, selected.layerK),
            d1: Math.max(selected.frac * dk, dMin),
            d2: Math.max((1 - selected.frac) * dk, dMin),
            hostThickness: dk,
        };
    }
    // gap → describe neighbours. Gap p sits before stored layer p, so gap 0 is
    // at the outer medium on the front and at the substrate on the back.
    const layers = scan.layers, p = selected.pos, N = layers.length;
    const name = index => matFriendlyName(layers[index]?.material, design) || '—';
    const number = index => scanLayerNumber(scan, index);
    const back = scan.side === 'back';
    let gapLabel;
    if (N === 0)      gapLabel = tn.gapBare;
    else if (p === 0) gapLabel = (back ? tn.gapSubstrate : tn.gapIncident)(number(0), name(0));
    else if (p === N) gapLabel = (back ? tn.gapExit : tn.gapSubstrate)(number(N - 1), name(N - 1));
    else              gapLabel = tn.gapBetween(number(p - 1), name(p - 1), number(p), name(p));
    return { gapLabel, hostThickness: 0 };
}

