/**
 * TFStudio.exe --mcp: the MCP server as the app starts it (src/main/serverEntry.js).
 *
 *   1. The bundle an installed app runs (tools/mcpBundle.mjs, built here to a
 *      folder of its own), loaded by the child entry the app starts
 *      (src/main/serverChild.js) as the installed app starts it: with the WASM
 *      kernel's file, the skill file and a data folder named, and without the
 *      globals Node 16 lacks (the Windows 7 build's Electron 22). It reports
 *      the version it is given, loads the kernel from that file and the
 *      folder's catalogs, gives the design method from the skill file,
 *      computes the spectrum the API computes in this process, copies a
 *      design, and runs a refinement on the bundled job thread. Given a live
 *      link file, as --mcp --live gives it one, it reads a design from the
 *      app's pipe, which this process opens. Where Electron is installed, the
 *      same bundle on Electron's Node, as the installed app runs it, takes a
 *      synthesis job to an answer on worker threads started from the job's
 *      own thread, and a job stopped part-way ends stopped.
 *   2. On Windows, the app itself started with --mcp from this checkout: it
 *      answers over stdin and stdout, gives the design method from the
 *      checkout's skills folder, and ends when stdin closes. Electron's
 *      own main process gets no piped stdin on Windows, which is why the server
 *      runs in a child of it, and it writes one line break to stdout as it
 *      starts, before any of the app's code runs; MCP clients pass over a line
 *      that holds no message. Nothing else on stdout is not a message. Started
 *      with --mcp --live it lists the tools that reach the open app; none is
 *      called, since a developer's own app may be open.
 *
 * Run: node tests/mcp_exe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildMcpServer } from '../tools/mcpBundle.mjs';
import { startClient, onlyMessages, INIT } from './_mcpClient.mjs';
import { makeFakeApp } from './_fakeLiveApp.mjs';
import { electronBinary } from './_electron.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CHILD = path.join(ROOT, 'src', 'main', 'serverChild.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ended = client => Promise.race([client.exited, sleep(15000).then(() => 'still running')]);

const AR_ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }];

// ── 1. The bundle ──────────────────────────────────────────────────────────
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-mcp-bundle-'));
await buildMcpServer(out);
{
    // A data folder holding a user catalog without a stamp, which its load gives
    // one from crypto, a global Node 16 lacks.
    const dataDir = path.join(out, 'data');
    fs.mkdirSync(path.join(dataDir, 'Materials', 'user'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'designs', 'user-catalog-no-copy', 'catalogs', 'catalog-present', 'user', 'user_lab.catalog.json'),
        path.join(dataDir, 'Materials', 'user', 'user_lab.catalog.json'));
    // What Node 16 does not have, gone from the server and its job threads.
    const node16 = path.join(out, 'node16.cjs');
    fs.writeFileSync(node16, 'delete globalThis.CustomEvent; delete globalThis.crypto; delete globalThis.structuredClone;\n');
    const wasmPath = createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm');
    // The app's end of the live link, open in this process.
    const { createLiveBridge } = createRequire(import.meta.url)('../src/main/liveBridge.js');
    const appDesign = {
        id: 'app-1', name: 'Open in the app', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 30 }], backLayers: [],
    };
    const openApp = makeFakeApp({ 'app-1': appDesign }, 'app-1');
    const liveFile = path.join(out, 'live-bridge.json');
    const bridge = createLiveBridge({ file: liveFile, log: () => {}, version: '9.9.9-test', forward: openApp.forward });
    await bridge.open();
    // The skill file as the installer ships it, in a folder of the resources.
    const skillPath = path.join(out, 'resources', 'skills', 'coating-design', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'skills', 'coating-design', 'SKILL.md'), skillPath);
    const options = { server: path.join(out, 'server.js'), bundled: true, version: '9.9.9-test', dataDir, wasmPath, skillPath, live: { file: liveFile } };
    const bundle = startClient(process.execPath, ['--require', node16, CHILD, JSON.stringify(options)]);
    const init = await bundle.request('initialize', INIT);
    ok('the bundle reports the version it is given', init.result?.serverInfo?.version === '9.9.9-test', JSON.stringify(init.error || init.result?.serverInfo));
    ok('it loads the kernel from the file it is given and the data folder\'s catalogs, without Node 19\'s globals',
        bundle.stderr.includes(`WASM true, data folder ${dataDir}`), bundle.stderr.slice(-300));
    const id = (await bundle.call('newDesign', {})).designId;
    await bundle.call('stackFromFormula', { designId: id, formula: '(HL)^4 H', symbols: { H: 'TiO2', L: 'SiO2' } });
    const there = await bundle.call('spectrum', { designId: id, from: 450, to: 650, step: 10, values: true });
    const api = await import('../src/api/index.js');
    await api.init();
    const local = api.stackFromFormula(api.newDesign(), { formula: '(HL)^4 H', symbols: { H: 'TiO2', L: 'SiO2' } });
    ok('the bundle computes the API\'s spectrum', JSON.stringify(there.angles) === JSON.stringify(api.spectrum(local, { from: 450, to: 650, step: 10 }).angles));
    ok('it copies a design', /^d\d+$/.test((await bundle.call('copyDesign', { designId: id })).designId ?? ''));
    ok('it reads the data folder\'s user catalog', (await bundle.call('findMaterials', { query: 'user_lab' })).materials?.some(m => m.id === 'user_lab:Ta2O5'));
    const method = await bundle.call('designMethod', {});
    ok('it gives the design method from the skill file it is given', method.method?.startsWith('# Designing a coating'), JSON.stringify(method).slice(0, 200));
    const ar = (await bundle.call('newDesign', {})).designId;
    await bundle.call('insertLayer', { designId: ar, material: 'TiO2', thickness: 30 });
    await bundle.call('insertLayer', { designId: ar, material: 'SiO2', thickness: 50 });
    await bundle.call('setMerit', { designId: ar, rows: AR_ROWS });
    const refined = await bundle.call('refine', { designId: ar, method: 'dls', maxIter: 20, waitSeconds: 50 });
    ok('a refinement runs on the bundled job thread', refined.state === 'done' && refined.designId && refined.designId !== ar, JSON.stringify(refined));
    const fromApp = await bundle.call('readAppDesign', {});
    ok('it reads a design from the app over the live link', fromApp.appDesignId === 'app-1' && fromApp.name === 'Open in the app' && fromApp.front?.length === 1, JSON.stringify(fromApp));
    ok('the bundle writes only messages to stdout', onlyMessages(bundle));
    bundle.child.stdin.end();
    ok('the bundle ends when stdin closes', await ended(bundle) === 0);
    bridge.close();
}
if (electronBinary()) {
    // The bundle on the app's own runtime, Electron's Node, as TFStudio.exe
    // --mcp starts it: a synthesis job's run spreads over worker threads
    // started from the job's own thread, which a bundle without them cannot
    // start, and a job stopped once its run reports ends stopped. That the
    // answer is the one the calling thread gives, tests/api_run_threads.mjs
    // checks on that runtime.
    const require = createRequire(import.meta.url);
    const options = { server: path.join(out, 'server.js'), bundled: true, version: '9.9.9-test', dataDir: null, wasmPath: require.resolve('tmmcore/tmm_kernel.wasm') };
    const onElectron = startClient(electronBinary(), [CHILD, JSON.stringify(options)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    await onElectron.request('initialize', INIT);
    const id = (await onElectron.call('newDesign', {})).designId;
    await onElectron.call('stackFromFormula', { designId: id, formula: '(HL)^2', symbols: { H: 'TiO2', L: 'SiO2' } });
    const startMerit = (await onElectron.call('setMerit', { designId: id, rows: AR_ROWS })).total;
    const job = await onElectron.call('synthesize', { designId: id, method: 'needle', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 8, threads: 3 }, waitSeconds: 50 });
    ok('on Electron\'s Node a synthesis job runs on its threads to an answer better than its start',
        job.state === 'done' && job.result?.completed === true && job.result.mf < startMerit, JSON.stringify(job).slice(0, 300));
    const long = await onElectron.call('synthesize', { designId: id, method: 'needle', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 40, targetMF: 0, threads: 3 }, waitSeconds: 0 });
    let view = long;
    for (let i = 0; i < 200 && view.state === 'running' && Object.keys(view.progress ?? {}).length === 0; i++) {
        await sleep(25);
        view = await onElectron.call('jobStatus', { jobId: long.jobId, waitSeconds: 0 });
    }
    await onElectron.call('stopJob', { jobId: long.jobId });
    const stopped = await onElectron.call('jobStatus', { jobId: long.jobId, waitSeconds: 20 });
    ok('and a job stopped once its run reports ends stopped, with its design', view.state === 'running' && stopped.state === 'stopped'
        && stopped.designId === id && !stopped.error, JSON.stringify([view.state, stopped]).slice(0, 300));
    ok('it writes only messages to stdout', onlyMessages(onElectron));
    onElectron.child.stdin.end();
    ok('and ends when stdin closes', await ended(onElectron) === 0);
}
fs.rmSync(out, { recursive: true, force: true });

// ── 2. The app started with --mcp ──────────────────────────────────────────
if (process.platform === 'win32') {
    const electron = createRequire(import.meta.url)('electron');
    const app = startClient(electron, ['.', '--mcp'], { cwd: ROOT });
    const init = await app.request('initialize', INIT);
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    ok('the app with --mcp answers initialize with its version', init.result?.serverInfo?.version === version, JSON.stringify(init.result?.serverInfo));
    const found = await app.call('findMaterials', { query: 'SiO2' });
    ok('its tools answer', found.materials?.some(m => m.id === 'SiO2'), JSON.stringify(found).slice(0, 200));
    const method = await app.call('designMethod', {});
    ok('it gives the design method from the checkout\'s skill file', method.method?.startsWith('# Designing a coating'), JSON.stringify(method).slice(0, 200));
    const [first, ...rest] = app.lines;
    ok('the app writes only messages to stdout after Electron\'s line break', (first.trim() === '' || first.startsWith('{'))
        && onlyMessages({ lines: rest }), JSON.stringify(app.lines.filter(line => !line.startsWith('{'))));
    app.child.stdin.end();
    ok('the app ends when stdin closes', await ended(app) === 0);

    const live = startClient(electron, ['.', '--mcp', '--live'], { cwd: ROOT });
    await live.request('initialize', INIT);
    const names = ((await live.request('tools/list')).result?.tools || []).map(tool => tool.name);
    ok('the app with --mcp --live lists the tools that reach the open app', ['listAppDesigns', 'readAppDesign', 'applyToApp'].every(name => names.includes(name)), names.join(','));
    live.child.stdin.end();
    ok('and ends when stdin closes', await ended(live) === 0);
} else {
    console.log('SKIP: the app is started with --mcp on Windows only');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
