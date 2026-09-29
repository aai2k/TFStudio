// The window's run history and what the history buttons do with it. A history
// is one object per design: rows (one per new best design), run blocks
// (synthesisShared/runBlocks.js), the trend, the design the open block works
// on and the edit revision it belongs to, and the parts the last run used.

import { computePareto, sideKeyFor } from '../synthesisShared/synthesisMath.js';
import { activeBaseline, undoRunBlock } from '../synthesisShared/runBlocks.js';
import { getCached, setCached, clearCached } from './sessionState.js';

const SAVED_FIELDS = ['rows', 'runs', 'trend', 'savedDesign', 'baseDesign', 'baseRev', 'parts', 'startInfo'];

export const freshHistory = () => ({
    rows: [], runs: [], trend: [], runOpen: false, genCount: 0,
    savedDesign: null, baseDesign: null, baseRev: 0, parts: null, startInfo: null,
});

const lastGenNum = rows => (rows.length ? rows[rows.length - 1].genNum : 0);
const lowestMf = rows => (rows.length ? Math.min(...rows.map(row => row.mf)) : null);
const layerCountOf = design => (design?.[sideKeyFor(design)] || []).length;

// The view fields that follow from the history as it stands. `design` gives
// the layer count when there are no rows.
export function historyView(hist, design) {
    const last = hist.rows[hist.rows.length - 1] || null;
    return {
        rows: hist.rows, top: computePareto(hist.rows), trend: hist.trend,
        mf: last?.mf ?? null, mfBest: lowestMf(hist.rows),
        layerCount: last?.layerCount ?? layerCountOf(design),
        parts: hist.parts, startInfo: hist.startInfo, canReset: !!hist.savedDesign,
    };
}

export function saveHistory(ctx) {
    const hist = ctx.hist;
    setCached(ctx.designRef.current?.id, Object.fromEntries(SAVED_FIELDS.map(key => [key, hist[key]])));
}

// Load the history of the design now in the editor. A cached run is over (a
// remount is not a Stop), so its block is closed. An edit made while the
// window was closed reads as an edit on the next Run; a cache without a
// revision matches none.
export function loadHistory(ctx, designId) {
    const cached = getCached(designId);
    ctx.hist = { ...freshHistory(), ...(cached || {}), runOpen: false };
    ctx.hist.genCount = lastGenNum(ctx.hist.rows);
    ctx.hist.baseRev = cached ? (cached.baseRev ?? -1) : (ctx.getDesignRevision?.(designId) ?? 0);
    ctx.publish({ ...historyView(ctx.hist, ctx.designRef.current), phase: null, step: 0, round: 0, statusMsg: '' });
}

// A real editor write since the open block started means the next Run starts
// from the edited design in a block of its own. Live previews do not bump the
// revision, so Stop then Run still continues the block.
export function reconcileWithEdits(ctx) {
    const hist = ctx.hist;
    const rev = ctx.getDesignRevision?.(ctx.designRef.current?.id) ?? 0;
    if (rev === hist.baseRev) return;
    Object.assign(hist, { baseDesign: null, runOpen: false, baseRev: rev });
}

// Reset undoes one Run press: the design it started from comes back and its
// rows and trend points go, earlier runs stay.
export function resetLastRun(ctx) {
    const hist = ctx.hist;
    const undone = undoRunBlock(hist.runs, hist.rows);
    if (!undone) return;
    ctx.updateDesign({ frontLayers: undone.baseline.frontLayers, backLayers: undone.baseline.backLayers });
    Object.assign(hist, {
        runs: undone.runs, rows: undone.gens, runOpen: false, baseDesign: null,
        savedDesign: activeBaseline(undone.runs), genCount: lastGenNum(undone.gens),
        trend: hist.trend.filter(point => point.runNum !== undone.runNum),
    });
    const baseline = { ...ctx.designRef.current, ...undone.baseline };
    ctx.publish({ ...historyView(hist, baseline), step: 0, round: 0, statusMsg: `${ctx.td.runSeparator(undone.runNum)} ✕` });
    if (hist.runs.length) saveHistory(ctx); else clearCached(ctx.designRef.current?.id);
}

// Forget every run and row and leave the design where it is.
export function clearHistory(ctx) {
    clearCached(ctx.designRef.current?.id);
    ctx.hist = { ...freshHistory(), baseRev: ctx.hist.baseRev };
    ctx.publish({ ...historyView(ctx.hist, ctx.designRef.current), phase: null, step: 0, round: 0, statusMsg: '' });
}

// Put a row's design back into the editor.
export function restoreRow(ctx, row) {
    const patch = { frontLayers: row.frontSnap, backLayers: row.backSnap };
    ctx.updateDesign(JSON.parse(JSON.stringify(patch)));
    ctx.hist.baseDesign = { ...(ctx.hist.baseDesign || ctx.designRef.current), ...patch };
    ctx.publish({ mf: row.mf, layerCount: row.layerCount });
}

export function restoreBest(ctx) {
    const rows = ctx.hist.rows;
    if (!rows.length) return;
    restoreRow(ctx, rows.reduce((a, b) => (a.mf <= b.mf ? a : b)));
}
