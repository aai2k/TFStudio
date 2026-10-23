/**
 * The API server linked to the open app (node src/apiServer/server.js --live
 * <file>), driven over stdio, against the app's real pipe
 * (src/main/liveBridge.js) in this process with the window's answers standing
 * in for the window (_fakeLiveApp.mjs).
 *
 *   1. The hello says the server is live; app.designs lists the designs the
 *      app holds with the app's version; app.read copies the open design, or
 *      the one named, with the revision it was read at.
 *   2. A design read, edited with the API's calls and applied back is one
 *      write in the app, which names it in a notice, and the answer is at the
 *      app's new revision, which applies again. A design holding NaN or an
 *      infinite number is refused before it is sent, since the link's JSON
 *      would make it null in the app, and the refusal names where it is. An
 *      edit in the app after the read refuses the apply with the code
 *      'edited', a design that is not the open one with 'switched', and
 *      neither writes anything; a design the app does not hold is 'unknown'.
 *      The refusals name the Python package's calls that read and list the
 *      app's designs.
 *   3. The app's user clicking Deny refuses a call with the code 'denied', in
 *      words that point to Interactive on the Optimization tab. The app gone:
 *      once its link closes, a call is refused with the code 'off', in words
 *      that say to click Interactive there.
 *   4. Without --live the hello says so and every app.* call is refused.
 *   5. The server names its program to the app as --program gives it.
 *
 * Run: node tests/api_server_live.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startApiClient, onlyMessages } from './_apiClient.mjs';
import { makeFakeApp } from './_fakeLiveApp.mjs';

const require = createRequire(import.meta.url);
const { createLiveBridge } = require('../src/main/liveBridge.js');
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'apiServer', 'server.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ended = client => Promise.race([client.exited, sleep(10000).then(() => 'still running')]);
const thicknesses = design => design.frontLayers.map(l => l.thickness).join();

// Two designs as the app holds them: a two-layer AR coating, open, and a mirror.
const api = await import('../src/api/index.js');
await api.init();
let ar = api.newDesign({ name: 'Two-layer AR' });
ar = api.insertLayer(ar, { material: 'TiO2', thickness: 30 });
ar = api.insertLayer(ar, { material: 'SiO2', thickness: 50 });
const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
const app = makeFakeApp({ 'app-ar': { ...ar, id: 'app-ar' }, 'app-hr': { ...mirror, id: 'app-hr' } }, 'app-ar');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-live-'));
const file = path.join(dir, 'live-bridge.json');
// The programs the app was asked to let in, by the name each gave; while
// `letIn` is false the app's user clicks Deny.
const programs = [];
let letIn = true;
const bridge = createLiveBridge({ file, log: () => {}, version: '9.9.9', forward: app.forward, admit: program => { programs.push(program); return letIn; } });
ok('the app opens the link', (await bridge.open()).open === true);
const server = startApiClient(process.execPath, ['--no-warnings', SERVER, '--live', file, '--program', 'python.exe']);

// ── 1. Designs and reads ───────────────────────────────────────────────────
{
    ok('the hello says the server is live', (await server.hello).live === true);
    const listed = (await server.call('app.designs')).result;
    ok('app.designs lists the designs the app holds, with the app\'s version', [listed?.appVersion, listed?.activeDesignId, listed?.designs?.length].join() === '9.9.9,app-ar,2', JSON.stringify(listed));
    ok('each with its folder and layer counts', [listed?.designs?.[0]?.folder, listed?.designs?.[0]?.frontLayers].join() === 'Coatings/AR,2');
    const read = (await server.call('app.read')).result;
    ok('app.read copies the open design with its revision', [read?.appDesignId, read?.active, read?.appRunning, typeof read?.revision, read?.design?.name].join()
        === 'app-ar,true,false,string,Two-layer AR', JSON.stringify(read)?.slice(0, 200));
    const named = (await server.call('app.read', [{ appDesignId: 'app-hr' }])).result;
    ok('or the one named', named?.active === false && named.design?.frontLayers?.length === 9);
    ok('an option it does not take is refused in the API\'s words', /^app\.read: unknown option 'id'/.test((await server.call('app.read', [{ id: 'app-hr' }])).error?.message ?? ''));
}

// ── 2. Apply ───────────────────────────────────────────────────────────────
{
    const read = (await server.call('app.read')).result;
    let design = (await server.call('setLayer', [read.design, { index: 0, thickness: 40 }])).result;
    design = (await server.call('setLayer', [design, { index: 1, thickness: 60 }])).result;
    const applied = await server.call('app.apply', [{ appDesignId: read.appDesignId, revision: read.revision, design }]);
    ok('two edits applied back are one write in the app', applied.result?.appDesignId === 'app-ar' && app.writes === 1
        && thicknesses(app.designs['app-ar']) === '40,60', JSON.stringify(applied.error));
    ok('which names the design in a notice', app.notices.join() === 'Two-layer AR');
    const now = applied.result;
    ok('the answer is at the app\'s new revision', typeof now?.revision === 'string' && now.revision !== read.revision && thicknesses(now.design) === '40,60');
    const again = (await server.call('setLayer', [now.design, { index: 0, thickness: 41 }])).result;
    const second = (await server.call('app.apply', [{ appDesignId: 'app-ar', revision: now.revision, design: again }])).result;
    ok('which applies again', !!second && app.writes === 2);
    const holed = { ...second.design, frontLayers: second.design.frontLayers.map((layer, i) => (i === 1 ? { ...layer, thickness: NaN } : layer)) };
    const nan = await server.call('app.apply', [{ appDesignId: 'app-ar', revision: second.revision, design: holed }]);
    ok('a design holding NaN is refused before it reaches the app, naming where', nan.error?.message === 'app.apply: design.frontLayers[1].thickness is NaN or infinite, which the app cannot take'
        && !nan.error.code && app.writes === 2, JSON.stringify(nan.error));
    const unbounded = { ...second.design, frontLayers: second.design.frontLayers.map((layer, i) => (i === 0 ? { ...layer, thickness: -Infinity } : layer)) };
    const infinite = await server.call('app.apply', [{ appDesignId: 'app-ar', revision: second.revision, design: unbounded }]);
    ok('and so is one holding an infinite number', infinite.error?.message === 'app.apply: design.frontLayers[0].thickness is NaN or infinite, which the app cannot take'
        && !infinite.error.code && app.writes === 2, JSON.stringify(infinite.error));

    const stale = (await server.call('app.read')).result;
    app.edit('app-ar', { referenceWavelength: 600 });
    const edited = await server.call('app.apply', [{ appDesignId: 'app-ar', revision: stale.revision, design: stale.design }]);
    ok('an edit in the app after the read refuses the apply as edited', edited.error?.code === 'edited'
        && /changed in TFStudio since it was read.*Read it again with tf\.app\.open_design\(\)/.test(edited.error.message), JSON.stringify(edited.error));
    ok('and writes nothing', app.writes === 2 && app.designs['app-ar'].referenceWavelength === 600);
    const other = (await server.call('app.read', [{ appDesignId: 'app-hr' }])).result;
    const switched = await server.call('app.apply', [{ appDesignId: 'app-hr', revision: other.revision, design: other.design }]);
    ok('a design that is not the open one is refused as switched', switched.error?.code === 'switched'
        && /no longer the one open in TFStudio/.test(switched.error.message) && app.writes === 2, JSON.stringify(switched.error));
    const unknown = await server.call('app.read', [{ appDesignId: 'nowhere' }]);
    ok('a design the app does not hold is unknown', unknown.error?.code === 'unknown' && /tf\.app\.designs\(\) lists them/.test(unknown.error.message), JSON.stringify(unknown.error));
}

// ── 3. Deny, and the app gone ──────────────────────────────────────────────
{
    letIn = false;
    bridge.drop();
    const denied = await server.call('app.designs');
    ok('a call the app\'s user denied is refused as denied, pointing to Interactive', denied.error?.code === 'denied'
        && /^app\.designs: Deny was clicked in TFStudio when this program asked to work on the open design\. Click Interactive on TFStudio's Optimization tab/.test(denied.error.message),
    JSON.stringify(denied.error));
    letIn = true;
    bridge.close();
    const off = await server.call('app.designs');
    ok('once the link closes a call is refused as off, saying to click Interactive', off.error?.code === 'off'
        && off.error.message === "app.designs: TFStudio is not running, or it is not listening for this program. Click Interactive on TFStudio's Optimization tab, then call this again.",
    JSON.stringify(off.error));
    ok('the API\'s calls answer on', !!(await server.call('newDesign')).result);
    ok('the server names its program to the app as --program gives it', programs.length === 2 && programs.every(program => program === 'python.exe'), programs.join());
}

ok('every line on stdout is a message', onlyMessages(server.lines));
server.child.stdin.end();
ok('closing stdin ends the server', await ended(server) === 0);

// ── 4. Without --live ──────────────────────────────────────────────────────
{
    const plain = startApiClient(process.execPath, ['--no-warnings', SERVER]);
    ok('without --live the hello says the server is not live', (await plain.hello).live === false);
    const refused = [];
    for (const call of ['app.designs', 'app.read', 'app.apply']) refused.push(await plain.call(call, [{}]));
    ok('and every app.* call is refused', refused.every(answer => /started without --live/.test(answer.error?.message ?? '') && !answer.error.code),
        JSON.stringify(refused.map(answer => answer.error)));
    plain.child.stdin.end();
    await ended(plain);
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
