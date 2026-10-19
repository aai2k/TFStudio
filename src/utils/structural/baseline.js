// The start of a Structural run: the starting design, smart-seeded or as it
// is, refined into the run's first best and current design.

import { buildARSeedCandidates } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { deep, sumD } from './core.js';
import { alive } from './runState.js';
import { designFor, refineJob, trueEval } from './refine.js';
import { refineGuarded } from './workers.js';

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

async function smartSeedBaseline(S) {
    if (!S.smartSeed || !S.pool.length) return null;
    const candidates = buildARSeedCandidates({
        design: S.curDes, pool: S.pool, maxLayers: S.cfg.maxLayers,
    });
    S.emit({ activity: { id: 'smartSeeding', count: candidates.length } });
    const results = [];
    for (let offset = 0; offset < candidates.length && alive(S); offset += S.workerCount) {
        const wave = candidates.slice(offset, offset + S.workerCount);
        const waveResults = await Promise.all(wave.map((candidate, index) => refineGuarded(
            S, index, refineJob(S, smartSeedDesign(S, candidate)),
            index === 0 ? S.onTick : null)));
        results.push(...waveResults);
    }
    if (!alive(S)) return null;
    const bestIndex = bestSeedIndex(results);
    if (bestIndex < 0) return null;
    const best = results[bestIndex];
    console.log('[Structural] Smart seed:', candidates.map((candidate, index) =>
        `${candidate.name}=${results[index]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
    `→ best "${candidates[bestIndex].name}" ${best.mf.toFixed(6)}`);
    return best;
}

// The starting design's row, when the history has no rows yet: the design
// every later row of the history is measured from.
function recordBaseline(S, score) {
    if (S.hasRows) return;
    S.hooks.onRow?.({
        id: Math.random().toString(36).slice(2),
        genNum: 0, mf: score.mf, omf: score.omf, dMF: null, side: S.side, seed: S.seed,
        kind: (S.smartSeed && S.pool.length) ? 'seed' : 'baseline',
        layerCount: (S.current[S.layerKey] || []).length,
        tot: sumD(S.current.frontLayers) + sumD(S.current.backLayers),
        tMs: performance.now() - S.runT0, insertMat: null,
        frontSnap: deep(S.current.frontLayers), backSnap: deep(S.current.backLayers),
        layers: deep(S.current[S.layerKey] || []),
    });
}

/**
 * Refines the starting design (smart-seeded or as it is) into the run's first
 * best and current design and reports it. Returns 'continue', 'stop' when the
 * run was stopped meanwhile, or { end } when no starting design could be
 * refined.
 */
export async function establishBaseline(S) {
    let baseline = await smartSeedBaseline(S);
    if (!alive(S)) return 'stop';
    if (!baseline) {
        const design = designFor(S, S.curDes[S.layerKey], S.curDes[S.otherKey]);
        baseline = await refineGuarded(S, 0, refineJob(S, design), S.onTick);
    }
    if (!alive(S)) return 'stop';
    if (!baseline) return { end: { stopReason: 'noMutation' } };
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
    S.emit({
        design: { frontLayers: S.current.frontLayers, backLayers: S.current.backLayers },
        mf: score.mf, mfBest: score.mf, layerCount: (S.current[S.layerKey] || []).length,
        omf: score.omf, omfBest: score.omf,
    });
    S.emit({ trend: { iter: S.trendX, cur: S.current.mf, best: S.best.mf }, redraw: true });
    recordBaseline(S, score);
    S.prevBestMF = S.best.mf;
    return 'continue';
}
