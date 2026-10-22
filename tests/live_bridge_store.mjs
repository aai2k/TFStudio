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
const folders = [{ id: 'Coatings/AR', items: [{ id: 'd1' }, { id: 'd2' }] }];

// The desktop app's side: each request handed to the host, its reply kept.
let onRequest = null;
const replies = new Map();
globalThis.electronAPI = {
    onLiveRequest: (cb) => { onRequest = cb; return () => { onRequest = null; }; },
    liveReply: (id, answer) => replies.set(id, answer),
};
// Each request with a deadline, as the main process sends it; the host answers
// at once here, so a second ahead is never reached.
let lastId = 0;
const ask = (method, params = {}, deadline = Date.now() + 1000) => {
    const id = ++lastId;
    onRequest({ id, method, params, deadline });
    return replies.get(id);
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
const renderHost = () => as(host, () => host.run(() => LiveBridgeHost({ t, notify: n => notices.push(n), dirtyDesigns: store.dirtyDesigns })));
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
    assert.equal(ask('read').result.revision, seen[0], 'and it is the one a read hands the agent');
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
    const stale = ask('apply', { appDesignId: 'd1', revision: fromReload, design: store.designs.d1 });
    assert.equal(stale.error?.code, 'edited', 'so a token from before a reload or a restart never matches');
    store.setDesigns(prev => ({ ...prev, d1: before }));
    redraw();
}

// ── What the agent sees ─────────────────────────────────────────────────────
{
    ctx().updateLayer('front', 'l2', { thickness: 95 });
    redraw();
    const listed = ask('designs').result;
    assert.equal(listed.activeDesignId, 'd1');
    assert.deepEqual(listed.designs.find(d => d.appDesignId === 'd1'), {
        appDesignId: 'd1', name: 'Mine', folder: 'Coatings/AR', active: true, unsaved: true, frontLayers: 2, backLayers: 0,
    }, 'each design with its folder, whether it is the open one, whether it is unsaved, and its layer counts');
    assert.equal(listed.designs.find(d => d.appDesignId === 'd2').active, false);
    const named = ask('read', { appDesignId: 'd2' }).result;
    assert.deepEqual([named.appDesignId, named.active, named.design], ['d2', false, store.designs.d2], 'any design can be read');
    assert.equal(ask('read', { appDesignId: 'gone' }).error?.code, 'unknown');
    ctx().beginOptimization();
    redraw();
    assert.equal(ask('read').result.appRunning, true, 'a read during a window\'s run says the copy is that run\'s latest step');
    ctx().endOptimization();
    store.setActiveDesignId(null);
    redraw();
    assert.equal(ask('read').error?.code, 'noDesign', 'with none open a read must name a design');
    store.setActiveDesignId('d1');
    redraw();
}

// ── A write ─────────────────────────────────────────────────────────────────
const AGENT_LAYERS = [{ id: 'n1', material: 'builtin:SiO2', thickness: 50, locked: false }];
{
    const read = ask('read').result;
    const past = store.historyRef.current.d1?.past.length ?? 0;
    const answer = ask('apply', {
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
    const again = ask('apply', { appDesignId: 'd1', revision: answer.result.revision, design: { ...answer.result.design, frontLayers: [] } });
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
    const read = ask('read').result;
    const edit = { appDesignId: 'd1', revision: read.revision, design: { ...read.design, frontLayers: AGENT_LAYERS } };
    const designs = store.designs;
    const noticed = notices.length;
    assert.equal(ask('apply', edit, Date.now() - 1).error?.code, 'timeout', 'a write handled after its deadline is refused');
    assert.equal(store.designs, designs, 'it writes nothing');
    assert.equal(notices.length, noticed, 'and raises no notice');
    assert.ok(ask('apply', edit).result, 'the same write in time is written');
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
    const read = ask('read').result;
    change();
    redraw();
    const designs = store.designs;
    const noticed = notices.length;
    const answer = ask('apply', { appDesignId: 'd1', revision: read.revision, design: { ...read.design, frontLayers: AGENT_LAYERS } });
    assert.equal(answer.error?.code, reason, `${what} after the read: refused as ${reason}`);
    assert.equal(store.designs, designs, `${what} after the read: nothing is written`);
    assert.equal(notices.length, noticed, `${what} after the read: no notice`);
    undoChange?.();
    redraw();
}
{
    const noticed = notices.length;
    const read = ask('read', { appDesignId: 'd2' }).result;
    const answer = ask('apply', { appDesignId: 'd2', revision: read.revision, design: read.design });
    assert.equal(answer.error?.code, 'switched', 'a design that is not the open one is never written');
    const open = ask('read').result;
    store.dropDesigns(['d1']);
    store.setActiveDesignId(null);
    redraw();
    const designs = store.designs;
    assert.equal(ask('apply', { appDesignId: 'd1', revision: open.revision, design: open.design }).error?.code, 'switched', 'nor one deleted since it was read');
    assert.equal(store.designs, designs);
    assert.equal(notices.length, noticed, 'and neither raises a notice');
}

globalThis.ReactDOM = RealReactDOM;
console.log('PASS: live_bridge_store');
