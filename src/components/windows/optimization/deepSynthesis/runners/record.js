// A run's new best designs as history rows and editor previews, and its trend.

import { mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { activeRunNum } from '../../synthesisShared/runBlocks.js';
import { historyView, saveHistory } from '../historyActions.js';

// A design counts as a new best when its merit is below the last one by more
// than this fraction; less is the same design refined a little further.
const NEW_BEST_GAIN = 1e-12;

const sumNm = layers => layers.reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);

// The editor patch for engine layers: the active side with ids, and the mirror
// on the back in symmetric mode. The other side is fixed for the run.
export function designPatch(S, layers) {
    const active = layers.map((layer, i) => ({
        id: `ds-${i}`, material: layer.material, thickness: layer.thickness, locked: false,
    }));
    const patch = { [S.layerKey]: active };
    if (S.surfaceMode === 'symmetric') patch.backLayers = mirrorLayers(active);
    return patch;
}

function bestRow(ctx, S, { patch, mf, kind, move }) {
    const hist = ctx.hist;
    const design = { ...S.curDes, ...patch };
    const frontSnap = design.frontLayers || [];
    const backSnap = design.backLayers || [];
    hist.genCount += 1;
    return {
        id: Math.random().toString(36).slice(2),
        genNum: hist.genCount, runNum: activeRunNum(hist.runs), seed: S.seed,
        mf, dMF: Number.isFinite(S.bestMf) ? mf - S.bestMf : null, side: S.side,
        kind, move, layerCount: patch[S.layerKey].length,
        tot: sumNm(frontSnap) + sumNm(backSnap), tMs: performance.now() - S.runT0, insertMat: null,
        frontSnap, backSnap, layers: patch[S.layerKey],
    };
}

const isNewBest = (S, layers, mf) =>
    !!layers && layers.length <= S.cfg.maxLayers && mf < S.bestMf * (1 - NEW_BEST_GAIN);

// Record `layers` when it is the best design of the run so far and within the
// layer cap: a history row, a live preview in the editor, and the design the
// next Run continues from. `kind` names the phase or 'search'; `move` the
// search's destroy and repair.
export function recordBest(ctx, S, { layers, mf, kind, move = null }) {
    if (!isNewBest(S, layers, mf)) return;
    const patch = designPatch(S, layers);
    ctx.updateDesign(patch, { transient: true });
    ctx.hist.baseDesign = { ...(ctx.hist.baseDesign || ctx.designRef.current), ...patch };
    const row = bestRow(ctx, S, { patch, mf, kind, move });
    S.bestMf = mf;
    S.bestLayers = layers;
    ctx.hist.rows = [...ctx.hist.rows, row];
    const { rows, top, mfBest } = historyView(ctx.hist, null);
    ctx.publish({ rows, top, mfBest, mf, layerCount: layers.length });
    saveHistory(ctx);
}

// One trend point per GE step and search round: the design the method works
// on and the best so far, both MF.
export function pushTrend(ctx, S, { cur, best }) {
    S.trendX += 1;
    ctx.hist.trend = [...ctx.hist.trend, { iter: S.trendX, cur, best, runNum: activeRunNum(ctx.hist.runs) }];
    ctx.publish({ trend: ctx.hist.trend });
}
