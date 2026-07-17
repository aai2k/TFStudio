import {
    deepTemperature, temperatureAt, stagnationAction, basinKick,
} from '../../../../../utils/synthesis/structuralOptimizer.js';
import { computePareto, minOmfOf } from '../../synthesisShared/synthesisHelpers.js';
import { alive, deep, sumD } from './runUtils.js';
import { refineScore } from './refine.js';
import { generateProposals, refineProposals, acceptProposal } from './proposals.js';
import { establishBaseline } from './baseline.js';

const HARD_CAP = 2_000_000;

function commitBest(ctx, S) {
    if (S.best.frontLayers || S.best.backLayers) {
        const patch = {};
        if (S.best.frontLayers) patch.frontLayers = S.best.frontLayers;
        if (S.best.backLayers) patch.backLayers = S.best.backLayers;
        ctx.updateDesignRef.current(patch, { transient: true });
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
        ctx.setMf(S.best.mf);
        ctx.setMfBest(S.best.mf);
        ctx.setLayerCount((S.best[S.layerKey] || []).length);
        if (S.best.omf != null) {
            ctx.setOmf(S.best.omf);
            ctx.setOmfBest(S.best.omf);
        }
    }
    ctx.saveCache();
}

function finalize(ctx, S, reason) {
    if (ctx.runIdRef.current !== S.runId) return;
    commitBest(ctx, S);
    ctx.runningRef.current = false;
    ctx.killWorkers();
    ctx.setRunning(false);
    ctx.setTemp(null);
    ctx.setCanReset(true);
    ctx.setStatusMsg(reason || S.ts.statusDone);
}

function recordBest(ctx, S, candidate, mutation) {
    S.noImprove = 0;
    S.best = {
        mf: candidate.mf, omf: candidate.omf,
        frontLayers: deep(candidate.frontLayers), backLayers: deep(candidate.backLayers),
    };
    ctx.updateDesignRef.current({
        frontLayers: S.best.frontLayers, backLayers: S.best.backLayers,
    }, { transient: true });
    ctx.setMf(candidate.mf);
    ctx.setOmf(candidate.omf);
    ctx.setLayerCount((S.best[S.layerKey] || []).length);
    ctx.genCountRef.current += 1;
    const dMF = S.prevBestMF === Infinity ? null : candidate.mf - S.prevBestMF;
    S.prevBestMF = candidate.mf;
    const generation = {
        id: Math.random().toString(36).slice(2),
        genNum: ctx.genCountRef.current,
        mf: candidate.mf, omf: candidate.omf, dMF, side: S.side,
        kind: mutation.kind,
        layerCount: (S.best[S.layerKey] || []).length,
        tot: sumD(candidate.frontLayers) + sumD(candidate.backLayers),
        tMs: performance.now() - S.runT0,
        insertMat: mutation.insertMat ?? null,
        frontSnap: deep(candidate.frontLayers), backSnap: deep(candidate.backLayers),
        layers: deep(S.best[S.layerKey] || []),
    };
    ctx.gensRef.current = [...ctx.gensRef.current, generation];
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setMfBest(S.best.mf);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.saveCache();
    return S.best.mf < S.cfg.targetMF;
}

function updateIterationState(ctx, S, iteration) {
    if (S.current.mf > S.best.mf * 1.3) {
        S.current = {
            mf: S.best.mf, omf: S.best.omf,
            frontLayers: deep(S.best.frontLayers), backLayers: deep(S.best.backLayers),
        };
    }
    ctx.trendRef.current = [
        ...ctx.trendRef.current,
        { iter: ++S.trendX, cur: S.current.mf, best: S.best.mf },
    ];
    if (iteration % 2 === 0 || S.noImprove === 0) ctx.setTrend(ctx.trendRef.current.slice());
    ctx.setAccRate(S.attempts ? S.accepts / S.attempts : null);
}

async function reheat(ctx, S, iteration) {
    S.reheatCount += 1;
    ctx.setReheats(S.reheatCount);
    ctx.setStatusMsg(S.ts.statusReheat(S.reheatCount));
    const kicked = basinKick(deep(S.best[S.layerKey] || []), {
        rng: S.rng, pool: S.poolLite, dMin: S.cfg.dMin, dMax: S.cfg.dMax,
        addMaxNm: S.cfg.addMaxNm, jitterPct: S.cfg.jitterPct,
        kinds: S.kinds, maxKick: 3,
    });
    const result = await refineScore(ctx, S, kicked, S.current[S.otherKey], 0);
    if (!alive(ctx, S)) return false;
    if (result) {
        S.current = result;
        if (result.mf < S.best.mf - 1e-12 &&
            recordBest(ctx, S, result, { kind: 'perturb', insertMat: null })) {
            finalize(ctx, S, S.ts.statusConverged(S.best.mf));
            return false;
        }
    } else {
        S.current = {
            mf: S.best.mf, omf: S.best.omf,
            frontLayers: deep(S.best.frontLayers), backLayers: deep(S.best.backLayers),
        };
    }
    S.cycleStart = iteration + 1;
    S.noImprove = 0;
    return true;
}

function checkTimeBudget(state) {
    const { ctx, S } = state;
    if (!S.deepBudgetMs || performance.now() - S.runT0 < S.deepBudgetMs) return null;
    finalize(ctx, S, S.ts.statusTimeUp);
    return 'stop';
}

async function checkProposals(state) {
    const { ctx, S } = state;
    const batch = generateProposals(S);
    if (batch.reason) {
        finalize(ctx, S, batch.reason);
        return 'stop';
    }
    state.bestResult = await refineProposals(ctx, S, batch.proposals);
    if (!alive(ctx, S)) return 'stop';
    return null;
}

function checkAcceptance(state) {
    const { ctx, S, temperature } = state;
    if (!acceptProposal(ctx, S, state.bestResult, temperature, recordBest)) return null;
    finalize(ctx, S, S.ts.statusConverged(S.best.mf));
    return 'stop';
}

function checkStagnation(state) {
    const { ctx, S, iteration } = state;
    updateIterationState(ctx, S, iteration);
    const action = stagnationAction({
        deepMode: S.cfg.deepMode, noImprove: S.noImprove, patience: S.patience,
    });
    if (action === 'stop') {
        finalize(ctx, S, S.ts.statusStalled(S.patience));
        return 'stop';
    }
    return action === 'reheat' ? 'reheat' : null;
}

const ITERATION_STEPS = [checkTimeBudget, checkProposals, checkAcceptance, checkStagnation];

async function evaluateIterationStep(ctx, S, iteration, temperature) {
    const state = { ctx, S, iteration, temperature };
    for (const step of ITERATION_STEPS) {
        const outcome = await step(state);
        if (outcome) return outcome;
    }
    return 'continue';
}

async function runIteration(ctx, S, iteration) {
    ctx.setIter(iteration);
    const temperature = S.cfg.deepMode
        ? deepTemperature(iteration - S.cycleStart, S.coolPeriod, S.cfg.T0, S.endTemperature)
        : temperatureAt(iteration / S.cfg.maxIter, S.cfg.T0, S.endTemperature);
    ctx.setTemp(temperature);
    const outcome = await evaluateIterationStep(ctx, S, iteration, temperature);
    if (outcome === 'reheat') return reheat(ctx, S, iteration);
    return outcome !== 'stop';
}

export async function runLoop(ctx, S) {
    try {
        if (!(await establishBaseline(ctx, S, finalize))) return;
        for (let iteration = 1;
            alive(ctx, S) && (S.cfg.deepMode ? iteration <= HARD_CAP : iteration <= S.cfg.maxIter);
            iteration++) {
            if (!(await runIteration(ctx, S, iteration))) return;
        }
        finalize(ctx, S, S.cfg.deepMode ? S.ts.statusDone : S.ts.statusMaxIter);
    } catch (err) {
        console.error('[Structural] run error:', err);
        if (alive(ctx, S)) ctx.stopOpt(String((err && err.message) || err));
    }
}
