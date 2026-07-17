// Worker message handling for the DLS pool run (runDlsEvent, see dlsPool.js).
// One module-scope handler per message type, driven off the shared run-state
// object `S` built by runDlsEvent — split out from dlsPool.js's setup/pool-
// management code so the two concerns don't compound into one high-complexity
// file.

import { runOptMainThread } from './mainThread.js';
import { makeJob } from './dlsPoolJobs.js';

// Monotonic cumulative iteration counter across ALL workers/restarts. A pooled
// worker's reported iter resets to 0 when it picks up the next restart, so we
// accumulate per-worker DELTAS instead of summing last-reported iters (which was
// non-monotonic and made the MF-trend plot zig-zag / collapse).
function bumpCum(S, wid, it) {
    const prev = S.prevIterByW.get(wid) ?? 0;
    S.cumIter += (it >= prev) ? (it - prev) : it;   // it < prev ⇒ restart reset
    S.prevIterByW.set(wid, it);
    return S.cumIter;
}

// best = { front, back, iter, mf, omf }
function setSyntheticBest(ctx, S, best) {
    const { front, back, iter, mf, omf } = best;
    ctx.lastBestRef.current = { mfBest: mf, omf: omf ?? null, frontLayers: front, backLayers: back };
    ctx.optimizerRef.current = {
        iter, mf, mfBest: mf, layerSide: S.layerSide,
        applyToDesign: (d) => ({ ...d, frontLayers: front, backLayers: back }),
        restoreBest: () => {},
    };
}

function finalizeRun(ctx, S) {
    if (S.finished) return;
    S.finished = true;
    ctx.runningRef.current = false;
    ctx.setRunning(false);
    ctx.setRestartIdx(0);
    const lb = ctx.lastBestRef.current;
    if (lb) {
        ctx.updateDesignRef.current(
            { frontLayers: lb.frontLayers, backLayers: lb.backLayers }, { transient: true });
        if (S.isMulti) {
            const layers = S.layerSide === 'backLayers' ? lb.backLayers : lb.frontLayers;
            ctx.addHistEntry({
                id: Math.random().toString(36).slice(2),
                label: `${S.runLabel} (×${S.N})`,
                iter:  S.cumIter,
                omf:   lb.omf,
                mf:    lb.mfBest,
                layers,
                layerCount: (layers || []).length,
                layerSide: S.layerSide,
            });
            console.log(`[Multi-start pool] Done: ${S.N} restarts on ${S.K} workers, best MF=${lb.mfBest.toFixed(6)} (mode=${S.surfMode})`);
        } else {
            console.log(`[DLS] done: best MF=${lb.mfBest.toFixed(6)}`);
        }
    }
    ctx.killWorker();
}

// Idempotent — only one fallback ever fires (M6 fix).
export function doFallback(ctx, S, why, err) {
    if (S.fellBack) return;
    S.fellBack = true;
    console.error(`[DLS] Worker ${why}, using main-thread fallback:`, err);
    ctx.killWorker();
    ctx.runningRef.current = false;
    runOptMainThread(ctx);
}

function onProgressMsg(ctx, S, m, wid) {
    S.gotProgress = true;
    const ci = bumpCum(S, wid, m.iter);
    ctx.setIter(ci);
    if (m.mfBest != null && m.mfBest < S.globalBest) {
        S.globalBest = m.mfBest;
        S.globalBestOMF = m.omfBest ?? S.globalBestOMF;
        ctx.setMfBest(S.globalBest);
        ctx.setOmfBest(S.globalBestOMF);
        if (m.bestFrontLayers) {
            setSyntheticBest(ctx, S, { front: m.bestFrontLayers, back: m.bestBackLayers, iter: ci, mf: S.globalBest, omf: S.globalBestOMF });
            if (S.isMulti) ctx.updateDesignRef.current(
                { frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers }, { transient: true });
        }
    }
    if (!S.isMulti) {
        // Single-start: live MF trajectory (per-progress) + live design.
        ctx.setMf(m.mf);
        if (m.omf != null) ctx.setOmf(m.omf);
        ctx.setMfHistory(prev => [...prev, { iter: ci, mf: m.mf }]);
        ctx.updateDesignRef.current(
            { frontLayers: m.frontLayers, backLayers: m.backLayers }, { transient: true });
    } else {
        // Multi-start pool: a point on EVERY progress so the plot renders,
        // plotting best-so-far vs. monotonic cumulative iterations (clean
        // staircase across all restarts).
        const y = (S.globalBest === Infinity) ? m.mf : S.globalBest;
        ctx.setMf(y);
        ctx.setOmf((S.globalBest === Infinity) ? (m.omf ?? null) : S.globalBestOMF);
        ctx.setMfHistory(prev => [...prev, { iter: ci, mf: y }]);
    }
}

function onDoneMsg(ctx, S, w, m, wid) {
    S.gotProgress = true;
    const ci = bumpCum(S, wid, m.iter);
    const mfB = m.mfBest ?? m.mf;
    const omfB = m.omfBest ?? m.omf;
    if (mfB < S.globalBest) {
        S.globalBest = mfB;
        S.globalBestOMF = omfB ?? S.globalBestOMF;
        ctx.setMfBest(S.globalBest);
        ctx.setMf(S.globalBest);
        ctx.setOmfBest(S.globalBestOMF);
        ctx.setOmf(S.globalBestOMF);
        setSyntheticBest(ctx, S, {
            front: m.bestFrontLayers || m.frontLayers,
            back:  m.bestBackLayers  || m.backLayers,
            iter: ci, mf: S.globalBest, omf: S.globalBestOMF,
        });
    }
    S.completed++;
    if (S.isMulti) {
        ctx.setIter(ci);
        ctx.setMfHistory(prev => [...prev, {
            iter: ci, mf: (S.globalBest === Infinity ? mfB : S.globalBest),
        }]);
        ctx.setRestartIdx(S.completed);
    }
    if (S.nextJob < S.nJobs) {
        const r = S.nextJob++;
        w.postMessage(makeJob(S, S.isMulti ? r + 1 : 0));
    } else {
        try { w.terminate(); } catch (_) {}
        ctx.poolRef.current = ctx.poolRef.current.filter(x => x !== w);
        if (S.completed >= S.nJobs) finalizeRun(ctx, S);
    }
}

function onErrorMsg(ctx, S, m) {
    if (!S.gotProgress) doFallback(ctx, S, 'errored before progress', m.message);
    else { console.error('[DLS] Worker error:', m.message); ctx.stopOpt(); }
}

export function handleMsg(ctx, S, w, wid, e) {
    const m = e.data;
    if (!m || (!ctx.runningRef.current && !S.finished)) return;   // empty / stale post-stop message
    if (m.type === 'warn')  { console.warn(m.message); return; }
    if (m.type === 'error') { onErrorMsg(ctx, S, m); return; }
    // 'init' is a no-op (mfInitial is computed main-side).
    if (m.type === 'progress') onProgressMsg(ctx, S, m, wid);
    else if (m.type === 'done') onDoneMsg(ctx, S, w, m, wid);
}
