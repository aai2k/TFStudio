// The scan phase of a Needle run: the optional smart starting design, then one
// needle scan across the scanned sides and pool slices in parallel, which
// leaves the queue of improving needles for the refine phase (refine.js).

import { buildARSeedCandidates } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { cullMarginalNeedles, SYNTHESIS_INTRA_SAMPLES } from '../synthesis/synthesisConfig.js';
import { alive } from './runState.js';

// Smart seed: refine the canonical QW/HW AR starting designs (plus the current
// design) in parallel on the pool and begin from whichever scores best. Seeds
// `best`; returns false if a Stop tore the run down mid-seed.
export async function smartSeed(run) {
    const { best } = run;
    const cands = buildARSeedCandidates({ design: run.curDes, pool: run.pool, maxLayers: run.maxLayers });
    run.emit({ phase: 'refining', activity: { id: 'smartSeeding', count: cands.length } });
    const seedJobs = cands.map(cd => ({
        type: 'seedDls', operands: run.operands,
        design: run.designSnap(run.mkLayers(cd.frontLayers), run.mkLayers(cd.backLayers)),
        materials: run.materials, dMin: run.dMin, dlsIter: run.refineIter,
        jobId: 'seed', side: run.scanSides[0], engine: run.innerEngine,
    }));
    const seedResults = await run.workerPool.map(seedJobs, run.onTick);
    if (!alive(run)) return false;
    let bi = -1;
    for (let i = 0; i < seedResults.length; i++) {
        const r = seedResults[i];
        if (r && (bi < 0 || r.mf < seedResults[bi].mf)) bi = i;
    }
    if (bi >= 0) {
        const r = seedResults[bi];
        best.mf = r.mf;
        best.omf = r.omf ?? null;
        best.frontLayers = run.deep(r.frontLayers || []);
        best.backLayers  = run.deep(r.backLayers  || []);
        run.emit({
            design: { frontLayers: best.frontLayers, backLayers: best.backLayers },
            mf: r.mf, mfBest: r.mf,
            layerCount: (best.frontLayers.length || 0) + (best.backLayers.length || 0),
        });
        run.gotProgress = true;
        console.log('[Needle] Smart seed:', cands.map((cd, i) =>
            `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
            `→ best "${cands[bi].name}" ${r.mf.toFixed(6)}`);
    }
    return true;
}

// One parallel scan cycle: cap check → fan the needle scan across sides × pool
// slices → merge, seed the baseline best, and build the improving-needle queue
// (best ΔMF first, marginal tail culled). Returns a signal for the cycle loop.
export async function scanCycle(run) {
    const { best } = run;
    const baseFront = best.frontLayers || run.mkLayers(run.curDes.frontLayers);
    const baseBack  = best.backLayers  || run.mkLayers(run.curDes.backLayers);
    // Max-layers stop: in both_independent each side caps independently; if
    // EITHER still has room we continue.
    const remainingSides = run.scanSides.filter(sd =>
        (sd === 'front' ? baseFront.length : baseBack.length) < run.maxLayers);
    if (remainingSides.length === 0) return { done: true, end: { stopReason: 'maxLayers' } };

    run.emit({ phase: 'scanning', activity: { id: 'scanning' } });
    const snap = run.designSnap(baseFront, baseBack);
    const scanJobs = [];
    for (const sd of remainingSides) {
        for (const slice of run.poolSlices) {
            scanJobs.push({ type: 'scan', operands: run.operands, design: snap,
                materials: run.materials, poolSlice: slice, deltaNm: run.deltaNm, side: sd,
                dMin: run.dMin, nIntra: SYNTHESIS_INTRA_SAMPLES });
        }
    }
    const scanRes = await run.workerPool.map(scanJobs);
    if (!alive(run)) return { aborted: true };
    run.gotProgress = true;
    let candidates = [];
    for (const r of scanRes) candidates = candidates.concat(r.candidates || []);
    const mf0 = scanRes.length ? scanRes[0].mf0 : Infinity;
    if (best.frontLayers === null && best.backLayers === null) {
        best.mf = mf0;
        best.frontLayers = run.deep(baseFront);
        best.backLayers  = run.deep(baseBack);
    }
    // Global best needle: most negative ΔMF wins regardless of side. Then cull
    // the marginal tail (needle sensitivity; no-op when 'off').
    const queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) =>
            (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
            (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
        run.sensFloor);
    if (queue.length === 0) return { done: true, end: { stopReason: 'needleOptimal' } };
    return { queue };
}
