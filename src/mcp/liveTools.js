// Tools that reach the designs open in the TFStudio app, offered when the
// server runs with --live (liveLink.js connects to the app). An agent reads a
// copy of an app design into the session, edits it with the other tools, and
// writes it back; the app takes it as one undo step, and only while its design
// is still as it was when the copy was read. It can also open a design in the
// app, add one to a project folder there, and delete one.
//
// Each session design read from the app keeps where it came from in the store
// (designStore.js): the app's id for it and the revision it was read at. A
// job's answer keeps its source's, as it was when the run started.

import { designView, sameLayers } from './designStore.js';
import { failureText } from './liveLink.js';
import { object, str, DESIGN_ID } from './schemaParts.js';

export const LIVE_INSTRUCTIONS = [
    'Live: this server is linked to the TFStudio app open on this computer. listAppDesigns lists the designs it holds and its project folders; readAppDesign copies one, the open one by default, into this session.',
    'Only the open design takes changes. When none is open, selectAppDesign opens one, and addAppDesign adds a design of this session, or a blank one, to a project folder and opens it. deleteAppDesign deletes one, its file to the Recycle Bin.',
    'Edit that copy with the tools above, then applyToApp writes it back to the open design as one step the user undoes with Ctrl+Z. An apply is refused when the design changed in the app since it was read, or another design is open there: read it again and redo the change. Every apply is one of the user\'s undo steps, so make the edits first and apply once.',
    'refine and synthesize take applyToApp: true to apply their answer when the run ends.',
].join('\n');

// What the agent is told for each reason the app gives, or the link does.
const said = err => failureText(err, { read: 'readAppDesign', list: 'listAppDesigns', folders: 'listAppDesigns' });

export const APPLY_TO_APP = {
    type: 'boolean',
    description: 'true applies the answer, when the run ends, to the TFStudio design this design was read from (readAppDesign), under the revision it was read at, as one undo step. While TFStudio takes it the job shows state applying, which stopJob leaves to finish. The job then shows applied, true when TFStudio took it, and appRefusal when TFStudio refused it: the design changed there meanwhile, another design is open, or a run is going in a TFStudio window. A stopped run, or one that left the layers as they were, applies nothing. Default false',
};

// The app's answer to `method`, or an error that tells the agent why there is none.
async function ask(link, method, params) {
    try { return await link.request(method, params); } catch (err) { throw new Error(said(err)); }
}

// A session design as the tools show it, with where it was read from in the app.
const appView = (store, designId, { appDesignId, revision }) => ({ ...designView(designId, store.get(designId)), appDesignId, appRevision: revision });

async function readAppDesign(store, link, appDesignId) {
    const answer = await ask(link, 'read', appDesignId ? { appDesignId } : {});
    const from = { appDesignId: answer.appDesignId, revision: answer.revision };
    const designId = store.add(answer.design, from);
    return { ...appView(store, designId, from), active: answer.active, appRunning: answer.appRunning };
}

// Writes `designId` back to the app design it was read from; the session
// design then holds what the app holds, at its new revision.
async function push(store, link, designId) {
    const from = store.linkOf(designId);
    if (!from) throw new Error(`${designId} was not read from TFStudio; readAppDesign reads a design open there into the session`);
    const answer = await ask(link, 'apply', { ...from, design: store.get(designId) });
    const to = { appDesignId: answer.appDesignId, revision: answer.revision };
    store.set(designId, answer.design, to);
    return appView(store, designId, to);
}

// Adds `designId`, or a blank design without one, to a project folder of the
// app. The session design then holds what the app holds, linked to it; a
// blank one is read into the session as a new design.
async function addAppDesign(store, link, designId, folder) {
    const design = designId ? store.get(designId) : null;
    const answer = await ask(link, 'add', { ...(design ? { design } : {}), ...(folder ? { folder } : {}) });
    const from = { appDesignId: answer.appDesignId, revision: answer.revision };
    let id = designId;
    if (id) store.set(id, answer.design, from);
    else id = store.add(answer.design, from);
    return { ...appView(store, id, from), folder: answer.folder, active: answer.active, appRunning: answer.appRunning };
}

// A finished job's answer applied to the app, unless the run left the layers
// as they were.
async function finishRun(store, link, job, designId) {
    if (sameLayers(store.get(designId), job.startDesign)) return {};
    try {
        await push(store, link, designId);
        return { applied: true };
    } catch (err) {
        return { appRefusal: err.message };
    }
}

/**
 * The live tools over `link` (liveLink.js), and finishRun(job, designId), which
 * applies a finished job's answer when the job was started with applyToApp
 * (jobs.js).
 */
export function liveTools({ store, link }) {
    const tools = [
        {
            name: 'listAppDesigns', title: 'List the designs open in TFStudio',
            description: "The designs the TFStudio app holds, as its project explorer shows them: each one's appDesignId, name, project folder, whether it is the open design (active; only that one takes changes) and whether it has unsaved edits, and its layer counts on each side; the project folders (folders), empty ones included; and the app's version. Reads nothing into the session.",
            inputSchema: object({}),
            run: async () => ({ ...(await ask(link, 'designs')), appVersion: link.appVersion() }),
        },
        {
            name: 'readAppDesign', title: 'Read a design from TFStudio',
            description: 'Copies a design TFStudio holds into this session under a new designId: the open design, or the one appDesignId names. Edit the copy with the other tools, then applyToApp writes it back. Answers with the design, its appDesignId, the revision it was read at (appRevision), whether it is the open design (active), and appRunning, true while a run in a TFStudio window is changing it, the copy then being that run\'s latest step.',
            inputSchema: object({ appDesignId: str('The design\'s id in TFStudio, as listAppDesigns lists it. Default: the open design') }),
            run: ({ appDesignId }) => readAppDesign(store, link, appDesignId),
        },
        {
            name: 'applyToApp', title: 'Apply a design to TFStudio',
            description: 'Writes a design of this session back to the TFStudio design it was read from (readAppDesign) as one step the user undoes with Ctrl+Z, and TFStudio shows a notice that names the design. The app\'s design takes everything but its name, and the change stays unsaved until the user saves it. Refused, with nothing written, when the design changed in TFStudio since it was read (an edit, an undo or a run there), when it is no longer the open design, or while a run is going in a TFStudio window: read it again and redo the change. Once applied, the session design is what TFStudio holds, at its new revision, so it can be edited and applied again.',
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: async ({ designId }) => ({ applied: true, ...(await push(store, link, designId)) }),
        },
        {
            name: 'selectAppDesign', title: 'Open a design in TFStudio',
            description: 'Opens a design TFStudio holds, as a click on its row in the project explorer does, so it becomes the open design, the one applyToApp writes to. Reads nothing into the session: readAppDesign then copies it. Answers with the design as listAppDesigns lists it.',
            inputSchema: object({ appDesignId: str('The design\'s id in TFStudio, as listAppDesigns lists it') }, ['appDesignId']),
            run: ({ appDesignId }) => ask(link, 'select', { appDesignId }),
        },
        {
            name: 'addAppDesign', title: 'Add a design to TFStudio',
            description: 'Adds a design of this session, or without designId a blank one as New Design makes it, to a TFStudio project folder, written there as a .tfs file, and opens it. A name the folder already holds gets a number after it. The session design is then what TFStudio holds, linked to it, so applyToApp writes to it at once; a blank one is read into the session under a new designId. Answers as readAppDesign does, with the folder.',
            inputSchema: object({
                designId: str('The id of a design in this session. Default: a blank design'),
                folder: str('The project folder, as listAppDesigns lists its folders. Default: the folder selected in TFStudio\'s project explorer, or the first'),
            }),
            run: ({ designId, folder }) => addAppDesign(store, link, designId, folder),
        },
        {
            name: 'deleteAppDesign', title: 'Delete a design in TFStudio',
            description: 'Deletes a design TFStudio holds, as Delete in its project explorer does, with no question: its file goes to the Recycle Bin, from where the user can restore it; Ctrl+Z does not bring it back. Refused, with nothing deleted, when the design has edits that are not saved, or when the Recycle Bin does not take the file. Session designs read from it stay in the session.',
            inputSchema: object({ appDesignId: str('The design\'s id in TFStudio, as listAppDesigns lists it') }, ['appDesignId']),
            run: async ({ appDesignId }) => ({ deleted: true, ...(await ask(link, 'delete', { appDesignId })) }),
        },
    ];
    return { tools, finishRun: (job, designId) => finishRun(store, link, job, designId) };
}
