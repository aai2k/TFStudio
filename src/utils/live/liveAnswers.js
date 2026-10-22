/**
 * The window's answers to an AI agent working through the live link
 * (src/main/liveBridge.js): the designs the app holds, a copy of one with the
 * revision it was read at, and an edited copy written back over the design it
 * was read from.
 *
 * Writes go to the open design only, under the rule a Script Console run's
 * result follows (state/runDesignApply.js): one undo step, and nothing written
 * when that design changed since the agent read it, another design or none is
 * open now, or a window's optimization run is on. Nor is an apply written that
 * the window handles after its deadline: the main process has told the agent
 * by then that the app did not answer, and the agent goes on as if nothing was
 * written.
 *
 * Every answer is { result } or { error: { code } }: the code is the reason the
 * rule gave, 'unknown' for a design the app does not hold, 'noDesign' for a
 * read with no design named and none open, 'timeout' for an apply past its
 * deadline, or 'invalid' for a method there is no answer to.
 */

import { designAtRevision, revisionOf, runDesignDecision } from '../../state/runDesignApply.js';

// Each design the app holds, with the project folder it sits in, the folder
// being its path under Projects.
function listDesigns({ designs, activeDesignId, folders, dirtyDesigns }) {
    const folderOf = new Map((folders || []).flatMap(folder => (folder.items || []).map(item => [item.id, folder.id])));
    return {
        activeDesignId: activeDesignId ?? null,
        designs: Object.entries(designs || {}).map(([id, design]) => ({
            appDesignId: id, name: design.name ?? null, folder: folderOf.get(id) ?? null,
            active: id === activeDesignId, unsaved: !!dirtyDesigns?.[id],
            frontLayers: design.frontLayers?.length ?? 0, backLayers: design.backLayers?.length ?? 0,
        })),
    };
}

// A design as the agent gets it: as the store holds it, with the token of that
// state, and whether a window's run is previewing into it, in which case the
// copy is that run's latest preview.
function copyOf(app, id) {
    const active = id === app.activeDesignId;
    return {
        appDesignId: id, revision: revisionOf(app.designs[id]), active,
        appRunning: active && !!app.isOptimizing, design: app.designs[id],
    };
}

function read(app, appDesignId) {
    const id = appDesignId ?? app.activeDesignId;
    if (id == null) return { error: { code: 'noDesign' } };
    if (!app.designs?.[id]) return { error: { code: 'unknown' } };
    return { result: copyOf(app, id) };
}

function apply(app, { appDesignId, revision, design }) {
    const decision = runDesignDecision(designAtRevision(appDesignId, revision, app.designs), app, design);
    if (!decision.apply) return { error: { code: decision.reason } };
    const after = app.write(decision.patch);
    app.notify(after.designs[appDesignId].name);
    return { result: copyOf(after, appDesignId) };
}

/**
 * The answer to `request` ({ method, params, deadline }, as the main process
 * checked it; `deadline` is the time, as Date.now() gives it, at which the main
 * process stops waiting for the answer, and a request without one has none)
 * from `app`, the design context as it is now: { designs, activeDesignId,
 * isOptimizing, folders, dirtyDesigns }, with write(patch), which writes the
 * patch to the open design as updateDesign does and returns the app as it is
 * once that write is rendered, and notify(name), which tells the user an agent
 * changed the design named `name`.
 */
export function answerLiveRequest({ method, params = {}, deadline }, app) {
    if (method === 'designs') return { result: listDesigns(app) };
    if (method === 'read') return read(app, params.appDesignId);
    if (method === 'apply') return Date.now() > deadline ? { error: { code: 'timeout' } } : apply(app, params);
    return { error: { code: 'invalid' } };
}
