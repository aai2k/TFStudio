// A Script Console run on a thread of its own (src/main/scriptRuns.js), so the
// app keeps answering while the script computes and Stop can end it at any
// point. It starts the API on the app's data folder, runs the script and posts
// what the script prints, then { type: 'done' } with what runScript resolved
// to, or { type: 'error' } with what the script threw and the script's line it
// names. The script prints through the console it is handed; anything else
// written to this thread's console, such as the engine's own reports, reaches
// the app log instead.

import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import process from 'node:process';
import { format } from 'node:util';
import { init } from '../api/index.js';
import { runScript, scriptErrorLine, scriptErrorText } from './runScript.js';
import { createOutputBatches } from './outputBounds.js';

// A batch posts { lines, dropped } (outputBounds.js).
const output = createOutputBatches(batch => parentPort.postMessage({ type: 'output', ...batch }));

// Each line printed is one line of output, however many one call prints.
const print = (...args) => output.print(format(...args));

const scriptConsole = { log: print, info: print, warn: print, error: print, debug: print };

const { environment, text, fileName, filePath, design } = workerData;

function fail(error) {
    output.flush();
    const shown = scriptErrorText(error, fileName);
    parentPort.postMessage({ type: 'error', text: shown, line: scriptErrorLine(shown, fileName) });
}

// An error thrown outside the script's own chain of awaits, from a timer or a
// promise nothing awaits, fails the run as one inside it does. process.exit()
// in the script ends the thread with no answer, and what it printed before
// still goes out.
process.on('uncaughtException', fail);
process.on('exit', output.flush);

async function main() {
    const info = await init(environment);
    // A saved script's require finds files beside it, as Node's own does.
    const scriptRequire = createRequire(filePath || import.meta.url);
    const answer = await runScript({ info, text, fileName, design, console: scriptConsole, require: scriptRequire });
    output.flush();
    parentPort.postMessage({ type: 'done', ...answer });
}

main().catch(fail);
