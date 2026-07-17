import { createRunState } from './runState.js';
import { runLoop } from './iterationLoop.js';

export function runStructuralWorker(ctx) {
    if (ctx.runningRef.current) return;
    const state = createRunState(ctx);
    if (!state) return;
    ctx.runningRef.current = true;
    ctx.setRunning(true);
    ctx.setStatusMsg(ctx.ts.statusBaseline);
    ctx.setIter(0);
    ctx.setReheats(0);
    return runLoop(ctx, state);
}
