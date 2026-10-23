/**
 * The live link in the main process (src/main/ipc/liveBridge.js), with a
 * stand-in for Electron's ipcMain and the main window, and programs that
 * connect to the pipe the live link file names.
 *
 *   1. Interactive: only the main window starts it. It opens the pipe and
 *      tells the window it holds the app; a program comes in without a
 *      question, and the window is told its name. A request from the program
 *      reaches the window on live:request with the time main stops waiting
 *      for it, and the window's reply on live:reply answers it; a reply from
 *      any other page is ignored, and a window that does not answer by then
 *      gets the program a timeout, sooner than its own. An apply whose design
 *      is not a design is refused in the main process and never reaches the
 *      window.
 *   2. Terminate ends the programs' connections and Interactive, and gives
 *      the app back with or without a program connected. With the switch off
 *      it closes the pipe and removes the live link file; with the switch on
 *      the pipe stays open. Either way the program it let go is turned away
 *      as 'off' with no question while the pipe is open, until Interactive
 *      lets it in again.
 *   3. The switch, "Start listening when TFStudio starts": a program that
 *      comes is told to wait and the window asks the user, and a line it
 *      sends meanwhile ends its connection and reaches nothing. Allow lets it
 *      in, and the app is held for it; Deny refuses it with 'denied'. Each
 *      program is asked about once, by name, and the answer stands for as
 *      long as the app runs; two connections of one program wait on one
 *      question; a program with no name is asked about each time. Terminate
 *      turns away a program it let go, allowed or not, with no question;
 *      Interactive lets in a program that was denied or let go, and its
 *      Terminate turns them away again, while a program allowed and gone
 *      before it keeps its Allow, and one with no name is asked about again.
 *   4. The switch turned off, the window closed, crashed or loaded again each
 *      close the pipe, end the program's connection with its request
 *      unanswered, and remove the live link file, with nothing sent to a page
 *      already destroyed; going away ends Interactive, and a question still
 *      open counts as Deny without being kept. A page
 *      that loads in place leaves the pipe open. Turned on again, the program
 *      finds the new pipe.
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
const { proof } = require('../src/main/liveProtocol.js');

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

// A page, which, as Electron's does, throws on a send once it is destroyed.
class Contents extends EventEmitter {
    constructor() { super(); this.sent = []; this.gone = false; }
    isDestroyed() { return this.gone; }
    send(channel, payload) {
        if (this.gone) throw new TypeError('Object has been destroyed');
        this.sent.push([channel, payload]);
        if (channel === 'live:request') this.onSend?.(payload);
    }
}
const win = { destroyed: false, isDestroyed() { return this.destroyed; }, webContents: new Contents() };
const otherPage = new Contents();
const handlers = new Map();
const listeners = new Map();
register({ handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => listeners.set(channel, fn) }, {
    path, userDataPath: dir, log: () => {}, app: { getVersion: () => '9.9.9' }, getMainWindow: () => win,
});
const setLink = (sender, on) => handlers.get('live:set')({ sender }, on);
const interactive = (sender = win.webContents) => handlers.get('live:interactive')({ sender });
const terminate = (sender = win.webContents) => handlers.get('live:terminate')({ sender });
const reply = (sender, id, answer) => listeners.get('live:reply')({ sender }, id, answer);
const answerAsk = (sender, id, allowed) => listeners.get('live:answer')({ sender }, id, allowed);

const design = {
    id: 'app-1', name: 'AR', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 30 }], backLayers: [],
};
const app = makeFakeApp({ 'app-1': design }, 'app-1');
// The window: each request answered as the app answers it, a moment later.
const answering = (request) => setImmediate(async () => reply(win.webContents, request.id, await app.forward(request.method, request.params)));
win.webContents.onSend = answering;
const sentOn = channel => win.webContents.sent.filter(([sent]) => sent === channel).map(([, payload]) => payload);
const requestsSent = () => sentOn('live:request').length;
const asks = () => sentOn('live:ask');
const lastState = () => sentOn('live:state').at(-1);
const settled = () => new Promise(resolve => setImmediate(resolve));
const link = () => JSON.parse(fs.readFileSync(file, 'utf8'));
// A connection closing comes within milliseconds; one still open after this
// is not closing, and the test must not hang on it.
const CLOSE_WAIT_MS = 5000;
const closes = (client, what) => {
    let timer;
    const late = new Promise((_, reject) => { timer = realSetTimeout(() => reject(new Error(`${what}: still open after ${CLOSE_WAIT_MS} ms`)), CLOSE_WAIT_MS); });
    return Promise.race([client.closed, late]).finally(() => clearTimeout(timer));
};

// A program called `program` at the pipe the live link file names, its hello
// sent: { client, first }, `first` the first answer, or { closed: true }.
async function greet(program) {
    const { pipe, secret } = link();
    const client = await rawClient(net, pipe);
    client.send(agentHello(secret, `nonce of ${program}`, program));
    client.secret = secret;
    let lastId = 0;
    // The answer to a request, or { closed: true } when the connection ends first.
    client.ask = (method, params = {}) => {
        client.send({ id: ++lastId, method, params });
        return client.reply();
    };
    client.reply = () => Promise.race([client.next(), client.closed.then(() => ({ closed: true }))]);
    return { client, first: await client.reply() };
}

// A program let in without a question; null when there is no live link file.
async function connectAgent(program = 'agent') {
    if (!fs.existsSync(file)) return null;
    const { client, first } = await greet(program);
    assert.equal(first.version, '9.9.9', `${program}: the hello is answered with the app's version, no question asked`);
    return client;
}

// ── 1. Interactive ──────────────────────────────────────────────────────────
assert.deepEqual(await setLink(otherPage, true), { open: false, error: 'only the main window turns the link on' });
assert.deepEqual(await interactive(otherPage), { open: false, error: 'only the main window turns the link on' });
assert.ok(!fs.existsSync(file), 'another page can neither turn the link on nor start Interactive');
assert.deepEqual(await interactive(), { open: true });
assert.ok(fs.existsSync(file), 'Interactive opens the pipe, and the live link file names it');
assert.deepEqual(lastState(), { interactive: true, programs: [] }, 'and the window is told to hold the app');
let agent = await connectAgent('claude-code');
assert.deepEqual(asks(), [], 'a program comes in without a question');
assert.deepEqual(lastState(), { interactive: true, programs: ['claude-code'] }, 'and the window is told its name');

{
    const asked = Date.now();
    const listed = await agent.ask('designs');
    assert.deepEqual(listed.result.designs.map(d => d.appDesignId), ['app-1'], 'a request is answered from the window');
    const request = sentOn('live:request').at(-1);
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
{
    win.webContents.onSend = null;
    windowTimeouts.length = 0;
    const before = requestsSent();
    const waiting = agent.ask('designs');
    while (requestsSent() === before) await settled();
    // The deadline the window got is ANSWER_TIMEOUT_MS after the request, as
    // checked above, so main's wait is that long too.
    assert.equal(windowTimeouts.length, 1, 'main waits for the window exactly until the deadline it sends');
    windowTimeouts.shift()();
    assert.equal((await waiting).error?.code, 'timeout', 'a window that does not answer gets the program a timeout');
    win.webContents.onSend = answering;
    assert.ok((await agent.ask('designs')).result, 'and the link goes on');
}

// ── 2. Terminate ────────────────────────────────────────────────────────────
{
    const second = await connectAgent('script.exe');
    assert.deepEqual(lastState().programs, ['claude-code', 'script.exe'], 'the window is told every program in');
    await terminate(otherPage);
    assert.ok((await agent.ask('designs')).result, 'Terminate from another page does nothing');
    await terminate();
    await Promise.all([closes(agent, 'Terminate ends every program\'s connection'), closes(second, 'Terminate ends every program\'s connection')]);
    assert.deepEqual(lastState(), { interactive: false, programs: [] }, 'and gives the app back');
    assert.ok(!fs.existsSync(file), 'with the switch off it closes the pipe and removes the live link file');
    assert.equal(await connectAgent(), null, 'so no program finds the link');

    assert.deepEqual(await setLink(win.webContents, true), { open: true });
    const askedBefore = asks().length;
    const { client: letGo, first: refused } = await greet('script.exe');
    assert.equal(refused.error?.code, 'off', 'with the switch off Terminate lets the program go too: the switch turned on later turns it away');
    await closes(letGo, 'the program turned away is hung up on');
    assert.deepEqual([asks().length, lastState().programs], [askedBefore, []], 'with no question, and the app is not held');
    assert.deepEqual(await interactive(), { open: true });
    const returned = await connectAgent('script.exe');
    assert.ok((await returned.ask('designs')).result, 'until Interactive lets it in again');
    await terminate();
    await closes(returned, 'Terminate');
    await setLink(win.webContents, false);

    assert.deepEqual(await interactive(), { open: true });
    await terminate();
    assert.deepEqual(lastState(), { interactive: false, programs: [] }, 'Terminate with no program connected gives the app back too');
    assert.ok(!fs.existsSync(file), 'and closes the pipe');

    assert.deepEqual(await setLink(win.webContents, true), { open: true });
    assert.deepEqual(await interactive(), { open: true });
    const pipe = link().pipe;
    agent = await connectAgent('claude-code');
    await terminate();
    await closes(agent, 'with the switch on, Terminate lets the program go too');
    assert.deepEqual(lastState(), { interactive: false, programs: [] }, 'and gives the app back');
    assert.equal(link().pipe, pipe, 'but the pipe stays open, as the switch has it');
    const asked = asks().length;
    const { client: back, first: turnedAway } = await greet('claude-code');
    assert.equal(turnedAway.error?.code, 'off', 'and the program it let go is turned away, as when the pipe closes');
    await closes(back, 'the program turned away is hung up on');
    assert.deepEqual([asks().length, lastState().programs], [asked, []], 'with no question, and the app is not held');
}

// ── 3. The switch ───────────────────────────────────────────────────────────
{
    const asked = asks().length;
    const { client: python, first } = await greet('python.exe');
    assert.deepEqual(first, { asking: true, proof: proof(python.secret, 'nonce of python.exe', 'app') },
        'a program that comes while the switch listens is told, with the app\'s proof, that the user is asked');
    const [ask] = asks().slice(asked);
    assert.equal(ask?.program, 'python.exe', 'and the window asks the user, naming it');
    assert.equal(lastState().programs.length, 0, 'the app is not held for a program not let in');
    answerAsk(otherPage, ask.id, true);
    await settled();
    assert.equal(lastState().programs.length, 0, 'an answer from another page is ignored');
    answerAsk(win.webContents, ask.id, true);
    assert.equal((await python.reply()).version, '9.9.9', 'Allow lets it in');
    assert.deepEqual(lastState(), { interactive: false, programs: ['python.exe'] }, 'and the app is held for it');
    assert.ok((await python.ask('designs')).result, 'its requests are answered');

    const again = await connectAgent('python.exe');
    assert.equal(asks().length, asked + 1, 'the same program again is let in without a question');
    await terminate();
    await Promise.all([closes(python, 'Terminate lets an allowed program go'), closes(again, 'Terminate lets an allowed program go')]);
    assert.deepEqual(lastState(), { interactive: false, programs: [] }, 'and gives the app back');
    const { first: afterTerminate } = await greet('python.exe');
    assert.equal(afterTerminate.error?.code, 'off', 'the program it let go does not come back on its Allow');
    assert.equal(asks().length, asked + 1, 'and is not asked about again');
    assert.equal(lastState().programs.length, 0, 'so the app stays given back');

    const { client: agentDenied, first: waiting } = await greet('codex');
    assert.equal(waiting.asking, true);
    answerAsk(win.webContents, asks().at(-1).id, false);
    assert.equal((await agentDenied.reply()).error?.code, 'denied', 'Deny refuses it');
    await closes(agentDenied, 'Deny ends the connection');
    const { first: refusedAgain } = await greet('codex');
    assert.equal(refusedAgain.error?.code, 'denied', 'and refuses it again without a question');
    assert.equal(asks().length, asked + 2, 'asked once for each program');

    const before = asks().length;
    const twice = await Promise.all([greet('two.exe'), greet('two.exe')]);
    assert.equal(asks().length, before + 1, 'two connections of one program wait on one question');
    answerAsk(win.webContents, asks().at(-1).id, true);
    for (const { client } of twice) assert.equal((await client.reply()).version, '9.9.9', 'and both come in on its answer');
    for (const { client } of twice) client.socket.destroy();

    const { client: nameless, first: askedNameless } = await greet(null);
    assert.equal(askedNameless.asking, true);
    assert.equal(asks().at(-1).program, null, 'a program with no name is asked about as one');
    answerAsk(win.webContents, asks().at(-1).id, true);
    assert.equal((await nameless.reply()).version, '9.9.9');
    nameless.socket.destroy();
    const { client: namelessAgain, first: askedAgain } = await greet(null);
    assert.equal(askedAgain.asking, true, 'and again each time, since it cannot be told from another');
    answerAsk(win.webContents, asks().at(-1).id, false);
    await closes(namelessAgain, 'Deny ends the connection');

    const requests = requestsSent();
    const { client: eager } = await greet('eager.exe');
    eager.send({ id: 1, method: 'designs' });
    assert.deepEqual(await eager.reply(), { closed: true }, 'a line sent while the user is asked ends the connection');
    assert.equal(requestsSent(), requests, 'and reaches nothing');
    answerAsk(win.webContents, asks().at(-1).id, false);
    while (lastState().programs.length) await settled();

    assert.deepEqual(await interactive(), { open: true });
    agent = await connectAgent('codex');
    assert.ok((await agent.ask('designs')).result, 'Interactive lets in a program that was denied');
    const letGo = await connectAgent('python.exe');
    assert.ok((await letGo.ask('designs')).result, 'and one that Terminate let go');
    const { client: unnamed } = await greet(null);
    await terminate();
    await Promise.all([closes(agent, 'Terminate'), closes(letGo, 'Terminate'), closes(unnamed, 'Terminate')]);
    const turnedAway = asks().length;
    for (const program of ['codex', 'python.exe']) {
        assert.equal((await greet(program)).first.error?.code, 'off', `${program}: its Terminate turns it away again`);
    }
    assert.equal(asks().length, turnedAway, 'with no question');
    const kept = await connectAgent('two.exe');
    assert.ok((await kept.ask('designs')).result, 'a program allowed and gone before Terminate keeps its Allow');
    kept.socket.destroy();
    const { client: unnamedAgain, first: askedUnnamed } = await greet(null);
    assert.equal(askedUnnamed.asking, true, 'and one with no name is asked about again, since it cannot be told from another');
    answerAsk(win.webContents, asks().at(-1).id, false);
    await closes(unnamedAgain, 'Deny ends the connection');
}

// ── 4. What closes it ───────────────────────────────────────────────────────
for (const [what, open, close] of [
    ['the switch turned off', () => setLink(win.webContents, true), () => setLink(win.webContents, false)],
    ['the window loading again', interactive, () => win.webContents.emit('did-start-navigation', {}, 'file:///index.html', false, true)],
    ['the window\'s page crashing', interactive, () => win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })],
    ['the window closed', interactive, () => { win.webContents.gone = true; win.webContents.emit('destroyed'); }],
]) {
    assert.deepEqual(await open(), { open: true });
    agent = await connectAgent('two.exe');
    assert.ok((await agent.ask('designs')).result, `${what}: the program finds the pipe as it is now`);
    win.webContents.onSend = null;
    const before = requestsSent();
    const waiting = agent.ask('designs');
    while (requestsSent() === before) await settled();
    close();
    await closes(agent, `${what}: the program's connection ends`);
    assert.deepEqual(await waiting, { closed: true }, `${what}: the program's connection ends with its request unanswered`);
    assert.ok(!fs.existsSync(file), `${what}: the live link file is removed`);
    assert.equal(await connectAgent(), null, `${what}: so no program finds the link`);
    win.webContents.onSend = answering;
    win.webContents.gone = false;
}
{
    assert.deepEqual(await interactive(), { open: true });
    win.webContents.emit('did-start-navigation', {}, 'file:///index.html', false, true);
    assert.deepEqual(await setLink(win.webContents, false), { open: false }, 'a page that loads again starts without Interactive');
    assert.ok(!fs.existsSync(file));

    await setLink(win.webContents, true);
    const { client: unanswered } = await greet('late.exe');
    const ask = asks().at(-1);
    win.webContents.emit('did-start-navigation', {}, 'file:///index.html', false, true);
    assert.equal((await unanswered.reply()).closed, true, 'going away ends a program the user is still asked about');
    answerAsk(win.webContents, ask.id, true);
    await setLink(win.webContents, true);
    const { first: askedOnceMore } = await greet('late.exe');
    assert.equal(askedOnceMore.asking, true, 'and the question counts as Deny without being kept: it is asked again');
    answerAsk(win.webContents, asks().at(-1).id, false);
    await setLink(win.webContents, false);
}
{
    assert.deepEqual(await interactive(), { open: true });
    agent = await connectAgent();
    win.webContents.emit('did-start-navigation', {}, 'file:///index.html#help', true, true);
    win.webContents.emit('did-start-navigation', {}, 'about:blank', false, false);
    assert.ok((await agent.ask('designs')).result, 'a page that moves in place, or a frame inside it, leaves the link open');
    win.destroyed = true;
    assert.equal((await agent.ask('designs')).error?.code, 'off', 'a request that finds no main window is answered off');
    win.destroyed = false;
    await terminate();
}

globalThis.setTimeout = realSetTimeout;
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS: live_bridge_ipc');
