/**
 * Every doc example of the plain API's calls (src/api, as
 * tools/api-reference/docComments.mjs reads them) runs where those calls are
 * reached: as the body of a Node program that has
 * `const tf = require('…/src/api/index.js')` and has awaited tf.init(). tf is
 * then the API's module, which holds no design of its own, beside `require`
 * and `console`. Each runs in strict mode, so one that leans on a `tf.design`
 * fails here, without an error, and prints what it found. A file an example
 * writes in the home folder goes to a folder of the test's own.
 *
 * Run: node tests/api_plain_examples.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = await import('../src/api/index.js');
const { apiCalls } = await import('../tools/api-reference/docComments.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const AsyncFunction = (async () => {}).constructor;
const realRequire = createRequire(import.meta.url);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-plain-examples-'));
const programRequire = id => (id === 'os' || id === 'node:os' ? { ...os, homedir: () => home } : realRequire(id));

// The engine's own reports go to the process's console; a run here keeps them
// out of the test's output.
async function quietly(run) {
    const { log, warn, info } = console;
    console.log = console.warn = console.info = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, info }); }
}

const calls = apiCalls(path.join(ROOT, 'src', 'api'));
const withExample = calls.filter(call => call.example);
ok('every call but init has an example', JSON.stringify(calls.filter(call => !call.example).map(call => call.name)) === '["init"]',
    calls.filter(call => !call.example).map(call => call.name).join(', '));
for (const call of withExample) {
    const printed = [];
    const print = (...args) => printed.push(format(...args));
    const programConsole = { log: print, info: print, warn: print, error: print, debug: print };
    const body = new AsyncFunction('tf', 'console', 'require', `'use strict';\n${call.example}`);
    const failed = await quietly(() => body(api, programConsole, programRequire)).then(() => null, err => err.message);
    ok(`the example of ${call.name} runs and prints what it found`, failed === null && printed.length > 0, failed ?? 'printed nothing');
}
fs.rmSync(home, { recursive: true, force: true });

console.log(`${pass} passed, ${fail} failed (${withExample.length} examples)`);
process.exitCode = fail ? 1 : 0;
