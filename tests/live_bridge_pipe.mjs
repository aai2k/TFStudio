/**
 * The app's end of the live link (src/main/liveBridge.js), in plain Node, with
 * the window's answers standing in for the window (_fakeLiveApp.mjs).
 *
 * Opening the pipe writes the live link file, which names the pipe and holds
 * a secret; elsewhere than Windows the socket is the user's alone (0600, in a
 * 0700 folder). A connection is served only after a hello in this protocol
 * that proves the secret, and hung up on otherwise, also when it sends the
 * secret itself; the app answers it with its own proof. Requests on one
 * connection are answered under their own ids, a slow one after a quick one
 * sent later. A line that is not JSON is answered, a request the app has no
 * method for and an apply whose design is not a design are refused before
 * they reach the window, and a line past the length the protocol takes ends
 * the connection.
 * Closing ends every connection at once and removes the file, but only a file
 * that still names this pipe, and the next opening is a new pipe with a new
 * secret, written over a file a crash left behind.
 * A program that proved the secret comes in only as `admit` says, asked by the
 * name its hello gives: let in at once it gets the hello, asked about it is
 * first told to wait, with the app's proof, and refused it is answered
 * 'denied' and hung up on. The programs in are reported as they come and go;
 * one gone before it was let in never is. drop() lets every program in go and
 * keeps listening.
 *
 * Run: node tests/live_bridge_pipe.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { agentHello, makeFakeApp, rawClient } from './_fakeLiveApp.mjs';

const require = createRequire(import.meta.url);
const { createLiveBridge } = require('../src/main/liveBridge.js');
const { PROTOCOL, MAX_LINE, proof } = require('../src/main/liveProtocol.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-live-pipe-'));
const file = path.join(dir, 'live-bridge.json');
const readLink = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const within = (promise, ms, what) => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: nothing within ${ms} ms`)), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

const design = {
    id: 'app-1', name: 'AR', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 30 }], backLayers: [],
};
const app = makeFakeApp({ 'app-1': design }, 'app-1');
const logs = [];
let slowNext = false;
const forward = (method, params) => {
    if (!slowNext) return app.forward(method, params);
    slowNext = false;
    return new Promise(resolve => setTimeout(() => resolve(app.forward(method, params)), 300));
};

// A file a crashed app left behind.
fs.writeFileSync(file, JSON.stringify({ pipe: 'gone', secret: 'old' }));
const bridge = createLiveBridge({ file, log: text => logs.push(text), version: '9.9.9', forward });

// ── Opening ─────────────────────────────────────────────────────────────────
assert.deepEqual(await bridge.open(), { open: true });
const link = readLink();
assert.ok(link.pipe !== 'gone' && /^[0-9a-f]{64}$/.test(link.secret), 'the file a crash left is written over with this pipe and a fresh secret');
assert.deepEqual(Object.keys(link).sort(), ['pipe', 'secret'], 'the file holds the pipe and the secret');
if (process.platform === 'win32') {
    assert.match(link.pipe, /^\\\\\.\\pipe\\tfstudio-live-[0-9a-f]{32}$/, 'a named pipe under a name no one can guess');
} else {
    assert.equal(fs.statSync(link.pipe).mode & 0o777, 0o600, 'the socket is the user\'s alone');
    assert.equal(fs.statSync(path.dirname(link.pipe)).mode & 0o777, 0o700, 'in a folder of the user\'s own');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'and so is the file that holds the secret');
}
assert.deepEqual(await bridge.open(), { open: true }, 'opening an open link keeps it');
assert.equal(readLink().secret, link.secret, 'with its pipe and secret');

// ── The hello ───────────────────────────────────────────────────────────────
{
    const stranger = await rawClient(net, link.pipe);
    stranger.send(agentHello('guess'));
    assert.equal((await within(stranger.next(), 5000, 'wrong secret')).error?.code, 'secret');
    await within(stranger.closed, 5000, 'hang-up');
    assert.ok(logs.some(line => /without the secret/.test(line)), 'a connection without the secret is logged');

    const plain = await rawClient(net, link.pipe);
    plain.send({ hello: PROTOCOL, secret: link.secret });
    assert.equal((await within(plain.next(), 5000, 'secret sent as it is')).error?.code, 'secret', 'the secret itself is not a proof');
    await within(plain.closed, 5000, 'hang-up');

    const other = await rawClient(net, link.pipe);
    other.send({ ...agentHello(link.secret), hello: PROTOCOL + 1 });
    assert.equal((await within(other.next(), 5000, 'other protocol')).error?.code, 'protocol', 'another protocol is turned away');
    await within(other.closed, 5000, 'hang-up');

    const silent = await rawClient(net, link.pipe);
    silent.send({ id: 1, method: 'designs' });
    assert.equal((await within(silent.next(), 5000, 'no hello')).error?.code, 'protocol', 'a request before the hello is turned away');
    await within(silent.closed, 5000, 'hang-up');
    assert.deepEqual(app.requests, [], 'and nothing reached the window');
}

// ── Requests ────────────────────────────────────────────────────────────────
const client = await rawClient(net, link.pipe);
client.send(agentHello(link.secret, 'nonce 1'));
assert.deepEqual(await within(client.next(), 5000, 'hello'), { hello: PROTOCOL, version: '9.9.9', proof: proof(link.secret, 'nonce 1', 'app') },
    'the hello is answered with the app\'s version and its proof of the secret for that nonce');
{
    slowNext = true;
    client.send({ id: 'slow', method: 'read', params: {} });
    client.send({ id: 'quick', method: 'designs' });
    const first = await within(client.next(), 5000, 'first answer');
    const second = await within(client.next(), 5000, 'second answer');
    assert.equal(first.id, 'quick', 'a quick request is answered before a slow one sent first');
    assert.equal(first.result.designs[0].appDesignId, 'app-1');
    assert.equal(second.id, 'slow');
    assert.equal(second.result.design.name, 'AR', 'each under its own id');

    client.send('{not json');
    assert.equal((await within(client.next(), 5000, 'bad JSON')).error?.code, 'invalid', 'a line that is not JSON is answered');
    client.send({ id: 7, method: 'deleteEverything' });
    const unknown = await within(client.next(), 5000, 'unknown method');
    assert.deepEqual([unknown.id, unknown.error?.code], [7, 'invalid'], 'a method the link does not have is refused');
    const asked = app.requests.length;
    client.send({ id: 8, method: 'apply', params: { appDesignId: 'app-1', revision: second.result.revision, design: { frontLayers: [] } } });
    const bad = await within(client.next(), 5000, 'malformed apply');
    assert.deepEqual([bad.id, bad.error?.code], [8, 'invalid'], 'an apply whose design has no substrate is refused');
    assert.match(bad.error.message, /substrate/, 'saying why, as a design file that cannot open does');
    client.send({ id: 9, method: 'apply', params: { appDesignId: 'app-1', design } });
    assert.equal((await within(client.next(), 5000, 'apply without revision')).error?.code, 'invalid', 'an apply must name the revision it was read at');
    assert.equal(app.requests.length, asked, 'neither reached the window');
    assert.equal(app.writes, 0);
}

// ── A line too long ─────────────────────────────────────────────────────────
{
    const long = await rawClient(net, link.pipe);
    long.send(agentHello(link.secret));
    await within(long.next(), 5000, 'hello');
    const chunk = 'x'.repeat(1024 * 1024);
    const drained = () => new Promise(resolve => {
        const done = () => { long.socket.off('drain', done).off('close', done); resolve(); };
        long.socket.on('drain', done).on('close', done);
    });
    for (let sent = 0; sent <= MAX_LINE && !long.socket.destroyed; sent += chunk.length) {
        if (!long.socket.write(chunk)) await drained();
    }
    await within(long.closed, 10000, 'cut off');
    client.send({ id: 10, method: 'designs' });
    assert.equal((await within(client.next(), 5000, 'after the long line')).id, 10, 'a line past the limit ends its own connection, not the others');
}

// ── Closing ─────────────────────────────────────────────────────────────────
{
    app.hang = true;
    client.send({ id: 11, method: 'designs' });
    await new Promise(resolve => setTimeout(resolve, 100));
    bridge.close();
    await within(client.closed, 5000, 'close');
    assert.ok(!fs.existsSync(file), 'closing removes the live link file');
    if (process.platform !== 'win32') assert.ok(!fs.existsSync(path.dirname(link.pipe)), 'and the socket\'s folder');
    await assert.rejects(rawClient(net, link.pipe), 'nothing listens on the pipe once it is closed');
    app.hang = false;

    assert.deepEqual(await bridge.open(), { open: true }, 'it opens again');
    const again = readLink();
    assert.ok(again.pipe !== link.pipe && again.secret !== link.secret, 'as a new pipe with a new secret');
    // Another opening's file, say a second copy of the app's, is left alone.
    fs.writeFileSync(file, JSON.stringify({ pipe: 'someone else', secret: 'theirs' }));
    bridge.close();
    assert.equal(readLink().pipe, 'someone else', 'a file that names another pipe is not removed');
}

// ── Letting a program in ────────────────────────────────────────────────────
{
    const gateFile = path.join(dir, 'gate-bridge.json');
    const asked = [];
    const lists = [];
    let decide = null;
    const gate = createLiveBridge({
        file: gateFile, log: () => {}, version: '9.9.9', forward: app.forward,
        admit: (program, asking) => {
            asked.push(program);
            if (program === 'quick') return true;
            asking();
            return new Promise(resolve => { decide = resolve; });
        },
        onPrograms: names => lists.push(names),
    });
    await gate.open();
    const { pipe, secret } = JSON.parse(fs.readFileSync(gateFile, 'utf8'));
    const connectAs = async (program, nonce) => {
        const client = await rawClient(net, pipe);
        client.send(agentHello(secret, nonce, program));
        return client;
    };

    const quick = await connectAs('  quick  ', 'q');
    assert.equal((await within(quick.next(), 5000, 'quick hello')).version, '9.9.9', 'a program let in at once gets the app\'s hello');
    assert.deepEqual(asked, ['quick'], 'the app is asked about the program by the name its hello gives');
    assert.deepEqual(lists.at(-1), ['quick'], 'and told it is in');

    const slow = await connectAs('slow', 's');
    assert.deepEqual(await within(slow.next(), 5000, 'asking'), { asking: true, proof: proof(secret, 's', 'app') },
        'a program the user is asked about is told to wait, with the app\'s proof');
    decide(false);
    const denied = await within(slow.next(), 5000, 'denied');
    assert.deepEqual([denied.error?.code, denied.hello], ['denied', undefined], 'one the user does not let in is refused as denied');
    await within(slow.closed, 5000, 'hang-up after denied');
    assert.deepEqual(lists.at(-1), ['quick'], 'and is never in');

    const gone = await connectAs(5, 'g');
    await within(gone.next(), 5000, 'asking');
    assert.equal(asked.at(-1), null, 'a hello whose program is not a name gives none');
    gone.socket.destroy();
    await within(gone.closed, 5000, 'gone');
    // The app's end hears of the close a moment after this end has closed.
    await new Promise(resolve => setTimeout(resolve, 100));
    decide(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(lists.at(-1), ['quick'], 'a program gone before the user let it in is not in');

    gate.drop();
    await within(quick.closed, 5000, 'drop');
    assert.deepEqual(lists.at(-1), [], 'drop ends the connections of the programs in');
    const after = await connectAs('quick', 'q2');
    assert.equal((await within(after.next(), 5000, 'after drop')).version, '9.9.9', 'and the pipe goes on listening');
    gate.close();
    await within(after.closed, 5000, 'close');
    assert.deepEqual(lists.at(-1), [], 'closing lets every program go');
    assert.ok(!fs.existsSync(gateFile));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS: live_bridge_pipe');
