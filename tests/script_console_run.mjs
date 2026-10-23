/**
 * The Script Console window around a run (scriptConsole/useScriptRun.js),
 * drawn as the app draws it: the window under a stand-in for React that runs
 * effects and unmounts (_effectRuntime.mjs), the app's design store and design
 * context (useDesignStore, DesignProvider) wired as App.js wires them, and a
 * stand-in for the desktop app's runScript, stopScript and onScriptOutput.
 *
 * Run sends the open design, or null with none open. What the script prints
 * shows as it comes, the newest lines within the output's bounds
 * (src/scripts/outputBounds.js) with the count of those not shown, and nothing
 * of a run shows once it has answered. A result is applied to the design the run
 * started on as one undo step, and not after an edit, an undo or a design
 * switch, or while another window's optimization run is on, when the output
 * says why. The Stop button asks the main process to end the run; closing,
 * hiding or moving the window does too, the output then says so, and an answer
 * that comes after applies nothing. With no run on, the window goes and comes
 * back with nothing asked and nothing added. Ctrl+Enter in the editor runs;
 * Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+O and Ctrl+N stay in the editor and never reach
 * the document's listener, while a chord the editor does not keep does.
 *
 * The script in the editor, with the file it was last saved to and its
 * language, outlives closing the window and a restart, and comes back without
 * running. A copy of the window shown again does not put its script over one
 * typed since in another copy. Open asks before it replaces a script its file
 * does not hold, and Cancel keeps the script.
 *
 * The script's language follows the file opened, .py Python and .js
 * JavaScript, and the picker; a run says its language, and Save offers a file
 * of it. Choosing Python says which Python runs the script, or what is
 * missing. The line a run's error names is marked until the script is edited
 * or run again. A Python run that never started, with no Python or no folder
 * to run in, says why in the output, and the row gives it no time.
 *
 * Run: node tests/script_console_run.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const RealReact = globalThis.React;

// The app (its design store and design context) and the window hold hooks of
// their own, as two components do. A module reads React when it loads and a
// hook when it runs, so each is the global React while it does.
const app = makeEffectRuntime(RealReact);
const win = makeEffectRuntime(RealReact);
const as = (runtime, draw) => {
    globalThis.React = runtime;
    try { return draw(); } finally { globalThis.React = RealReact; }
};
globalThis.React = app;
await loadApp();
const { DesignContext, DesignProvider } = await import('../src/state/DesignContext.js');
const { useDesignStore } = await import('../src/hooks/useDesignStore.js');
globalThis.React = win;
const { ScriptConsole } = await import('../src/components/windows/optimization/scriptConsole/ScriptConsole.js');
globalThis.React = RealReact;
const { ScriptConsoleLayout } = await import('../src/components/windows/optimization/scriptConsole/ScriptConsoleLayout.js');
const { loadLastScript, scriptConsoleSession } = await import('../src/components/windows/optimization/scriptConsole/sessionState.js');
const { appShortcutFor } = await import('../src/utils/misc/appShortcuts.js');
const { OUTPUT_LINES } = await import('../src/scripts/outputBounds.js');

// The main process: each run waits for the test to answer it.
const main = { runs: [], stops: [], feeds: new Set() };
globalThis.electronAPI = {
    runScript: (runId, request) => new Promise(resolve => main.runs.push({ runId, request, reply: resolve })),
    stopScript: (runId) => { main.stops.push(runId); },
    onScriptOutput: (feed) => {
        main.feeds.add(feed);
        return () => main.feeds.delete(feed);
    },
};
const print = (runId, lines, dropped = 0) => main.feeds.forEach(feed => feed(runId, lines, dropped));

let store;
function renderApp() {
    as(app, () => app.run(() => {
        store = useDesignStore({});
        DesignContext.value = DesignProvider({
            activeDesignId: store.activeDesignId, designs: store.designs, folders: [],
            onDesignChange: store.handleDesignChange, onCheckpoint: store.pushCheckpoint,
            historyView: store.historyView, onJumpToHistory: store.jumpToHistory,
        }).props.value;
    }));
}

// The tab the window is drawn in, which names its open copy
// (windowSession.js); null is a window outside the layout.
let copy = null;
win.useContext = context => (context === DesignContext ? context.value : copy);

// The app's confirm dialog: what the window last asked it to show, or null.
let dialog = null;
const setInputDialog = (next) => { dialog = next; };

const c = makeTheme();
const t = makeLocale('en');
const z = t.scriptConsole;
// What the window hands its layout.
let view;
const renderWindow = () => { view = as(win, () => win.run(() => ScriptConsole({ c, t, setInputDialog }).props)); };
const redraw = () => { renderApp(); renderWindow(); };
const output = () => scriptConsoleSession.peek(null, null).output;
const typeScript = (text) => { view.setField('text', text); renderWindow(); };

// Run pressed: the run the main process got, with `done` the window's own
// handling of it, which ends once the answer is in.
function startRun() {
    const asked = main.runs.length;
    const done = view.onRun();
    renderWindow();
    assert.equal(main.runs.length, asked + 1, 'Run asks the main process to run the script');
    return { ...main.runs.at(-1), done };
}
async function answer(run, reply) {
    run.reply(reply);
    await run.done;
    redraw();
}
// Lets what an awaited reply set going finish.
const settle = () => new Promise(resolve => setImmediate(resolve));

// The first element under `el`, depth first, that `test` picks out.
const find = (el, test) => {
    if (!el || typeof el !== 'object') return null;
    if (Array.isArray(el)) return el.reduce((hit, child) => hit || find(child, test), null);
    return test(el) ? el : find(el.props?.children, test);
};
// Run or Stop as the control row draws it, pressed.
function pressRunButton() {
    const controls = find(ScriptConsoleLayout(view), el => el.type?.name === 'Controls');
    const button = find(controls.type(controls.props), el => el.type?.name === 'RunButton');
    button.type(button.props).props.onClick();
}

redraw();

// ── No design open ──────────────────────────────────────────────────────────
assert.equal(DesignContext.value.hasActiveDesign, false);
assert.ok(DesignContext.value.design, 'windows are handed a placeholder design meanwhile');
typeScript('console.log(tf.design);');
{
    const run = startRun();
    assert.equal(run.request.design, null, 'with no design open the script gets null, not the placeholder');
    assert.equal(run.request.text, 'console.log(tf.design);');
    assert.ok(view.running, 'the window shows the run as on');
    print(run.runId, ['null']);
    print('another run', ['not this one']);
    assert.deepEqual(output(), ['null'], 'what the run prints shows as it comes, and only what this run prints');
    print(run.runId, ['x'], 4);
    assert.equal(scriptConsoleSession.peek(null, null).outputHidden, 4, 'with the count of lines a batch left out');
    await answer(run, { state: 'done' });
    print(run.runId, ['late']);
    assert.deepEqual(output(), ['null', 'x'], 'nothing of a run shows once it has answered');
    assert.equal(view.running, false);
}
{
    const run = startRun();
    assert.deepEqual(output(), [], 'Run empties the output');
    const batch = from => Array.from({ length: OUTPUT_LINES }, (_, i) => String(from + i));
    print(run.runId, batch(0), 2);
    print(run.runId, batch(OUTPUT_LINES), 3);
    assert.deepEqual(output(), batch(OUTPUT_LINES), 'the window keeps the newest lines');
    assert.equal(scriptConsoleSession.peek(null, null).outputHidden, OUTPUT_LINES + 5, 'and counts every line it does not show');
    await answer(run, { state: 'done' });
}

// ── A design open: the run gets it, and its result is one undo step ─────────
const before = { ...makeSampleDesign(), id: 'd1', name: 'Mine' };
const other = { ...makeSampleDesign(), id: 'd2', name: 'Other' };
store.setDesigns({ d1: before, d2: other });
store.setActiveDesignId('d1');
redraw();
const SCRIPT_LAYERS = [{ id: 'n', material: 'builtin:SiO2', thickness: 50, locked: false }];
const done = { state: 'done', design: { ...before, id: 'worker id', name: 'Renamed', frontLayers: SCRIPT_LAYERS } };
{
    const run = startRun();
    assert.equal(run.request.design, store.designs.d1, 'the script gets the open design');
    await answer(run, done);
    assert.equal(output().at(-1), z.applied);
    assert.deepEqual(store.designs.d1.frontLayers, SCRIPT_LAYERS, 'the script\'s layers are the design\'s');
    assert.deepEqual([store.designs.d1.id, store.designs.d1.name], ['d1', 'Mine'], 'which keeps its id and name');
    assert.equal(store.historyRef.current.d1.past.length, 1, 'one undo step');
    store.undo();
    redraw();
    assert.deepEqual(store.designs.d1, before, 'one Undo puts the design back as it was before the run');
}

// ── The design changed while the script ran ─────────────────────────────────
for (const [what, change, reason] of [
    ['an edit', () => DesignContext.value.updateLayer('front', 'l1', { thickness: 777 }), 'edited'],
    ['an undo', () => store.undo(), 'edited'],
    ['another design selected', () => store.setActiveDesignId('d2'), 'switched'],
    ['an optimization run in another window', () => DesignContext.value.beginOptimization(), 'optimizing'],
]) {
    const run = startRun();
    change();
    redraw();
    const designs = store.designs;
    await answer(run, done);
    assert.equal(output().at(-1), z.notApplied[reason], `${what} during the run: the output says why nothing was applied`);
    assert.equal(store.designs, designs, `${what} during the run: nothing is written`);
}
assert.equal(store.designs.d1.frontLayers[0].thickness, 100, 'the edit was undone, not overwritten');
DesignContext.value.endOptimization();
store.setActiveDesignId('d1');
redraw();

// ── Stop ────────────────────────────────────────────────────────────────────
{
    const run = startRun();
    pressRunButton();
    assert.deepEqual(main.stops, [run.runId], 'the Stop button drawn while the run is on asks the main process to end it');
    const designs = store.designs;
    await answer(run, { state: 'stopped' });
    assert.equal(output().at(-1), z.stoppedNote);
    assert.equal(store.designs, designs, 'and nothing is written');
}

// ── The window closed or hidden with no run on ──────────────────────────────
{
    const shownBefore = output();
    win.unmount();
    renderWindow();
    assert.equal(main.stops.length, 1, 'with no run on, closing or hiding the window asks nothing of the main process');
    assert.deepEqual(output(), shownBefore, 'and adds nothing to the output');
}

// ── The window closed or hidden mid-run ─────────────────────────────────────
{
    const run = startRun();
    print(run.runId, ['layer 1: 0.12']);
    const designs = store.designs;
    win.unmount();
    assert.deepEqual(main.stops.slice(1), [run.runId], 'closing or hiding the window ends its run');
    assert.deepEqual(output(), ['layer 1: 0.12', z.stoppedClosed], 'and the output says it was stopped and why');
    run.reply(done);
    await run.done;
    renderApp();
    assert.equal(store.designs, designs, 'an answer that comes after the window has gone applies nothing');
    assert.deepEqual(output(), ['layer 1: 0.12', z.stoppedClosed], 'and adds nothing');
    renderWindow();
    assert.equal(view.session.output.at(-1), z.stoppedClosed, 'the line is there when the window is drawn again');
}

// ── The editor's keys ───────────────────────────────────────────────────────
{
    typeScript('console.log(2);');
    const editor = find(ScriptConsoleLayout(view), el => el.type?.name === 'EditorBox');
    const { onKeyDown } = editor.type(editor.props).props;
    // The app's own listener on the document, as useAppCommands.js has it.
    const reached = [];
    const documentListener = (event) => {
        const action = appShortcutFor(event);
        if (action) reached.push(action);
    };
    // A key pressed in the editor: React hands it to the editor first, and it
    // goes on to the document unless the editor stopped it.
    const press = (init) => {
        let stopped = false;
        const event = {
            ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '', ...init,
            preventDefault() {}, stopPropagation() { stopped = true; },
        };
        onKeyDown(event);
        if (!stopped) documentListener(event);
    };
    const asked = main.runs.length;
    press({ key: 'Enter', code: 'Enter', ctrlKey: true });
    assert.equal(main.runs.length, asked + 1, 'Ctrl+Enter in the editor runs the script');
    assert.equal(main.runs.at(-1).request.text, 'console.log(2);');
    main.runs.at(-1).reply({ state: 'done' });
    await new Promise(resolve => setImmediate(resolve));
    renderWindow();
    for (const [key, code] of [['z', 'KeyZ'], ['y', 'KeyY'], ['s', 'KeyS'], ['o', 'KeyO'], ['n', 'KeyN']]) {
        press({ key, code, ctrlKey: true });
    }
    assert.deepEqual(reached, [], 'Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+O and Ctrl+N in the editor never reach the document');
    press({ key: ',', code: 'Comma', ctrlKey: true });
    assert.deepEqual(reached, ['settings'], 'a chord the editor does not keep goes on to the document');

    // An edit in the editor, as it hands its text on (codeEditor.js).
    const { onChange } = editor.type(editor.props).props;
    onChange('console.log("typed");');
    renderWindow();
    assert.equal(view.session.text, 'console.log("typed");', 'an edit in the editor is the script');
    assert.equal(loadLastScript().text, 'console.log("typed");', 'and is kept as the last script');
}

// ── The script outlives the window and the app ──────────────────────────────
// A window opened again is a copy of its own that starts empty, as every copy
// does after a restart.
const reopen = () => {
    win.unmount();
    scriptConsoleSession.reset();
    renderWindow();
};
const shown = () => {
    const { text, fileName, filePath, fileText } = view.session;
    return { text, fileName, filePath, fileText };
};
// Save, with the save dialog answered by `filePath`.
async function saveTo(filePath) {
    globalThis.electronAPI.saveScriptFile = async () => ({ success: true, filePath });
    await view.onSave();
    renderWindow();
}
{
    typeScript('console.log(3);');
    await saveTo('C:\\scripts\\first.js');
    // Saved again under another name, the text as it was: only the file's
    // name and path change.
    await saveTo('C:\\scripts\\ar.js');
    // And under the same name in another folder: only the path changes.
    await saveTo('C:\\other\\ar.js');
    const asked = main.runs.length;
    const script = { text: 'console.log(3);', fileName: 'ar.js', filePath: 'C:\\other\\ar.js', fileText: 'console.log(3);' };
    reopen();
    assert.deepEqual(shown(), script, 'a window opened again with an empty editor gets the last script back, with the file it was last saved to');
    assert.equal(main.runs.length, asked, 'and does not run it');

    const restarted = await import('../src/components/windows/optimization/scriptConsole/sessionState.js?restart');
    assert.equal(restarted.scriptConsoleSession.read(null).text, '', 'after a restart the window\'s store starts empty');
    assert.deepEqual(restarted.loadLastScript(), { ...script, language: 'javascript' }, 'and the last script is read back from storage, with its language');

    typeScript('');
    reopen();
    assert.equal(view.session.text, '', 'an editor emptied on purpose stays empty');
    win.unmount();
}

// ── Two copies in one dock group: showing one tab hides the other ───────────
{
    const show = (id) => {
        win.unmount();
        copy = id;
        renderWindow();
    };
    show('A');
    typeScript('aaa');
    show('B');
    assert.equal(view.session.text, 'aaa', 'a copy that opens with an empty editor takes the last script');
    typeScript('bbb');
    show('A');
    assert.equal(view.session.text, 'aaa', 'a copy shown again keeps its own script');
    assert.equal(loadLastScript().text, 'bbb', 'showing a copy again does not put its script over one typed since in another');
    show('B');
    typeScript('');
    show('A');
    show('B');
    assert.equal(view.session.text, '', 'nor fills an editor emptied on purpose with it');
    win.unmount();
    copy = null;
}

// ── Open asks before it replaces a script its file does not hold ────────────
{
    const other = { text: 'console.log("other");', fileName: 'other.js', filePath: 'C:\\scripts\\other.js' };
    let reads = 0;
    globalThis.electronAPI.openScriptFile = async () => {
        reads += 1;
        return { success: true, ...other };
    };
    reopen();
    typeScript('console.log(5);');
    const kept = loadLastScript();
    view.onOpen();
    assert.equal(dialog?.message, z.discardConfirm, 'Open with a script not saved to a file asks first');
    assert.equal(reads, 0, 'and reads no file until it is answered');
    dialog.onCancel();
    await settle();
    renderWindow();
    assert.equal(dialog, null);
    assert.equal(view.session.text, 'console.log(5);', 'Cancel keeps the script');
    assert.deepEqual(loadLastScript(), kept, 'and the last script kept for the next start');

    view.onOpen();
    dialog.onConfirm();
    await settle();
    renderWindow();
    assert.deepEqual(shown(), { ...other, fileText: other.text }, 'Discard opens the file');
    view.onOpen();
    await settle();
    renderWindow();
    assert.deepEqual([dialog, reads], [null, 2], 'a script as its file holds it is replaced without asking');
    typeScript('console.log("changed");');
    view.onOpen();
    assert.equal(dialog?.message, z.discardConfirm, 'one changed since it was opened asks again');
    dialog.onCancel();
    await settle();
    renderWindow();
    typeScript('');
    view.onOpen();
    assert.equal(dialog, null, 'an empty editor is replaced without asking');
    await settle();
    win.unmount();
}

// ── The language follows the file, and Save and Run use it ─────────────────
{
    const opened = file => async () => ({ success: true, text: 'x = 1', fileName: file.split('\\').pop(), filePath: file });
    const openFile = async (file) => {
        globalThis.electronAPI.openScriptFile = opened(file);
        typeScript('');
        await view.onOpen();
        renderWindow();
    };
    reopen();
    await openFile('C:\\scripts\\ar.py');
    assert.equal(view.session.language, 'python', 'a .py file opens as Python');
    const run = startRun();
    assert.deepEqual([run.request.language, run.request.fileName, run.request.filePath], ['python', 'ar.py', 'C:\\scripts\\ar.py'],
        'and runs as Python, under its own name');
    await answer(run, { state: 'done' });

    let saved = null;
    globalThis.electronAPI.saveScriptFile = async (text, suggested, language) => {
        saved = { suggested, language };
        return { success: true, filePath: suggested };
    };
    await view.onSave();
    assert.deepEqual(saved, { suggested: 'C:\\scripts\\ar.py', language: 'python' }, 'Save offers a Python file');
    view.onLanguage('javascript');
    renderWindow();
    await view.onSave();
    assert.deepEqual(saved, { suggested: 'C:\\scripts\\ar.js', language: 'javascript' }, 'the picker changes the language Save uses, and the extension it offers');

    await openFile('C:\\scripts\\notes.txt');
    assert.equal(view.session.language, 'javascript', 'a file of neither extension keeps the language');
    await openFile('C:\\scripts\\b.py');
    await openFile('C:\\scripts\\a.js');
    assert.equal(view.session.language, 'javascript', 'a .js file opens as JavaScript');
    await openFile('C:\\scripts\\b.py');
    reopen();
    assert.equal(view.session.language, 'python', 'the language comes back with the last script');
    win.unmount();
}

// ── Choosing Python says which Python runs the script, or what is missing ───
{
    reopen();
    typeScript('print(1)');
    view.onLanguage('javascript');
    renderWindow();
    for (const [found, status] of [
        [{ found: { path: 'C:\\Python312\\python.exe', version: '3.12.1' } }, { type: 'success', msg: z.python.found('3.12.1', 'C:\\Python312\\python.exe') }],
        [{ missing: { reason: 'none' } }, { type: 'error', msg: z.python.none }],
        [{ missing: { reason: 'setPath', path: 'D:\\py.exe' } }, { type: 'error', msg: z.python.setPath('D:\\py.exe') }],
    ]) {
        let asked = 0;
        globalThis.electronAPI.findPython = async (setPath) => { asked += 1; assert.equal(setPath, undefined, 'the path set in Preferences'); return found; };
        await view.onLanguage('python');
        renderWindow();
        assert.equal(asked, 1, 'choosing Python looks for it');
        assert.deepEqual(view.status, status, `the row says ${status.msg}`);
        assert.equal(view.session.language, 'python');
    }
    globalThis.electronAPI.findPython = async () => { throw new Error('asked JavaScript'); };
    await view.onLanguage('javascript');
    renderWindow();
    assert.equal(view.status, null, 'choosing JavaScript looks for no Python');
    win.unmount();
}

// ── The line a run's error names is marked until the script is edited ───────
{
    reopen();
    typeScript('const a = 1;\nnull.x;');
    let run = startRun();
    await answer(run, { state: 'failed', error: 'TypeError: x\n    at script.js:2:6', line: 2 });
    assert.equal(view.session.errorLine, 2, 'the error\'s line is marked');
    view.onTextChange('const a = 2;\nnull.x;');
    renderWindow();
    assert.equal(view.session.errorLine, 0, 'and the mark goes with an edit');
    run = startRun();
    await answer(run, { state: 'failed', error: 'TypeError: x\n    at script.js:2:6', line: 2 });
    run = startRun();
    assert.equal(view.session.errorLine, 0, 'and with the next run');
    await answer(run, { state: 'done' });
    win.unmount();
}

// ── A Python run that never started ─────────────────────────────────────────
{
    reopen();
    typeScript('print(1)');
    for (const [never, line] of [
        [{ state: 'noPython', missing: { reason: 'none' } }, z.python.none],
        [{ state: 'noFolder', folder: 'E:\\scripts' }, z.folderGone('E:\\scripts')],
    ]) {
        await answer(startRun(), never);
        assert.deepEqual([output().at(-1), view.runStatus], [line, ''], `${never.state}: the output says why, and the row gives no time`);
    }
    win.unmount();
}

console.log('PASS: script_console_run');
