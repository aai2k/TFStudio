import { buildARSeedCandidates, computePareto } from '../../synthesisShared/synthesisHelpers.js';
import { alive, deep, sumD } from './runUtils.js';
import { designFor, refineJob, onTick, trueEval } from './refine.js';
import { refineGuarded } from './workerLifecycle.js';

function smartSeedDesign(S, candidate) {
    const activeLayers = candidate.name === 'current'
        ? S.curDes[S.layerKey]
        : (S.layerKey === 'frontLayers'
            ? candidate.frontLayers
            : (candidate.backLayers.length ? candidate.backLayers : candidate.frontLayers));
    return designFor(S, activeLayers, S.curDes[S.otherKey]);
}

function bestSeedIndex(results) {
    let bestIndex = -1;
    for (let i = 0; i < results.length; i++) {
        if (results[i] && (bestIndex < 0 || results[i].mf < results[bestIndex].mf)) bestIndex = i;
    }
    return bestIndex;
}

async function smartSeedBaseline(ctx, S) {
    if (!S.smartSeed || !S.pool.length) return null;
    const candidates = buildARSeedCandidates({
        design: S.curDes, pool: S.pool, maxLayers: S.cfg.maxLayers,
    });
    ctx.setStatusMsg(S.ts.smartSeeding(candidates.length));
    const results = [];
    for (let offset = 0; offset < candidates.length && alive(ctx, S); offset += S.workerCount) {
        const wave = candidates.slice(offset, offset + S.workerCount);
        const waveResults = await Promise.all(wave.map((candidate, index) => refineGuarded(
            ctx, S, index, refineJob(S, smartSeedDesign(S, candidate)),
            index === 0 ? message => onTick(ctx, S, message) : null)));
        results.push(...waveResults);
    }
    if (!alive(ctx, S)) return null;
    const bestIndex = bestSeedIndex(results);
    if (bestIndex < 0) return null;
    const best = results[bestIndex];
    console.log('[Structural] Smart seed:', candidates.map((candidate, index) =>
        `${candidate.name}=${results[index]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
    `→ best "${candidates[bestIndex].name}" ${best.mf.toFixed(6)}`);
    return best;
}

export function recordBaseline(ctx, S, score) {
    if (ctx.gensRef.current.length) return;
    const generation = {
        id: Math.random().toString(36).slice(2),
        genNum: 0, mf: score.mf, omf: score.omf, dMF: null, side: S.side,
        kind: (S.smartSeed && S.pool.length) ? 'seed' : 'baseline',
        layerCount: (S.current[S.layerKey] || []).length,
        tot: sumD(S.current.frontLayers) + sumD(S.current.backLayers),
        tMs: performance.now() - S.runT0, insertMat: null,
        frontSnap: deep(S.current.frontLayers), backSnap: deep(S.current.backLayers),
        layers: deep(S.current[S.layerKey] || []),
    };
    ctx.gensRef.current = [generation];
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.saveCache();
}

/** Refines the starting design (smart-seeded or as-is) into the run's baseline
 * best/current candidate. `finalize` is injected by the caller (the iteration loop
 * owns run termination) and is invoked if no baseline could be produced at all. */
export async function establishBaseline(ctx, S, finalize) {
    let baseline = await smartSeedBaseline(ctx, S);
    if (!alive(ctx, S)) return false;
    if (!baseline) {
        const design = designFor(S, S.curDes[S.layerKey], S.curDes[S.otherKey]);
        baseline = await refineGuarded(
            ctx, S, 0, refineJob(S, design), message => onTick(ctx, S, message));
    }
    if (!alive(ctx, S)) return false;
    if (!baseline) {
        finalize(ctx, S, S.ts.statusNoMut);
        return false;
    }
    const score = trueEval(
        S, baseline.frontLayers, baseline.backLayers, baseline.mf, baseline.omf ?? null);
    S.current = {
        mf: score.mf, omf: score.omf,
        frontLayers: deep(baseline.frontLayers), backLayers: deep(baseline.backLayers),
    };
    S.best = {
        mf: score.mf, omf: score.omf,
        frontLayers: deep(baseline.frontLayers), backLayers: deep(baseline.backLayers),
    };
    ctx.updateDesignRef.current({
        frontLayers: S.current.frontLayers, backLayers: S.current.backLayers,
    }, { transient: true });
    ctx.setMf(score.mf);
    ctx.setMfBest(score.mf);
    ctx.setLayerCount((S.current[S.layerKey] || []).length);
    ctx.setOmf(score.omf);
    ctx.setOmfBest(score.omf);
    S.trendX = ctx.trendRef.current.length
        ? ctx.trendRef.current[ctx.trendRef.current.length - 1].iter
        : 0;
    ctx.trendRef.current = [
        ...ctx.trendRef.current,
        { iter: S.trendX, cur: S.current.mf, best: S.best.mf },
    ];
    ctx.setTrend(ctx.trendRef.current.slice());
    recordBaseline(ctx, S, score);
    S.prevBestMF = S.best.mf;
    return true;
}
