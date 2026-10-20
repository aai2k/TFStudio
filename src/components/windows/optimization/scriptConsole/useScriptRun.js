/**
 * One Script Console run at a time: Run sends the script and the open design
 * to a thread of the desktop app's main process (src/main/ipc/scripts.js),
 * the output follows what the script prints, and the answer is applied to the
 * open design when that design takes it (state/runDesignApply.js).
 *
 * Stop ends the script's thread at once and changes nothing. Hiding or closing
 * the window stops its run too, as Refinement and Deep Synthesis stop theirs:
 * a hidden tab is unmounted, and nothing would be left to show the answer.
 * So does anything else that unmounts it, moving it to another dock group or
 * tearing it off, and the output says the run was stopped and why.
 */

import { designAtRun, runDesignDecision } from '../../../../state/runDesignApply.js';

const { useCallback, useEffect, useRef, useState } = React;

const newRunId = () => `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// The output's line for an answer that is not a finished script, by its state.
const ENDED_LINE = { unavailable: 'desktopOnly', stopped: 'stoppedNote', refused: 'refused' };

/**
 * What a run's answer adds to the output, applying the design it left in
 * tf.design when the open design takes it, as one undo step
 * (runDesignApply.js says why there is no checkpoint). `atRun` is what the run
 * started on (designAtRun) and `ctx` the design context as it is now.
 */
export function finishRun(z, answer, atRun, ctx) {
    if (ENDED_LINE[answer.state]) return [z[ENDED_LINE[answer.state]]];
    if (answer.state !== 'done') return [answer.error || z.noAnswer];
    if (answer.invalid) return [z.notADesign(answer.invalid)];
    const decision = runDesignDecision(atRun, ctx, answer.design);
    if (decision.apply) {
        ctx.updateDesign(decision.patch);
        return [z.applied];
    }
    return decision.reason === 'unchanged' ? [] : [z.notApplied[decision.reason]];
}

/** The run's state in the control row: how long it has run, or how it ended and when. */
export function runStatus(z, { run, ended, now }) {
    if (run) return z.running(Math.max(0, Math.floor((now - run.started) / 1000)));
    if (!ended) return '';
    const seconds = ended.seconds.toFixed(1);
    if (ended.state === 'done') return z.doneIn(seconds);
    return ended.state === 'stopped' ? z.stoppedAfter(seconds) : z.failedAfter(seconds);
}

// The output of the run on now, as the script prints it. A batch for a run
// that has answered is left out, so nothing shows under the line that says
// how the run ended.
function useOutputFeed(active, append) {
    useEffect(() => {
        const off = window.electronAPI?.onScriptOutput?.((runId, lines, dropped) => {
            if (runId === active.current) append(lines, dropped);
        });
        return typeof off === 'function' ? off : undefined;
    }, [active, append]);
}

// A clock for the elapsed time, ticking once a second while a run is on.
function useClock(run) {
    const [now, setNow] = useState(0);
    useEffect(() => {
        if (!run) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [run]);
    return now;
}

async function askMain(runId, request) {
    try {
        return await window.electronAPI.runScript(runId, request);
    } catch (error) {
        return { state: 'failed', error: error?.message || String(error) };
    }
}

/**
 * `script` is { text, fileName, filePath }; `context` the design context
 * (useDesign); `append(lines, dropped)` adds lines to the output, `dropped`
 * being how many older lines a batch left out, and `clearOutput()` empties
 * it. Returns { running, status, run, stop }.
 */
export function useScriptRun({ z, script, context, append, clearOutput }) {
    const [run, setRun] = useState(null);
    const [ended, setEnded] = useState(null);
    const now = useClock(run);
    // The run on now, whose answer is still awaited.
    const active = useRef(null);
    const latest = useRef(context);
    latest.current = context;
    useOutputFeed(active, append);

    // The window's output outlives it (sessionState.js), so the line written
    // here as the window goes is shown when it is drawn again.
    const noteClosed = useRef(null);
    noteClosed.current = () => append([z.stoppedClosed]);
    useEffect(() => () => {
        if (!active.current) return;
        window.electronAPI?.stopScript?.(active.current);
        active.current = null;
        noteClosed.current();
    }, []);

    const start = useCallback(async () => {
        if (active.current) return;
        const runId = newRunId();
        const ctx = latest.current;
        const atRun = designAtRun(ctx);
        active.current = runId;
        clearOutput();
        const started = Date.now();
        setRun({ runId, started });
        setEnded(null);
        const answer = await askMain(runId, {
            ...script, design: ctx.hasActiveDesign ? ctx.design : null,
        });
        if (active.current !== runId) return;
        active.current = null;
        append(finishRun(z, answer, atRun, latest.current));
        setRun(null);
        setEnded(answer.state === 'unavailable' ? null : { state: answer.state, seconds: (Date.now() - started) / 1000 });
    }, [z, script, append, clearOutput]);

    const stop = useCallback(() => {
        if (active.current) window.electronAPI?.stopScript?.(active.current);
    }, []);

    return { running: !!run, status: runStatus(z, { run, ended, now }), run: start, stop };
}
