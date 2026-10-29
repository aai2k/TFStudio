// The iterations of a Structural run: annealing over proposals, with Deep
// search reheats, until the run ends on its own.
//
// Each step returns 'continue', 'stop' when the run was stopped meanwhile,
// 'reheat', or { end } when the run ends.

import {
    deepTemperature, temperatureAt, stagnationAction, basinKick,
} from '../synthesis/structuralOptimizer.js';
import { deep, sumD } from './core.js';
import { alive } from './runState.js';
import { refineScore, regridIfGrown } from './refine.js';
import { generateProposals, refineProposals, acceptProposal } from './proposals.js';
import { establishBaseline } from './baseline.js';

// Deep search ends here if nothing else ends it first.
const HARD_CAP = 2_000_000;

// A new best: it becomes the run's best design and a history row. Returns
// true when it reaches the target merit.
function recordBest(S, candidate, mutation) {
    S.noImprove = 0;
    S.best = {
        mf: candidate.mf, omf: candidate.omf,
        frontLayers: deep(candidate.frontLayers), backLayers: deep(candidate.backLayers),
    };
    const layerCount = (S.best[S.layerKey] || []).length;
    S.emit({
        design: { frontLayers: S.best.frontLayers, backLayers: S.best.backLayers },
        mf: candidate.mf, omf: candidate.omf, layerCount,
    });
    S.genNum += 1;
    const dMF = S.prevBestMF === Infinity ? null : candidate.mf - S.prevBestMF;
    S.prevBestMF = candidate.mf;
    S.hooks.onRow?.({
        id: Math.random().toString(36).slice(2),
        genNum: S.genNum, seed: S.seed,
        mf: candidate.mf, omf: candidate.omf, dMF, side: S.side,
        kind: mutation.kind, layerCount,
        tot: sumD(candidate.frontLayers) + sumD(candidate.backLayers),
        tMs: performance.now() - S.runT0,
        insertMat: mutation.insertMat ?? null,
        frontSnap: deep(candidate.frontLayers), backSnap: deep(candidate.backLayers),
        layers: deep(S.best[S.layerKey] || []),
    });
    return S.best.mf < S.cfg.targetMF;
}

const reachedTarget = S => ({ end: { stopReason: 'target', stopMF: S.best.mf } });

// The chain falls back to the best design when it has wandered far above it;
// the trend gains a point, drawn on even iterations and on a new best.
function updateIterationState(S, iteration) {
    if (S.current.mf > S.best.mf * 1.3) {
        S.current = {
            mf: S.best.mf, omf: S.best.omf,
            frontLayers: deep(S.best.frontLayers), backLayers: deep(S.best.backLayers),
        };
    }
    S.emit({
        trend: { iter: ++S.trendX, cur: S.current.mf, best: S.best.mf },
        redraw: iteration % 2 === 0 || S.noImprove === 0,
    });
    S.emit({ accRate: S.attempts ? S.accepts / S.attempts : null });
}

// Deep search, stalled: kick the best design into another basin and refine it.
async function reheat(S, iteration) {
    S.reheatCount += 1;
    S.emit({ reheats: S.reheatCount, activity: { id: 'reheat', count: S.reheatCount } });
    const kicked = basinKick(deep(S.best[S.layerKey] || []), {
        rng: S.rng, pool: S.poolLite, dMin: S.cfg.dMin, dMax: S.cfg.dMax,
        addMaxNm: S.cfg.addMaxNm, jitterPct: S.cfg.jitterPct,
        kinds: S.kinds, maxKick: 3,
    });
    const result = await refineScore(S, kicked, S.current[S.otherKey], 0);
    if (!alive(S)) return 'stop';
    if (result) {
        S.current = result;
        if (result.mf < S.best.mf - 1e-12 &&
            recordBest(S, result, { kind: 'perturb', insertMat: null })) {
            return reachedTarget(S);
        }
    } else {
        S.current = {
            mf: S.best.mf, omf: S.best.omf,
            frontLayers: deep(S.best.frontLayers), backLayers: deep(S.best.backLayers),
        };
    }
    S.cycleStart = iteration + 1;
    S.noImprove = 0;
    return 'continue';
}

function checkTimeBudget(state) {
    const { S } = state;
    if (!S.deepBudgetMs || performance.now() - S.runT0 < S.deepBudgetMs) return null;
    return { end: { stopReason: 'budget' } };
}

async function checkProposals(state) {
    const { S } = state;
    const batch = await generateProposals(S);
    if (!alive(S)) return 'stop';
    if (batch.reason) return { end: { stopReason: batch.reason } };
    state.refined = await refineProposals(S, batch.proposals);
    if (!alive(S)) return 'stop';
    return null;
}

function checkAcceptance(state) {
    const { S, temperature } = state;
    return acceptProposal(S, state.refined, temperature, recordBest) ? reachedTarget(S) : null;
}

function checkStagnation(state) {
    const { S, iteration } = state;
    updateIterationState(S, iteration);
    const action = stagnationAction({
        deepMode: S.cfg.deepSearch, noImprove: S.noImprove, patience: S.patience,
    });
    if (action === 'stop') return { end: { stopReason: 'patience', patience: S.patience } };
    return action === 'reheat' ? 'reheat' : null;
}

const ITERATION_STEPS = [checkTimeBudget, checkProposals, checkAcceptance, checkStagnation];

async function evaluateIterationStep(S, iteration, temperature) {
    const state = { S, iteration, temperature };
    for (const step of ITERATION_STEPS) {
        const outcome = await step(state);
        if (outcome) return outcome;
    }
    return 'continue';
}

async function runIteration(S, iteration) {
    S.iteration = iteration;
    S.emit({ iter: iteration });
    regridIfGrown(S);
    const temperature = S.cfg.deepSearch
        ? deepTemperature(iteration - S.cycleStart, S.coolPeriod, S.cfg.T0, S.endTemperature)
        : temperatureAt(iteration / S.cfg.maxIter, S.cfg.T0, S.endTemperature);
    S.emit({ temp: temperature });
    const outcome = await evaluateIterationStep(S, iteration, temperature);
    return outcome === 'reheat' ? reheat(S, iteration) : outcome;
}

// What a step's outcome means for the run: its end, null when it was
// stopped, or undefined when it goes on.
const endOf = outcome => (outcome === 'stop' ? null : outcome.end);

async function iterate(S) {
    const last = S.cfg.deepSearch ? HARD_CAP : S.cfg.maxIter;
    for (let iteration = 1; alive(S) && iteration <= last; iteration++) {
        const end = endOf(await runIteration(S, iteration));
        if (end !== undefined) return end;
    }
    return alive(S) ? { stopReason: S.cfg.deepSearch ? 'iterationCap' : 'maxIter' } : null;
}

/**
 * The run from its start to its end: its end ({ stopReason, ... }) when it
 * ended on its own, or null when it was stopped.
 */
export async function runToEnd(S) {
    const end = endOf(await establishBaseline(S));
    return end !== undefined ? end : iterate(S);
}
