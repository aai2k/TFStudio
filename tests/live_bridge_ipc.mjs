/**
 * The live link in the main process (src/main/ipc/liveBridge.js), with a
 * stand-in for Electron's ipcMain and the main window, and an agent that
 * connects to the pipe the live link file names.
 *
 * Only the main window turns the link on. A request from the agent reaches
 * that window on live:request with the time main stops waiting for it, and
 * the window's reply on live:reply answers it; a reply from any other page is
 * ignored, and a window that does not answer by then gets the agent a timeout,
 * sooner than the agent's own. An apply whose design is not a design is
 * refused in the main process and never reaches the window. The switch turned
 * off, the window closed, crashed or loaded again each close the pipe, end the
 * agent's connection with its request unanswered, and remove the live link
 * file; a page that loads in place leaves it open. Turned on again, the agent
 * finds the new pipe.
 *
 * Run: node tests/live_bridge_ipc.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { agentHello, makeFakeApp, rawClient } from './_fakeLiveApp.mjs';

const require = createRequire(import.meta.url);
const { register, ANSWER_TIMEOUT_MS } = require('../src/main/ipc/liveBridge.js');

// Main's wait for the window is caught by its length, ANSWER_TIMEOUT_MS, and
// ends when the test says, not after fifteen seconds.
const realSetTimeout = globalThis.setTimeout;
const windowTimeouts = [];
globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms !== ANSWER_TIMEOUT_MS) return realSetTimeout(fn, ms, ...args);
    windowTimeouts.push(fn);
    return realSetTimeout(() => {}, 0);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-live-ipc-'));
const file = path.join(dir, 'live-bridge.json');

class Contents extends EventEmitter {
    constructor() { super(); this.sent = []; }
    send(channel, payload) { this.sent.push([channel, payload]); this.onSend?.(payload); }
}
const win = { destroyed: false, isDestroyed() { return this.destroyed; }, webContents: new Contents() };
const otherPage = new Contents();
const handlers = new Map();
const listeners = new Map();
register({ handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => listeners.set(channel, fn) }, {
    path, userDataPath: dir, log: () => {}, app: { getVersion: () => '9.9.9' }, getMainWindow: () => win,
});
const setLink = (sender, on) => handlers.get('live:set')({ sender }, on);
const reply = (sender, id, answer) => listeners.get('live:reply')({ sender }, id, answer);

const design = {
    id: 'app-1', name: 'AR', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 30 }], backLayers: [],
};
const app = makeFakeApp({ 'app-1': design }, 'app-1');
// The window: each request answered as the app answers it, a moment later.
const answering = (request) => setImmediate(async () => reply(win.webContents, request.id, await app.forward(request.method, request.params)));
win.webContents.onSend = answering;
const requestsSent = () => win.webContents.sent.filter(([channel]) => channel === 'live:request').length;

// The agent: connected through the live link file, or null when there is none.
async function connectAgent() {
    if (!fs.existsSync(file)) return null;
    const { pipe, secret } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const client = await rawClient(net, pipe);
    client.send(agentHello(secret));
    assert.equal((await client.next()).version, '9.9.9', 'the hello is answered with the app\'s version');
    let lastId = 0;
    // The answer to a request, or { closed: true } when the connection ends first.
    client.ask = (method, params = {}) => {
        client.send({ id: ++lastId, method, params });
        return Promise.race([client.next(), client.closed.then(() => ({ closed: true }))]);
    };
    return client;
}

// ── Turning it on ───────────────────────────────────────────────────────────
assert.deepEqual(await setLink(otherPage, true), { open: false, error: 'only the main window turns the link on' });
assert.ok(!fs.existsSync(file), 'another page cannot turn the link on');
assert.deepEqual(await setLink(win.webContents, true), { open: true });
assert.ok(fs.existsSync(file), 'the main window turns it on, and the live link file names the pipe');
let agent = await connectAgent();

// ── Requests and replies ────────────────────────────────────────────────────
{
    const asked = Date.now();
    const listed = await agent.ask('designs');
    assert.deepEqual(listed.result.designs.map(d => d.appDesignId), ['app-1'], 'a request is answered from the window');
    const [channel, request] = win.webContents.sent.at(-1);
    assert.equal(channel, 'live:request');
    assert.deepEqual([request.method, request.params], ['designs', {}], 'the window gets the method and its parameters under an id');
    assert.ok(request.deadline >= asked + ANSWER_TIMEOUT_MS && request.deadline <= Date.now() + ANSWER_TIMEOUT_MS,
        'and the time main stops waiting for its answer, past which the window writes no apply');

    win.webContents.onSend = (req) => {
        reply(otherPage, req.id, { result: { forged: true } });
        answering(req);
    };
    const read = (await agent.ask('read')).result;
    assert.equal(read.design?.name, 'AR', 'a reply from another page is ignored; the window\'s answers');
    win.webContents.onSend = answering;

    const before = requestsSent();
    const malformed = await agent.ask('apply', { appDesignId: 'app-1', revision: read.revision, design: { substrate: { material: 'BK7' }, frontLayers: 5 } });
    assert.equal(malformed.error?.code, 'invalid', 'an apply whose layers are not a list is refused');
    assert.equal(requestsSent(), before, 'in the main process: it never reaches the window');
}

// ── The window does not answer ──────────────────────────────────────────────
{
    win.webContents.onSend = null;
    windowTimeouts.length = 0;
    const before = requestsSent();
    const waiting = agent.ask('designs');
    while (requestsSent() === before) await new Promise(resolve => setImmediate(resolve));
    // The deadline the window got is ANSWER_TIMEOUT_MS after the request, as
    // checked above, so main's wait is that long too.
    assert.equal(windowTimeouts.length, 1, 'main waits for the window exactly until the deadline it sends');
    windowTimeouts.shift()();
    assert.equal((await waiting).error?.code, 'timeout', 'a window that does not answer gets the agent a timeout');
    win.webContents.onSend = answering;
    assert.ok((await agent.ask('designs')).result, 'and the link goes on');
}

// ── What closes it ──────────────────────────────────────────────────────────
for (const [what, close] of [
    ['the switch turned off', () => setLink(win.webContents, false)],
    ['the window loading again', () => win.webContents.emit('did-start-navigation', {}, 'file:///index.html', false, true)],
    ['the window\'s page crashing', () => win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })],
    ['the window closed', () => win.webContents.emit('destroyed')],
]) {
    assert.deepEqual(await setLink(win.webContents, true), { open: true });
    agent = await connectAgent();
    assert.ok((await agent.ask('designs')).result, `${what}: the agent finds the pipe as it is now`);
    win.webContents.onSend = null;
    const before = requestsSent();
    const waiting = agent.ask('designs');
    while (requestsSent() === before) await new Promise(resolve => setImmediate(resolve));
    close();
    assert.deepEqual(await waiting, { closed: true }, `${what}: the agent's connection ends with its request unanswered`);
    assert.ok(!fs.existsSync(file), `${what}: the live link file is removed`);
    assert.equal(await connectAgent(), null, `${what}: so the agent finds no link`);
    win.webContents.onSend = answering;
}
{
    assert.deepEqual(await setLink(win.webContents, true), { open: true });
    agent = await connectAgent();
    win.webContents.emit('did-start-navigation', {}, 'file:///index.html#help', true, true);
    win.webContents.emit('did-start-navigation', {}, 'about:blank', false, false);
    assert.ok((await agent.ask('designs')).result, 'a page that moves in place, or a frame inside it, leaves the link open');
    win.destroyed = true;
    assert.equal((await agent.ask('designs')).error?.code, 'off', 'a request that finds no main window is answered off');
    win.destroyed = false;
    await setLink(win.webContents, false);
}

globalThis.setTimeout = realSetTimeout;
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS: live_bridge_ipc');
