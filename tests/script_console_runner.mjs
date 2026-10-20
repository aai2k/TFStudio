/**
 * Script Console runs through the real thread (src/main/scriptRuns.js starting
 * src/scripts/scriptWorker.js), as a source checkout of the app runs them.
 *
 * What the script prints arrives as output, a line per line printed, and so
 * does what it prints while it never yields. A batch carries the newest lines
 * that fit in the output's bounds (src/scripts/outputBounds.js) and the count
 * of older ones it left out, so a script printing in a loop sends no more than
 * that however fast it prints, and the thread holds no more than twice that
 * between batches; a line too long for the bound is cut, and says
 * by how much. What the script printed still arrives when it calls
 * process.exit() or throws from a timer, and such an error names its line. A
 * design the script replaced or changed in place comes back, checked as a
 * design; one it left alone does not, and a value that is not a design is
 * refused with a reason that speaks of tf.design, not of a file. An error
 * names the script's own line and none of the app's. Stop ends a script that
 * never ends, and once it has, nothing more of that run arrives, however
 * late the thread's last batch is handled. The engine's own console output,
 * and anything else written to the thread's console, goes to the log and not
 * the output. The thread starts the API on the data folder it is given: a
 * design using a material from a user catalog there computes the spectrum the
 * API computes here. require is Node's, and finds a file beside a saved
 * script; import() is not offered.
 *
 * Run: node tests/script_console_runner.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createScriptRuns, scriptWorkerFile } = require('../src/main/scriptRuns.js');
const api = await import('../src/api/index.js');
const { OUTPUT_CHARS, OUTPUT_LINES, createHeldOutput, keepNewest, lineLength } = await import('../src/scripts/outputBounds.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-script-runner-'));
const dataDir = path.join(out, 'data');
fs.mkdirSync(path.join(dataDir, 'Materials', 'user'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', 'designs', 'user-catalog-no-copy', 'catalogs', 'catalog-present', 'user', 'user_lab.catalog.json'),
    path.join(dataDir, 'Materials', 'user', 'user_lab.catalog.json'));

const logged = [];
const runs = createScriptRuns({
    workerFile: scriptWorkerFile({ isPackaged: false, srcDir: path.join(ROOT, 'src') }),
    log: line => logged.push(line),
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let seq = 0;
/**
 * Starts `text` as my.js on `design`; resolves to { answer, output, batches },
 * `output` filled with the lines as the script prints and `batches` with each
 * batch as it came, { lines, dropped }.
 */
function start(text, design = null, filePath = null) {
    const runId = `r${++seq}`;
    const output = [];
    const batches = [];
    const answer = runs.start(runId, 'test', {
        environment: { dataDir, wasmPath: null }, text, fileName: 'my.js', filePath, design,
    }, (lines, dropped) => {
        batches.push({ lines, dropped });
        output.push(...lines);
    });
    return { runId, output, batches, done: answer.then(result => ({ answer: result, output, batches })) };
}
const run = (text, design, filePath) => start(text, design, filePath).done;

await api.init({ dataDir });
const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2', symbols: { H: 'user_lab:Ta2O5', L: 'SiO2' } });

const [
    printed, untouched, replaced, inPlace, notNumber, noSubstrate, runtime, syntax, spectrum, required, imported,
    exited, thrownLater, longLine, manyLines,
] = await Promise.all([
    run("console.log('a', 1);\nconsole.warn({ x: 2 });\nconsole.error('two\\nlines');"),
    run('console.log(tf.design.name);', ar),
    run("tf.design = tf.insertLayer(tf.design, { material: 'SiO2', thickness: 100 });", ar),
    run('tf.design.frontLayers[0].thickness = 77;', ar),
    run('tf.design = 42;', ar),
    run("tf.design = { name: 'no substrate' };", ar),
    run('const a = 1;\nnull.x;', ar),
    run('const a = 1;\n\nlet x = ;', ar),
    run('console.log(JSON.stringify(tf.spectrum(tf.design, { from: 450, to: 650, step: 50 }).angles));', ar),
    (() => {
        const folder = path.join(out, 'saved');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, 'helper.js'), 'module.exports = { value: 42 };\n');
        return run("console.log(require('./helper.js').value, require('path').basename('/a/b.txt'));", null, path.join(folder, 'my.js'));
    })(),
    run("await import('node:fs');"),
    run("console.log('a');\nconsole.log('b');\nprocess.exit(0);"),
    run("setTimeout(() => { throw new Error('boom'); }, 10);\nconsole.log('x');\nconsole.log('y');\nawait new Promise(resolve => setTimeout(resolve, 2000));"),
    run(`console.log('x'.repeat(${OUTPUT_CHARS + 5}));`),
    run(`console.log(Array.from({ length: ${OUTPUT_LINES + 3} }, (_, i) => i).join('\\n'));`),
]);

// ── Output ──────────────────────────────────────────────────────────────────
assert.equal(printed.answer.state, 'done');
assert.deepEqual(printed.output, ['a 1', '{ x: 2 }', 'two', 'lines'], 'each line printed is one entry, formatted as Node formats it');
assert.deepEqual(untouched.output, ['AR'], 'tf.design is the design the run was given');
assert.deepEqual(exited.output, ['a', 'b'], 'what the script printed before process.exit() arrives');
assert.deepEqual(exited.answer, { state: 'failed', error: null }, 'and the run has no answer');
assert.deepEqual(thrownLater.output, ['x', 'y'], 'what the script printed before a timer threw arrives');
assert.equal(thrownLater.answer.state, 'failed');
assert.match(thrownLater.answer.error, /^Error: boom\n\s+at .*my\.js:1:\d+\)?$/, `an error thrown from a timer names the script line: ${thrownLater.answer.error}`);

// ── How much a batch carries ────────────────────────────────────────────────
assert.deepEqual(longLine.output, [{ text: 'x'.repeat(OUTPUT_CHARS), cut: 5 }], 'a line too long for the output is cut, and says by how much');
assert.deepEqual(manyLines.batches.map(batch => [batch.lines.length, batch.dropped]), [[OUTPUT_LINES, 3]],
    'a print of more lines than a batch carries sends the newest, and counts the rest');
assert.equal(manyLines.output[0], '3');
assert.equal(manyLines.output.at(-1), String(OUTPUT_LINES + 2));

// The window's output keeps the newest lines in the same bounds, and counts
// what it leaves out.
assert.deepEqual(keepNewest(['a', 'b']), { lines: ['a', 'b'], left: 0 });
{
    const lines = Array.from({ length: OUTPUT_LINES + 7000 }, (_, i) => String(i));
    const kept = keepNewest(lines);
    assert.equal(kept.left, 7000, 'the count of older lines left out');
    assert.deepEqual(kept.lines, lines.slice(7000), 'the newest lines, in order');
    const long = Array.from({ length: 30 }, (_, i) => `${i}`.padEnd(OUTPUT_CHARS / 10, '.'));
    const byChars = keepNewest(long);
    assert.deepEqual([byChars.lines.length, byChars.left], [10, 20], 'long lines are kept to the character bound');
    assert.equal(byChars.lines[0], long[20]);
    const huge = 'y'.repeat(OUTPUT_CHARS + 1);
    assert.deepEqual(keepNewest(['a', huge]), { lines: [huge], left: 1 }, 'the newest line is kept whatever its length');
}

// Between batches the thread holds at most twice a batch: past that it keeps a
// batch's worth, and the batch counts what that left out.
{
    const held = createHeldOutput();
    for (let i = 0; i < 2 * OUTPUT_LINES; i++) held.add(String(i));
    assert.equal(held.size(), 2 * OUTPUT_LINES, 'up to twice a batch of lines is held as printed');
    held.add(String(2 * OUTPUT_LINES));
    assert.equal(held.size(), OUTPUT_LINES, 'one more and the thread keeps a batch\'s worth');
    const batch = held.take();
    assert.deepEqual([batch.lines.length, batch.dropped, batch.lines[0]], [OUTPUT_LINES, OUTPUT_LINES + 1, String(OUTPUT_LINES + 1)],
        'the newest, with the older ones counted');
    for (let i = 0; i < 3; i++) held.add('z'.repeat(0.7 * OUTPUT_CHARS));
    assert.equal(held.size(), 1, 'more than twice a batch of characters is trimmed too');
    held.add('z'.repeat(0.7 * OUTPUT_CHARS));
    assert.equal(held.size(), 2, 'the characters held are counted again after a trim, so the next line is held as printed');
    held.add('z'.repeat(0.7 * OUTPUT_CHARS));
    assert.equal(held.size(), 1, 'until they pass twice a batch again');
    assert.equal(held.take().dropped, 4);
}

// ── The design that comes back ──────────────────────────────────────────────
assert.deepEqual(untouched.answer, { state: 'done', design: undefined, invalid: undefined }, 'a design left alone does not come back');
assert.equal(replaced.answer.design?.frontLayers.length, ar.frontLayers.length + 1, 'a replaced design comes back');
assert.equal(replaced.answer.design.name, 'AR');
assert.equal(inPlace.answer.design?.frontLayers[0].thickness, 77, 'a design changed in place comes back');
for (const [what, { answer }] of [['a number', notNumber], ['a design with no substrate', noSubstrate]]) {
    assert.equal(answer.state, 'done', `${what}: the script itself ran`);
    assert.equal(answer.design, undefined, `${what}: is not taken as a design`);
    assert.ok(typeof answer.invalid === 'string' && answer.invalid.length > 0, `${what}: the reason is given (${answer.invalid})`);
    assert.doesNotMatch(answer.invalid, /file/i, `${what}: the reason speaks of no file, which a script has not read`);
}
assert.equal(notNumber.answer.invalid, 'tf.design is a number.');

// ── Errors name the script's lines ──────────────────────────────────────────
assert.equal(runtime.answer.state, 'failed');
assert.match(runtime.answer.error, /^TypeError: .*\n\s+at my\.js:2:6$/, `a thrown error names the script line: ${runtime.answer.error}`);
assert.equal(syntax.answer.state, 'failed');
assert.match(syntax.answer.error, /^my\.js:3\n/, `a syntax error names the script line: ${syntax.answer.error}`);
assert.match(syntax.answer.error, /SyntaxError/);
for (const error of [runtime.answer.error, syntax.answer.error]) {
    assert.ok(!/runScript|scriptWorker|node:/.test(error), `no frame of the app's own: ${error}`);
}

// ── The data folder's catalogs, Node's require, no import() ─────────────────
const local = api.spectrum(ar, { from: 450, to: 650, step: 50 });
assert.deepEqual(spectrum.output, [JSON.stringify(local.angles)], 'the thread computes the API\'s spectrum with a user-catalog material');
assert.deepEqual(required.output, ['42 b.txt'], 'require finds a file beside the saved script, and Node\'s modules');
assert.equal(imported.answer.state, 'failed', 'import() is not offered');

// ── A script printing without end, and Stop ─────────────────────────────────
{
    // Each line is its own number, so every batch shows which lines it kept
    // and whether the ones it left out are the older ones it counts.
    const endless = start('let i = 0;\nwhile (true) console.log(i++);');
    for (let waited = 0; endless.output.length === 0 && waited < 20000; waited += 50) await sleep(50);
    assert.ok(endless.output.length > 0, 'a script that never yields still shows what it prints');
    await sleep(1000);
    // This side kept busy past the quarter second between batches, so Stop
    // comes with a batch the thread posted still waiting to be handled, as it
    // can in the app. Whether one is waiting or not, none may arrive after.
    const until = Date.now() + 400;
    while (Date.now() < until) { /* busy */ }
    const asked = Date.now();
    runs.stop(endless.runId);
    const shown = endless.output.length;
    const { answer, batches } = await endless.done;
    assert.equal(answer.state, 'stopped');
    assert.ok(Date.now() - asked < 1000, 'Stop answers at once');
    await sleep(300);
    assert.equal(endless.output.length, shown, 'nothing of the run arrives once Stop has ended it');

    assert.ok(batches.length >= 2, `a second of printing comes in batches (${batches.length})`);
    let next = 0;
    for (const { lines, dropped } of batches) {
        assert.ok(lines.length <= OUTPUT_LINES, `a batch carries at most ${OUTPUT_LINES} lines (${lines.length})`);
        assert.ok(lines.reduce((sum, line) => sum + lineLength(line), 0) <= OUTPUT_CHARS, 'and at most the output\'s characters');
        assert.equal(Number(lines[0]), next + dropped, 'the lines it leaves out are the oldest, and it counts them');
        assert.equal(Number(lines.at(-1)), Number(lines[0]) + lines.length - 1, 'and keeps the newest in order');
        next = Number(lines.at(-1)) + 1;
    }
    assert.ok(batches.some(batch => batch.dropped > 0), 'a loop printing faster than batches go out has lines left out');

    const second = start('while (true) {}');
    await sleep(300);
    runs.stopOwner('test');
    assert.equal((await second.done).answer.state, 'stopped', 'a page\'s runs stop together');
}

// ── The engine's console goes to the log ────────────────────────────────────
{
    const merit = api.setMerit(ar, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }]);
    const { answer, output } = await run([
        "globalThis.console.log('engine report');",
        "const { result } = await tf.refine(tf.design, { method: 'dls', maxIter: 5 });",
        "console.log('refined', result.mf >= 0);",
    ].join('\n'), merit);
    assert.equal(answer.state, 'done', answer.error);
    assert.deepEqual(output, ['refined true'], 'only what the script printed reaches the output');
    assert.ok(logged.some(line => line.includes('engine report')), 'the thread\'s own console reaches the log');
}

fs.rmSync(out, { recursive: true, force: true });
console.log('PASS: script_console_runner');
