// A Script Console run on a thread of its own (src/main/scriptRuns.js), so the
// app keeps answering while the script computes and Stop can end it at any
// point. It starts the API on the app's data folder, runs the script and posts
// what the script prints, then { type: 'done' } with what runScript resolved
// to, or { type: 'error' } with what the script threw. The script prints
// through the console it is handed; anything else written to this thread's
// console, such as the engine's own reports, reaches the app log instead.

import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import process from 'node:process';
import { format } from 'node:util';
import * as api from '../api/index.js';
import { runScript, scriptErrorText } from './runScript.js';
import { createHeldOutput } from './outputBounds.js';

// The window redraws its output for each batch, so what the script prints
// goes out at most four times a second however fast it prints, and what is
// waiting goes out before the run's answer. A batch is posted from inside the
// print call itself when the quarter second is up, so a script that never
// yields, a loop with no await, still shows its output as it goes.
const OUTPUT_EVERY_MS = 250;

// The lines waiting for the next batch (outputBounds.js). A batch posts
// { lines, dropped }.
const held = createHeldOutput();
let lastPost = 0;
let timer = null;

function postHeld() {
    clearTimeout(timer);
    timer = null;
    const batch = held.take();
    if (batch.lines.length || batch.dropped) parentPort.postMessage({ type: 'output', ...batch });
    lastPost = Date.now();
}

// Each line printed is one line of output, however many one call prints.
function print(...args) {
    held.add(format(...args));
    const wait = OUTPUT_EVERY_MS - (Date.now() - lastPost);
    if (wait <= 0) postHeld();
    else timer ??= setTimeout(postHeld, wait);
}

const scriptConsole = { log: print, info: print, warn: print, error: print, debug: print };

const { environment, text, fileName, filePath, design } = workerData;

function fail(error) {
    postHeld();
    parentPort.postMessage({ type: 'error', text: scriptErrorText(error, fileName) });
}

// An error thrown outside the script's own chain of awaits, from a timer or a
// promise nothing awaits, fails the run as one inside it does. process.exit()
// in the script ends the thread with no answer, and what it printed before
// still goes out.
process.on('uncaughtException', fail);
process.on('exit', postHeld);

async function main() {
    await api.init(environment);
    // A saved script's require finds files beside it, as Node's own does.
    const scriptRequire = createRequire(filePath || import.meta.url);
    const answer = await runScript({ api, text, fileName, design, console: scriptConsole, require: scriptRequire });
    postHeld();
    parentPort.postMessage({ type: 'done', ...answer });
}

main().catch(fail);
