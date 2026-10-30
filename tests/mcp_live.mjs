/**
 * The MCP server linked to the open app (node src/mcp/server.js --live
 * <file>), driven over stdio, against the app's real pipe
 * (src/main/liveBridge.js) in this process with the window's answers standing
 * in for the window (_fakeLiveApp.mjs).
 *
 *   1. With --live the server lists the three tools that reach the app, and
 *      refine and synthesize take applyToApp; mcp_server.mjs checks that
 *      without it they are absent.
 *   2. Read, edit, apply: an app design read into the session, edited with the
 *      existing tools and applied back is one write in the app, which keeps the
 *      design's name and names it in a notice; the session copy is then at the
 *      app's new revision and applies again. An edit in the app between the
 *      read and the apply refuses the apply and writes nothing, and a read again
 *      then applies. A design not read from the app, a copy of one included,
 *      is refused.
 *   3. Runs: a run without applyToApp writes nothing to the app; a refinement
 *      with applyToApp applies its answer as one write when it ends; with an
 *      edit in the app after the read it ends applied: false, says why, and
 *      keeps its answer; a stopped Deep Synthesis applies nothing, though its
 *      answer is a design of its own; a run whose answer is on its way to the
 *      app shows applying, and Stop leaves it to finish.
 *   4. The app gone: no file, the switch turned off mid-session, a file a
 *      crash left, a file with the wrong secret, and a program at the pipe a
 *      file left behind names that cannot prove the secret, answering with
 *      the agent's own proof or with none, or telling the agent to wait for
 *      the user without the app's proof, each give the "not running, or
 *      not listening" answer, which says to click Interactive on the
 *      Optimization tab, and that program hears no secret and no request; the
 *      link follows the app when it opens again; an app that does not answer
 *      gives the "did not answer" one, and an app whose user clicked Deny the
 *      answer that says so and points to Interactive.
 *   5. The agent's name: the server names the agent to the app as the MCP
 *      client called itself in initialize, its title before its name. While
 *      the app asks its user, the link waits for the answer past its own
 *      deadline for the hello.
 *   6. A hang-up: a request made the moment the app has ended the link's
 *      connection, or at once after, before the link has read that, goes on
 *      a new one.
 *
 * Run: node tests/mcp_live.mjs
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startClient, onlyMessages, INIT } from './_mcpClient.mjs';
import { makeFakeApp } from './_fakeLiveApp.mjs';

const require = createRequire(import.meta.url);
const { createLiveBridge } = require('../src/main/liveBridge.js');
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ended = client => Promise.race([client.exited, sleep(10000).then(() => 'still running')]);
// Looks at `check` every 50 ms until it holds, and gives up after 200 looks,
// 10 s: what it waits for comes within about a second, and a run that never
// gets there must not hang the test.
async function until(check) {
    for (let i = 0; i < 200 && !(await check()); i++) await sleep(50);
}

const OFF = /^\w+: TFStudio is not running, or it is not listening for this program\. Click Interactive on TFStudio's Optimization tab, then call this again\.$/;
const DENIED = /^\w+: Deny was clicked in TFStudio when this program asked to work on the open design\. Click Interactive on TFStudio's Optimization tab/;
const AR = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }];
const POOL = ['TiO2', 'SiO2'];

// Two designs as the app holds them: an unrefined two-layer AR coating, open,
// and a mirror.
const api = await import('../src/api/index.js');
await api.init();
let ar = api.newDesign({ name: 'Two-layer AR' });
ar = api.insertLayer(ar, { material: 'TiO2', thickness: 30 });
ar = api.insertLayer(ar, { material: 'SiO2', thickness: 50 });
ar = api.setMerit(ar, AR);
const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
const app = makeFakeApp({ 'app-ar': { ...ar, id: 'app-ar' }, 'app-hr': { ...mirror, id: 'app-hr' } }, 'app-ar');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-mcp-live-'));
const file = path.join(dir, 'live-bridge.json');
// While `holdApply` is set, an apply waits for it before the app answers, as
// one does while the window is busy; `applyHeld` says one has waited.
let holdApply = null;
let applyHeld = false;
const forward = async (method, params) => {
    if (method === 'apply' && holdApply) {
        applyHeld = true;
        await holdApply;
    }
    return app.forward(method, params);
};
// The programs the app was asked to let in, by the name each gave; while
// `letIn` is false the app's user clicks Deny.
const programs = [];
let letIn = true;
const bridge = createLiveBridge({ file, log: () => {}, version: '9.9.9', forward, admit: program => { programs.push(program); return letIn; } });
ok('the app opens the link', (await bridge.open()).open === true);

const server = startClient(process.execPath, ['--no-warnings', SERVER, '--live', file]);
const init = await server.request('initialize', { ...INIT, clientInfo: { name: 'claude-code', title: 'Claude Code', version: '2' } });
server.write({ jsonrpc: '2.0', method: 'notifications/initialized' });

// ── 1. The tools ───────────────────────────────────────────────────────────
{
    const listed = (await server.request('tools/list')).result.tools;
    const byName = Object.fromEntries(listed.map(t => [t.name, t]));
    ok('with --live the server lists the tools that reach the app', ['listAppDesigns', 'readAppDesign', 'applyToApp'].every(name => byName[name]?.description)
        && listed.length === 72, listed.map(t => t.name).join(','));
    ok('refine and synthesize take applyToApp, Monte Carlo does not', byName.refine.inputSchema.properties.applyToApp?.type === 'boolean'
        && byName.synthesize.inputSchema.properties.applyToApp?.type === 'boolean' && !byName.monteCarlo.inputSchema.properties.applyToApp);
    ok('the instructions say how to work on the open design', /readAppDesign/.test(init.result.instructions) && /applyToApp/.test(init.result.instructions));
    const apps = await server.call('listAppDesigns', {});
    const shown = apps.designs?.[0];
    ok('listAppDesigns lists the designs the app holds, with the app\'s version', [apps.appVersion, apps.activeDesignId, apps.designs?.length].join() === '9.9.9,app-ar,2', JSON.stringify(apps));
    ok('each with its folder and layer counts', [shown?.folder, shown?.frontLayers].join() === 'Coatings/AR,2', JSON.stringify(shown));
    ok('the server names the agent to the app as its client called itself, by title', programs.join() === 'Claude Code', programs.join());
}

// ── 2. Read, edit, apply ───────────────────────────────────────────────────
{
    const read = await server.call('readAppDesign', {});
    ok('readAppDesign copies the open design into the session under a new id', /^d\d+$/.test(read.designId ?? '') && read.name === 'Two-layer AR' && read.front?.length === 2, JSON.stringify(read));
    ok('with where it came from', [read.appDesignId, read.active, read.appRunning, typeof read.appRevision].join() === 'app-ar,true,false,string', JSON.stringify(read));
    await server.call('setLayer', { designId: read.designId, index: 0, thickness: 40 });
    await server.call('setLayer', { designId: read.designId, index: 1, thickness: 60 });
    const applied = await server.call('applyToApp', { designId: read.designId });
    ok('two edits applied back are one write in the app', applied.applied === true && app.writes === 1
        && app.designs['app-ar'].frontLayers.map(l => l.thickness).join() === '40,60', JSON.stringify(applied));
    ok('which keeps the design\'s name and names it in a notice', app.designs['app-ar'].name === 'Two-layer AR' && app.notices.join() === 'Two-layer AR');
    ok('the session copy is at the app\'s new revision', applied.appRevision && applied.appRevision !== read.appRevision && applied.designId === read.designId);
    await server.call('setLayer', { designId: read.designId, index: 0, thickness: 41 });
    ok('and applies again', (await server.call('applyToApp', { designId: read.designId })).applied === true && app.writes === 2);

    const stale = await server.call('readAppDesign', {});
    app.edit('app-ar', { referenceWavelength: 600 });
    await server.call('setLayer', { designId: stale.designId, index: 0, thickness: 33 });
    const refused = await server.call('applyToApp', { designId: stale.designId });
    ok('an edit in the app after the read refuses the apply', /changed in TFStudio since it was read/.test(refused.error ?? '') && app.writes === 2, JSON.stringify(refused));
    ok('and writes nothing', app.designs['app-ar'].frontLayers[0].thickness === 41 && app.designs['app-ar'].referenceWavelength === 600);
    const fresh = await server.call('readAppDesign', {});
    await server.call('setLayer', { designId: fresh.designId, index: 0, thickness: 33 });
    ok('a read again then applies', (await server.call('applyToApp', { designId: fresh.designId })).applied === true && app.writes === 3
        && app.designs['app-ar'].referenceWavelength === 600);

    const named = await server.call('readAppDesign', { appDesignId: 'app-hr' });
    ok('a design that is not the open one is read', named.active === false && named.front.length === 9);
    ok('but not written', /no longer the one open in TFStudio/.test((await server.call('applyToApp', { designId: named.designId })).error ?? '') && app.writes === 3);
    const own = (await server.call('newDesign', {})).designId;
    ok('a design not read from the app is refused', /was not read from TFStudio/.test((await server.call('applyToApp', { designId: own })).error ?? ''));
    const copy = (await server.call('copyDesign', { designId: fresh.designId })).designId;
    ok('so is a copy of one read from it', /was not read from TFStudio/.test((await server.call('applyToApp', { designId: copy })).error ?? ''));
    ok('and a run on one cannot apply', /applyToApp needs a design read from TFStudio/.test((await server.call('refine', { designId: own, method: 'dls', applyToApp: true })).error ?? ''));
}

// ── 3. Runs ────────────────────────────────────────────────────────────────
{
    app.edit('app-ar', { frontLayers: ar.frontLayers, referenceWavelength: 550 });
    const read = await server.call('readAppDesign', {});
    const writes = app.writes;
    // First without applyToApp, while the copy is still at the app's revision,
    // so an apply nobody asked for would land.
    const plain = await server.call('refine', { designId: read.designId, method: 'dls', maxIter: 20, waitSeconds: 50 });
    ok('a run without applyToApp changes the design', plain.state === 'done' && plain.designId !== read.designId, JSON.stringify(plain));
    ok('and writes nothing to the app', !('applied' in plain) && !plain.appRefusal && app.writes === writes, JSON.stringify(plain));
    const run = await server.call('refine', { designId: read.designId, method: 'dls', maxIter: 20, waitSeconds: 50, applyToApp: true });
    const answer = run.designId ? await server.call('showDesign', { designId: run.designId }) : null;
    ok('a refinement with applyToApp applies its answer when it ends', run.state === 'done' && run.applied === true && !run.appRefusal
        && app.writes === writes + 1, JSON.stringify(run));
    ok('as the layers it answered with', answer && app.designs['app-ar'].frontLayers.map(l => l.thickness).join() === answer.front.map(l => l.thickness).join());

    const before = await server.call('readAppDesign', {});
    app.edit('app-ar', { referenceWavelength: 555 });
    const late = await server.call('refine', { designId: before.designId, method: 'dls', maxIter: 20, waitSeconds: 50, applyToApp: true });
    ok('a run whose design changed in the app ends applied: false and says why', late.state === 'done' && late.applied === false
        && /changed in TFStudio since it was read/.test(late.appRefusal ?? '') && app.writes === writes + 1, JSON.stringify(late));
    ok('and keeps its answer', !!late.designId && (await server.call('showDesign', { designId: late.designId })).front?.length === 2);

    // Deep Synthesis answers Stop with its best design so far, a design of its
    // own, so there is an answer the stop must keep from the app. It is stopped
    // once it reports a merit, that is, once it holds a best design.
    const fresh = await server.call('readAppDesign', {});
    const long = await server.call('synthesize', { designId: fresh.designId, method: 'deep', pool: POOL, settings: { maxLayers: 20, seed: 7 }, waitSeconds: 0, applyToApp: true });
    await until(async () => Number.isFinite((await server.call('jobStatus', { jobId: long.jobId })).progress?.mf));
    await server.call('stopJob', { jobId: long.jobId });
    const stopped = await server.call('jobStatus', { jobId: long.jobId, waitSeconds: 20 });
    ok('a stopped Deep Synthesis answers with a design of its own', stopped.state === 'stopped' && !!stopped.designId && stopped.designId !== fresh.designId, JSON.stringify(stopped));
    ok('which it does not apply', stopped.applied === false && !stopped.appRefusal && app.writes === writes + 1, JSON.stringify(stopped));

    // A run whose answer is on its way to the app has ended: Stop leaves it to
    // finish. The app holds the apply until the job has been asked to stop.
    app.edit('app-ar', { frontLayers: ar.frontLayers });
    const held = await server.call('readAppDesign', {});
    let release;
    holdApply = new Promise(resolve => { release = resolve; });
    const handing = await server.call('refine', { designId: held.designId, method: 'dls', maxIter: 20, waitSeconds: 0, applyToApp: true });
    await until(() => applyHeld);
    const asked = await server.call('stopJob', { jobId: handing.jobId });
    holdApply = null;
    release();
    const handed = await server.call('jobStatus', { jobId: handing.jobId, waitSeconds: 20 });
    ok('a run handing its answer to the app shows applying, which Stop leaves alone', applyHeld && asked.state === 'applying', asked.state);
    ok('so it ends done with its answer applied', handed.state === 'done' && handed.applied === true && app.writes === writes + 2, JSON.stringify(handed));
}

// ── 4. The app gone ────────────────────────────────────────────────────────
{
    letIn = false;
    bridge.drop();
    const denied = await server.call('listAppDesigns', {});
    ok('an app whose user clicked Deny says so, and points to Interactive', DENIED.test(denied.error ?? ''), `${JSON.stringify(denied).slice(0, 300)}; asked ${programs.length} times`);
    letIn = true;
    ok('and once the user lets the agent in, it works again', (await server.call('listAppDesigns', {})).designs?.length === 2);
    bridge.close();
    ok('the switch turned off mid-session', OFF.test((await server.call('listAppDesigns', {})).error ?? ''));
    ok('no live link file', !fs.existsSync(file) && OFF.test((await server.call('readAppDesign', {})).error ?? ''));
    const unused = process.platform === 'win32' ? '\\\\.\\pipe\\tfstudio-live-0000' : path.join(dir, 'gone.sock');
    fs.writeFileSync(file, JSON.stringify({ pipe: unused, secret: 'old' }));
    ok('a file a crash left', OFF.test((await server.call('listAppDesigns', {})).error ?? ''));
    await bridge.open();
    const opened = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...opened, secret: 'not it' }));
    ok('a file with the wrong secret', OFF.test((await server.call('listAppDesigns', {})).error ?? ''));

    // A program that took the pipe a file left behind names: it answers the
    // hello with what `answerHello(hello)` gives, and every request.
    const heard = [];
    const sockets = [];
    let answerHello;
    const impostorPipe = process.platform === 'win32' ? `\\\\.\\pipe\\tfstudio-live-impostor-${process.pid}` : path.join(dir, 'impostor.sock');
    const impostor = net.createServer(socket => {
        sockets.push(socket);
        socket.setEncoding('utf8');
        socket.on('error', () => {});
        socket.on('data', chunk => {
            for (const message of chunk.split('\n').filter(Boolean).map(line => JSON.parse(line))) {
                heard.push(message);
                const answer = message.hello ? answerHello(message) : { id: message.id, result: { activeDesignId: 'theirs', designs: [] } };
                socket.write(`${JSON.stringify(answer)}\n`);
            }
        });
    });
    await new Promise(resolve => impostor.listen(impostorPipe, resolve));
    fs.writeFileSync(file, JSON.stringify({ pipe: impostorPipe, secret: 'left behind' }));
    for (const [how, answer] of [
        ['the agent\'s proof handed back as its own', hello => ({ hello: hello.hello, version: '6.6.6', proof: hello.proof })],
        ['no proof', hello => ({ hello: hello.hello, version: '6.6.6' })],
        ['a wait for the user, without the app\'s proof', hello => ({ asking: true, proof: hello.proof })],
    ]) {
        heard.length = 0;
        answerHello = answer;
        // The answer comes at once; one not there after 5 s, a wait on a
        // loaded machine included, is not coming.
        const said = await Promise.race([server.call('listAppDesigns', {}), sleep(5000).then(() => ({ error: 'no answer within 5 s' }))]);
        ok(`a program at the pipe of a file left behind, answering with ${how}`, OFF.test(said.error ?? ''), said.error);
        ok(`learns neither the secret nor a request (${how})`, heard.length === 1 && !JSON.stringify(heard).includes('left behind'), JSON.stringify(heard));
    }
    for (const socket of sockets) socket.destroy();
    impostor.close();
    fs.writeFileSync(file, JSON.stringify(opened));
    ok('the link follows the app when it opens again', (await server.call('listAppDesigns', {})).designs?.length === 2);
    app.hang = true;
    const asked = Date.now();
    const slow = await server.call('listAppDesigns', {});
    ok('an app that does not answer', /TFStudio did not answer/.test(slow.error ?? '') && Date.now() - asked < 30000, JSON.stringify(slow));
    app.hang = false;
}

ok('every line on stdout is a JSON-RPC message', onlyMessages(server), server.lines.find(line => !line.startsWith('{')));
server.child.stdin.end();
ok('closing stdin ends the server', await ended(server) === 0);
bridge.close();

// ── 5. Waiting for the user ────────────────────────────────────────────────
// The servers' end of the link in this process, its 20 s deadlines held until
// the test fires the ones still set, as they would have run out.
{
    const { createLiveLink } = await import('../src/mcp/liveLink.js');
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const deadlines = new Set();
    globalThis.setTimeout = (fn, ms, ...args) => {
        if (ms !== 20000) return realSetTimeout(fn, ms, ...args);
        const deadline = { fn };
        deadlines.add(deadline);
        return deadline;
    };
    globalThis.clearTimeout = handle => (deadlines.has(handle) ? deadlines.delete(handle) : realClearTimeout(handle));
    const askedFile = path.join(dir, 'asking-bridge.json');
    let answer = null;
    const asking = createLiveBridge({
        file: askedFile, log: () => {}, version: '9.9.9', forward: app.forward,
        admit: (program, tell) => { tell(); return new Promise(resolve => { answer = resolve; }); },
    });
    await asking.open();
    const link = createLiveLink(askedFile, () => 'python.exe');
    let settled = null;
    const listed = link.request('designs').then(result => { settled = { result }; }, err => { settled = { err }; });
    await until(() => answer);
    await sleep(50);
    for (const deadline of [...deadlines]) { deadlines.delete(deadline); deadline.fn(); }
    await sleep(50);
    ok('while the app asks its user, the link waits past its deadline for the hello', settled === null, JSON.stringify(settled?.err?.message));
    answer(true);
    await listed;
    ok('and goes on once the user lets it in', settled?.result?.designs?.length === 2, JSON.stringify(settled?.err?.message));
    link.close();
    asking.close();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
}

// ── 6. A hang-up ───────────────────────────────────────────────────────────
// The servers' end of the link in this process, its connections caught as it
// makes them, so the test can call the moment the app's hang-up arrives, or
// at once after it, before the link has read it.
{
    const { createLiveLink } = await import('../src/mcp/liveLink.js');
    const hangUpFile = path.join(dir, 'hang-up-bridge.json');
    const hangingUp = createLiveBridge({ file: hangUpFile, log: () => {}, version: '9.9.9', forward: app.forward });
    await hangingUp.open();
    const realConnect = net.connect;
    const connections = [];
    net.connect = (...args) => {
        const socket = realConnect(...args);
        connections.push(socket);
        return socket;
    };
    const link = createLiveLink(hangUpFile, () => 'python.exe');
    const designs = () => link.request('designs').then(result => ({ result }), err => ({ err }));
    await link.request('designs');
    hangingUp.drop();
    await new Promise(resolve => connections[0].once('end', resolve));
    const again = await designs();
    ok('a request made as the app hangs up goes on a new connection', again.result?.designs?.length === 2 && connections.length === 2, again.err?.code);
    hangingUp.drop();
    const atOnce = await designs();
    ok('so does one made at once after, before the link has read the hang-up', atOnce.result?.designs?.length === 2 && connections.length === 3, atOnce.err?.code);
    net.connect = realConnect;
    link.close();
    hangingUp.close();
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
