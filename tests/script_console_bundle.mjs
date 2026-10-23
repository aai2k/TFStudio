/**
 * The Script Console's thread as an installed app runs it: the CommonJS bundle
 * (tools/scriptBundle.mjs, built here to a folder of its own), started by the
 * main process's runner (src/main/scriptRuns.js) in this Node with the globals
 * and built-in methods listed in NEWER_THAN_NODE_16 taken out, on the runner
 * and on the script's thread. Node 16.17 is what the Windows 7 build's
 * Electron 22 runs, and it has none of them, so a call to one of them on the
 * paths the scripts here take fails as it would there. Paths no script here
 * takes are not covered.
 *
 * As a second check, the bundle text names none of structuredClone, findLast
 * and fetch. On the thread, the script prints, a design using a material from
 * a user catalog in the data folder computes through the object API
 * (src/api/objects) the spectrum the API computes in this process, a
 * refinement runs, the design it changes comes back, and its error names its
 * own line. With a Python 3.8 or newer here, a Python script does the same on
 * the bundle's Python thread (src/scripts/pythonWorker.js), which serves it
 * the API.
 *
 * Run: node tests/script_console_bundle.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildScriptWorker } from '../tools/scriptBundle.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-script-bundle-'));
await buildScriptWorker(out);
const bundle = path.join(out, 'scriptWorker.js');

// ── What Node 16 does not have ──────────────────────────────────────────────
const text = fs.readFileSync(bundle, 'utf8');
for (const [name, pattern] of [
    ['structuredClone', /\bstructuredClone\b/], ['findLast', /\.findLast(Index)?\(/], ['fetch', /\bfetch\(/],
]) {
    assert.ok(!pattern.test(text), `the bundle calls ${name}, which Node 16 lacks`);
}

// ── A run on the bundled thread, in a Node 16 runtime ───────────────────────
const dataDir = path.join(out, 'data');
fs.mkdirSync(path.join(dataDir, 'Materials', 'user'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'designs', 'user-catalog-no-copy', 'catalogs', 'catalog-present', 'user', 'user_lab.catalog.json'),
    path.join(dataDir, 'Materials', 'user', 'user_lab.catalog.json'));
// The globals and built-in methods this test removes, as [owner, names]: each
// is one Node 16.17 lacks. They are not every one added since Node 16, so a
// call to one left off this list still passes here. --require runs the file
// that deletes them on every worker thread too.
const NEWER_THAN_NODE_16 = [
    ['globalThis', ['CustomEvent', 'crypto', 'structuredClone', 'fetch', 'Headers', 'Request', 'Response', 'FormData',
        'Blob', 'File', 'navigator', 'WebSocket', 'DOMException', 'BroadcastChannel', 'Iterator', 'Float16Array']],
    ['Array.prototype', ['findLast', 'findLastIndex', 'toSorted', 'toReversed', 'toSpliced', 'with']],
    ['Object.getPrototypeOf(Uint8Array).prototype', ['findLast', 'findLastIndex', 'toSorted', 'toReversed', 'with']],
    ['Object', ['groupBy']], ['Map', ['groupBy']], ['Promise', ['withResolvers', 'try']], ['Array', ['fromAsync']],
    ['AbortSignal', ['any']],
    ['String.prototype', ['isWellFormed', 'toWellFormed']],
    ['Set.prototype', ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']],
    ['Object.getPrototypeOf(Object.getPrototypeOf([].values()))', ['map', 'filter', 'take', 'drop', 'flatMap', 'reduce',
        'toArray', 'forEach', 'some', 'every', 'find']],
];
const node16 = path.join(out, 'node16.cjs');
fs.writeFileSync(node16, NEWER_THAN_NODE_16
    .map(([owner, names]) => `for (const name of ${JSON.stringify(names)}) delete (${owner})[name];`).join('\n'));
// Runs each script of the JSON argument on the bundle, one after another, and
// prints what each answered and printed.
// Then the Python script, on the bundle's Python thread, in the Python found
// here, with the repo's package; null in its place when there is no Python.
const child = path.join(out, 'runScripts.cjs');
fs.writeFileSync(child, `
const { createScriptRuns } = require(${JSON.stringify(path.join(ROOT, 'src', 'main', 'scriptRuns.js'))});
const { findPython, pythonLaunch } = require(${JSON.stringify(path.join(ROOT, 'src', 'main', 'pythonLaunch.js'))});
const { workerFile, pythonWorkerFile, environment, design, scripts, python } = JSON.parse(process.argv[2]);
const runs = createScriptRuns({ workerFile, pythonWorkerFile, log: () => {} });
(async () => {
    const results = [];
    for (const [i, text] of scripts.entries()) {
        const output = [];
        const answer = await runs.start('b' + i, 'test', { environment, text, fileName: 'my.js', filePath: null, design }, lines => output.push(...lines));
        results.push({ answer, output });
    }
    const found = await findPython();
    if (found.missing) results.push(null);
    else {
        const output = [];
        const launch = async () => pythonLaunch({ found: found.found, filePath: null, dataDir: environment.dataDir, packageHome: ${JSON.stringify(path.join(ROOT, 'python'))} });
        const answer = await runs.startPython('p', 'test', { environment, version: '0', text: python, fileName: 'my.py', filePath: null, design }, launch, lines => output.push(...lines));
        results.push({ answer, output });
    }
    process.stdout.write(JSON.stringify(results));
})();
`);

const api = await import('../src/api/index.js');
await api.init({ dataDir });
const design = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2', symbols: { H: 'user_lab:Ta2O5', L: 'SiO2' } });
const wasmPath = createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm');
// The names above that the script's thread still has, as "owner.name".
const stillThere = `${JSON.stringify(NEWER_THAN_NODE_16)}.flatMap(([owner, names]) => names.filter(name => name in (0, eval)(owner)).map(name => owner + '.' + name))`;
const request = {
    workerFile: bundle, pythonWorkerFile: path.join(out, 'pythonWorker.js'), environment: { dataDir, wasmPath }, design,
    python: 'import json\nprint(json.dumps(list(tf.design.spectrum(450, 650, step=50).R)))\n'
        + 'tf.design.layers[len(tf.design.layers)].thickness = 61',
    scripts: [
        `console.log(JSON.stringify(${stillThere}));\nconsole.log(JSON.stringify(tf.design.spectrum(450, 650, { step: 50 }).R));`,
        "const rated = tf.design.copy();\nrated.merit.add('RAV', 450, 650, { target: 0 });\n"
            + "const run = await rated.refine({ method: 'dls', maxIter: 5 });\nconsole.log('refined', run.merit >= 0);",
        'tf.design.layers[tf.design.layers.length].thickness = 61;',
        'const a = 1;\nnull.x;',
    ],
};
const [printed, refined, changed, failed, python] = JSON.parse(execFileSync(process.execPath, ['--require', node16, child, JSON.stringify(request)], {
    encoding: 'utf8', timeout: 120000,
}));

assert.equal(printed.answer.state, 'done', printed.answer.error);
assert.equal(printed.output[0], '["globalThis.CustomEvent","globalThis.crypto"]',
    'the script\'s thread runs without what Node 16 lacks, apart from the two the API puts back itself (src/api/environment.js)');
assert.equal(printed.output[1], JSON.stringify(api.spectrum(design, { from: 450, to: 650, step: 50 }).angles[0].R),
    'the bundle computes the API\'s spectrum with a user-catalog material');
assert.equal(refined.answer.state, 'done', refined.answer.error);
assert.deepEqual(refined.output, ['refined true'], 'a refinement runs');
assert.equal(changed.answer.design?.frontLayers[0].thickness, 61, 'the changed design comes back');
assert.equal(failed.answer.state, 'failed');
assert.match(failed.answer.error, /^TypeError: .*\n\s+at my\.js:2:6$/, `the error names the script line: ${failed.answer.error}`);

// The rest of the bundle is checked either way, so this is a note, not a SKIP.
if (python === null) console.log('note: no Python 3.8 or newer here, so the bundle\'s Python thread is not checked');
else {
    assert.equal(python.answer.state, 'done', python.answer.error);
    assert.deepEqual(JSON.parse(python.output[0]), api.spectrum(design, { from: 450, to: 650, step: 50 }).angles[0].R,
        'a Python script computes the API\'s spectrum on the bundle\'s Python thread');
    assert.equal(python.answer.design?.frontLayers[0].thickness, 61, 'and the design it changed comes back');
}

fs.rmSync(out, { recursive: true, force: true });
console.log('PASS: script_console_bundle');
