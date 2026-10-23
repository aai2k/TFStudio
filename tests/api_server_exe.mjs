/**
 * TFStudio.exe --api: the API server as the app starts it (src/main/serverEntry.js).
 *
 *   0. What a launch asks for (src/main/serverLaunch.js): --api the API
 *      server, --data a folder made absolute, --program the name of the
 *      program served; --api with --mcp, and --data with no folder after it,
 *      are refused, and --program with no name after it gives none.
 *   1. The bundle an installed app runs (tools/apiServerBundle.mjs, built here
 *      to a folder of its own), loaded by the child entry the app starts
 *      (src/main/serverChild.js) as the installed app starts it: with the WASM
 *      kernel's file and a data folder named, and without the globals Node 16
 *      lacks (the Windows 7 build's Electron 22). Its hello reports the version
 *      it is given, the kernel loaded from that file and the folder; it reads
 *      the folder's user catalog, computes the spectrum the API computes in
 *      this process and streams a refinement's progress. Given a live link
 *      file, as --api --live gives it one, it reads a design from the app's
 *      pipe, which this process opens, naming its program as --program gave
 *      it.
 *   2. On Windows, the app itself started with --api from this checkout: its
 *      hello comes after the line break Electron writes to stdout as it starts,
 *      and nothing else on stdout is not a message; it answers and ends when
 *      stdin closes. --data runs it on the folder named; --api --live says it
 *      is live, and no app.* call is made, since a developer's own app may be
 *      open. --api with --mcp is refused.
 *
 * Run: node tests/api_server_exe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildApiServer } from '../tools/apiServerBundle.mjs';
import { startApiClient, onlyMessages } from './_apiClient.mjs';
import { makeFakeApp } from './_fakeLiveApp.mjs';
import { encode } from '../src/apiServer/wire.js';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHILD = path.join(ROOT, 'src', 'main', 'serverChild.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ended = client => Promise.race([client.exited, sleep(15000).then(() => 'still running')]);

// A data folder holding a user catalog without a stamp, which its load gives
// one from crypto, a global Node 16 lacks.
function dataFolder(dir) {
    fs.mkdirSync(path.join(dir, 'Materials', 'user'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'designs', 'user-catalog-no-copy', 'catalogs', 'catalog-present', 'user', 'user_lab.catalog.json'),
        path.join(dir, 'Materials', 'user', 'user_lab.catalog.json'));
    return dir;
}
const hasUserCatalog = async client => (await client.call('findMaterials', ['user_lab'])).result?.some(m => m.id === 'user_lab:Ta2O5');

const api = await import('../src/api/index.js');
await api.init();
const AR_ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }];
const stack = api.stackFromFormula(api.newDesign(), { formula: '(HL)^4 H', symbols: { H: 'TiO2', L: 'SiO2' } });
const ar = api.setMerit(api.insertLayer(api.insertLayer(api.newDesign(), { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 }), AR_ROWS);

// ── What a launch asks for ─────────────────────────────────────────────────
{
    const { serverLaunch, launchProgram } = require('../src/main/serverLaunch.js');
    ok('--program names the program the server serves', launchProgram(['TFStudio.exe', '--api', '--live', '--program', 'python.exe']) === 'python.exe');
    ok('and gives none without a name after it, or without it', [['TFStudio.exe', '--api', '--program'], ['TFStudio.exe', '--api', '--program', '--live'], ['TFStudio.exe', '--api']]
        .every(argv => launchProgram(argv) === null));
    ok('--api asks for the API server, --data for a folder made absolute', JSON.stringify(serverLaunch(['TFStudio.exe', '--api', '--data', 'here']))
        === JSON.stringify({ kind: 'api', dataDir: path.resolve('here') }));
    ok('the app itself is no server, and --data alone runs nothing', JSON.stringify(serverLaunch(['TFStudio.exe', '--data', 'here'])) === JSON.stringify({ kind: null, dataDir: null }));
    ok('--api with --mcp is refused', /--mcp and --api each start a server/.test(serverLaunch(['TFStudio.exe', '--mcp', '--api']).refusal));
    ok('so is --data with no folder', /--data names a data folder/.test(serverLaunch(['TFStudio.exe', '--api', '--data', '--live']).refusal ?? '')
        && /--data names a data folder/.test(serverLaunch(['TFStudio.exe', '--api', '--data']).refusal ?? ''));
}

// ── 1. The bundle ──────────────────────────────────────────────────────────
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-bundle-'));
await buildApiServer(out);
{
    const dataDir = dataFolder(path.join(out, 'data'));
    // What Node 16 does not have, gone from the server.
    const node16 = path.join(out, 'node16.cjs');
    fs.writeFileSync(node16, 'delete globalThis.CustomEvent; delete globalThis.crypto; delete globalThis.structuredClone;\n');
    const wasmPath = require.resolve('tmmcore/tmm_kernel.wasm');
    // The app's end of the live link, open in this process.
    const { createLiveBridge } = require('../src/main/liveBridge.js');
    const appDesign = {
        id: 'app-1', name: 'Open in the app', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 30 }], backLayers: [],
    };
    const openApp = makeFakeApp({ 'app-1': appDesign }, 'app-1');
    const liveFile = path.join(out, 'live-bridge.json');
    const programs = [];
    const bridge = createLiveBridge({ file: liveFile, log: () => {}, version: '9.9.9-test', forward: openApp.forward, admit: program => { programs.push(program); return true; } });
    await bridge.open();
    const options = { server: path.join(out, 'server.js'), bundled: true, version: '9.9.9-test', dataDir, wasmPath, live: { file: liveFile, program: 'python.exe' } };
    const bundle = startApiClient(process.execPath, ['--require', node16, CHILD, JSON.stringify(options)]);
    const hello = await bundle.hello;
    ok('the bundle\'s hello reports the version it is given, the kernel loaded from its file and the data folder, without Node 19\'s globals',
        hello.version === '9.9.9-test' && hello.wasm === true && hello.dataDir === dataDir && hello.live === true, JSON.stringify(hello).slice(0, 300) + bundle.stderr.slice(-300));
    ok('it reads the data folder\'s user catalog', await hasUserCatalog(bundle));
    const there = await bundle.call('spectrum', [stack, { from: 450, to: 650, step: 10 }]);
    ok('it computes the API\'s spectrum', encode(there.result?.angles) === encode(api.spectrum(stack, { from: 450, to: 650, step: 10 }).angles));
    const refined = await bundle.call('refine', [ar, { method: 'dls', maxIter: 20 }], { hooks: ['onProgress'] });
    ok('a refinement runs and streams its progress', refined.result?.result?.completed === true && refined.progress.length > 0
        && refined.progress.every(p => p.hook === 'onProgress'), JSON.stringify(refined.error));
    const fromApp = await bundle.call('app.read');
    ok('it reads a design from the app over the live link', fromApp.result?.appDesignId === 'app-1' && fromApp.result.design?.name === 'Open in the app', JSON.stringify(fromApp.error));
    ok('naming its program as it was given', programs.join() === 'python.exe', programs.join());
    ok('the bundle writes only messages to stdout', onlyMessages(bundle.lines));
    bundle.child.stdin.end();
    ok('the bundle ends when stdin closes', await ended(bundle) === 0);
    bridge.close();
}

// ── 2. The app started with --api ──────────────────────────────────────────
if (process.platform === 'win32') {
    const electron = require('electron');
    const app = startApiClient(electron, ['.', '--api'], { cwd: ROOT });
    const hello = await app.hello;
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    ok('the app with --api says hello with its version', hello.hello === 'tfstudio-api' && hello.version === version && hello.wasm === true && hello.live === false, JSON.stringify(hello).slice(0, 300));
    ok('and answers', (await app.call('findMaterials', ['SiO2'])).result?.some(m => m.id === 'SiO2'));
    const [first, ...rest] = app.lines;
    ok('the app writes only messages to stdout after Electron\'s line break', (first.trim() === '' || first.startsWith('{')) && onlyMessages(rest),
        JSON.stringify(app.lines.filter(line => !line.startsWith('{'))));
    app.child.stdin.end();
    ok('the app ends when stdin closes', await ended(app) === 0);

    const dataDir = dataFolder(path.join(out, 'data-for-the-app'));
    const onData = startApiClient(electron, ['.', '--api', '--data', dataDir], { cwd: ROOT });
    ok('--data runs it on the folder named', (await onData.hello).dataDir === dataDir && await hasUserCatalog(onData));
    onData.child.stdin.end();
    await ended(onData);

    const live = startApiClient(electron, ['.', '--api', '--live'], { cwd: ROOT });
    ok('the app with --api --live says it is live', (await live.hello).live === true);
    live.child.stdin.end();
    ok('and ends when stdin closes', await ended(live) === 0);

    const both = spawnSync(electron, ['.', '--api', '--mcp'], { cwd: ROOT, encoding: 'utf8', input: '', timeout: 30000 });
    ok('--api with --mcp is refused', both.status === 1 && /--mcp and --api each start a server/.test(both.stderr) && !both.stdout.trim(), JSON.stringify([both.status, both.stderr.slice(-200)]));
} else {
    console.log('The app is started with --api on Windows only; the bundle was checked.');
}
fs.rmSync(out, { recursive: true, force: true });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
