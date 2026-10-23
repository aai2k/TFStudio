// A Script Console run of a Python script (src/main/scriptRuns.js): the API
// server for the script's Python, which the main process starts with the
// package the app ships first on its path (python/tfstudio/_console.py), and
// what the script prints, held for the window as scriptWorker.js holds it.
//
// The main process carries the lines between the two. Each message for Python
// goes out as { type: 'wire', line }, and comes in as { type: 'wire', line }
// for each line Python writes on its stdout; what Python writes on its stderr,
// where the script prints, comes in as { type: 'printed', text }, and
// { type: 'exited' } once Python has ended and all it wrote has come. The
// first line out is the run, { text, fileName, filePath, design }, which
// _console.py reads before anything else; then the server's hello and its
// answers, as src/apiServer/server.js documents them.
//
// The script's last line in is { end }, what tf.design held when the script
// ended or what it raised (_console.py says how). Once Python has ended, the
// run's answer goes out as scriptWorker.js posts it: { type: 'done' } with
// what changedDesign makes of tf.design, or { type: 'error', text, line },
// text null for a Python that ended without saying how the script did.

import { parentPort, workerData } from 'node:worker_threads';
import * as api from '../api/index.js';
import { createSession } from '../apiServer/calls.js';
import { liveCalls } from '../apiServer/live.js';
import { helloMessage } from '../apiServer/hello.js';
import { encode, parse } from '../apiServer/wire.js';
import { OUTPUT_CHARS, createOutputBatches } from './outputBounds.js';
import { changedDesign, startedOn } from './runScript.js';

const { environment, version, text, fileName, filePath, design } = workerData;
const before = startedOn(design);

const output = createOutputBatches(batch => parentPort.postMessage({ type: 'output', ...batch }));
const wire = message => parentPort.postMessage({ type: 'wire', line: encode(message) });

// What Python printed after its last line break, which waits for the rest of
// its line. One longer than the output shows goes out as it is, so a script
// that prints without ever ending a line holds no more than that. Python on
// Windows ends its lines with \r\n.
let partial = '';
function printed(chunk) {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop();
    if (partial.length > OUTPUT_CHARS) {
        lines.push(partial);
        partial = '';
    }
    if (lines.length) output.print(lines.map(line => line.replace(/\r$/, '')).join('\n'));
}

let session = null;
let end = null;

// A line from Python: a request for the server, or the script's { end }.
function received(line) {
    let message = null;
    try { message = parse(line); } catch (_) { /* the server answers it as no request */ }
    if (message && typeof message === 'object' && 'end' in message) end = message.end;
    else session?.receive(line);
}

function answerOf(ended) {
    if (ended.invalid) return { invalid: ended.invalid };
    return ended.design ? changedDesign(ended.design, before) : {};
}

function exited() {
    if (partial) output.print(partial);
    output.flush();
    session?.stopAll();
    if (end && 'error' in end) parentPort.postMessage({ type: 'error', text: end.error, line: end.line ?? null });
    else if (end) parentPort.postMessage({ type: 'done', ...answerOf(end) });
    else parentPort.postMessage({ type: 'error', text: null });
}

parentPort.on('message', (message) => {
    if (message.type === 'printed') printed(message.text);
    else if (message.type === 'wire') received(message.line);
    else if (message.type === 'exited') exited();
});

async function main() {
    wire({ text, fileName, filePath, design });
    const started = await api.init(environment);
    session = createSession({ api, app: liveCalls(null).calls, send: wire });
    wire(helloMessage({ version, started, live: false, calls: session.calls }));
}

main().catch(error => parentPort.postMessage({ type: 'error', text: error?.stack || String(error) }));
