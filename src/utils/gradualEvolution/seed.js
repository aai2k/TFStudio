// The seed phase of a Gradual Evolution run: the starting design refined
// (optionally through a parallel smart-seed search) before the outer
// needle/GE loop begins.

import { buildARSeedCandidates } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { deep, mkLayers, designSnap, reportDesign, recordCycle } from './core.js';
import { alive } from './runState.js';

function pickBestSeedResult(seedResults) {
    let bi = -1;
    for (let i = 0; i < seedResults.length; i++) {
        const r = seedResults[i];
        if (r && (bi < 0 || r.mf < seedResults[bi].mf)) bi = i;
    }
    return bi;
}

// Smart seed: generate the canonical QW/HW antireflection starting designs from
// the pool PLUS the current design, refine them ALL IN PARALLEL on the worker
// pool, then begin synthesis from whichever scores best. The current design is
// a candidate, so the seed can only match or improve the starting point.
// Disabled in preserve-bulk (that mode deliberately keeps the user's thick
// seed intact and must not be replaced). Returns `{ stopped: true }` if the
// pool died mid-scan, `{ result }` if a candidate won, or `{}` if none refined
// (caller falls back to the plain seed run).
async function smartSeedResult(S, seedSide, seedIter) {
    const cands = buildARSeedCandidates({ design: S.curDes, pool: S.pool, maxLayers: S.maxLayers });
    S.emit({ activity: { id: 'smartSeeding', count: cands.length } });
    const seedJobs = cands.map(cd => ({
        type: 'seedDls', operands: S.operands,
        design: designSnap(S, mkLayers(cd.frontLayers), mkLayers(cd.backLayers)),
        materials: S.materials, dMin: S.dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: S.innerEngine,
    }));
    const seedResults = await S.workerPool.map(seedJobs, S.onTick);
    if (!alive(S)) return { stopped: true };
    const bi = pickBestSeedResult(seedResults);
    if (bi < 0) return {};
    console.log('[GE] Smart seed:', cands.map((cd, i) =>
        `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
        `→ best "${cands[bi].name}" ${seedResults[bi].mf.toFixed(6)}`);
    return { result: seedResults[bi] };
}

// Apply the winning seed result to `work` + `best`, and record it as the first
// history row so its contribution is visible: otherwise a strong smart-seed
// (or a refined start) leaves the history empty and the run looks like
// "nothing happened" when the seed WAS the win. Only when the history has no
// rows yet (a resumed history carries its rows).
function applySeedResult(S, sres, seedSide) {
    S.gotProgress = true;
    S.work.mf = sres.mf;
    S.work.frontLayers = deep(sres.frontLayers || []);
    S.work.backLayers  = deep(sres.backLayers  || []);
    S.best.mf = sres.mf;
    S.best.frontLayers = deep(S.work.frontLayers);
    S.best.backLayers  = deep(S.work.backLayers);
    const seedTotal = S.work.frontLayers.length + S.work.backLayers.length;
    reportDesign(S, S.work.frontLayers, S.work.backLayers, {
        mf: sres.mf, mfBest: sres.mf,
        ...(sres.omf != null ? { omf: sres.omf, omfBest: sres.omf } : {}),
        layerCount: seedTotal,
    });
    console.log(`[GE Seed] ${S.innerEngine.toUpperCase()} ${sres.iters} iters, MF=${sres.mf.toFixed(6)}`);
    if (!S.hasRows) {
        const seedActive = (seedSide === 'back' ? S.work.backLayers : S.work.frontLayers);
        recordCycle(S, {
            type: (S.smartSeed && !S.preserveBulk) ? 'seed' : 'baseline',
            mf: sres.mf, layerCount: seedTotal, insertMat: null, side: seedSide, activeLayers: seedActive, omf: sres.omf ?? null,
        });
    }
}

export async function seedPhase(S) {
    const seedSide = S.scanSides[0];
    // preserve-bulk: dlsIter:0 → evaluate the seed MF only, leave the thick bulk
    // intact (refining the bare seed moves it for almost no merit gain;
    // seedMode.js).
    const seedIter = S.preserveBulk ? 0 : S.dlsIter;
    S.emit({ phase: 'refining' });
    let sres;
    if (S.smartSeed && !S.preserveBulk) {
        const smart = await smartSeedResult(S, seedSide, seedIter);
        if (smart.stopped) return null;
        sres = smart.result;
    }
    if (!sres) {
        S.emit({ activity: { id: S.preserveBulk ? 'seedKeptBulk' : 'seedRefining' } });
        sres = await S.workerPool.run({
            type: 'seedDls', operands: S.operands,
            design: designSnap(S, mkLayers(S.curDes.frontLayers), mkLayers(S.curDes.backLayers)),
            materials: S.materials, dMin: S.dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: S.innerEngine,
        }, (m) => S.onTick(0, m));
    }
    if (!alive(S)) return null;
    applySeedResult(S, sres, seedSide);
    return sres;
}
