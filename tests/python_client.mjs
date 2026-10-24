/**
 * The tfstudio Python package (python/) driving this checkout's API server
 * as a Python program drives it: tests/_pythonDriver.py runs each scenario
 * in the Python on PATH, and what it got is checked against the API in this
 * process. The package, used from python/, starts the server of the checkout
 * around it.
 *
 *   1. The calls the objects are made on: their names are the hello's, which
 *      are the API's exports but init, and every call answers what the API
 *      answers here, the ids a design draws and the time a synthesis step
 *      took aside: designs built, edited, cleaned, saved (to the bytes the API
 *      writes) and opened again, a layer set by its QWOT, sides scaled,
 *      rounded, perturbed, flipped and copied, one rounding and one flip
 *      refused, two designs compared, an edge filter searched, one refused
 *      and one put in, a deposition run on the part, one on chips with a
 *      plan of the wrong length refused, its files written, spectra, a band's
 *      width and an edge against angle, a spectrum file read and a design
 *      compared with a curve of it or one given, and a file of several curves
 *      compared without naming one refused, index
 *      profiles, one of a side with no layers refused, layer thicknesses,
 *      the design's facts, admittance loci and electric fields, one of a
 *      side with no layers refused, colours, one with an observer refused,
 *      integral values with rows of no value, Psi and Delta against
 *      wavelength and against angle, a sweep of start above end refused,
 *      phase and group delay on a uniform grid and on the window's, the whole
 *      part in reflection refused, materials, a material's dispersion with
 *      masked wavelengths, a slab of 0 mm refused, merit, a specification
 *      set and checked, layer sensitivity, the runs, a seeded Monte Carlo and
 *      a seeded yield.
 *   2. Values: a spectrum's angles are keyed by text, and the spectrum as
 *      Python holds it summarizes as here; NaN, Infinity and -Infinity come
 *      back as floats; a NaN sent in gets the API's refusal; an object with
 *      tolist() is taken as a list; a trailing None takes the default; a
 *      value JSON cannot carry raises TypeError; a relative path is taken
 *      from the program's working folder as it is at the call; a call the
 *      server lacks names the TFStudio version.
 *   3. Runs: each hook reaches its Python function as many times as the run
 *      calls it here, with the same arguments. A Stop stopped in a hook
 *      stops a run 'stopped' with the design as given, and a stopped one
 *      stops the next run at once, whose request asks for it stopped; a
 *      hook that raises, or raises
 *      KeyboardInterrupt, stops the run and the exception goes on, and the
 *      server takes a run after it; a run in another thread lets a spectrum
 *      through, refuses a second run, and stops on a Stop stopped outside it.
 *      One Stop stops a run on each of two servers, and a second run it is
 *      given, which the server refuses, does not keep it from stopping the
 *      first. A server that does not answer the stop is ended at once by a
 *      second Ctrl+C. On POSIX, SIGINT to the program's process group
 *      mid-run, as a terminal's Ctrl+C sends it, stops the run as
 *      KeyboardInterrupt in a hook does, and the server is gone after the
 *      with block.
 *   4. The server's life: the end of the with block ends it with 0, and a
 *      call after it is refused; a program that ends without closing it
 *      leaves no server after 10 s, and a TFStudio() the program drops, by
 *      giving its name to another or deleting it, ends its server with the
 *      garbage collector off, while a design, a material, tf.materials or
 *      tf.app it gave keeps it computing until that is dropped too; a server
 *      that writes more to its log than a
 *      pipe holds still answers; two servers answer at once, and closing one
 *      leaves the other; a path that is not there, as the argument or in
 *      TFSTUDIO_EXE, a folder that is no source checkout, and nothing found
 *      are each refused, the last with where it looked; so are a server of
 *      another protocol and one whose API could not start; the commands that
 *      start an executable's server and a checkout's, a linked one naming the
 *      program as the Python's executable; the argument comes
 *      before TFSTUDIO_EXE, and the checkout the package is in before an
 *      install the registry records.
 *   5. The open app, through the app's pipe in this process with the
 *      window's answers standing in for the window (_fakeLiveApp.mjs):
 *      tf.app.designs(); tf.app.open_design() changed and pushed back as one
 *      write with a notice, and a renamed copy of it pushed again, which then
 *      holds the design the app stored, the app's name included; 'edited'
 *      after an edit in the app, by push, and 'switched' for a design that is
 *      not the open one, and a design holding NaN refused by push before it
 *      is sent, none writing;
 *      open_design by name, by id and by a listed design, and an unknown one
 *      refused; push of a design not read from the app refused; 'off' once
 *      the app's link closes, in words that say to click Interactive on the
 *      Optimization tab, by the method called; and tf.app without live
 *      refused. The app is asked to let the program in under the name of the
 *      Python's executable.
 *   6. The objects, each computed again here with the API's calls on the
 *      design the object computed on, as tests/_pythonObjects.mjs lists.
 *   7. Installing, from a stand-in install folder whose resources folder
 *      also looks like a source checkout: install.py, run in a virtual
 *      environment, writes tfstudio.pth there and says so, writes the same
 *      file run again, and the environment then imports the package from
 *      that folder, which starts the TFStudio it came with unless
 *      TFSTUDIO_EXE names another; deleting the file uninstalls it. A
 *      site-packages that cannot be written sends the file to the user's,
 *      and when this Python reads no user site-packages install.py says so
 *      and writes nothing. The file is written in the encoding each Python
 *      reads it with, and a folder that encoding cannot write is refused.
 *      Without the venv module the venv part says so and goes on.
 *   8. Python 3.8: the package's files and the manual's examples use no
 *      grammar newer than 3.8 and none of the newer names _python38Check.py
 *      lists, and the check finds each kind it looks for; the manual's zh
 *      pages show the same examples.
 *   9. The installer ships python/ as resources/python without __pycache__,
 *      the Windows 7 build too.
 *  10. The manual's examples, on the API Reference, the Script Console and
 *      the Python page, each run as a reader runs it (tests/_pythonExamples.py
 *      says how), the live ones against the stand-in app of section 5: each
 *      runs without an error and prints what it found, and one that writes a
 *      file, run again, writes over nothing of its first run. The Python
 *      page's table of AppError codes lists the codes AppError's docstring
 *      names.
 *
 * Without Python 3.8 or newer on PATH the test is skipped.
 *
 * Run: node tests/python_client.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encode, parse } from '../src/apiServer/wire.js';
import { makeFakeApp } from './_fakeLiveApp.mjs';
import { checkObjects } from './_pythonObjects.mjs';
import { checkExamples } from './_pythonExamples.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'tests', '_pythonDriver.py');
const PACKAGE = path.join(ROOT, 'python');
const DOCS = path.join(ROOT, 'docs-site', 'src', 'content', 'docs');
// The manual's pages that hold Python examples, each in English and zh.
const PAGES = ['python', 'script-console', 'api-reference'].map(slug => ({
    slug, en: path.join(DOCS, 'automation', `${slug}.md`), zh: path.join(DOCS, 'zh', 'automation', `${slug}.md`),
}));
// TFStudio's executable in its install folder.
const EXE_NAME = process.platform === 'win32' ? 'TFStudio.exe' : 'tfstudio';
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];

// A version check takes well under a second; this leaves room for a cold start.
const VERSION_CHECK_MS = 30000;
// The longest scenario takes seconds; one still going after this is stuck.
const SCENARIO_LIMIT_MS = 120000;
// The API Reference's examples take about a minute here, most of it in its
// four Needle runs; a page's examples still going after this are stuck.
const EXAMPLES_LIMIT_MS = 300000;
// Making a virtual environment, or running install.py, takes a few seconds.
const PYTHON_STEP_MS = 60000;

// Python 3.8 or newer, by the names it goes by: each is asked its version,
// since a name on PATH can be an older Python or a stand-in that installs one.
function findPython() {
    for (const [command, ...prefix] of [['python3'], ['python'], ['py', '-3']]) {
        const asked = spawnSync(command, [...prefix, '-c', 'import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])'],
            { encoding: 'utf8', timeout: VERSION_CHECK_MS });
        const [newEnough, version] = (asked.stdout ?? '').trim().split(' ');
        if (asked.status === 0 && newEnough === 'True') return { command, prefix, version };
    }
    return null;
}
const python = findPython();
if (!python) {
    console.log('SKIP: no Python 3.8 or newer on PATH');
    process.exit(0);
}
console.log(`Python ${python.version} (${[python.command, ...python.prefix].join(' ')})`);
// The name the package gives TFStudio for the program: the Python's executable.
const PROGRAM = spawnSync(python.command, [...python.prefix, '-c', 'import os, sys; print(os.path.basename(sys.executable))'],
    { encoding: 'utf8', timeout: VERSION_CHECK_MS }).stdout.trim();

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
    try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};
async function goneWithin(pid, ms) {
    for (const until = Date.now() + ms; Date.now() < until; await sleep(100)) if (!alive(pid)) return true;
    return !alive(pid);
}
// A value as the wire writes it, without what differs from one computation
// of it to the next: the ids a design draws at random, the time a synthesis
// step took (tMs), and a refine record's merit trend (mfHistory), whose points
// are the progress the optimizer posts at most every 80 ms of wall clock, so a
// slower machine records more of them.
const DRAWN = new Set(['id', 'tMs', 'mfHistory']);
const undrawn = v => {
    if (Array.isArray(v)) return v.map(undrawn);
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
    return Object.fromEntries(Object.entries(v).filter(([key]) => !DRAWN.has(key)).map(([key, x]) => [key, undrawn(x)]));
};
const canon = v => encode(undrawn(v));
// The engine prints as it runs; the runs made here keep it off the test's output.
// Each keeps the console it found, so two may not overlap, as two in one
// Promise.all would: the second would keep the first's silent console.
const quietly = async run => {
    const { log, warn, info } = console;
    console.log = console.warn = console.info = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, info }); }
};
// What `make` gives, or what it threw, so that a scenario that went wrong
// fails its checks rather than the test.
const attempt = async make => {
    try { return await quietly(make); } catch (err) { return { threw: err.message }; }
};

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-python-'));

// The environment the programs here run in: without TFSTUDIO_EXE, the package
// in python/ starts this checkout's server.
const ENV = { ...process.env };
delete ENV.TFSTUDIO_EXE;

/**
 * Runs the scenario `name` of `driver` in WORK, with `input` as its first
 * line of stdin. Resolves to { code, pid, messages, said, stdout, stderr }:
 * the JSON lines it printed in order, and merged into one object.
 * onMessage(message, child) sees each as it comes. `detached` starts the
 * driver in a process group of its own, as a terminal starts a program; `env`
 * is the environment it runs in, and `limit` how long it may take.
 */
function scenario(name, { input = null, packageDir = PACKAGE, onMessage, detached = false, driver = DRIVER, env = ENV, limit = SCENARIO_LIMIT_MS } = {}) {
    const child = spawn(python.command, [...python.prefix, '-B', '-I', driver, name, packageDir], { cwd: WORK, env, detached });
    const ran = { messages: [], said: {}, stdout: '', stderr: '' };
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        ran.stdout += chunk;
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            let message = null;
            try { message = parse(line); } catch (_) { continue; }
            if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
            ran.messages.push(message);
            Object.assign(ran.said, message);
            onMessage?.(message, child);
        }
    });
    child.stderr.on('data', chunk => { ran.stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.write(`${encode(input)}\n`);
    return new Promise(resolve => {
        const timer = setTimeout(() => child.kill(), limit);
        child.on('close', code => { clearTimeout(timer); resolve({ ...ran, code, pid: child.pid }); });
    });
}
const failure = ran => `exit ${ran.code}: ${ran.stderr.slice(-600)}`;

const api = await import('../src/api/index.js');
await api.init();
// What the API answers in this process, as the server answers: { result } or { error }.
async function local(call, args) {
    try { return { result: (await quietly(() => api[call](...args))) ?? null }; } catch (err) { return { error: err.message }; }
}

const AR_ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }];
const POOL = ['TiO2', 'SiO2'];
const twoLayers = api.insertLayer(api.insertLayer(api.newDesign({ name: 'AR' }), { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 });
const start = api.setMerit(twoLayers, AR_ROWS);
const stack = api.stackFromFormula(api.newDesign({ name: 'Stack' }), { formula: '(HL)^3 H' });
const NEEDLE = { method: 'needle', pool: POOL, settings: { maxLayers: 6, refineIter: 10, threads: 1 } };
const STRUCTURAL = { method: 'structural', pool: POOL, settings: { maxIter: 3, refineIter: 5, threads: 1, seed: 7 } };
const CHECKS = [{ kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'le', target: 0.02 }, { kind: 'LAYER_COUNT', cmp: 'le', target: 2 }];
const specified = api.setSpecification(start, CHECKS);
// A Needle run that stops on its own at 'maxLayers', and a Monte Carlo run
// that takes about ten seconds unless it is stopped.
const LONG_NEEDLE = { method: 'needle', pool: POOL, settings: { maxLayers: 20, refineIter: 10, threads: 1, targetMF: 0 } };
const LONG_MONTE_CARLO = { from: 450, to: 650, step: 1, runs: 100000, seed: 5 };
// A stopped run answers at its next trial, in milliseconds; one not stopped
// would take the Monte Carlo run's ten seconds.
const STOPPED_WITHIN_S = 5;

// ── 1. The calls ───────────────────────────────────────────────────────────
{
    const taken = path.join(WORK, 'taken.tfs');
    fs.writeFileSync(taken, '');
    const there = path.join(WORK, 'there.tfs');
    const here = path.join(WORK, 'here.tfs');
    const processFolder = path.join(WORK, 'process');
    fs.mkdirSync(processFolder);
    const spectrum = api.spectrum(stack, { from: 400, to: 700, step: 10, angles: [0, 45] });
    const scan = path.join(WORK, 'scan.csv');
    fs.writeFileSync(scan, '# AOI 8 deg\nWavelength (nm),R,Ts\n450,0.1,0.85\n500,0.06,0.9\n550,0.04,0.93\n600,0.05,0.91\n650,0.08,0.88\n');
    const CALLS = [
        ['newDesign', [{ name: 'AR', substrate: 'SiO2', referenceWavelength: 600 }]],
        ['setDesignSetup', [stack, { referenceWavelength: 600, surfaceMode: 'symmetric' }]],
        ['insertLayer', [stack, { material: 'Ta2O5', thickness: 80, index: 2 }]],
        ['deleteLayer', [stack, { index: 0 }]],
        ['setLayer', [stack, { index: 1, thickness: 99, locked: true }]],
        ['stackFromFormula', [twoLayers, { formula: '(HL)^2', symbols: { H: 'Ta2O5' } }]],
        ['cleanDesign', [api.insertLayer(stack, { material: 'TiO2', thickness: 3, index: 2 }), { minThickness: 4 }]],
        ['cleanDesign', [api.newDesign()]],
        ['scaleThicknesses', [stack, { factor: 1.03 }]],
        ['quantize', [stack, { mode: 'qwot', value: 0.5 }]],
        ['quantize', [stack, { mode: 'decimals', value: 9 }]],
        ['perturb', [stack, { percent: 4, seed: 11 }]],
        ['flipLayers', [stack, { side: 'front' }]],
        ['flipLayers', [stack, { side: 'back' }]],
        ['copySide', [api.setDesignSetup(stack, { surfaceMode: 'both_independent' }), { from: 'front' }]],
        ['designDifferences', [stack, api.scaleThicknesses(stack, { factor: 1.1 })]],
        ['edgeFilter', [stack, { angle: 45, edge: 650 }]],
        ['edgeFilter', [stack, { pass: 'band' }]],
        ['applyEdgeFilter', [stack, { solution: 1, periods: 4 }]],
        ['processSteps', [stack, { otherSide: 'coated', step: 5 }]],
        ['processSteps', [stack, { chips: { plan: [1] } }]],
        ['exportProcess', [stack, processFolder, { step: 10 }]],
        ['findMaterials', ['SiO2']],
        ['findMaterials', []],
        ['materialNK', ['TiO2', [400, 550, 700]]],
        ['materialDispersion', ['Si', { from: 400, to: 1100, thickness: 2 }]],
        ['materialDispersion', ['BK7', { thickness: 0 }]],
        ['spectrum', [stack, { from: 400, to: 700, step: 10, angles: [0, 45] }]],
        ['summarize', [spectrum, { bands: [{ from: 450, to: 650 }] }]],
        ['bandFeature', [stack, { feature: 'fwhm', from: 400, to: 700, quantity: 'R', angle: 30, level: 0.3 }]],
        ['edgeShift', [stack, { from: 400, to: 700, angles: [0, 30], quantity: 'R' }]],
        ['readSpectrumFile', [scan, { pol: 'p' }]],
        ['measuredDifference', [stack, scan, { curve: 1, grid: 'uniform', step: 5, levelFree: true }]],
        ['measuredDifference', [stack, { quantity: 'R', wavelength: [450, 550, 650], values: [0.1, 0.05, 0.08] }]],
        ['measuredDifference', [stack, scan]],
        ['indexProfile', [stack, { wavelength: 633 }]],
        ['indexProfile', [stack, { side: 'back' }]],
        ['layerThicknesses', [stack, { side: 'total' }]],
        ['designFacts', [stack]],
        ['setLayer', [stack, { index: 1, qwot: 1.5 }]],
        ['admittance', [stack, { wavelength: 633, angle: 45, plane: 'reflection' }]],
        ['electricField', [stack, { wavelength: 1064, depthUnit: 'FWOT', pointsPerLayer: 12 }]],
        ['electricField', [stack, { side: 'back' }]],
        ['color', [stack, { quantity: 'T', observer: 10, illuminant: 'D50', step: 2 }]],
        ['color', [stack, { observer: 3 }]],
        ['integrals', [stack, { start: 350, end: 1000, step: 2, custom: [{ key: 'bb', source: { id: 'blackbody', T: 3000 } }] }]],
        ['ellipsometry', [stack, { step: 5, angles: [55, 70], deltaConvention: 'reversed' }]],
        ['ellipsometryVsAngle', [stack, { wavelength: 633, angleStep: 2.5 }]],
        ['ellipsometryVsAngle', [stack, { angleStart: 80, angleEnd: 45 }]],
        ['groupDelay', [stack, { from: 450, to: 650, step: 2, pol: 's', reference: 550 }]],
        ['groupDelay', [stack, { response: 'T', step: 'auto' }]],
        ['groupDelay', [stack, { side: 'total' }]],
        ['setMerit', [stack, AR_ROWS]],
        ['merit', [start]],
        ['setSpecification', [start, CHECKS]],
        ['checkSpecification', [specified]],
        ['layerSensitivity', [start, { deltaNm: 2 }]],
        ['runHooks', ['needle']],
        ['runHooks', ['nothing']],
        ['refine', [start, { method: 'dls', maxIter: 20 }]],
        ['synthesize', [start, NEEDLE]],
        ['synthesize', [start, STRUCTURAL]],
        ['monteCarlo', [start, { from: 450, to: 650, step: 10, runs: 5, seed: 3 }]],
        ['estimateYield', [specified, { runs: 5, thicknessRelPct: 3, seed: 3 }]],
        ['saveDesign', [start, taken]],
        ['saveDesign', [start, there]],
        ['openDesign', [there]],
    ];
    const ran = await scenario('calls', { input: CALLS });
    const [{ hello, methods } = {}, ...answers] = ran.messages;
    const exported = Object.keys(api).filter(name => name !== 'init').sort();
    ok('the calls the objects are made on are the hello\'s, the API\'s exports but init',
        JSON.stringify([...(methods ?? [])].sort()) === JSON.stringify(exported) && JSON.stringify([...(hello?.calls ?? [])].sort()) === JSON.stringify(exported),
        `${methods} / ${failure(ran)}`);
    // The file Python wrote is compared with one the API writes here, and read back here from that one.
    const differ = [];
    for (const [i, [call, args]] of CALLS.entries()) {
        const there_ = await local(call, args.map(arg => (arg === there ? here : arg)));
        if (canon(answers[i] ?? null) !== canon(there_)) differ.push(`${call}: ${canon(answers[i] ?? null).slice(0, 160)} / ${canon(there_).slice(0, 160)}`);
    }
    ok('each call answers what the API answers in this process', differ.length === 0 && answers.length === CALLS.length, differ.join('\n') || failure(ran));
    ok('saveDesign writes the file the API writes', fs.existsSync(there) && fs.readFileSync(there, 'utf8') === fs.readFileSync(here, 'utf8'));
}

// ── 2. Values ──────────────────────────────────────────────────────────────
{
    const ran = await scenario('values', { input: { stack, saved: 'saved.tfs', quantities: QUANTITIES } });
    const { said } = ran;
    const spectrum = api.spectrum(stack, { from: 400, to: 700, step: 10, angles: [0, 45] });
    ok('a spectrum\'s angles are keyed by text', JSON.stringify(said.keys) === '["0","45"]', failure(ran));
    ok('and the spectrum as Python holds it summarizes as here', canon(said.summary) === canon(api.summarize(spectrum, { bands: [{ from: 450, to: 650 }] })));
    ok('NaN, Infinity and -Infinity come back as floats', JSON.stringify(said.nan) === '[true,true,true]', JSON.stringify(said.nan));
    ok('a NaN sent in gets the API\'s refusal', said.nanRefused === (await local('insertLayer', [stack, { material: 'TiO2', thickness: NaN }])).error, said.nanRefused);
    ok('an object with tolist() is taken as a list', canon(said.tolist) === canon(api.materialNK('TiO2', [400, 550, 700])));
    ok('a trailing None takes the default', said.trailingNone === true);
    ok('a value JSON cannot carry raises TypeError', /not a set/.test(said.unsendable ?? ''), said.unsendable);
    ok('a relative path is taken from the program\'s working folder as it is at the call', said.relativePath === null && said.opened === 'Stack'
        && fs.existsSync(path.join(WORK, 'moved', 'saved.tfs')) && !fs.existsSync(path.join(WORK, 'saved.tfs')), JSON.stringify(said.opened));
    ok('a call the server lacks names the TFStudio version', /^merit: the TFStudio this program started, version \S+, does not have this call$/.test(said.missingCall ?? ''), said.missingCall);
}

// ── 3. Runs ────────────────────────────────────────────────────────────────
{
    const RUNS = [
        { name: 'needle', call: 'synthesize', args: [start, NEEDLE], hooks: ['onGeneration'] },
        { name: 'structural', call: 'synthesize', args: [start, STRUCTURAL], hooks: ['onRow'] },
        { name: 'refine', call: 'refine', args: [start, { method: ['dls', 'cg'] }], hooks: ['onStart', 'onMethodStart', 'onRecord'] },
    ];
    const ran = await scenario('hooks', { input: RUNS });
    for (const run of RUNS) {
        const called = Object.fromEntries(run.hooks.map(name => [name, []]));
        const hooks = Object.fromEntries(run.hooks.map(name => [name, (...args) => called[name].push(args)]));
        await quietly(() => api[run.call](...run.args, hooks));
        const counts = run.hooks.map(name => called[name].length);
        ok(`${run.name}: each hook reaches Python as often as the run calls it here, with the same arguments`,
            counts.every(n => n > 0) && canon(ran.said[run.name]) === canon(called),
            `${counts} here / ${run.hooks.map(name => ran.said[run.name]?.[name]?.length)} / ${failure(ran)}`);
    }

    const stopped = await scenario('stops', { input: { start, needle: LONG_NEEDLE, monteCarlo: LONG_MONTE_CARLO } });
    const { said } = stopped;
    ok('a Stop stopped in a hook stops the run, with the design as given', said.signalled?.result?.stopReason === 'stopped'
        && encode(said.signalled.design) === encode(start), failure(stopped));
    ok('a stopped Stop stops the next run at once', said.alreadyStopped === 'stopped', said.alreadyStopped);
    const asked = await scenario('asked');
    ok('since a run whose Stop was stopped before it is asked for stopped, and another is not', JSON.stringify(asked.said.asked) === '[true,null]',
        JSON.stringify(asked.said.asked) + failure(asked));
    const [message, raisedAfter, runAfterRaise] = said.raised ?? [];
    ok('a hook that raises stops the run and the error goes on', message === 'a hook failed' && raisedAfter < STOPPED_WITHIN_S && typeof runAfterRaise === 'string', JSON.stringify(said.raised));
    const [interruptedAfter, runAfterInterrupt] = said.interrupted ?? [];
    ok('so does KeyboardInterrupt in a hook', interruptedAfter < STOPPED_WITHIN_S && typeof runAfterInterrupt === 'string', JSON.stringify(said.interrupted));
    ok('a run in another thread lets a spectrum through', said.thread?.answeredWhileGoing === true, JSON.stringify(said.thread));
    ok('and refuses a second run, saying to start another TFStudio()', /monteCarlo is running on this server.*open another TFStudio\(\)/.test(said.thread?.second ?? ''), said.thread?.second);
    ok('and stops on a Stop stopped outside it', said.thread?.trials >= 1 && said.thread.trials < LONG_MONTE_CARLO.runs);

    const stoppedEarly = trials => trials >= 1 && trials < LONG_MONTE_CARLO.runs;
    const shared = await scenario('shared', { input: { start, monteCarlo: LONG_MONTE_CARLO } });
    const { twoServers, oneServer } = shared.said;
    ok('one Stop given to a run on each of two servers stops both', JSON.stringify(twoServers?.map(stoppedEarly)) === '[true,true]', JSON.stringify(twoServers) + failure(shared));
    ok('and a second run it was given, which the server refused, leaves it stopping the first',
        JSON.stringify([oneServer?.refused?.length, stoppedEarly(oneServer?.trials?.[0])]) === '[1,true]', JSON.stringify(oneServer));

    const unanswered = await scenario('unanswered');
    ok('a second Ctrl+C while a stop goes unanswered ends the server at once', unanswered.said.interrupted < STOPPED_WITHIN_S
        && unanswered.said.exitCode !== null && /ended while its run was being stopped/.test(unanswered.said.after ?? ''), JSON.stringify(unanswered.said) + failure(unanswered));

    if (process.platform !== 'win32') {
        // A terminal's Ctrl+C reaches every process in the program's group;
        // the server, in a session of its own, is not among them.
        const interrupted = await scenario('interrupt', {
            detached: true,
            input: { start, monteCarlo: LONG_MONTE_CARLO },
            onMessage: (message, child) => { if (message.going) process.kill(-child.pid, 'SIGINT'); },
        });
        const [after, runAfter] = interrupted.said.interrupted ?? [];
        ok('SIGINT to the program\'s group mid-run stops the run and raises KeyboardInterrupt, and the server takes a run after it',
            after < STOPPED_WITHIN_S && typeof runAfter === 'string', failure(interrupted));
        ok('and the server is gone after the with block', interrupted.said.closed === true && await goneWithin(interrupted.said.pid, 5000));
    } else {
        console.log('Ctrl+C from outside the program is sent on POSIX only; here it is raised in a hook.');
    }
}

// ── 4. The server's life ───────────────────────────────────────────────────
{
    const closes = await scenario('closes');
    ok('the server answers in the with block', closes.said.answers === 'New Design', failure(closes));
    ok('and the end of the block ends it with 0', closes.said.exitCode === 0 && await goneWithin(closes.said.pid, 2000), String(closes.said.exitCode));
    ok('a call after it is refused', /this TFStudio\(\) is closed/.test(closes.said.afterClose ?? ''), closes.said.afterClose);

    const forgotten = await scenario('forgotten');
    ok('a program that ends without closing its server leaves none after 10 s', !!forgotten.said.pid && await goneWithin(forgotten.said.pid, 10000), failure(forgotten));

    const dropped = await scenario('dropped');
    ok('a TFStudio() whose name is given to another ends its server, without the garbage collector, and the other answers',
        [dropped.said.rebound, dropped.said.otherAnswers].join() === 'true,true', JSON.stringify(dropped.said) + failure(dropped));
    ok('and so does one deleted', dropped.said.deleted === true);
    // What the program kept of a dropped TFStudio(), each with what the
    // scenario said of it under `name` + `suffix`.
    const KEPT = ['design', 'material', 'materials', 'app'];
    const keptSaid = suffix => KEPT.map(name => [name, dropped.said[name + suffix]]);
    const allTrue = KEPT.map(name => [name, true]);
    ok('a design, a material, tf.materials or tf.app whose TFStudio() was dropped still computes', canon(keptSaid('Kept')) === canon(allTrue), canon(keptSaid('Kept')));
    ok('and its server ends once that is deleted too', canon(keptSaid('Dropped')) === canon(allTrue), canon(keptSaid('Dropped')));

    const chatty = await scenario('chatty');
    ok('a server that writes more to its log than a pipe holds still answers', chatty.said.answered === true, failure(chatty));

    const two = await scenario('two');
    ok('two servers answer at once', two.said.pids?.[0] !== two.said.pids?.[1] && JSON.stringify(two.said.both) === '[true,true]', failure(two));
    ok('and closing one leaves the other', /is closed/.test(two.said.closed ?? '') && two.said.otherAnswers === true);

    // The package alone, with no checkout around it.
    const alone = path.join(WORK, 'alone');
    fs.cpSync(path.join(PACKAGE, 'tfstudio'), path.join(alone, 'tfstudio'), { recursive: true });
    const missing = await scenario('missing', { packageDir: alone });
    const nowhere = path.join(WORK, 'nowhere', 'TFStudio.exe');
    ok('a path that is not there is refused', missing.said.notThere === `TFStudio(exe) names ${nowhere}, which is not there`, missing.said.notThere ?? failure(missing));
    ok('so is a folder that is no source checkout', /names the folder .* which is not a TFStudio source checkout/.test(missing.said.notCheckout ?? ''), missing.said.notCheckout);
    ok('and a path in TFSTUDIO_EXE that is not there', missing.said.envNotThere === `TFSTUDIO_EXE names ${nowhere}, which is not there`, missing.said.envNotThere);
    const own = path.join(path.dirname(WORK), EXE_NAME);
    ok('and nothing found says where it looked and names TFSTUDIO_EXE', missing.said.notFound?.startsWith(`TFStudio was not found. Looked for: the TFStudio this package came with, ${own}; `
        + `a source checkout with its node_modules around this package, ${WORK}; installs, which this test leaves out.`)
        && /TFSTUDIO_EXE\.$/.test(missing.said.notFound), missing.said.notFound);

    const hellos = await scenario('hellos');
    ok('a server of another protocol is refused, naming both', hellos.said.otherProtocol
        === 'this tfstudio package speaks protocol 1 and TFStudio 9.9.9 speaks 2; use the package that TFStudio ships, by running install.py in its resources/python folder',
    hellos.said.otherProtocol ?? failure(hellos));
    ok('so is one whose API could not start, with its reason', hellos.said.initFailed === 'TFStudio could not start its API: no Materials', hellos.said.initFailed);

    const exe = path.join(WORK, 'TFStudio.exe');
    fs.writeFileSync(exe, '');
    const other = path.join(WORK, 'other', EXE_NAME);
    fs.mkdirSync(path.dirname(other));
    fs.writeFileSync(other, '');
    const commands = await scenario('commands', { input: { exe, checkout: ROOT, other } });
    ok('an executable\'s server starts with --api, --data made absolute, --live and the program\'s name',
        JSON.stringify(commands.said.exe) === JSON.stringify([exe, '--api', '--data', path.join(WORK, 'data'), '--live', '--program', PROGRAM]),
        JSON.stringify(commands.said.exe) + failure(commands));
    ok('a live link file is named only for a checkout', /only for a TFStudio source checkout/.test(commands.said.exeLinkFile ?? ''));
    const [node, ...rest] = commands.said.checkout ?? [];
    ok('a checkout\'s server is server.js on Node, with the live link file and the program\'s name',
        /node/i.test(path.basename(node ?? '')) && JSON.stringify(rest) === JSON.stringify([path.join(ROOT, 'src', 'apiServer', 'server.js'), '--live', path.join(WORK, 'link.json'), '--program', PROGRAM]),
        JSON.stringify(commands.said.checkout));
    ok('the argument comes before TFSTUDIO_EXE', JSON.stringify(commands.said.argumentFirst) === JSON.stringify([exe, '--api']), JSON.stringify(commands.said.argumentFirst));
    const [checkoutNode, ...checkoutRest] = commands.said.checkoutFirst ?? [];
    ok('and the source checkout the package is in before an install the registry records',
        /node/i.test(path.basename(checkoutNode ?? '')) && JSON.stringify(checkoutRest) === JSON.stringify([path.join(ROOT, 'src', 'apiServer', 'server.js')]),
        JSON.stringify(commands.said.checkoutFirst));
}

// ── 5. The open app ────────────────────────────────────────────────────────
// Two designs as the app holds them: a two-layer AR coating with a merit
// function, open, and a mirror.
const { createLiveBridge } = require('../src/main/liveBridge.js');
const appDesigns = () => ({ 'app-ar': { ...start, name: 'Two-layer AR', id: 'app-ar' }, 'app-hr': { ...stack, name: 'Mirror', id: 'app-hr' } });
// `programs` gets the name of each program the app is asked to let in.
async function openApp(file, programs) {
    const app = makeFakeApp(appDesigns(), 'app-ar');
    const admit = program => { programs.push(program); return true; };
    const bridge = createLiveBridge({ file, log: () => {}, version: '9.9.9', forward: app.forward, admit });
    await bridge.open();
    return { app, bridge };
}
{
    const link = path.join(WORK, 'live-bridge.json');
    const programs = [];
    const { app, bridge } = await openApp(link, programs);
    let writesAtEdit = null;
    const ran = await scenario('live', {
        input: { link },
        onMessage: (message, child) => {
            if (message.waiting === 'edit') {
                app.edit('app-ar', { referenceWavelength: 600 });
                writesAtEdit = app.writes;
            }
            if (message.waiting === 'close') bridge.close();
            if (message.waiting) child.stdin.write('\n');
        },
    });
    const { said } = ran;
    ok('tf.app.designs() lists the app\'s designs', canon((said.listed ?? []).map(([id, name, , active, , front, back]) => [id, name, active, front, back]))
        === canon([['app-ar', 'Two-layer AR', true, 2, 0], ['app-hr', 'Mirror', false, 7, 0]]), JSON.stringify(said.listed) + failure(ran));
    ok('tf.app.open_design() copies the open design', canon(said.opened) === '["Two-layer AR","app-ar"]', JSON.stringify(said.opened));
    ok('a design changed and pushed is one write in the app, at a new revision', canon(said.pushed) === '[40,true]', JSON.stringify(said.pushed));
    ok('and a copy of it pushes again, each with a notice', said.again === 41 && writesAtEdit === 2 && app.designs['app-ar'].frontLayers[0].thickness === 41
        && app.notices.slice(0, 2).join() === 'Two-layer AR,Two-layer AR', `${said.again} ${writesAtEdit}`);
    ok('and then holds the design the app stored, which keeps the app\'s name, not its own', said.afterPush === true, JSON.stringify(said.afterPush));
    ok('a push after an edit in the app is refused as edited, by push, naming open_design', said.edited?.[0] === 'edited'
        && /^push: .*Read it again with tf\.app\.open_design\(\)/.test(said.edited[1]), JSON.stringify(said.edited));
    const notOpen = [said.switched, said.notFinite, app.writes];
    ok('a design that is not the open one is refused as switched, and a design holding NaN, by push before it is sent, and none writes', canon(notOpen)
        === canon(['switched', ['TFStudioError', 'push: design.frontLayers[0].thickness is NaN or infinite, which the app cannot take'], 2]), canon(notOpen));
    ok('open_design takes a name, an id or a listed design', [said.byId, said.byListed].join() === 'Mirror,Mirror', JSON.stringify([said.byId, said.byListed]));
    ok('and refuses a name the app has no design of', /^open_design: the app holds no design with the id or name 'Nothing'/.test(said.unknown ?? ''), said.unknown);
    ok('push of a design not read from the app is refused', /^push: this design was not read from the TFStudio app/.test(said.notRead ?? ''), said.notRead);
    ok('once the app\'s link closes, a call is refused as off, saying to click Interactive', said.off?.[0] === 'off'
        && said.off[1] === "designs: TFStudio is not running, or it is not listening for this program. Click Interactive on TFStudio's Optimization tab, then call this again.",
    JSON.stringify(said.off));
    const offBy = [said.off, said.offOpen, said.offOpenByName].map(refusal => String(refusal).split(':')[0]);
    ok('by the method called, open_design for both of the calls it makes', canon(offBy) === canon(['off,designs', 'off,open_design', 'off,open_design']), canon(offBy));
    ok('tf.app without live is refused', /^tf\.app: this TFStudio\(\) was started without live=True/.test(said.notLive ?? ''), said.notLive);
    ok('the app is asked to let the program in under the name of the Python\'s executable', programs.length > 0 && programs.every(program => program === PROGRAM),
        `${programs.join()} (${PROGRAM})`);
}

// ── 6. The objects ─────────────────────────────────────────────────────────
// tests/_pythonObjects.mjs says what it checks.
await checkObjects({ api, scenario, ok, canon, attempt, local, failure, POOL, QUANTITIES, WORK, DRAWN, STOPPED_WITHIN_S });

// ── 7. Installing ──────────────────────────────────────────────────────────
// An installed TFStudio as the package sees it: its executable, and the
// package in resources/python, in a folder whose name is not ASCII, as a
// user's folder can be. Its resources folder also holds what marks a source
// checkout, so the TFStudio the package came with is shown to come first.
const runPython = (command, args, options = {}) => spawnSync(command, args, { cwd: WORK, encoding: 'utf8', timeout: PYTHON_STEP_MS, ...options });
{
    const app = path.join(WORK, 'Programs', 'TFStudio Проба');
    const home = path.join(app, 'resources', 'python');
    fs.cpSync(PACKAGE, home, { recursive: true, filter: source => path.basename(source) !== '__pycache__' });
    const exe = path.join(app, EXE_NAME);
    fs.writeFileSync(exe, '');
    fs.mkdirSync(path.join(app, 'resources', 'src', 'apiServer'), { recursive: true });
    fs.writeFileSync(path.join(app, 'resources', 'src', 'apiServer', 'server.js'), '');
    fs.mkdirSync(path.join(app, 'resources', 'node_modules', 'tmmcore'), { recursive: true });
    const install = path.join(home, 'install.py');
    // install.py prints the paths it names, which are not ASCII here.
    const env = { ...ENV, PYTHONIOENCODING: 'utf-8' };
    const reported = ran => /^Wrote (.+)$/m.exec(String(ran.stdout))?.[1]?.trim();
    const other = path.join(WORK, 'other', EXE_NAME);

    const venv = path.join(WORK, 'venv');
    const made = runPython(python.command, [...python.prefix, '-m', 'venv', '--without-pip', venv]);
    const inVenv = [path.join(venv, 'Scripts', 'python.exe'), path.join(venv, 'bin', 'python')].find(file => fs.existsSync(file));
    const installInVenv = () => {
        const installed = runPython(inVenv, [install], { env });
        const pth = String(reported(installed));
        ok('install.py writes tfstudio.pth into the environment it runs in', JSON.stringify([installed.status, pth.startsWith(venv), path.basename(pth), fs.existsSync(pth)])
            === '[0,true,"tfstudio.pth",true]', `${installed.stdout}${installed.stderr}`);
        ok('and says how to remove it', /delete that file/.test(installed.stdout));
        ok('and run again writes the same file', reported(runPython(inVenv, [install], { env })) === pth);
        const FOUND = 'import json, tfstudio; from tfstudio import _finding; print(json.dumps([tfstudio.__file__, _finding.find_server(None, False, None)]))';
        const imported = runPython(inVenv, ['-I', '-B', '-c', FOUND], { env });
        // [file, command] as the environment's Python printed them, or nothing when it could not.
        const [file, command] = JSON.parse(`[${imported.stdout.trim()}]`).flat();
        ok('the environment imports tfstudio from the folder install.py is in', file === path.join(home, 'tfstudio', '__init__.py'), `${file} ${imported.stderr}`);
        ok('and the package starts the TFStudio it came with', JSON.stringify(command) === JSON.stringify([exe, '--api']), JSON.stringify(command));
        const named = runPython(inVenv, ['-I', '-B', '-c', FOUND], { env: { ...env, TFSTUDIO_EXE: other } });
        ok('unless TFSTUDIO_EXE names another', JSON.stringify(JSON.parse(named.stdout.trim() || '[]')[1]) === JSON.stringify([other, '--api']), named.stdout + named.stderr);
        fs.rmSync(pth, { force: true });
        ok('deleting the file uninstalls it', runPython(inVenv, ['-I', '-B', '-c', 'import tfstudio'], { env }).status !== 0);
    };
    const noVenv = () => console.log(`Python's venv module made no environment, so install.py was not run in one: ${String(made.stderr).trim().split('\n').at(-1)}`);
    (made.status === 0 ? installInVenv : noVenv)();

    // A Python whose own site-packages cannot be written: install.py writes
    // into the user's site-packages instead, here a folder of the test's;
    // a Python that reads no user site-packages gets a message instead.
    const blocked = path.join(WORK, 'a file');
    fs.writeFileSync(blocked, '');
    const fallBack = (userSite, userBase) => runPython(python.command, [...python.prefix, '-B', '-c',
        `import runpy, site, sys, sysconfig\nsysconfig.get_path = lambda *a, **k: sys.argv[1]\nsite.ENABLE_USER_SITE = ${userSite}\nrunpy.run_path(sys.argv[2], run_name="__main__")`,
        path.join(blocked, 'site-packages'), install], { env: { ...env, PYTHONUSERBASE: userBase } });
    const userBase = path.join(WORK, 'user base');
    const fallback = fallBack('True', userBase);
    const userPth = String(reported(fallback));
    ok('a site-packages that cannot be written sends the file to the user\'s', JSON.stringify([userPth.startsWith(userBase), fs.existsSync(userPth)]) === '[true,true]',
        `${fallback.stdout}${fallback.stderr}`);
    const noUserBase = path.join(WORK, 'no user base');
    const noUser = fallBack('False', noUserBase);
    ok('and when this Python reads no user site-packages, install.py says so and writes nothing', noUser.status === 1
        && /cannot be written, and this Python reads no user site-packages folder/.test(noUser.stderr) && !fs.existsSync(noUserBase), `${noUser.status} ${noUser.stderr}`);

    // The encoding each Python reads tfstudio.pth in, with the locale's
    // functions standing in so each branch shows which it takes.
    const LOAD = 'import importlib.util, json, locale, sys\nspec = importlib.util.spec_from_file_location("install", sys.argv[1])\n'
        + 'install = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(install)\n';
    const chosen = runPython(python.command, [...python.prefix, '-B', '-c', `${LOAD}locale.getencoding = lambda: "getencoding"\n`
        + 'locale.getpreferredencoding = lambda do_setlocale=True: "getpreferredencoding"\n'
        + 'print(json.dumps([install.pth_encoding(version) for version in [(3, 14), (3, 13, 0), (3, 12, 4), (3, 11), (3, 10, 9), (3, 8)]]))', install]);
    ok('tfstudio.pth is written in UTF-8 for 3.13 on, locale.getencoding() for 3.11 and 3.12, and getpreferredencoding(False) before', chosen.stdout.trim()
        === JSON.stringify(['utf-8', 'utf-8', 'getencoding', 'getencoding', 'getpreferredencoding', 'getpreferredencoding']).replace(/,/g, ', '), chosen.stdout + chosen.stderr);
    const site = path.join(WORK, 'ascii site');
    fs.mkdirSync(site);
    const unwritable = runPython(python.command, [...python.prefix, '-B', '-c', `${LOAD}import sysconfig\ninstall.HERE = sys.argv[2]\n`
        + 'install.pth_encoding = lambda version: "ascii"\nsysconfig.get_path = lambda *a, **k: sys.argv[3]\ninstall.main()', install, home, site], { env });
    ok('a folder that encoding cannot write is refused with a message, and nothing is written', unwritable.status === 1
        && unwritable.stderr.includes(`The folder ${home} cannot be written in ascii`) && fs.readdirSync(site).length === 0, `${unwritable.status} ${unwritable.stderr}`);
}

// ── 8. Python 3.8 ──────────────────────────────────────────────────────────
// The package runs on Python 3.8, the last for Windows 7, though the Python
// here is newer: tests/_python38Check.py reads each of its files and each
// example on the manual's pages with 3.8's grammar, and for the names it lists
// of what 3.9 to 3.12 added. A 3.8 interpreter would see more.
const examplesOf = file => [...fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').matchAll(/^```python\n([\s\S]*?)^```$/gm)].map(m => m[1]);
{
    const sources = fs.readdirSync(PACKAGE, { recursive: true }).filter(name => name.endsWith('.py'))
        .map(name => [`python/${name.replace(/\\/g, '/')}`, fs.readFileSync(path.join(PACKAGE, name), 'utf8')]);
    const examples = PAGES.flatMap(page => examplesOf(page.en).map((code, i) => [`${page.slug}.md example ${i + 1}`, code]));
    const PROBES = [
        ['match', 'match x:\n    case 1:\n        pass\n'], ['removeprefix', '"ab".removeprefix("a")\n'], ['generic', 'x: list[int] = []\n'],
        ['union', 'isinstance(1, int | None)\n'], ['strict', 'zip([], [], strict=True)\n'], ['module', 'import tomllib\n'], ['cache', 'from functools import cache\n'],
    ];
    const checked = runPython(python.command, [...python.prefix, '-I', '-B', path.join(ROOT, 'tests', '_python38Check.py')], { input: JSON.stringify([...sources, ...examples, ...PROBES]) });
    // The problems by source, or none when the check printed nothing.
    const problems = Object.assign({}, ...JSON.parse(`[${checked.stdout.trim()}]`));
    ok('what 3.8 lacks is found: grammar, a method, list[...], | between types, zip(strict=), a module and a function',
        PROBES.every(([name]) => problems[name]?.length === 1), JSON.stringify(PROBES.map(([name]) => problems[name])) + checked.stderr);
    const found = [...sources, ...examples].filter(([name]) => problems[name]?.length !== 0);
    ok('the package and the manual\'s examples use nothing of it', JSON.stringify([sources.some(([name]) => name.startsWith('python/tfstudio/')), examples.length > 0, found.length])
        === '[true,true,0]', found.map(([name]) => `${name}: ${problems[name]}`).join('; '));
    const unlike = PAGES.filter(page => JSON.stringify(examplesOf(page.zh)) !== JSON.stringify(examplesOf(page.en))).map(page => page.slug);
    ok('the manual\'s zh pages show the same examples', unlike.length === 0, unlike.join(', '));
}

// ── 9. What the installer ships ────────────────────────────────────────────
{
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const shipped = pkg.build.extraResources.filter(entry => entry.from === 'python');
    ok('the installer ships python/ as resources/python, without the __pycache__ folders Python writes',
        JSON.stringify(shipped) === JSON.stringify([{ from: 'python', to: 'python', filter: ['**/*', '!**/__pycache__{,/**/*}'] }]), JSON.stringify(shipped));
    ok('and so does the Windows 7 build', JSON.stringify(require('../build/electron-builder.win7.js').extraResources) === JSON.stringify(pkg.build.extraResources));
}

// ── 10. The manual's examples ──────────────────────────────────────────────
// tests/_pythonExamples.mjs says what it checks.
await checkExamples({ scenario, ok, failure, openApp, examplesOf, PAGES, PACKAGE, ENV, WORK, limit: EXAMPLES_LIMIT_MS });

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
