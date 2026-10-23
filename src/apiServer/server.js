/**
 * TFStudio's API server: the headless API (src/api/) over stdin and stdout,
 * for programs in other languages, such as Python's tfstudio package. The
 * calls keep the API's names, arguments and answers, so the API Reference
 * serves them as it is.
 *
 *   node src/apiServer/server.js [--data <folder>] [--live <file>] [--program <name>]
 *   TFStudio.exe --api [--data <folder>] [--live] [--program <name>]  (src/main/serverEntry.js)
 *
 * --data names a TFStudio data folder (the one holding Materials), whose
 * catalogs the calls then use as the app does; TFStudio.exe takes the app's
 * own without it. Without either, the built-in catalog and the materials a
 * design carries resolve.
 *
 * --live names the live link file the open app writes (src/main/
 * liveProtocol.js), and the app.* calls then reach the app's designs.
 * --program names the program the server serves, python.exe for the Python
 * package, which the app shows its user while that program works on the
 * open design.
 *
 * The messages, one JSON value per line in UTF-8 each way (wire.js: NaN,
 * Infinity and -Infinity travel as bare tokens, typed arrays as lists):
 *
 *   first line   <- { hello: 'tfstudio-api', protocol, version, wasm, dataDir,
 *                     unreadable, live, calls }
 *                   wasm, dataDir and unreadable are what the API's init
 *                   answered, live whether app.* reach an app, calls the
 *                   API's calls by name. When init fails:
 *                   { hello: 'tfstudio-api', protocol, error: { message } },
 *                   and the server exits with 1.
 *   request      -> { id, call, args, hooks, stopped }
 *                   id a string or a whole number, which the answer carries;
 *                   call an API call's name or app.designs, app.read,
 *                   app.apply; args the list of its arguments, empty when
 *                   left out. Only a run (calls.js RUNS) takes hooks: the
 *                   names of the hooks to stream, its third argument made of
 *                   them and of the server's own signal, so it takes at most
 *                   two args. Only a run takes stopped: true starts it
 *                   stopped, for a client told to stop it before it asked.
 *   answer       <- { id, result } or { id, error: { message, code, fields } }
 *                   message is the API's own refusal, in its own names. code
 *                   is there on an app.* refusal (liveLink.js), and on an API
 *                   refusal a client's objects word in their own names, which
 *                   carries fields too: what it was worded from
 *                   (src/api/check.js refusal lists them). A line that is no
 *                   request is answered with id null when it carries none.
 *   progress     <- { id, progress: { hook, args } }
 *                   a named hook the run called, with its arguments, before
 *                   the run's answer (hooks.js).
 *   stop         -> { stop: id }
 *                   stops the run of that id; it then answers as stopped.
 *                   A stop of anything else is passed over.
 *
 * The server ends when stdin closes, after stopping a run that is going.
 */
import fs from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { format } from 'node:util';
import { pathToFileURL } from 'node:url';
import { failedHello, helloMessage } from './hello.js';

const log = text => process.stderr.write(`[tfstudio-api] ${text}\n`);

/**
 * Serves the API on this process's stdin and stdout until stdin closes.
 * `dataDir` is the TFStudio data folder or null, `version` the version the
 * hello reports, `wasmPath` the WASM kernel's file when it is not the tmmcore
 * package's, `live` { file, program } the live link file and the program's
 * name when the server is linked to the open app.
 */
export async function serve({ dataDir = null, version, wasmPath, live = null } = {}) {
    // stdout carries the messages alone; whatever the computation prints goes
    // to stderr, the server's log.
    for (const level of ['log', 'info', 'warn', 'debug']) {
        console[level] = (...args) => process.stderr.write(`${format(...args)}\n`);
    }
    const api = await import('../api/index.js');
    const { encode } = await import('./wire.js');
    const { createSession } = await import('./calls.js');
    const { liveCalls } = await import('./live.js');
    const send = message => process.stdout.write(`${encode(message)}\n`);

    let started;
    try {
        started = await api.init({ dataDir, wasmPath });
    } catch (err) {
        process.stdout.write(`${encode(failedHello(err?.message || String(err)))}\n`, () => process.exit(1));
        return;
    }
    log(`started: WASM ${started.wasm}, data folder ${dataDir ?? 'none'}${live ? `, live link file ${live.file}` : ''}`);
    for (const file of started.unreadable) log(`catalog left out, could not be read: ${JSON.stringify(file)}`);

    const app = liveCalls(live);
    const session = createSession({ api, app: app.calls, send });
    send(helloMessage({ version, started, live: !!live, calls: session.calls }));

    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    input.on('line', line => session.receive(line));
    input.on('close', () => {
        session.stopAll();
        app.close();
        // The process ends once its event loop drains: a stopped run answers
        // at its next step, in milliseconds. Two seconds leaves room on a
        // loaded machine, and a step still computing after that does not keep
        // a client waiting on a server it has closed.
        setTimeout(() => process.exit(0), 2000).unref();
    });
}

function parseArgs(argv) {
    let dataDir = null, file = null, program = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--data' && argv[i + 1]) dataDir = argv[++i];
        else if (argv[i] === '--live' && argv[i + 1]) file = argv[++i];
        else if (argv[i] === '--program' && argv[i + 1]) program = argv[++i];
        else throw new Error(`unknown argument '${argv[i]}'. Usage: server.js [--data <folder>] [--live <file>] [--program <name>]`);
    }
    return { dataDir, live: file ? { file, program } : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    Promise.resolve()
        .then(() => serve({ ...parseArgs(process.argv.slice(2)), version }))
        .catch(err => {
            log(err?.message || String(err));
            process.exit(1);
        });
}
