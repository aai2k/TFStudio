/**
 * The manual's API Reference is what tools/gen_api_reference.mjs writes from
 * the source now, it has a section for every class of the object API and an
 * entry for every method and attribute of one, and every JavaScript example on
 * it and on the Script Console page runs.
 *
 *   1. Both pages, English and zh, are the generator's text: a doc comment, a
 *      docstring, a setting, a default or a method changed in code without
 *      running the generator fails here. So does an English text whose zh
 *      translation in tools/api-reference/zh.json is missing or was written
 *      for an earlier English text, since the generator then refuses to build
 *      the zh page.
 *   2. Each class the object API exports in JavaScript (src/api/objects) and
 *      in Python (python/tfstudio's __all__) has a section on both pages, and
 *      each JavaScript method and attribute an entry in its class's section,
 *      found on the classes themselves rather than read from their comments.
 *   3. Every js example on the reference and on the Script Console page runs
 *      through the console's runner (src/scripts/runScript.js) with no design
 *      open, so none leans on the design that happens to be open, without an
 *      error, leaves what the console can apply, and prints what it found,
 *      since the output is all a reader sees of a run. Each zh page shows the
 *      same examples, in JavaScript and in Python, so the ones run here and
 *      in tests/python_client.mjs are the ones its readers copy. A file an
 *      example writes in the home folder goes to a folder of the test's own,
 *      and an example that writes one runs a second time there and must
 *      leave the files of its first run as they were: a reader who runs it
 *      twice loses nothing.
 *
 * Run: node tests/api_reference_current.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const { buildPages, PAGES } = await import('../tools/gen_api_reference.mjs');
const { pyObjects } = await import('../tools/api-reference/pyDocstrings.mjs');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { runScript } = await import('../src/scripts/runScript.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs-site', 'src', 'content', 'docs');
const CONSOLE_PAGES = { en: path.join(DOCS, 'automation', 'script-console.md'), zh: path.join(DOCS, 'zh', 'automation', 'script-console.md') };

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const blocksOf = (text, lang) => [...text.matchAll(new RegExp(`^\`\`\`${lang}\\n([\\s\\S]*?)^\`\`\`$`, 'gm'))].map(m => m[1]);

// ── 1. The pages are the generator's ────────────────────────────────────────
const built = buildPages();
for (const lang of Object.keys(PAGES)) {
    assert.equal(read(PAGES[lang]), built[lang], `the ${lang} API Reference is what the generator writes; run node tools/gen_api_reference.mjs`);
}

// ── 2. A section for each class, an entry for each JavaScript member ────────
// The headings of a page: each section's title with the entries under it.
function sections(text) {
    const found = {};
    let current = null;
    for (const line of text.split('\n')) {
        if (line.startsWith('## ')) found[current = line.slice(3)] = [];
        else if (line.startsWith('### ') && current) found[current].push(line.slice(4));
    }
    return found;
}

const isClass = value => typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value));
// A class's public members as a program finds them: its prototype's own
// methods and accessors, and the fields an instance has, without the
// constructor, internal names and the inspect hook.
function membersOf(Class) {
    const own = Object.getOwnPropertyNames(Class.prototype).filter(name => name !== 'constructor' && !name.startsWith('_'));
    const iterates = Object.getOwnPropertySymbols(Class.prototype).includes(Symbol.iterator) ? ['for...of'] : [];
    return [...own, ...iterates];
}
const jsClasses = Object.entries(objects).filter(([, value]) => isClass(value));
const pythonClasses = pyObjects(path.join(ROOT, 'python', 'tfstudio')).all;
// The fields, which only an instance has: tf.design.
const FIELDS = { TFStudio: ['design'] };
for (const lang of Object.keys(PAGES)) {
    const found = sections(read(PAGES[lang]));
    const errors = found[Object.keys(found).at(-1)];
    const missingClasses = [...new Set([...jsClasses.map(([name]) => name), ...pythonClasses])]
        .filter(name => !found[name] && !errors.includes(name));
    assert.deepEqual(missingClasses, [], `the ${lang} page has a section for each class of both languages`);
    const missing = jsClasses.flatMap(([name, Class]) => [...membersOf(Class), ...(FIELDS[name] ?? [])]
        .filter(member => !found[name].some(heading => heading === member || heading.startsWith(`${member} /`)))
        .map(member => `${name}.${member}`));
    assert.deepEqual(missing, [], `the ${lang} page has an entry for each JavaScript method and attribute`);
}

// ── 3. Every example runs ───────────────────────────────────────────────────
const info = await api.init();
const realRequire = createRequire(import.meta.url);

// The engine's own reports go to the process's console; a run here keeps them
// out of the test's output.
async function quietly(run) {
    const { log, warn, info: inform } = console;
    console.log = console.warn = console.info = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, info: inform }); }
}

/** Runs `text` as the console runs a script, with no design open; resolves to { answer, printed }. */
async function runExample(text, require) {
    const printed = [];
    const print = (...args) => printed.push(format(...args));
    const scriptConsole = { log: print, info: print, warn: print, error: print, debug: print };
    const answer = await quietly(() => runScript({ info, text, fileName: 'example.js', design: null, console: scriptConsole, require }));
    return { answer, printed };
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-examples-'));
const scriptRequire = id => (id === 'os' || id === 'node:os' ? { ...os, homedir: () => home } : realRequire(id));

// The files in the home folder, each with the time it was last written.
const homeFiles = () => new Map(fs.readdirSync(home).map(name => [name, fs.statSync(path.join(home, name)).mtimeMs]));

// An example that wrote files there, `before` being the folder as it was,
// runs again and must leave every file there as it was after its first run.
async function runsAgainWritingOverNothing(text, where, before) {
    const after = homeFiles();
    if (after.size === before.size) return;
    await runExample(text, scriptRequire).catch(err => assert.fail(`${where} threw when run again: ${err.stack}`));
    const now = homeFiles();
    const rewritten = [...after].filter(([name, at]) => now.get(name) !== at).map(([name]) => name);
    assert.deepEqual(rewritten, [], `${where}, run again, leaves the files it wrote as they were`);
}

let ran = 0;
for (const pages of [PAGES, CONSOLE_PAGES]) {
    const [en, zh] = [read(pages.en), read(pages.zh)];
    for (const lang of ['js', 'python']) {
        assert.deepEqual(blocksOf(zh, lang), blocksOf(en, lang), `${path.basename(pages.zh)}: the zh page shows the English page's ${lang} examples`);
    }
    const examples = blocksOf(en, 'js');
    assert.ok(examples.length > 0, `the examples on ${path.basename(pages.en)} are found`);
    for (const text of examples) {
        const where = `${path.basename(pages.en)}: ${text.split('\n')[0]}`;
        const before = homeFiles();
        const { answer, printed } = await runExample(text, scriptRequire).catch(err => assert.fail(`${where} threw: ${err.stack}`));
        assert.equal(answer.invalid, undefined, `${where} leaves what the console can apply`);
        assert.ok(printed.length > 0, `${where} prints what it found`);
        await runsAgainWritingOverNothing(text, where, before);
        ran++;
    }
}
fs.rmSync(home, { recursive: true, force: true });
console.log(`PASS: api_reference_current (${ran} examples)`);
