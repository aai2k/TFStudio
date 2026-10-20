/**
 * The Script Console's IPC handlers (src/main/ipc/scripts.js), driven with a
 * fake ipcMain, a fake page and the app's own ctx shape.
 *
 * Opening a script returns its text and runs nothing: a script that would
 * write a marker file leaves none. Saving writes the text. A run started by
 * the app's page sends what the script prints to that page, and a run asked
 * for by any other page is refused before a thread starts. Stop ends a run,
 * and so does the page going away or loading again, after which nothing is
 * sent to it. The thread is src/scripts/ in a source checkout and the bundle
 * outside the asar archive in an installed app.
 *
 * Run: node tests/script_console_ipc.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scriptsIpc = require('../src/main/ipc/scripts.js');
const { scriptWorkerFile } = require('../src/main/scriptRuns.js');
const { readTextAuto } = require('../src/main/paths.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-script-ipc-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── The thread's file ───────────────────────────────────────────────────────
assert.equal(scriptWorkerFile({ isPackaged: true, resourcesDir: path.join('R', 'resources'), srcDir: 'S' }),
    path.join('R', 'resources', 'app.asar.unpacked', 'build', 'app', 'scripts', 'scriptWorker.js'),
    'an installed app runs the bundle kept outside its asar archive');
const devWorker = scriptWorkerFile({ isPackaged: false, resourcesDir: 'R', srcDir: path.join(ROOT, 'src') });
assert.equal(devWorker, path.join(ROOT, 'src', 'scripts', 'scriptWorker.js'), 'a source checkout runs src/scripts/');
assert.ok(fs.existsSync(devWorker));

// ── The handlers, with the dialogs answering files in a folder of their own ─
const marker = path.join(out, 'ran.txt');
const scriptFile = path.join(out, 'writes-marker.js');
const scriptText = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`;
fs.writeFileSync(scriptFile, scriptText);
const savedFile = path.join(out, 'saved.js');
const dataDir = path.join(out, 'data');
fs.mkdirSync(path.join(dataDir, 'Materials'), { recursive: true });

const handlers = new Map();
const logged = [];
const ctx = {
    fs, path, readTextAuto, log: line => logged.push(line),
    isPackaged: false, resourcesDir: path.join(out, 'resources'), srcDir: path.join(ROOT, 'src'),
    appIndexFile: path.join(ROOT, 'src', 'index.html'),
    userDocsDir: dataDir,
    getMainWindow: () => null,
    dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [scriptFile] }),
        showSaveDialog: async () => ({ canceled: false, filePath: savedFile }),
    },
};
scriptsIpc.register({ handle: (channel, fn) => handlers.set(channel, fn) }, ctx);
const call = (channel, ...args) => handlers.get(channel)(...args);

class FakePage extends EventEmitter {
    constructor(url = pathToFileURL(ctx.appIndexFile).href) {
        super();
        this.url = url;
        this.sent = [];
        this.destroyed = false;
    }
    send(channel, ...args) { this.sent.push([channel, ...args]); }
    isDestroyed() { return this.destroyed; }
    event() { return { sender: this, senderFrame: { url: this.url } }; }
}

// ── Open reads, and runs nothing ────────────────────────────────────────────
{
    const opened = await call('scripts:open', new FakePage().event());
    assert.deepEqual(opened, { success: true, text: scriptText, fileName: 'writes-marker.js', filePath: scriptFile });
    await sleep(500);
    assert.ok(!fs.existsSync(marker), 'opening a script does not run it');
}

// ── Save writes ─────────────────────────────────────────────────────────────
{
    const saved = await call('scripts:save', new FakePage().event(), "console.log('saved');\n", 'saved.js');
    assert.deepEqual(saved, { success: true, filePath: savedFile });
    assert.equal(fs.readFileSync(savedFile, 'utf8'), "console.log('saved');\n");
}

// ── A run from the app's page, and from any other ───────────────────────────
{
    const page = new FakePage();
    const answer = await call('scripts:run', page.event(), 'r1', { text: "console.log('hello');", fileName: 'x.js', design: null });
    assert.equal(answer.state, 'done');
    assert.deepEqual(page.sent, [['scripts:output', 'r1', ['hello'], 0]], 'the output goes to the page that started the run, with the count of lines left out');

    for (const url of ['https://example.com/', pathToFileURL(path.join(out, 'index.html')).href, 'about:blank']) {
        const other = new FakePage(url);
        const refused = await call('scripts:run', other.event(), 'r2', { text: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');` });
        assert.deepEqual(refused, { state: 'refused' }, `${url}: refused`);
    }
    await sleep(500);
    assert.ok(!fs.existsSync(marker), 'a refused run starts no thread');
}

// Starts a script that prints without end on `page`, and once it has printed
// hands back { answer }, the run's answer to come.
async function endless(page, runId) {
    const answer = call('scripts:run', page.event(), runId, { text: 'let i = 0;\nwhile (true) console.log(i++);' });
    for (let waited = 0; page.sent.length === 0 && waited < 20000; waited += 50) await sleep(50);
    assert.ok(page.sent.length > 0, `${runId} prints`);
    return { answer };
}

// ── Stop, and the page going away ───────────────────────────────────────────
{
    const page = new FakePage();
    const { answer } = await endless(page, 'r3');
    await call('scripts:stop', page.event(), 'r3');
    assert.deepEqual(await answer, { state: 'stopped' }, 'Stop ends the run');
}
{
    const page = new FakePage();
    const { answer } = await endless(page, 'r4');
    page.destroyed = true;
    page.emit('destroyed');
    assert.deepEqual(await answer, { state: 'stopped' }, 'a closed page stops its runs');
    const sent = page.sent.length;
    await sleep(300);
    assert.equal(page.sent.length, sent, 'and nothing more is sent to it');
}
{
    const page = new FakePage();
    const { answer: inPage } = await endless(page, 'r5');
    page.emit('did-start-navigation', {}, 'file:///x#y', true, true);
    page.emit('did-start-navigation', {}, 'https://frame/', false, false);
    let settled = false;
    inPage.then(() => { settled = true; });
    await sleep(200);
    assert.equal(settled, false, 'a navigation inside the page or in a frame of it leaves the run on');
    page.emit('did-start-navigation', {}, pathToFileURL(ctx.appIndexFile).href, false, true);
    assert.deepEqual(await inPage, { state: 'stopped' }, 'the page loading again stops its runs');
}

fs.rmSync(out, { recursive: true, force: true });
console.log('PASS: script_console_ipc');
