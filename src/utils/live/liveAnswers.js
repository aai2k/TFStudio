/**
 * The window's answers to an AI agent working through the live link
 * (src/main/liveBridge.js): the designs the app holds and its project folders,
 * a copy of one with the revision it was read at, an edited copy written back
 * over the design it was read from, and a design opened, added or deleted as
 * the Project Explorer does it.
 *
 * Writes go to the open design only, under the rule a Script Console run's
 * result follows (state/runDesignApply.js): one undo step, and nothing written
 * when that design changed since the agent read it, another design or none is
 * open now, or a window's optimization run is on.
 *
 * Opening a design is clicking its row. Adding one writes its .tfs into a
 * project folder first, as New Design does, and opens it. Deleting one sends
 * its file to the Recycle Bin, with no question: the agent's request cannot
 * wait for one. So a design with unsaved edits is not deleted, since the
 * bin's copy would not have them, and neither is one whose file the bin
 * refuses, which the explorer would offer to delete for good.
 *
 * No request is taken up after its deadline: the main process has told the
 * agent by then that the app did not answer. An add or a delete taken up in
 * time goes through even when its file is still being written or deleted at
 * the deadline, so the agent is told to list the designs before it asks again.
 *
 * Every answer is { result } or { error: { code } }, or a promise of one for an
 * add or a delete. The code is the reason the rule gave, 'unknown' for a design
 * the app does not hold, 'noDesign' for a read with no design named and none
 * open, 'noFolder' for an add into a folder the app does not have, 'unsaved'
 * for a delete of a design with unsaved edits, 'noBin' for one whose file the
 * Recycle Bin refused, 'failed' for a file that could not be written or
 * deleted, which the app has told its user about, 'timeout' for a request past
 * its deadline, or 'invalid' for a method there is no answer to.
 */

import { designAtRevision, revisionOf, runDesignDecision } from '../../state/runDesignApply.js';
import { copyDesignWithFreshIds } from '../io/designFiles.js';

// The project folder whose row shows the design `id`, or null for one no
// folder shows, such as a preview a window drops in.
function folderOf(app, id) {
    return (app.folders || []).find(folder => (folder.items || []).some(item => item.id === id)) ?? null;
}

// The design `id` as the list shows it, in project folder `folder`.
function entry(app, id, folder) {
    const design = app.designs[id];
    return {
        appDesignId: id, name: design.name ?? null, folder,
        active: id === app.activeDesignId, unsaved: !!app.dirtyDesigns?.[id],
        frontLayers: design.frontLayers?.length ?? 0, backLayers: design.backLayers?.length ?? 0,
    };
}

// Each design the app holds, with the project folder it sits in, and the
// folders, each being its path under Projects.
function listDesigns(app) {
    const folders = app.folders || [];
    const folderOfId = new Map(folders.flatMap(folder => (folder.items || []).map(item => [item.id, folder.id])));
    return {
        activeDesignId: app.activeDesignId ?? null,
        designs: Object.keys(app.designs || {}).map(id => entry(app, id, folderOfId.get(id) ?? null)),
        folders: folders.map(folder => folder.id),
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

function select(app, { appDesignId }) {
    const folder = folderOf(app, appDesignId);
    if (!folder) return { error: { code: 'unknown' } };
    return { result: entry(app.select(appDesignId), appDesignId, folder.id) };
}

// A copy of the agent's design, or a blank one as New Design makes it when the
// agent names none, into the project folder named, or the one the explorer
// has selected, or the first. The copy gets ids of its own, so it never shares
// one with the design it came from.
async function add(app, { design, folder }) {
    const target = folder ?? app.selectedFolder ?? app.folders?.[0]?.id;
    if (!(app.folders || []).some(f => f.id === target)) return { error: { code: 'noFolder' } };
    const id = await app.add(design ? copyDesignWithFreshIds(design, design.name) : null, target);
    if (!id) return { error: { code: 'failed' } };
    const after = await app.rendered(now => !!now.designs?.[id]);
    app.notify(after.designs[id].name, 'agentAdded');
    return { result: { ...copyOf(after, id), folder: target } };
}

async function remove(app, { appDesignId }) {
    const folder = folderOf(app, appDesignId);
    if (!folder) return { error: { code: 'unknown' } };
    if (app.dirtyDesigns?.[appDesignId]) return { error: { code: 'unsaved' } };
    const name = app.designs?.[appDesignId]?.name ?? folder.items.find(item => item.id === appDesignId).name;
    const outcome = await app.remove(folder.id, appDesignId);
    if (outcome !== 'deleted') return { error: { code: outcome } };
    const shown = now => (now.folders || []).find(f => f.id === folder.id)?.items.some(item => item.id === appDesignId);
    await app.rendered(now => !shown(now));
    app.notify(name, 'agentDeleted');
    return { result: { appDesignId, name, folder: folder.id } };
}

const DONE_BY_DEADLINE = { apply, select, add, delete: remove };

/**
 * The answer to `request` ({ method, params, deadline }, as the main process
 * checked it; `deadline` is the time, as Date.now() gives it, at which the main
 * process stops waiting for the answer, and a request without one has none)
 * from `app`, the window as it is now: { designs, activeDesignId, isOptimizing,
 * folders, dirtyDesigns, selectedFolder }, `selectedFolder` being the id of the
 * folder the explorer has selected or null, with
 *   write(patch)       writes the patch to the open design as updateDesign does
 *                      and returns the app once that write is rendered
 *   select(id)         opens the design as a click on its row does and returns
 *                      the app once that is rendered
 *   add(design, folderId)  adds `design`, or a blank design when it is null, to
 *                      the folder as the explorer does and opens it; resolves
 *                      to its id, or null when its file could not be written
 *   remove(folderId, id)   deletes the design's row in the folder, its file to
 *                      the Recycle Bin only; resolves to 'deleted', 'noBin' or
 *                      'failed'
 *   rendered(test)     resolves to the app once a render passes `test`
 *   notify(name, kind) tells the user an agent changed (by default), added
 *                      ('agentAdded') or deleted ('agentDeleted') the design
 *                      named `name`
 */
export function answerLiveRequest({ method, params = {}, deadline }, app) {
    if (method === 'designs') return { result: listDesigns(app) };
    if (method === 'read') return read(app, params.appDesignId);
    if (!Object.hasOwn(DONE_BY_DEADLINE, method)) return { error: { code: 'invalid' } };
    return Date.now() > deadline ? { error: { code: 'timeout' } } : DONE_BY_DEADLINE[method](app, params);
}
