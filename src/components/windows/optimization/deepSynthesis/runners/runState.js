import { randomSeed } from '../../../../../utils/physics/errorAnalysis/mcConfig.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { planRun } from '../../../../../utils/synthesis/deepSynthesis/settings.js';
import { prepareRun } from '../../../../../utils/synthesis/deepSynthesis/setup.js';
import { getPoolMaterials } from '../../synthesisShared/catalogPool.js';
import { activeBaseline, openRunBlock } from '../../synthesisShared/runBlocks.js';
import { reconcileWithEdits } from '../historyActions.js';

// The window's settings as the run takes them. The window gives the floor and
// the layer cap; the guard test also names the seed, the thread count and a
// smaller search budget (method).
function settingsOf(ctx, curDes) {
    const cfg = ctx.cfgRef.current;
    return {
        pool: getPoolMaterials(ctx.selectedCatsRef.current, { excluded: ctx.excludedMatsRef.current, design: curDes }),
        dMin: cfg.dMin, maxLayers: cfg.maxLayers, seed: cfg.seed ?? null,
        threads: cfg.threads ?? getThreadCount(), method: cfg.method ?? {},
    };
}

// Why a run cannot start, in the status line: a locked layer, an empty pool,
// no optical operand, or materials that could not be sampled.
function refusalText(td, failed) {
    return failed === 'presampleFailed' ? td.statusPresampleFailed : td.blocked[failed];
}

// Open a run block for this press unless one is still open from a Stop. The
// block records the design the press started from, which Reset restores.
export function openBlock(ctx, S) {
    const hist = ctx.hist;
    if (hist.runOpen) return;
    ctx.checkpoint?.();
    hist.runs = openRunBlock(hist.runs, ctx.designRef.current);
    Object.assign(hist, { savedDesign: activeBaseline(hist.runs), baseDesign: S.curDes, genCount: 0, runOpen: true });
    ctx.publish({ canReset: true });
}

const lastOf = list => list[list.length - 1];

// Everything a run needs (utils/synthesis/deepSynthesis/setup.js), or null
// when it cannot start (the status says why). The run block is opened once the
// run worker has loaded (runWorker.js).
export function createRunState(ctx) {
    reconcileWithEdits(ctx);
    const curDes = ctx.hist.baseDesign || ctx.designRef.current;
    if (!curDes) return null;
    const plan = planRun(settingsOf(ctx, curDes));
    const prep = prepareRun(curDes, ctx.operandsRef.current, plan);
    if (prep.failed) {
        ctx.publish({ statusMsg: refusalText(ctx.td, prep.failed) });
        return null;
    }
    return {
        cfg: { maxLayers: plan.maxLayers, dMin: prep.dMin, dMax: prep.dMax },
        curDes, ev: prep.ev, pool: plan.pool, method: plan.method, seed: plan.seed ?? randomSeed(),
        source: prep.source, side: prep.side, layerKey: prep.layerKey, surfaceMode: prep.surfaceMode, start: prep.start,
        runId: ++ctx.runIdRef.current, threads: plan.threads,
        runT0: performance.now() - (lastOf(ctx.hist.rows)?.tMs || 0),
        trendX: lastOf(ctx.hist.trend)?.iter ?? 0,
        parts: prep.parts, phase: null, steps: 0,
        bestMf: Infinity, bestLayers: null,
    };
}
