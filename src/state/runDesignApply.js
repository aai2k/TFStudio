/**
 * Whether a design computed away from the app's window, by a Script Console
 * run, may replace the open design when it arrives.
 *
 * Only the design the run started on, unchanged since, takes the result. The
 * open design is the same when the active design id is the one it was at the
 * start and the store holds the very object it held then: any edit, undo or
 * redo, a History jump, or another window's live preview stores a new object,
 * and applying over it would throw that change away. The edit counter
 * (getDesignRevision) is not enough, since undo, redo and History jumps leave
 * it as it was. While a window's optimization run is on, its next preview
 * would land over the result, so nothing is applied then either.
 *
 * What is applied goes to updateDesign as it is, not transient and with no
 * checkpoint before it: that write pushes the design it replaces onto the undo
 * history itself, so it is one undo step. A checkpoint first would snapshot the
 * store as of the last render, which can be a step behind, and leave two. The
 * design's id and its name are left out: the id is the explorer's, and the
 * name belongs to the file the design is saved in.
 */

/** What a run starts on: the active design's id and the object the store holds for it. */
export function designAtRun({ activeDesignId, designs }) {
    const id = activeDesignId ?? null;
    return { id, stored: id == null ? null : designs?.[id] ?? null };
}

// The patch that makes the open design `result`, keys `result` dropped
// included, without its id and name.
function patchFrom(current, result) {
    const patch = { ...result };
    delete patch.id;
    delete patch.name;
    for (const key of Object.keys(current || {})) {
        if (key !== 'id' && key !== 'name' && !(key in patch)) patch[key] = undefined;
    }
    return patch;
}

// Why a result is not applied, in the order the reasons are checked, each
// with when it holds.
const REFUSALS = [
    ['unchanged', (atRun, now, result) => !result],
    ['noDesign', atRun => atRun.id == null],
    ['switched', (atRun, now) => (now.activeDesignId ?? null) !== atRun.id],
    ['optimizing', (atRun, now) => !!now.isOptimizing],
    ['edited', (atRun, now) => now.designs?.[atRun.id] !== atRun.stored],
];

/**
 * What to do with `result`, the design a run that started at `atRun`
 * answered with, given the app as it is now ({ activeDesignId, designs,
 * isOptimizing }, as the design context holds them):
 *   { apply: true, patch }  write `patch` with updateDesign
 *   { apply: false, reason }  reason 'unchanged' (no design came back),
 *        'noDesign' (none was open at the start), 'switched' (another design,
 *        or none, is open now), 'optimizing' (a window's optimization run is
 *        on) or 'edited' (the design changed meanwhile)
 */
export function runDesignDecision(atRun, now, result) {
    const refused = REFUSALS.find(([, holds]) => holds(atRun, now, result));
    return refused ? { apply: false, reason: refused[0] } : { apply: true, patch: patchFrom(atRun.stored, result) };
}
