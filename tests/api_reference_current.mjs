/**
 * The manual's API Reference is what tools/gen_api_reference.mjs writes from
 * the source now, it has an entry for every call on the console's `tf` and for
 * no other, and every example on it and on the Script Console page runs.
 *
 *   1. Both pages, English and zh, are the generator's text: a doc comment, a
 *      setting, a default or a hook changed in code without running the
 *      generator fails here. So does an English text whose zh translation in
 *      tools/api-reference/zh.json is missing or was written for an earlier
 *      English text, since the generator then refuses to build the zh page.
 *   2. The entries on both pages are exactly the calls a script gets on `tf`,
 *      and the Script Console page's table of calls lists exactly those calls,
 *      so the reference groups every one of them.
 *   3. Every js example on the reference and on the Script Console page runs
 *      through the console's runner (src/scripts/runScript.js) on a small
 *      design with a merit function, without an error, leaves a design the
 *      console can apply, and prints what it found, since the output is all a
 *      reader sees of a run. Each zh page shows the same examples, so the ones
 *      run here are the ones its readers copy. A file an example writes in the
 *      home folder goes to a folder of the test's own, and an example that
 *      writes one runs a second time there and must leave the files of its
 *      first run as they were: a reader who runs it twice loses nothing.
 *
 * Run: node tests/api_reference_current.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { buildPages, PAGES, CONSOLE_PAGES } = await import('../tools/gen_api_reference.mjs');
const api = await import('../src/api/index.js');
const { runScript } = await import('../src/scripts/runScript.js');

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const examplesOf = text => [...text.matchAll(/^```js\n([\s\S]*?)^```$/gm)].map(m => m[1]);

// ── 1. The pages are the generator's ────────────────────────────────────────
const built = buildPages();
for (const lang of Object.keys(PAGES)) {
    assert.equal(read(PAGES[lang]), built[lang], `the ${lang} API Reference is what the generator writes; run node tools/gen_api_reference.mjs`);
}

const realRequire = createRequire(import.meta.url);

// The engine's own reports go to the process's console; a run here keeps them
// out of the test's output.
async function quietly(run) {
    const { log, warn, info } = console;
    console.log = console.warn = console.info = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, info }); }
}

/** Runs `text` as the console runs a script; resolves to { answer, printed }. */
async function runExample(text, design, require) {
    const printed = [];
    const print = (...args) => printed.push(args.join(' '));
    const scriptConsole = { log: print, info: print, warn: print, error: print, debug: print };
    const answer = await quietly(() => runScript({ api, text, fileName: 'example.js', design, console: scriptConsole, require }));
    return { answer, printed };
}

// ── 2. The entries are the calls on tf ──────────────────────────────────────
await api.init();
{
    const { printed: [onTf] } = await runExample("console.log(Object.keys(tf).filter(k => typeof tf[k] === 'function').sort().join(','));", null, realRequire);
    const table = read(CONSOLE_PAGES.en).split('\n').filter(line => line.startsWith('|') && line.includes('`'))
        .flatMap(line => [...line.split('|')[2].matchAll(/`(\w+)`/g)].map(m => m[1]));
    assert.equal([...table].sort().join(','), onTf, 'the Script Console page\'s table lists exactly the calls on tf');
    for (const lang of Object.keys(PAGES)) {
        const entries = [...read(PAGES[lang]).matchAll(/^### (\w+)$/gm)].map(m => m[1]).sort().join(',');
        assert.equal(entries, onTf, `the ${lang} page has an entry for each call on tf and for no other`);
    }
}

// ── 3. Every example runs ───────────────────────────────────────────────────
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-examples-'));
const scriptRequire = id => (id === 'os' || id === 'node:os' ? { ...os, homedir: () => home } : realRequire(id));
const small = api.setMerit(
    api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2', symbols: { H: 'Ta2O5', L: 'SiO2' } }),
    [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }],
);

// The files in the home folder, each with the time it was last written.
const homeFiles = () => new Map(fs.readdirSync(home).map(name => [name, fs.statSync(path.join(home, name)).mtimeMs]));

// An example that wrote files there, `before` being the folder as it was,
// runs again and must leave every file there as it was after its first run.
async function runsAgainWritingOverNothing(text, where, before) {
    const after = homeFiles();
    if (after.size === before.size) return;
    await runExample(text, structuredClone(small), scriptRequire).catch(err => assert.fail(`${where} threw when run again: ${err.stack}`));
    const now = homeFiles();
    const rewritten = [...after].filter(([name, at]) => now.get(name) !== at).map(([name]) => name);
    assert.deepEqual(rewritten, [], `${where}, run again, leaves the files it wrote as they were`);
}

let ran = 0;
for (const pages of [PAGES, CONSOLE_PAGES]) {
    const examples = examplesOf(read(pages.en));
    assert.ok(examples.length > 0, `the examples on ${path.basename(pages.en)} are found`);
    assert.deepEqual(examplesOf(read(pages.zh)), examples, `${path.basename(pages.zh)}: the zh page shows the English page's examples`);
    for (const text of examples) {
        const where = `${path.basename(pages.en)}: ${text.split('\n')[0]}`;
        const before = homeFiles();
        const { answer, printed } = await runExample(text, structuredClone(small), scriptRequire)
            .catch(err => assert.fail(`${where} threw: ${err.stack}`));
        assert.equal(answer.invalid, undefined, `${where} leaves a design the console can apply`);
        assert.ok(printed.length > 0, `${where} prints what it found`);
        await runsAgainWritingOverNothing(text, where, before);
        ran++;
    }
}
fs.rmSync(home, { recursive: true, force: true });
console.log(`PASS: api_reference_current (${ran} examples)`);
