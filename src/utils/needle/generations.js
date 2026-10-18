// The generation rows a Needle run reports: one per accepted needle, and a
// closing row for a final winner no accepted generation shows.

const sameLayers = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const totalOf = layers => (layers || []).reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);

// ΔMF from the best so far, which then follows the new merit down.
function stepFromBest(run, mf) {
    const dMF = run.prevBestMF === Infinity ? null : mf - run.prevBestMF;
    run.prevBestMF = Math.min(run.prevBestMF, mf);
    return dMF;
}

function publish(run, row) {
    run.rows.push(row);
    run.hooks.onGeneration?.(row);
}

/**
 * Record the generation `run.best` now holds: its merit, the merits of the
 * full design on both sides, and the side and material of the needle that made
 * it. The first generation after a thin-start rescue is marked `rescued`, so a
 * history shows why it can read worse than the one before it.
 */
export function recordGeneration(run, { omf, side, insertMat }) {
    const { best } = run;
    run.genNum += 1;
    const activeLayers = best[side === 'back' ? 'backLayers' : 'frontLayers'];
    const row = {
        genNum: run.genNum, mf: best.mf, omf, dMF: stepFromBest(run, best.mf),
        rescued:    run.markRescue || undefined,
        side,
        layerCount: activeLayers.length,
        tot:        totalOf(best.frontLayers) + totalOf(best.backLayers),
        tMs:        performance.now() - run.runT0,
        insertMat,
        layers:     run.deep(activeLayers),         // active-side snapshot
        frontSnap:  run.deep(best.frontLayers),     // full-design snapshot
        backSnap:   run.deep(best.backLayers),
    };
    run.markRescue = false;
    publish(run, row);
}

/**
 * A smart seed or the design kept aside by a thin-start rescue can be the
 * run's final winner with no accepted generation showing it. Such a winner is
 * recorded as the closing row, so a history, its best row and the design the
 * run ends on all agree. A winner that a row of this run, or of the history it
 * carries on, already shows is not recorded twice.
 */
export function recordFinalWinner(run, best, rescuedReturn) {
    const frontSnap = run.deep(best.frontLayers || []);
    const backSnap = run.deep(best.backLayers || []);
    const represented = run.rows.some(g =>
        Math.abs(g.mf - best.mf) < 1e-12 &&
        sameLayers(g.frontSnap, frontSnap) && sameLayers(g.backSnap, backSnap));
    if (represented) return;

    run.genNum += 1;
    const side = run.scanSides?.[0] || 'front';
    const activeLayers = side === 'back' ? backSnap : frontSnap;
    publish(run, {
        genNum: run.genNum,
        mf: best.mf,
        omf: best.omf ?? null,
        dMF: stepFromBest(run, best.mf),
        rescued: rescuedReturn || undefined,
        final: true,
        side,
        layerCount: activeLayers.length,
        tot: totalOf(frontSnap) + totalOf(backSnap),
        tMs: performance.now() - run.runT0,
        insertMat: null,
        layers: run.deep(activeLayers),
        frontSnap,
        backSnap,
    });
}
