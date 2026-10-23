/**
 * Python scripts in the Script Console, through the pieces a source checkout
 * runs them with: the IPC handler (src/main/ipc/scripts.js) finds the Python
 * (src/main/pythonLaunch.js), starts it on the package's own _console.py
 * (python/tfstudio) with the thread that serves it the API
 * (src/scripts/pythonWorker.js), and answers as a JavaScript run answers; the
 * window takes that answer as it takes a JavaScript run's.
 *
 * Finding Python: the path set in Preferences > Automation is the only one
 * tried, and one that does not run as Python is said to, a .cmd file Node
 * does not start among them; without one, py, then python3, then python on
 * Windows, python3 then python elsewhere, and a Python older than 3.8 is
 * passed over for a newer one, and said when there is none; with none at
 * all, that is said. A Python run with no Python to run in
 * answers so, and the window says what is missing. A saved script whose
 * folder is gone says that, and starts nothing.
 *
 * With a Python 3.8 or newer on this machine (the parts that need one say
 * SKIP when there is none): what the script prints, on stdout and stderr,
 * reaches the output a line per line, in UTF-8 whatever this machine sets, up
 * to the last line it prints before it ends, and before the answer, which
 * waits for a program the script started that writes to the script's output;
 * a line that never ends comes, cut, once it is longer than the output shows,
 * while the script still runs; tf is the object API on the
 * run's own server, with tf.design the open design as a Design, and a run
 * computes through it; a script saved to a file runs in its folder; it reads
 * nothing. A tf.design changed, or one made with no design open, comes back,
 * and one left alone does not; one that is not a Design is refused with a
 * reason; a script that closes tf still has its design taken. An error names
 * the script's line, which the answer carries, and none of the package's
 * frames; sys.exit() ends with no answer. Stop ends a script that never ends,
 * and its Python with it, and a run stopped while its Python is looked for
 * never starts one. In the window, what the script
 * prints shows in the output, a changed tf.design is applied as one undo step,
 * and it is refused when the design changed while the script ran, as a
 * JavaScript run's is; the Stop button stops it.
 *
 * Run: node tests/script_console_python.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

// What the script prints is UTF-8 because the run says so (pythonLaunch.js).
// An environment that says so already, or Python's UTF-8 mode, would hide a
// run that did not, so the Pythons here have neither.
delete process.env.PYTHONIOENCODING;
process.env.PYTHONUTF8 = '0';

const require = createRequire(import.meta.url);
// Every process the runner starts, which it takes from child_process as it
// loads: a Python started for a run already stopped would show here.
const childProcess = require('node:child_process');
const started = [];
const realSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
    const child = realSpawn(...args);
    started.push(child);
    return child;
};
const scriptsIpc = require('../src/main/ipc/scripts.js');
const { findPython } = require('../src/main/pythonLaunch.js');
const { readJsonSafe, readTextAuto } = require('../src/main/paths.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-script-python-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Finding Python ──────────────────────────────────────────────────────────
{
    // A stand-in for asking a Python its version: `answers` by command.
    const asking = (answers) => {
        const asked = [];
        const probe = async (command, args) => {
            asked.push([command, ...args].join(' '));
            return answers[command] ?? null;
        };
        return { asked, probe };
    };
    const py = version => ({ version, path: `C:\\Python${version.join('')}\\python.exe` });

    let { asked, probe } = asking({});
    assert.deepEqual(await findPython({ platform: 'win32', probe }), { missing: { reason: 'none' } }, 'none found says so');
    assert.deepEqual(asked, ['py -3', 'python3', 'python'], 'on Windows the py launcher, then python3, then python');
    ({ asked, probe } = asking({}));
    await findPython({ platform: 'linux', probe });
    assert.deepEqual(asked, ['python3', 'python'], 'elsewhere python3, then python');

    ({ asked, probe } = asking({ py: py([3, 7, 9]), python: py([3, 12, 1]) }));
    assert.deepEqual(await findPython({ platform: 'win32', probe }), { found: { path: 'C:\\Python3121\\python.exe', version: '3.12.1' } },
        'a Python older than 3.8 is passed over for a newer one');
    ({ probe } = asking({ py: py([3, 8, 0]) }));
    assert.deepEqual((await findPython({ platform: 'win32', probe })).found?.version, '3.8.0', '3.8 is new enough');
    ({ probe } = asking({ py: py([3, 7, 9]), python3: py([2, 7, 18]) }));
    assert.deepEqual(await findPython({ platform: 'win32', probe }), { missing: { reason: 'old', path: 'C:\\Python379\\python.exe', version: '3.7.9' } },
        'with only old ones, the first is named');

    ({ asked, probe } = asking({ py: py([3, 12, 1]) }));
    assert.deepEqual(await findPython({ setPath: ' D:\\gone\\python.exe ', platform: 'win32', probe }),
        { missing: { reason: 'setPath', path: 'D:\\gone\\python.exe' } }, 'a set path that does not run says so');
    assert.deepEqual(asked, ['D:\\gone\\python.exe'], 'and is the only one tried');
    ({ probe } = asking({ 'D:\\old\\python.exe': py([3, 6, 8]) }));
    assert.equal((await findPython({ setPath: 'D:\\old\\python.exe', probe })).missing.reason, 'old', 'a set path to an old Python says it is old');

    const gone = path.join(out, 'no-such-python.exe');
    assert.deepEqual(await findPython({ setPath: gone }), { missing: { reason: 'setPath', path: gone } }, 'a real set path that is not there');
    assert.deepEqual(await findPython({ setPath: process.execPath }), { missing: { reason: 'setPath', path: process.execPath } },
        'a real program that is not Python');
    // Node starts no .bat or .cmd file without a shell, and on Windows says so
    // by throwing rather than by calling back.
    const shim = path.join(out, 'python.cmd');
    fs.writeFileSync(shim, '@echo off\r\n');
    assert.deepEqual(await findPython({ setPath: shim }), { missing: { reason: 'setPath', path: shim } },
        'a .cmd file, as a Python shim is, which Node does not start');
    const empty = path.join(out, 'empty-path');
    fs.mkdirSync(empty);
    assert.deepEqual(await findPython({ env: { ...process.env, PATH: empty, Path: empty } }), { missing: { reason: 'none' } },
        'nothing on PATH');
}

// ── The handlers, with the app's ctx shape ──────────────────────────────────
const dataDir = path.join(out, 'data');
fs.mkdirSync(path.join(dataDir, 'Materials'), { recursive: true });
const settingsPath = path.join(out, 'settings.json');
const setPythonPath = value => fs.writeFileSync(settingsPath, JSON.stringify({ pythonPath: value }));
const handlers = new Map();
const logged = [];
const ctx = {
    fs, path, readTextAuto, readJsonSafe, log: line => logged.push(line),
    isPackaged: false, resourcesDir: path.join(out, 'resources'), srcDir: path.join(ROOT, 'src'),
    appIndexFile: path.join(ROOT, 'src', 'index.html'),
    userDocsDir: dataDir, settingsPath,
    app: { getVersion: () => '9.9.9' },
    getMainWindow: () => null,
    dialog: {},
};
scriptsIpc.register({ handle: (channel, fn) => handlers.set(channel, fn) }, ctx);
const call = (channel, ...args) => handlers.get(channel)(...args);

class FakePage extends EventEmitter {
    constructor() {
        super();
        this.url = pathToFileURL(ctx.appIndexFile).href;
        this.sent = [];
    }
    send(channel, ...args) {
        this.sent.push([channel, ...args]);
        this.emit('sent', channel, ...args);
    }
    isDestroyed() { return false; }
    event() { return { sender: this, senderFrame: { url: this.url } }; }
}
const printedBy = (page, runId) => page.sent.filter(([, id]) => id === runId).flatMap(([, , lines]) => lines);

{
    setPythonPath(path.join(out, 'no-such-python.exe'));
    const page = new FakePage();
    const answer = await call('scripts:run', page.event(), 'p0', { text: 'print(1)', fileName: 'my.py', language: 'python', design: null });
    assert.deepEqual(answer, { state: 'noPython', missing: { reason: 'setPath', path: path.join(out, 'no-such-python.exe') } },
        'a Python run with no Python to run in says what is missing');
    assert.deepEqual(page.sent, [], 'and starts nothing');
    assert.deepEqual(await call('scripts:find-python', page.event()), answer.missing && { missing: answer.missing },
        'the console asks for the Python set in Preferences');
}
{
    const filePath = path.join(out, 'unplugged', 'my.py');
    const page = new FakePage();
    const before = started.length;
    const answer = await call('scripts:run', page.event(), 'p-folder', { text: 'print(1)', fileName: 'my.py', filePath, language: 'python', design: null });
    assert.deepEqual(answer, { state: 'noFolder', folder: path.dirname(filePath) }, 'a saved script whose folder is gone says so');
    assert.deepEqual([page.sent, started.length], [[], before], 'and starts nothing');
}

const found = await findPython();
if (found.missing) {
    console.log(`SKIP: no Python 3.8 or newer here (${found.missing.reason}); the runs in Python are not checked`);
    fs.rmSync(out, { recursive: true, force: true });
    console.log('PASS: script_console_python');
    process.exit(0);
}
setPythonPath(found.found.path);
assert.deepEqual(await call('scripts:find-python', new FakePage().event(), ''), found, 'with no path set, the one found on PATH');

const api = await import('../src/api/index.js');
await api.init({ dataDir });
const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2', symbols: { H: 'TiO2', L: 'SiO2' } });

let seq = 0;
// How long a run here may take before it is taken to hang: each takes well
// under a second alone, and all of them at once a few seconds.
const RUN_DEADLINE_MS = 30000;
// Starts `text` as my.py on `design`: { runId, page, done }, `done` resolving
// to { answer, output }, or rejecting when the run hangs.
function start(text, design = null, filePath = null) {
    const page = new FakePage();
    const runId = `py${++seq}`;
    let timer;
    const hung = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${runId} did not answer: ${text}`)), RUN_DEADLINE_MS);
    });
    const answered = call('scripts:run', page.event(), runId, { text, fileName: 'my.py', filePath, design, language: 'python' })
        .then(answer => ({ answer, output: printedBy(page, runId) }));
    const done = Promise.race([answered, hung]).finally(() => clearTimeout(timer));
    return { runId, page, done };
}
const run = (text, design, filePath) => start(text, design, filePath).done;

const saved = path.join(out, 'saved');
fs.mkdirSync(saved);
fs.writeFileSync(path.join(saved, 'helper.py'), 'value = 42\n');

const [
    printed, untouched, inPlace, created, notDesign, emptied, raised, syntax, exited, refined, reads, beside, closed, nested, tail, bulk,
    spawned,
] = await Promise.all([
    run('print("a", 1)\nimport sys\nprint("err", file=sys.stderr)\nprint("two\\nlines")\nprint("\u00e9 \u4e2d")'),
    run('print(tf.design.name, type(tf.design).__name__, len(tf.design.layers), tf.info["live"])', ar),
    run('tf.design.layers[len(tf.design.layers)].thickness = 77', ar),
    run('print(tf.design)\ntf.design = tf.new_design("Fresh")'),
    run('tf.design = 42', ar),
    run('tf.design = None', ar),
    run('a = 1\ntf.design.layers[9].thickness = 1', ar),
    run('a = 1\n\nx = = 2', ar),
    run('import sys\nprint("bye")\nsys.exit(0)', ar),
    run('tf.design.merit.add("RAV", 450, 650, target=0)\nrun = tf.design.refine(method="dls", max_iter=5)\nprint("refined", run.merit >= 0)', ar),
    run('input()', ar),
    run('import helper, os\nprint(helper.value, os.path.basename(os.getcwd()), os.path.basename(__file__))', null, path.join(saved, 'my.py')),
    run('import tfstudio\ntf.design.layers[len(tf.design.layers)].thickness = 66\ntf.close()\ntry:\n    tf.design.spectrum(450, 650)\n'
        + 'except tfstudio.ServerError as err:\n    print(err)', ar),
    run('def deeper():\n    raise ValueError("deep")\n\ndeeper()'),
    run('import time\nprint("first", flush=True)\ntime.sleep(0.05)\nprint("last")\nprint("no line end", end="")'),
    run('for i in range(20000):\n    print(i)\ntf.design.layers[len(tf.design.layers)].thickness = 70', ar),
    run('import subprocess, sys\nlate = "import sys, time; time.sleep(0.5); print(\'late\', file=sys.stderr)"\n'
        + 'subprocess.Popen([sys.executable, "-c", late], stderr=sys.stderr)\nprint("ended")'),
]);

// ── Output ──────────────────────────────────────────────────────────────────
assert.equal(printed.answer.state, 'done', printed.answer.error);
assert.deepEqual(printed.output, ['a 1', 'err', 'two', 'lines', '\u00e9 \u4e2d'], 'what the script prints, on stdout and stderr, a line per line, in UTF-8');
assert.deepEqual(untouched.output, ['AR Design 4 False'], 'tf.design is the open design as a Design, on a server of the run\'s own');
assert.deepEqual(exited.output, ['bye'], 'what it printed before sys.exit() arrives');
assert.deepEqual(exited.answer, { state: 'failed', error: null, line: null }, 'and the run has no answer');
assert.deepEqual(beside.output, ['42 saved my.py'], 'a saved script runs in its folder, imports what is beside it, and knows its file');
assert.equal(reads.answer.state, 'failed', 'a script reads nothing');
assert.match(reads.answer.error, /EOFError/);
assert.deepEqual(tail.output, ['first', 'last', 'no line end'], 'what it prints just before it ends arrives, a last line with no line end too');
assert.deepEqual([bulk.output.at(-1), bulk.answer.design?.frontLayers[0].thickness], ['19999', 70],
    'and so does the end of a long output, with the answer after it');
assert.deepEqual(spawned.output, ['ended', 'late'], 'a run ends once all that writes to its output has, a program the script started too');

// ── The design that comes back ──────────────────────────────────────────────
assert.deepEqual(printed.answer, { state: 'done', design: undefined, invalid: undefined }, 'with no design open, tf.design left None brings nothing back');
assert.deepEqual(untouched.answer, { state: 'done', design: undefined, invalid: undefined }, 'a design left alone does not come back');
assert.equal(inPlace.answer.design?.frontLayers[0].thickness, 77, `a design changed in place comes back: ${inPlace.answer.error}`);
assert.deepEqual(created.output, ['None'], 'with no design open tf.design is None');
assert.equal(created.answer.design?.name, 'Fresh', 'a design made with none open comes back, for the window to refuse');
assert.deepEqual(notDesign.answer, { state: 'done', design: undefined, invalid: 'tf.design holds a value of type int, not a Design.' });
assert.deepEqual(emptied.answer, { state: 'done', design: undefined, invalid: 'tf.design is None.' });
assert.deepEqual(closed.output, ['this TFStudio() is closed'], 'tf.close() closes tf to the script');
assert.equal(closed.answer.design?.frontLayers[0].thickness, 66, 'and the design it changed before still comes back');
assert.equal(refined.answer.state, 'done', refined.answer.error);
assert.deepEqual(refined.output, ['refined True'], 'a refinement runs through the run\'s server');
assert.ok(refined.answer.design, 'and the design it refined comes back');

// ── Errors name the script's lines ──────────────────────────────────────────
assert.equal(raised.answer.state, 'failed');
assert.match(raised.answer.error, /^Traceback \(most recent call last\):\n {2}File "my\.py", line 2, in <module>\n {4}tf\.design\.layers\[9\]\.thickness = 1\n/,
    `a raised error names the script's line, and shows it: ${raised.answer.error}`);
assert.match(raised.answer.error, /TFStudioError: /);
assert.doesNotMatch(raised.answer.error, /_design\.py|_console\.py|_calls\.py/, 'and none of the package\'s frames');
assert.equal(raised.answer.line, 2, 'the answer carries the line');
assert.equal(syntax.answer.state, 'failed');
assert.match(syntax.answer.error, /File "my\.py", line 3/);
assert.match(syntax.answer.error, /SyntaxError/);
assert.equal(syntax.answer.line, 3, 'a syntax error\'s line');
assert.match(nested.answer.error, /line 4, in <module>\n {4}deeper\(\)\n( {4}[~^]+\n)? {2}File "my\.py", line 2, in deeper\n {4}raise ValueError\("deep"\)\nValueError: deep$/,
    `a call in the script is in the traceback: ${nested.answer.error}`);
assert.equal(nested.answer.line, 2, 'and the line marked is the innermost one in the script');

// ── Stop ────────────────────────────────────────────────────────────────────
{
    const endless = start('import os, time\nprint(os.getpid(), flush=True)\nwhile True:\n    time.sleep(0.01)');
    for (let waited = 0; printedBy(endless.page, endless.runId).length === 0 && waited < 30000; waited += 50) await sleep(50);
    const pid = Number(printedBy(endless.page, endless.runId)[0]);
    assert.ok(pid > 0, 'the script runs');
    const asked = Date.now();
    await call('scripts:stop', endless.page.event(), endless.runId);
    assert.deepEqual((await endless.done).answer, { state: 'stopped' }, 'Stop ends a script that never ends');
    assert.ok(Date.now() - asked < 1000, 'at once');
    let alive = true;
    for (let waited = 0; alive && waited < 5000; waited += 50) {
        try { process.kill(pid, 0); await sleep(50); } catch (_) { alive = false; }
    }
    assert.equal(alive, false, 'and its Python with it');

    // Stopped while its Python is still being looked for.
    const before = started.length;
    const early = start('print("ran")');
    await call('scripts:stop', early.page.event(), early.runId);
    assert.deepEqual((await early.done).answer, { state: 'stopped' }, 'a run stopped before its Python starts is stopped');
    await sleep(2000);
    assert.equal(started.length, before, 'and its Python never starts');
}

// ── A line that never ends ──────────────────────────────────────────────────
// The script sleeps after printing it, and ends by itself if the line never
// comes, so a failed check leaves no Python behind for long.
{
    const { OUTPUT_CHARS } = await import('../src/scripts/outputBounds.js');
    const unended = start(`import time\nprint("x" * ${OUTPUT_CHARS + 10}, end="", flush=True)\ntime.sleep(30)`);
    for (let waited = 0; printedBy(unended.page, unended.runId).length === 0 && waited < 20000; waited += 50) await sleep(50);
    const [first] = printedBy(unended.page, unended.runId);
    assert.deepEqual([first?.text?.length, first?.cut > 0], [OUTPUT_CHARS, true],
        'a line that never ends comes, cut, once it is longer than the output shows, while the script still runs');
    await call('scripts:stop', unended.page.event(), unended.runId);
    assert.deepEqual((await unended.done).answer, { state: 'stopped' });
}

// ── In the window ───────────────────────────────────────────────────────────
shimBrowserGlobals();
const RealReact = globalThis.React;
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
const { scriptConsoleSession } = await import('../src/components/windows/optimization/scriptConsole/sessionState.js');

// The page the window is in, as the preload hands it the main process.
const page = new FakePage();
const feeds = new Set();
page.on('sent', (channel, ...args) => { if (channel === 'scripts:output') feeds.forEach(feed => feed(...args)); });
globalThis.electronAPI = {
    runScript: (runId, request) => call('scripts:run', page.event(), runId, request),
    stopScript: runId => call('scripts:stop', page.event(), runId),
    onScriptOutput: (feed) => {
        feeds.add(feed);
        return () => feeds.delete(feed);
    },
};

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
win.useContext = context => (context === DesignContext ? context.value : null);
const c = makeTheme();
const t = makeLocale('en');
const z = t.scriptConsole;
let view;
const renderWindow = () => { view = as(win, () => win.run(() => ScriptConsole({ c, t, setInputDialog() {} }).props)); };
const redraw = () => { renderApp(); renderWindow(); };
const output = () => scriptConsoleSession.peek(null, null).output;

redraw();
const before = { ...ar, id: 'd1', name: 'Mine' };
store.setDesigns({ d1: before });
store.setActiveDesignId('d1');
redraw();
// Runs `text` in the window as Python; `meanwhile()` happens once it has printed.
async function runInWindow(text, meanwhile = () => {}) {
    view.setField('language', 'python');
    view.setField('text', text);
    renderWindow();
    const done = view.onRun();
    renderWindow();
    for (let waited = 0; output().length === 0 && waited < 30000; waited += 50) await sleep(50);
    meanwhile();
    redraw();
    await done;
    redraw();
}
{
    await runInWindow('top = tf.design.layers[len(tf.design.layers)]\nprint("thick", top.thickness)\ntop.thickness = 61');
    assert.equal(output()[0], `thick ${before.frontLayers[0].thickness}`, 'what the script prints shows in the output');
    assert.equal(output().at(-1), z.applied, 'a changed tf.design is applied');
    assert.equal(store.designs.d1.frontLayers[0].thickness, 61);
    assert.deepEqual([store.designs.d1.id, store.designs.d1.name], ['d1', 'Mine'], 'keeping the open design\'s id and name');
    assert.equal(store.historyRef.current.d1.past.length, 1, 'as one undo step');
    store.undo();
    redraw();
    assert.deepEqual(store.designs.d1, before, 'which one Undo takes back');
}
{
    const unchanged = store.designs;
    await runInWindow('import time\nprint("waiting", flush=True)\ntime.sleep(1)\ntf.design.layers[len(tf.design.layers)].thickness = 62',
        () => DesignContext.value.updateLayer('front', store.designs.d1.frontLayers[1].id, { thickness: 555 }));
    assert.equal(output().at(-1), z.notApplied.edited, 'refused when the design changed while the script ran, as in JavaScript');
    assert.notEqual(store.designs, unchanged);
    assert.equal(store.designs.d1.frontLayers[0].thickness, before.frontLayers[0].thickness, 'nothing of the script is written');
    assert.equal(store.designs.d1.frontLayers[1].thickness, 555, 'the edit stays');
}
{
    await runInWindow('import time\nprint("on", flush=True)\nwhile True:\n    time.sleep(0.01)', () => view.onStop());
    assert.equal(output().at(-1), z.stoppedNote, 'Stop stops a Python script');
    assert.equal(view.running, false);
}
win.unmount();

fs.rmSync(out, { recursive: true, force: true });
console.log('PASS: script_console_python');
