/**
 * The window's side of Interactive: the button (components/Toolbar.js), the
 * hold and the question (components/live/LiveDialogs.js, appHold.js) and the
 * cover over a torn-off window (components/docking/PopoutWindow.js). Each
 * component runs under a stand-in for React of its own that runs effects
 * (_effectRuntime.mjs).
 *
 *   1. The button is on the Optimization tab beside Script Console in every
 *      language, and a click reaches Interactive, which asks the desktop app
 *      to start listening; a failure is said in a notice, and the web demo
 *      says Interactive is the desktop app's.
 *   2. The hold window follows the main process: none until Interactive is
 *      on or a program is in, then "Waiting for a program to connect", then
 *      "Connected:" and the programs' names, a nameless one named as such, in
 *      every language; Terminate asks the main process to end it. Its
 *      backdrop covers the whole window, above every other dialog.
 *   3. While it is up the app is held: a key pressed anywhere but on it
 *      reaches nothing, so Ctrl+Z, Ctrl+O, Ctrl+N and F5 neither edit, open
 *      another design nor start a run, and a key pressed on it works its
 *      button and reaches nothing either; focus that leaves it comes back. A
 *      torn-off window is covered and its keyboard shut out too, and its tool
 *      is not mounted again. Taken down, every key acts again.
 *   4. The question: a program that asks to come in is asked about with its
 *      name, one question at a time in the order they came, above the hold,
 *      so its buttons take a press while a program holds the app, and Allow
 *      and Deny answer it.
 *   5. Terminate leaves each change a program made: two writes stay, one undo
 *      step each.
 *   6. A design handed over while the app is held, from the command line or
 *      from the file manager through the copy already running, opens nothing
 *      and switches nothing: it waits, and opens once the app is given back,
 *      the designs that waited in the order they came. Not held, it opens at
 *      once.
 *
 * Run: node tests/live_bridge_hold.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const RealReact = globalThis.React;
const RealReactDOM = globalThis.ReactDOM;
const shimDocument = globalThis.document;

// React for the modules under test: a hook goes to the stand-in of the
// component being run (mount), or to React itself in a server render.
let current = null;
const Shim = { ...RealReact };
for (const name of ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext']) {
    Shim[name] = (...args) => (current ?? RealReact)[name](...args);
}
Shim.useSyncExternalStore = (...args) => (current ? args[1]() : RealReact.useSyncExternalStore(...args));
const mount = () => {
    const runtime = makeEffectRuntime(RealReact);
    return {
        render: draw => {
            const before = current;
            current = runtime;
            try { return runtime.run(draw); } finally { current = before; }
        },
        unmount: () => runtime.unmount(),
    };
};
globalThis.React = Shim;
await loadApp();
const { Toolbar, makeTabs, ICONS } = await import('../src/components/Toolbar.js');
const { useAppCommands } = await import('../src/hooks/useAppCommands.js');
const { LiveDialogs, LiveHoldDialog, LiveAskDialog, startInteractive } = await import('../src/components/live/LiveDialogs.js');
const { LIVE_DIALOG, holdKeys, setAppHeld, useAppHeld } = await import('../src/components/live/appHold.js');
const { PopoutWindow } = await import('../src/components/docking/PopoutWindow.js');
const { DesignContext, DesignProvider } = await import('../src/state/DesignContext.js');
const { useDesignStore } = await import('../src/hooks/useDesignStore.js');
const { LiveBridgeHost } = await import('../src/components/live/LiveBridgeHost.js');
const { useDesignImport } = await import('../src/hooks/useDesignImport.js');

const h = RealReact.createElement;
const c = makeTheme();
const t = makeLocale('en');
const LOCALES = ['en', 'ru', 'zh', 'it'];
const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
function* walk(node) {
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    if (!node || typeof node !== 'object' || !node.props) return;
    yield node;
    yield* walk(node.props.children);
}
const button = (tree, label) => [...walk(tree)].find(el => el.type === 'button' && [].concat(el.props.children).includes(label));
const heldNow = () => renderToStaticMarkup(h(() => String(useAppHeld()))) === 'true';

// ── 1. The button ───────────────────────────────────────────────────────────
for (const code of LOCALES) {
    const tl = makeLocale(code);
    const scripts = makeTabs(tl).find(tab => tab.key === 'optimization').groups.find(group => group.key === 'scripts');
    assert.deepEqual(scripts.items.map(item => item.id), ['script-console', 'interactive'], `${code}: Interactive is beside Script Console`);
    localStorage.setItem('tfstudio-ribbon-tab', 'optimization');
    localStorage.setItem('tfstudio-ribbon-collapsed', '0');
    const html = renderToStaticMarkup(h(Toolbar, { c, t: tl, onToolAction() {}, onMenuAction() {} }));
    assert.ok(html.includes(`title="${esc(tl.toolbar.tooltips.interactive)}"`) && html.includes(`>${esc(tl.toolbar.buttons.interactive)}</span>`),
        `${code}: the button shows its label and tooltip`);
}
assert.ok(ICONS.interactive, 'the button has an icon');
{
    let clicked = 0;
    const opened = [];
    const commands = mount().render(() => useAppCommands({
        store: {}, project: {}, dialogs: {}, welcome: {}, locale: 'en',
        workspace: { openTool: id => opened.push(id) }, onInteractive: () => { clicked++; },
    }));
    commands.handleToolAction('interactive');
    assert.deepEqual([clicked, opened], [1, []], 'a click reaches Interactive and opens no window');

    const notices = [];
    const notify = notice => notices.push(notice);
    let asked = 0;
    globalThis.electronAPI = { startInteractive: async () => { asked++; return { open: true }; } };
    await startInteractive(t, notify);
    assert.deepEqual([asked, notices], [1, []], 'Interactive asks the desktop app to start listening');
    globalThis.electronAPI.startInteractive = async () => ({ open: false, error: 'EACCES' });
    await startInteractive(t, notify);
    assert.deepEqual(notices.pop(), { type: 'error', message: t.live.failed('EACCES') }, 'a failure is said in a notice');
    delete globalThis.electronAPI.startInteractive;
    await startInteractive(t, notify);
    assert.deepEqual(notices.pop(), { type: 'info', message: t.live.desktopOnly }, 'the web demo says Interactive is the desktop app\'s');
}

// ── 2. The hold window ──────────────────────────────────────────────────────
let onState = null;
let onAsk = null;
const answered = [];
let terminated = 0;
globalThis.electronAPI = {
    onLiveState: cb => { onState = cb; return () => { onState = null; }; },
    onLiveAsk: cb => { onAsk = cb; return () => { onAsk = null; }; },
    answerLive: (id, allowed) => answered.push([id, allowed]),
    terminateLive: () => { terminated++; onState({ interactive: false, programs: [] }); },
};
const dialogs = mount();
const drawDialogs = () => [].concat(dialogs.render(() => LiveDialogs({ c, t })).props.children).filter(Boolean);
assert.deepEqual(drawDialogs(), [], 'nothing is drawn while the app is not held');
assert.ok(onState && onAsk, 'the dialogs follow the main process');
{
    onState({ interactive: true, programs: [] });
    const [hold] = drawDialogs();
    assert.equal(hold?.type, LiveHoldDialog, 'Interactive on: the hold window');
    for (const code of LOCALES) {
        const tl = makeLocale(code);
        const waiting = renderToStaticMarkup(h(LiveHoldDialog, { ...hold.props, t: tl }));
        for (const shown of [tl.live.title, tl.live.waiting, tl.live.holdHint, tl.live.terminate]) {
            assert.ok(waiting.includes(esc(shown)), `${code}: ${shown}`);
        }
        const connected = renderToStaticMarkup(h(LiveHoldDialog, { ...hold.props, t: tl, programs: ['python.exe', null] }));
        assert.ok(connected.includes(esc(tl.live.connected(`python.exe, ${tl.live.unnamed}`))), `${code}: the programs connected, by name`);
        assert.ok(!connected.includes(esc(tl.live.waiting)), `${code}: and no longer waiting`);
    }
    onState({ interactive: false, programs: ['claude-code'] });
    const [byProgram] = drawDialogs();
    assert.deepEqual(byProgram?.props.programs, ['claude-code'], 'a program let in holds the app too, without Interactive');

    const holdMount = mount();
    const tree = holdMount.render(() => LiveHoldDialog(byProgram.props));
    const style = tree.props.style;
    assert.deepEqual([style.position, style.top, style.left, style.right, style.bottom], ['fixed', 0, 0, 0, 0], 'the backdrop covers the whole window');
    assert.ok(style.zIndex > 10003, 'above every other dialog and the guided tour');
    assert.equal([...walk(tree)].filter(el => el.props[LIVE_DIALOG] !== undefined).length, 1, 'its panel is the live link\'s dialog');
    button(tree, t.live.terminate).props.onClick();
    assert.equal(terminated, 1, 'Terminate asks the main process to end it');
    holdMount.unmount();
    assert.deepEqual(drawDialogs(), [], 'and once it has, the hold is gone');
}

// ── 3. The hold ─────────────────────────────────────────────────────────────
// Nodes that pass a key on as the DOM does: down from the window through the
// document's capture listeners to the target, then back up through the
// document's and the window's own, stopPropagation ending it after the node
// it is called at.
const node = () => {
    const listeners = [];
    const isCapture = option => option === true || option?.capture === true;
    return {
        listeners,
        addEventListener: (type, fn, option) => listeners.push({ type, fn, capture: isCapture(option) }),
        removeEventListener: (type, fn, option) => {
            const at = listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === isCapture(option));
            if (at >= 0) listeners.splice(at, 1);
        },
    };
};
function dispatch(path, init) {
    const event = {
        ...init, target: path.at(-1), defaultPrevented: false, stopped: false,
        stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; },
    };
    const call = (at, capture) => {
        for (const l of [...at.listeners]) if (l.type === event.type && (capture === null || l.capture === capture)) l.fn(event);
        return event.stopped;
    };
    const above = path.slice(0, -1);
    if (above.some(at => call(at, true)) || call(path.at(-1), null)) return event;
    [...above].reverse().some(at => call(at, false));
    return event;
}
function makeWindow() {
    const win = node();
    const doc = node();
    win.document = doc;
    const element = (dialog) => ({
        ...node(), isConnected: true,
        closest: selector => (selector === `[${LIVE_DIALOG}]` ? dialog : null),
        focus() { doc.activeElement = this; dispatch([win, doc, this], { type: 'focusin' }); },
        blur() { if (doc.activeElement === this) doc.activeElement = null; },
    });
    return { win, doc, element };
}
{
    const { win, doc, element } = makeWindow();
    const terminateButton = element({ dialog: true });
    const thicknessCell = element(null);
    doc.activeElement = thicknessCell;
    const did = [];
    // The app's shortcuts, as useAppCommands listens for them on the document,
    // and a run window's F5, as the Refinement window listens on the window.
    globalThis.document = doc;
    const commandsMount = mount();
    commandsMount.render(() => useAppCommands({
        store: { undo: () => did.push('undo'), redo: () => did.push('redo') },
        project: { addItem: () => did.push('new design'), openDesignFromFile: () => did.push('open design'), saveDesignToDisk() {} },
        workspace: {}, dialogs: {}, welcome: {}, locale: 'en', onInteractive() {},
    }));
    globalThis.document = shimDocument;
    win.addEventListener('keydown', event => { if (event.key === 'F5') did.push('run'); });
    const KEYS = [
        { key: 'z', code: 'KeyZ', ctrlKey: true }, { key: 'o', code: 'KeyO', ctrlKey: true },
        { key: 'n', code: 'KeyN', ctrlKey: true }, { key: 'F5', code: 'F5' },
    ];
    const press = (target, key) => dispatch([win, doc, target], { type: 'keydown', ...key });
    const ACTED = ['undo', 'open design', 'new design', 'run'];
    for (const key of KEYS) press(thicknessCell, key);
    assert.deepEqual(did, ACTED, 'without the hold each key acts');

    const holdMount = mount();
    const realWindow = globalThis.window;
    globalThis.window = win;
    try {
        holdMount.render(() => LiveHoldDialog({ c, t, programs: [], onTerminate() {} }));
    } finally {
        globalThis.window = realWindow;
    }
    assert.ok(heldNow(), 'the hold window holds the app');
    assert.equal(doc.activeElement, null, 'and takes focus off the window behind');
    did.length = 0;
    for (const key of KEYS) {
        assert.ok(press(thicknessCell, key).defaultPrevented, `${key.key} on a field behind does nothing there`);
        for (const type of ['keypress', 'keyup']) assert.ok(dispatch([win, doc, thicknessCell], { type, ...key }).defaultPrevented, `nor its ${type}`);
    }
    for (const key of [...KEYS, { key: 'Enter', code: 'Enter' }]) {
        assert.ok(!press(terminateButton, key).defaultPrevented, `${key.key} on Terminate works its button`);
    }
    assert.deepEqual(did, [], 'while held no key edits, opens another design or starts a run');
    terminateButton.focus();
    thicknessCell.focus();
    assert.equal(doc.activeElement, terminateButton, 'focus that leaves the hold comes back to it');

    holdMount.unmount();
    assert.ok(!heldNow(), 'taken down, the app is given back');
    for (const key of KEYS) press(thicknessCell, key);
    assert.deepEqual(did, ACTED, 'and every key acts again');
    thicknessCell.focus();
    assert.equal(doc.activeElement, thicknessCell, 'and focus stays where it is put');
    commandsMount.unmount();
}
{
    // A torn-off window, as window.open gives one.
    const { win: popup, doc: popupDoc, element } = makeWindow();
    Object.assign(popupDoc, {
        title: '', activeElement: null, head: { appendChild() {} }, body: { style: {}, appendChild() {} },
        documentElement: { setAttribute() {}, removeAttribute() {} }, createElement: () => ({ nodeType: 1, style: {} }),
    });
    popup.close = () => {};
    const realOpen = globalThis.open;
    globalThis.open = () => popup;
    const tool = h('div', null, 'a tool window');
    const popoutMount = mount();
    const children = () => [].concat(popoutMount.render(() => PopoutWindow({ id: 'p1', title: 'Spectrum', children: tool })).children.props.children);
    assert.deepEqual(children(), [tool, false], 'a torn-off window shows its tool, uncovered while the app is not held');
    setAppHeld(true);
    const [kept, cover] = children();
    assert.equal(kept, tool, 'held, it keeps the tool where it was, so the tool is not mounted again');
    assert.equal(cover?.props.win, popup, 'and covers the window');
    const coverMount = mount();
    const style = coverMount.render(() => cover.type(cover.props)).props.style;
    assert.deepEqual([style.position, style.top, style.left, style.right, style.bottom], ['fixed', 0, 0, 0, 0], 'the cover takes the whole window');
    let reached = 0;
    popupDoc.addEventListener('keydown', () => { reached++; });
    const field = element(null);
    assert.ok(dispatch([popup, popupDoc, field], { type: 'keydown', key: 'z', code: 'KeyZ', ctrlKey: true }).defaultPrevented && reached === 0,
        'and shuts its keyboard out');
    coverMount.unmount();
    setAppHeld(false);
    assert.deepEqual(children(), [tool, false], 'given back, the cover goes');
    dispatch([popup, popupDoc, field], { type: 'keydown', key: 'z', code: 'KeyZ', ctrlKey: true });
    assert.equal(reached, 1, 'and its keys reach it again');
    popoutMount.unmount();
    globalThis.open = realOpen;
}

// ── 4. The question ─────────────────────────────────────────────────────────
{
    onAsk({ id: 7, program: 'python.exe' });
    onAsk({ id: 8, program: null });
    let [ask] = drawDialogs();
    assert.equal(ask?.type, LiveAskDialog, 'a program that asks to come in is asked about');
    assert.equal(ask.props.ask.id, 7, 'one question at a time, the first that came first');
    for (const code of LOCALES) {
        const tl = makeLocale(code);
        const html = renderToStaticMarkup(h(LiveAskDialog, { ...ask.props, t: tl }));
        for (const shown of [tl.live.asks('python.exe'), tl.live.askHint, tl.live.allow, tl.live.deny]) assert.ok(html.includes(esc(shown)), `${code}: ${shown}`);
    }
    assert.ok(t.live.asks('python.exe').startsWith('python.exe '), 'the question names the program');
    const holdMount = mount();
    const holdZ = holdMount.render(() => LiveHoldDialog({ c, t, programs: ['claude-code'], onTerminate() {} })).props.style.zIndex;
    holdMount.unmount();
    assert.ok(LiveAskDialog(ask.props).props.style.zIndex > holdZ, 'above the hold, so Allow and Deny take a press while a program holds the app');
    button(LiveAskDialog(ask.props), t.live.allow).props.onClick();
    [ask] = drawDialogs();
    assert.deepEqual([answered, ask?.props.ask.id], [[[7, true]], 8], 'Allow answers it, and the next question follows');
    assert.ok(renderToStaticMarkup(h(LiveAskDialog, ask.props)).includes(esc(t.live.asks(null))), 'a program with no name is asked about as such');
    button(LiveAskDialog(ask.props), t.live.deny).props.onClick();
    assert.deepEqual([answered.at(-1), drawDialogs()], [[8, false], []], 'Deny answers it');
}

// ── 5. Terminate leaves each change ─────────────────────────────────────────
{
    let onRequest = null;
    const replies = new Map();
    Object.assign(globalThis.electronAPI, {
        onLiveRequest: cb => { onRequest = cb; return () => { onRequest = null; }; },
        liveReply: (id, answer) => replies.set(id, answer),
    });
    const appMount = mount();
    const hostMount = mount();
    let store;
    const redraw = () => {
        appMount.render(() => {
            store = useDesignStore({});
            DesignContext.value = DesignProvider({
                activeDesignId: store.activeDesignId, designs: store.designs, folders: [],
                onDesignChange: store.handleDesignChange, onCheckpoint: store.pushCheckpoint,
                historyView: store.historyView, onJumpToHistory: store.jumpToHistory,
            }).props.value;
        });
        hostMount.render(() => LiveBridgeHost({ t, notify() {}, dirtyDesigns: store.dirtyDesigns }));
    };
    globalThis.ReactDOM = { ...RealReactDOM, flushSync: (write) => { write(); redraw(); } };
    redraw();
    const before = { ...makeSampleDesign(), id: 'd1', name: 'Mine' };
    store.setDesigns({ d1: before });
    store.setActiveDesignId('d1');
    redraw();
    let lastId = 0;
    const ask = (method, params = {}) => {
        const id = ++lastId;
        onRequest({ id, method, params, deadline: Date.now() + 1000 });
        return replies.get(id);
    };
    onState({ interactive: true, programs: ['python.exe'] });
    const first = ask('read').result;
    const once = ask('apply', { appDesignId: 'd1', revision: first.revision, design: { ...first.design, frontLayers: first.design.frontLayers.slice(0, 1) } }).result;
    const twice = ask('apply', { appDesignId: 'd1', revision: once.revision, design: { ...once.design, frontLayers: [] } }).result;
    assert.ok(once && twice, 'the program writes twice');
    const steps = store.historyRef.current.d1.past.length;
    const holdMount = mount();
    button(holdMount.render(() => LiveHoldDialog({ c, t, programs: ['python.exe'], onTerminate: () => window.electronAPI.terminateLive() })), t.live.terminate).props.onClick();
    holdMount.unmount();
    redraw();
    assert.deepEqual(drawDialogs(), [], 'Terminate gives the app back');
    assert.deepEqual([store.designs.d1.frontLayers, store.historyRef.current.d1.past.length], [[], steps], 'and leaves the program\'s changes as they are');
    store.undo();
    redraw();
    assert.deepEqual(store.designs.d1.frontLayers, once.design.frontLayers, 'Ctrl+Z takes back the last change alone');
    store.undo();
    redraw();
    assert.deepEqual(store.designs.d1, before, 'and again the one before it');
    globalThis.ReactDOM = RealReactDOM;
}

// ── 6. A design handed over while held ──────────────────────────────────────
{
    let handOver = null;
    const shown = [];
    const settled = () => new Promise(resolve => setImmediate(resolve));
    const COMMAND_LINE = 'Named on the command line.tfs';
    Object.assign(globalThis.electronAPI, {
        takePendingOpenFile: async () => COMMAND_LINE,
        onOpenFile: cb => { handOver = cb; return () => { handOver = null; }; },
        // The first file is read slower than the rest, so opens that did not
        // wait for each other would come out of order.
        openTfsPath: async filePath => {
            if (filePath === COMMAND_LINE) await settled();
            return { success: true, folderId: 'f1', design: { id: filePath } };
        },
    });
    const folders = [{ id: 'f1', items: [] }];
    const tree = {
        foldersLoaded: true, foldersRef: { current: folders }, selectedFolder: folders[0], commitNewDesign() {},
        selectDesignInTree: id => { shown.push(id); return true; },
    };
    // Each open answers within a few turns of the event loop.
    const opened = async count => { for (let turn = 0; turn < 20 && shown.length < count; turn++) await settled(); };
    const importMount = mount();
    const draw = () => importMount.render(() => useDesignImport({ tree, addItemFromDesign: async () => true, openTool() {}, setMessageNotification() {}, t }));
    setAppHeld(true);
    draw();
    await settled();
    await handOver('A.tfs');
    await handOver('B.tfs');
    await opened(1);
    assert.deepEqual(shown, [], 'held, a design handed over opens nothing and switches nothing');
    setAppHeld(false);
    draw();
    await opened(3);
    assert.deepEqual(shown, [COMMAND_LINE, 'A.tfs', 'B.tfs'], 'given back, the designs that waited open in the order they came');
    setAppHeld(true);
    draw();
    setAppHeld(false);
    draw();
    await opened(4);
    assert.equal(shown.length, 3, 'each of them once');
    await handOver('C.tfs');
    assert.equal(shown.at(-1), 'C.tfs', 'not held, a design opens at once');
    importMount.unmount();
}

dialogs.unmount();
globalThis.React = RealReact;
console.log('PASS: live_bridge_hold');
