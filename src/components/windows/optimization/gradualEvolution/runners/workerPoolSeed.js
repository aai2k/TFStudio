// Seed-refinement phase of the worker-pool Gradual-Evolution engine: refines
// the starting design (optionally via a parallel smart-seed search) before the
// outer needle/GE loop begins. See workerPool.js.

import { getSynthesisSmartSeed } from '../../../../../utils/synthesis/synthesisConfig.js';
import { buildARSeedCandidates } from '../../synthesisShared/synthesisHelpers.js';
import { deep, mkLayers, designSnap, alive, onTick, applyDesignPatch, recordCycle } from './workerPoolCore.js';

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
// pool (off the UI thread — never blocks, and scales with the pool), then begin
// synthesis from whichever scores best. The current design is a candidate, so
// the seed can only match or improve the starting point. Disabled in
// preserve-bulk (that mode deliberately keeps the user's thick seed intact and
// must not be replaced). Returns `{ stopped: true }` if the pool died mid-scan,
// `{ result }` if a candidate won, or `{}` if none refined (caller falls back
// to the plain seed run).
async function smartSeedResult(ctx, S, seedSide, seedIter) {
    const cands = buildARSeedCandidates({ design: S.curDes, pool: S.pool, maxLayers: S.maxLayers });
    ctx.setStatusMsg(S.tg.smartSeeding(cands.length));
    const seedJobs = cands.map(cd => ({
        type: 'seedDls', operands: S.operands,
        design: designSnap(S, mkLayers(cd.frontLayers), mkLayers(cd.backLayers)),
        materials: S.materials, dMin: S.dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: S.innerEngine,
    }));
    const seedResults = await S.workerPool.map(seedJobs, (i, m) => onTick(ctx, S, i, m));
    if (!alive(ctx, S)) return { stopped: true };
    const bi = pickBestSeedResult(seedResults);
    if (bi < 0) return {};
    console.log('[GE] Smart seed:', cands.map((cd, i) =>
        `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
        `→ best "${cands[bi].name}" ${seedResults[bi].mf.toFixed(6)}`);
    return { result: seedResults[bi] };
}

// Apply the winning seed result to `work` + `best`, and record it as the first
// history row so its contribution is visible — otherwise a strong smart-seed
// (or a refined start) leaves the cycles table empty and the run looks like
// "nothing happened" when the seed WAS the win. Fresh runs only (resume carries
// cycles).
function applySeedResult(ctx, S, sres, seedSide) {
    S.gotProgress = true;
    S.work.mf = sres.mf;
    S.work.frontLayers = deep(sres.frontLayers || []);
    S.work.backLayers  = deep(sres.backLayers  || []);
    S.best.mf = sres.mf;
    S.best.frontLayers = deep(S.work.frontLayers);
    S.best.backLayers  = deep(S.work.backLayers);
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(sres.mf); ctx.setMfBest(sres.mf);
    if (sres.omf != null) { ctx.setOmf(sres.omf); ctx.setOmfBest(sres.omf); }
    const seedTotal = S.work.frontLayers.length + S.work.backLayers.length;
    ctx.setLayerCount(seedTotal);
    console.log(`[GE Seed] ${S.innerEngine.toUpperCase()} ${sres.iters} iters, MF=${sres.mf.toFixed(6)}`);
    if (!ctx.cyclesRef.current.length) {
        const seedActive = (seedSide === 'back' ? S.work.backLayers : S.work.frontLayers);
        recordCycle(ctx, S, {
            type: (getSynthesisSmartSeed('ge') && !S.preserveBulk) ? 'seed' : 'baseline',
            mf: sres.mf, layerCount: seedTotal, insertMat: null, side: seedSide, activeLayers: seedActive, omf: sres.omf ?? null,
        });
    }
}

export async function seedPhase(ctx, S) {
    const seedSide = S.scanSides[0];
    // preserve-bulk: dlsIter:0 → evaluate the seed MF only, leave the thick bulk
    // intact (refining the bare seed collapses it).
    const seedIter = S.preserveBulk ? 0 : S.dlsIter;
    ctx.setPhase('refining');
    let sres;
    if (getSynthesisSmartSeed('ge') && !S.preserveBulk) {
        const smart = await smartSeedResult(ctx, S, seedSide, seedIter);
        if (smart.stopped) return null;
        sres = smart.result;
    }
    if (!sres) {
        ctx.setStatusMsg(S.preserveBulk ? 'Seed (bulk preserved)…' : 'Seed refinement…');
        sres = await S.workerPool.run({
            type: 'seedDls', operands: S.operands,
            design: designSnap(S, mkLayers(S.curDes.frontLayers), mkLayers(S.curDes.backLayers)),
            materials: S.materials, dMin: S.dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: S.innerEngine,
        }, (m) => onTick(ctx, S, 0, m));
    }
    if (!alive(ctx, S)) return null;
    applySeedResult(ctx, S, sres, seedSide);
    return sres;
}
