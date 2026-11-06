/**
 * The window's side of the live link: the host (components/live/
 * LiveBridgeHost.js) answering an agent from the app's design store and
 * design context (useDesignStore, DesignProvider) wired as App.js wires them,
 * under a stand-in for React that runs effects (_effectRuntime.mjs).
 *
 * The revision token names one state of a design: it is kept across renders
 * and changes on an edit, a live preview, an undo, a redo, a History jump and
 * a rename, and a token from another load of the window never matches, even
 * when that load has counted as far. An agent's write of a design read at the
 * current token is one undo step that keeps the design's id and name, raises a
 * notice naming it, and is answered with the design as the store now holds it
 * at its new token. Nothing is written, no notice is raised, and the reason
 * comes back, for a write the window handles after its deadline, after an edit
 * or an undo, with another design or none open, with the design deleted,
 * during a window's optimization run, or for a design that is not the open one.
 *
 * With no design open, as at startup, the agent opens one by clicking its row,
 * and it is open by the time the agent hears. An add, of the agent's design
 * under ids of its own or of a blank one, and a delete are answered once the
 * app has rendered them, each with a notice; an add goes into the folder the
 * explorer has selected unless one is named, and is refused for a folder the
 * app does not have. A design with unsaved edits, or whose file the Recycle
 * Bin does not take, is not deleted.
 *
 * Run: node tests/live_bridge_store.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeSampleDesign, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const RealReact = globalThis.React;
const RealReactDOM = globalThis.ReactDOM;

// The app (its design store and design context) and the host hold hooks of
// their own, as two components do.
const app = makeEffectRuntime(RealReact);
const host = makeEffectRuntime(RealReact);
const as = (runtime, draw) => {
    globalThis.React = runtime;
    try { return draw(); } finally { globalThis.React = RealReact; }
};
globalThis.React = app;
await loadApp();
const { DesignContext, DesignProvider } = await import('../src/state/DesignContext.js');
const { useDesignStore } = await import('../src/hooks/useDesignStore.js');
globalThis.React = host;
const { LiveBridgeHost } = await import('../src/components/live/LiveBridgeHost.js');
globalThis.React = RealReact;
const { revisionOf } = await import('../src/state/runDesignApply.js');
const anotherLoad = await import('../src/state/runDesignApply.js?another-load');

const t = makeLocale('en');
const notices = [];
let folders = [
    { id: 'Coatings/AR', items: [{ id: 'd1', name: 'Mine' }, { id: 'd2', name: 'Other' }] },
    { id: 'Empty', items: [] },
];

// Looks at `check` once a turn of the event loop until it holds, for at most
// 2000 turns: what it waits for comes within a few.
async function until(check) {
    for (let i = 0; i < 2000 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 0));
}

// The desktop app's side: each request handed to the host, its reply kept.
let onRequest = null;
const replies = new Map();
globalThis.electronAPI = {
    onLiveRequest: (cb) => { onRequest = cb; return () => { onRequest = null; }; },
    liveReply: (id, answer) => replies.set(id, answer),
};
// Each request with a deadline, as the main process sends it; the host answers
// within a few turns here, so a second ahead is never reached.
let lastId = 0;
const ask = async (method, params = {}, deadline = Date.now() + 1000) => {
    const id = ++lastId;
    onRequest({ id, method, params, deadline });
    await until(() => replies.has(id));
    return replies.get(id);
};

// The project explorer as the host reaches it. A click on a row is recorded;
// an add or a delete waits for the test to finish writing its file, then puts
// the change in the store and the tree, which shows once the app renders.
const clicks = [];
const fileWrites = [];
const fileWrite = (change, answer) => new Promise(resolve => fileWrites.push(() => { change?.(); resolve(answer); }));
const putInTree = (folderId, design) => {
    folders = folders.map(f => (f.id === folderId ? { ...f, items: [...f.items, { id: design.id, name: design.name }] } : f));
    store.setDesigns(prev => ({ ...prev, [design.id]: design }));
    store.setActiveDesignId(design.id);
};
let deleteAnswer = 'deleted';
const project = {
    selectedFolder: { id: 'Coatings/AR' },
    handleItemClick: (item, folder) => clicks.push([item.id, folder.id]),
    addItemFromDesign: (design, folder) => fileWrite(() => putInTree(folder.id, design), design.id),
    addItem: (folder) => {
        const blank = { ...makeSampleDesign(), id: 'blank', name: 'Design 1', frontLayers: [] };
        return fileWrite(() => putInTree(folder.id, blank), blank.id);
    },
    removeItemForProgram: (folderId, id) => {
        if (deleteAnswer !== 'deleted') return fileWrite(null, deleteAnswer);
        return fileWrite(() => {
            folders = folders.map(f => (f.id === folderId ? { ...f, items: f.items.filter(item => item.id !== id) } : f));
            store.dropDesigns([id]);
            store.setActiveDesignId(prev => (prev === id ? null : prev));
        }, 'deleted');
    },
};

let store;
function renderApp() {
    as(app, () => app.run(() => {
        store = useDesignStore({});
        DesignContext.value = DesignProvider({
            activeDesignId: store.activeDesignId, designs: store.designs, folders,
            onDesignChange: store.handleDesignChange, onCheckpoint: store.pushCheckpoint,
            historyView: store.historyView, onJumpToHistory: store.jumpToHistory,
        }).props.value;
    }));
}
const renderHost = () => as(host, () => host.run(() => LiveBridgeHost({
    t, notify: n => notices.push(n), dirtyDesigns: store.dirtyDesigns, project, activateDesign: store.activateDesign,
})));
const redraw = () => { renderApp(); renderHost(); };
// React renders a write made under flushSync before flushSync returns.
globalThis.ReactDOM = { ...RealReactDOM, flushSync: (write) => { write(); redraw(); } };

const before = { ...makeSampleDesign(), id: 'd1', name: 'Mine' };
const other = { ...makeSampleDesign(), id: 'd2', name: 'Other' };
redraw();
assert.ok(onRequest, 'the host listens for the agent\'s requests');
store.setDesigns({ d1: before, d2: other });
store.setActiveDesignId('d1');
redraw();
const ctx = () => DesignContext.value;

// ── The revision token ──────────────────────────────────────────────────────
{
    const token = () => revisionOf(store.designs.d1);
    const seen = [token()];
    redraw();
    assert.equal(token(), seen[0], 'a render that changes nothing keeps the token');
    assert.equal((await ask('read')).result.revision, seen[0], 'and it is the one a read hands the agent');
    for (const [what, change] of [
        ['an edit', () => ctx().updateLayer('front', 'l1', { thickness: 101 })],
        ['a live preview', () => ctx().updateDesign({ referenceWavelength: 600 }, { transient: true })],
        ['an undo', () => store.undo()],
        ['a redo', () => store.redo()],
        ['a History jump', () => store.jumpToHistory(0)],
        ['a rename', () => store.setDesigns(prev => ({ ...prev, d1: { ...prev.d1, name: 'Renamed' } }))],
    ]) {
        change();
        redraw();
        assert.ok(!seen.includes(token()), `${what} gives the design a new token`);
        seen.push(token());
    }
    // Another load of the window that has counted as far as this one: only the
    // load's own id tells its token from the current one.
    const count = Number(token().split('.')[1]);
    let fromReload = anotherLoad.revisionOf({});
    while (Number(fromReload.split('.')[1]) < count) fromReload = anotherLoad.revisionOf({});
    assert.notEqual(fromReload, token(), 'another load of the window numbers its designs otherwise');
    const stale = await ask('apply', { appDesignId: 'd1', revision: fromReload, design: store.designs.d1 });
    assert.equal(stale.error?.code, 'edited', 'so a token from before a reload or a restart never matches');
    store.setDesigns(prev => ({ ...prev, d1: before }));
    redraw();
}

// ── What the agent sees ─────────────────────────────────────────────────────
{
    ctx().updateLayer('front', 'l2', { thickness: 95 });
    redraw();
    const listed = (await ask('designs')).result;
    assert.equal(listed.activeDesignId, 'd1');
    assert.deepEqual(listed.designs.find(d => d.appDesignId === 'd1'), {
        appDesignId: 'd1', name: 'Mine', folder: 'Coatings/AR', active: true, unsaved: true, frontLayers: 2, backLayers: 0,
    }, 'each design with its folder, whether it is the open one, whether it is unsaved, and its layer counts');
    assert.equal(listed.designs.find(d => d.appDesignId === 'd2').active, false);
    assert.deepEqual(listed.folders, ['Coatings/AR', 'Empty'], 'and the project folders, empty ones included');
    const named = (await ask('read', { appDesignId: 'd2' })).result;
    assert.deepEqual([named.appDesignId, named.active, named.design], ['d2', false, store.designs.d2], 'any design can be read');
    assert.equal((await ask('read', { appDesignId: 'gone' })).error?.code, 'unknown');
    ctx().beginOptimization();
    redraw();
    assert.equal((await ask('read')).result.appRunning, true, 'a read during a window\'s run says the copy is that run\'s latest step');
    ctx().endOptimization();
    store.setActiveDesignId(null);
    redraw();
    assert.equal((await ask('read')).error?.code, 'noDesign', 'with none open a read must name a design');
    store.setActiveDesignId('d1');
    redraw();
}

// ── A write ─────────────────────────────────────────────────────────────────
const AGENT_LAYERS = [{ id: 'n1', material: 'builtin:SiO2', thickness: 50, locked: false }];
{
    const read = (await ask('read')).result;
    const past = store.historyRef.current.d1?.past.length ?? 0;
    const answer = await ask('apply', {
        appDesignId: 'd1', revision: read.revision,
        design: { ...read.design, id: 'agent id', name: 'Agent name', frontLayers: AGENT_LAYERS },
    });
    assert.ok(answer.result, JSON.stringify(answer.error));
    assert.deepEqual(store.designs.d1.frontLayers, AGENT_LAYERS, 'the agent\'s layers are the design\'s');
    assert.deepEqual([store.designs.d1.id, store.designs.d1.name], ['d1', 'Mine'], 'which keeps its id and its name');
    assert.equal(store.historyRef.current.d1.past.length, past + 1, 'one undo step');
    assert.equal(answer.result.design, store.designs.d1, 'the answer is the design as the store now holds it');
    assert.equal(answer.result.revision, revisionOf(store.designs.d1), 'at its new token');
    assert.notEqual(answer.result.revision, read.revision);
    assert.deepEqual(notices.at(-1), { type: 'info', message: t.dialogs.agentChanged('Mine') }, 'a notice names the design and says Ctrl+Z undoes it');
    const again = await ask('apply', { appDesignId: 'd1', revision: answer.result.revision, design: { ...answer.result.design, frontLayers: [] } });
    assert.ok(again.result, 'the agent writes again at the token it was answered with');
    store.undo();
    store.undo();
    redraw();
    assert.deepEqual(store.designs.d1, read.design, 'two Undos put the design back as it was before the agent\'s two writes');
}

// ── A write the window gets late ────────────────────────────────────────────
// Past the deadline the main process has told the agent the app did not
// answer, so the write must not land after all.
{
    const read = (await ask('read')).result;
    const edit = { appDesignId: 'd1', revision: read.revision, design: { ...read.design, frontLayers: AGENT_LAYERS } };
    const designs = store.designs;
    const noticed = notices.length;
    assert.equal((await ask('apply', edit, Date.now() - 1)).error?.code, 'timeout', 'a write handled after its deadline is refused');
    assert.equal(store.designs, designs, 'it writes nothing');
    assert.equal(notices.length, noticed, 'and raises no notice');
    assert.ok((await ask('apply', edit)).result, 'the same write in time is written');
    assert.deepEqual(store.designs.d1.frontLayers, AGENT_LAYERS);
    store.undo();
    redraw();
    assert.deepEqual(store.designs.d1, read.design);
}

// ── Refusals ────────────────────────────────────────────────────────────────
// In order: the undo takes back the edit before it.
for (const [what, change, reason, undoChange] of [
    ['an edit', () => ctx().updateLayer('front', 'l1', { thickness: 777 }), 'edited'],
    ['an undo', () => store.undo(), 'edited'],
    ['another design opened', () => store.setActiveDesignId('d2'), 'switched', () => store.setActiveDesignId('d1')],
    ['the design closed', () => store.setActiveDesignId(null), 'switched', () => store.setActiveDesignId('d1')],
    ['a window\'s optimization run', () => ctx().beginOptimization(), 'optimizing', () => ctx().endOptimization()],
]) {
    const read = (await ask('read')).result;
    change();
    redraw();
    const designs = store.designs;
    const noticed = notices.length;
    const answer = await ask('apply', { appDesignId: 'd1', revision: read.revision, design: { ...read.design, frontLayers: AGENT_LAYERS } });
    assert.equal(answer.error?.code, reason, `${what} after the read: refused as ${reason}`);
    assert.equal(store.designs, designs, `${what} after the read: nothing is written`);
    assert.equal(notices.length, noticed, `${what} after the read: no notice`);
    undoChange?.();
    redraw();
}
{
    const noticed = notices.length;
    const read = (await ask('read', { appDesignId: 'd2' })).result;
    const answer = await ask('apply', { appDesignId: 'd2', revision: read.revision, design: read.design });
    assert.equal(answer.error?.code, 'switched', 'a design that is not the open one is never written');
    const open = (await ask('read')).result;
    store.dropDesigns(['d1']);
    store.setActiveDesignId(null);
    redraw();
    const designs = store.designs;
    assert.equal((await ask('apply', { appDesignId: 'd1', revision: open.revision, design: open.design })).error?.code, 'switched', 'nor one deleted since it was read');
    assert.equal(store.designs, designs);
    assert.equal(notices.length, noticed, 'and neither raises a notice');
}

// ── Opening, adding and deleting ────────────────────────────────────────────
// As the refusals left it: no design open, which is how the app starts.
const turns = async n => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
{
    assert.equal(store.activeDesignId, null, 'no design is open');
    const opened = await ask('select', { appDesignId: 'd2' });
    assert.deepEqual(clicks, [['d2', 'Coatings/AR']], 'opening a design clicks its row in its folder');
    assert.equal(store.activeDesignId, 'd2', 'and it is the open design by the time the agent hears');
    assert.deepEqual(opened.result, {
        appDesignId: 'd2', name: 'Other', folder: 'Coatings/AR', active: true, unsaved: false, frontLayers: 2, backLayers: 0,
    }, 'which is answered as the list shows it');
    const read = (await ask('read')).result;
    assert.ok((await ask('apply', { appDesignId: 'd2', revision: read.revision, design: { ...read.design, frontLayers: AGENT_LAYERS } })).result,
        'so the agent\'s write to it is written');
    assert.equal((await ask('select', { appDesignId: 'gone' })).error?.code, 'unknown', 'a design no folder shows cannot be opened');
    assert.equal(clicks.length, 1, 'and nothing is clicked');

    const design = { ...makeSampleDesign(), id: 'agent-id', name: 'Agent AR' };
    const adding = ask('add', { design });
    const addId = lastId;
    await until(() => fileWrites.length);
    fileWrites.shift()();
    await turns(10);
    assert.ok(!replies.has(addId), 'an add is not answered before the app renders what it added');
    redraw();
    const added = (await adding).result;
    const id = added?.appDesignId;
    assert.ok(id && id !== 'agent-id' && store.designs[id]?.name === 'Agent AR', 'the agent\'s design is added under an id of its own');
    assert.ok(store.designs[id].frontLayers.every((layer, i) => layer.id !== design.frontLayers[i].id), 'and layer ids of its own');
    assert.deepEqual([added.active, added.folder, added.revision], [true, 'Coatings/AR', revisionOf(store.designs[id])],
        'into the folder the explorer has selected, open, at the token of what the store holds');
    assert.deepEqual(notices.at(-1), { type: 'info', message: t.dialogs.agentAdded('Agent AR') }, 'a notice names it');
    assert.ok((await ask('apply', { appDesignId: id, revision: added.revision, design: { ...added.design, frontLayers: AGENT_LAYERS } })).result,
        'and the agent writes to it at once');

    const blank = ask('add', { folder: 'Empty' });
    await until(() => fileWrites.length);
    fileWrites.shift()();
    redraw();
    const made = (await blank).result;
    assert.deepEqual([made?.appDesignId, made?.folder, made?.design.frontLayers.length], ['blank', 'Empty', 0],
        'with no design given, a blank one goes into the folder named');
    assert.equal((await ask('add', { folder: 'Nowhere' })).error?.code, 'noFolder', 'a folder the app does not have is refused');
    assert.equal(fileWrites.length, 0, 'with no file written');

    assert.equal((await ask('delete', { appDesignId: id })).error?.code, 'unsaved', 'a design with unsaved edits is not deleted');
    assert.equal(fileWrites.length, 0, 'and its file is not touched');
    const noticed = notices.length;
    deleteAnswer = 'noBin';
    const refused = ask('delete', { appDesignId: 'blank' });
    await until(() => fileWrites.length);
    fileWrites.shift()();
    assert.equal((await refused).error?.code, 'noBin', 'a design whose file the Recycle Bin did not take is refused');
    assert.equal(notices.length, noticed, 'with no notice');
    deleteAnswer = 'deleted';
    const deleting = ask('delete', { appDesignId: 'blank' });
    const deleteId = lastId;
    await until(() => fileWrites.length);
    fileWrites.shift()();
    await turns(10);
    assert.ok(!replies.has(deleteId), 'a delete is not answered before the app renders the tree without it');
    redraw();
    assert.deepEqual((await deleting).result, { appDesignId: 'blank', name: 'Design 1', folder: 'Empty' }, 'then it is answered with the design deleted');
    assert.deepEqual(notices.at(-1), { type: 'info', message: t.dialogs.agentDeleted('Design 1') }, 'a notice names it and says where its file went');
    assert.ok(!(await ask('designs')).result.designs.some(d => d.appDesignId === 'blank'), 'and the list no longer has it');

    // An agent's tool calls can come at once; the host takes them in turn.
    const first = ask('add', { design });
    const firstId = lastId;
    const second = ask('add', { design });
    await until(() => fileWrites.length);
    await turns(10);
    assert.equal(fileWrites.length, 1, 'of two adds sent at once, the second writes no file before the first is answered');
    fileWrites.shift()();
    redraw();
    await until(() => replies.has(firstId));
    await until(() => fileWrites.length);
    fileWrites.shift()();
    redraw();
    const [one, two] = [(await first).result, (await second).result];
    assert.ok(one && two && one.appDesignId !== two.appDesignId, 'then both are added, each under an id of its own');
    assert.deepEqual([one.active, two.active, store.activeDesignId], [true, true, two.appDesignId], 'each open when it is answered');
}

globalThis.ReactDOM = RealReactDOM;
console.log('PASS: live_bridge_store');
