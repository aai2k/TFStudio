// What the window does with the engine's events (run.onEvent): new best
// designs become rows, GE steps and search rounds trend points, and phases the
// status message.

import { recordBest, pushTrend } from './record.js';

// A phase change: the design the phase before left as the run's best (for the
// search phase, the start's result) is recorded under that phase's name.
function onPhase(ctx, S, { phase }) {
    const best = S.run.best;
    if (best) recordBest(ctx, S, { layers: best.layers, mf: best.mf, kind: S.phase ?? phase });
    S.phase = phase;
    ctx.publish({ phase, statusMsg: ctx.td.phaseStatus[phase] });
}

function onGeStep(ctx, S, { layers, mf }) {
    S.steps += 1;
    recordBest(ctx, S, { layers, mf, kind: 'ge' });
    pushTrend(ctx, S, { cur: mf, best: Math.min(S.bestMf, mf) });
    ctx.publish({ step: S.steps, mf, layerCount: layers.length });
}

function onRound(ctx, S, { round, incumbent, best }) {
    pushTrend(ctx, S, { cur: incumbent.mf, best: Math.min(S.bestMf, best.mf) });
    ctx.publish({ round, mf: incumbent.mf, layerCount: incumbent.layers.length });
}

function onBest(ctx, S, { layers, mf, destroy, repair }) {
    recordBest(ctx, S, { layers, mf, kind: 'search', move: { destroy, repair } });
}

const HANDLERS = { phase: onPhase, geStep: onGeStep, round: onRound, best: onBest };

export function handleEvent(ctx, S, event) {
    HANDLERS[event?.type]?.(ctx, S, event);
}
