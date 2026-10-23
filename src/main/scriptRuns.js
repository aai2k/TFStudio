/**
 * Script Console runs, each on a worker thread of the main process, so a
 * script that computes for minutes keeps neither the window nor the main
 * process from answering, and Stop ends it at once by ending its thread.
 *
 * A JavaScript script runs on the thread itself (src/scripts/scriptWorker.js).
 * A Python script runs in a Python process (pythonLaunch.js says which and
 * how), and its thread (src/scripts/pythonWorker.js) is the API server that
 * process works through: the lines between the two go through here, and Stop
 * ends the process with the thread.
 *
 * A run resolves to one answer:
 *   { state: 'done', design?, invalid? }  the script returned; `design` is what
 *        it left in tf.design when it changed it, `invalid` why that is not a
 *        design
 *   { state: 'failed', error, line }  the script threw (`error` is the text the
 *        output shows, `line` the script's line it names or null), or its
 *        thread or its Python ended without an answer (`error` null)
 *   { state: 'stopped' }  Stop, or the page that started it went away
 *   { state: 'noPython', missing }  a Python run found no Python to run in
 *        (pythonLaunch.js findPython says what `missing` holds)
 *   { state: 'noFolder', folder }  a Python run of a saved script whose
 *        folder, which the script runs in, is gone
 *
 * What the thread writes to its own stdout and stderr, the engine's reports
 * among it, goes to the app log, never to the script's output.
 *
 * CommonJS, Electron-free, like the rest of the main process.
 */
const path = require('path');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const { Worker } = require('worker_threads');

/**
 * A thread's file: the bundle an installed app carries outside its asar
 * archive (tools/scriptBundle.mjs, built into build/app/scripts/), the ES
 * module in src/scripts/ in a source checkout. `name` is scriptWorker.js, a
 * JavaScript run's thread, or pythonWorker.js, a Python run's.
 */
function scriptWorkerFile({ isPackaged, resourcesDir, srcDir }, name = 'scriptWorker.js') {
  return isPackaged
    ? path.join(resourcesDir, 'app.asar.unpacked', 'build', 'app', 'scripts', name)
    : path.join(srcDir, 'scripts', name);
}

function onMessage(end, message, onOutput) {
  if (message.type === 'output') onOutput(message.lines, message.dropped);
  else if (message.type === 'done') end({ state: 'done', design: message.design, invalid: message.invalid });
  else if (message.type === 'error') end({ state: 'failed', error: message.text, line: message.line ?? null });
}

/**
 * The runs of one process. `workerFile` and `pythonWorkerFile` are the two
 * threads' files (scriptWorkerFile), and `log(line)` writes the app log. Each
 * run belongs to an `owner`, the page that started it, so all of a page's
 * runs can be stopped together.
 */
function createScriptRuns({ workerFile, pythonWorkerFile, log }) {
  const runs = new Map();

  function end(runId, answer) {
    const run = runs.get(runId);
    if (!run) return;
    runs.delete(runId);
    run.worker?.terminate();
    run.python?.kill();
    run.resolve(answer);
  }

  // The thread of `run`, started on `file`. Once the run has its answer
  // nothing more of it is handed on: a batch the thread posted just before
  // Stop ended it still reaches this side, and would show under the line that
  // says the run was stopped.
  function startThread(runId, run, file, workerData, onOutput) {
    const worker = new Worker(file, { workerData, stdout: true, stderr: true });
    run.worker = worker;
    const toLog = chunk => log(`[script] ${String(chunk).trimEnd()}`);
    worker.stdout.on('data', toLog);
    worker.stderr.on('data', toLog);
    worker.on('message', (message) => {
      if (!runs.has(runId)) return;
      if (message.type === 'wire') run.python.stdin.write(`${message.line}\n`);
      else onMessage(answer => end(runId, answer), message, onOutput);
    });
    worker.on('error', err => end(runId, { state: 'failed', error: err?.stack || String(err) }));
    worker.on('exit', () => end(runId, { state: 'failed', error: null }));
  }

  // The Python of `run`, started as `launch` says, with its lines carried to
  // and from the run's thread (pythonWorker.js says which).
  function startPython(runId, run, launch) {
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, windowsHide: true });
    run.python = child;
    const tell = (message) => { if (runs.has(runId)) run.worker.postMessage(message); };
    child.on('error', err => end(runId, { state: 'failed', error: `${launch.command}: ${err.message}` }));
    // A write after Python has ended fails; its close ends the run.
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => tell({ type: 'wire', line }));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => tell({ type: 'printed', text }));
    child.on('close', () => tell({ type: 'exited' }));
  }

  /**
   * Starts `runId` with `workerData` ({ environment, text, fileName, filePath,
   * design }, as scriptWorker.js reads it), handing each batch of printed
   * lines to `onOutput(lines, dropped)`, `dropped` being how many older lines
   * the batch left out (src/scripts/outputBounds.js). Resolves to the run's
   * answer.
   */
  function start(runId, owner, workerData, onOutput) {
    return new Promise((resolve) => {
      const run = { owner, resolve };
      runs.set(runId, run);
      startThread(runId, run, workerFile, workerData, onOutput);
    });
  }

  /**
   * Starts `runId` as a Python run: `workerData` as start() takes it, with
   * the app's `version` for the server's hello, and `findLaunch()` resolving
   * to how Python starts ({ command, args, cwd, env }) or to the answer of a
   * run that does not start, noPython or noFolder. The run is on from the
   * call, so a Stop while Python is looked for ends it.
   */
  function startPythonRun(runId, owner, workerData, findLaunch, onOutput) {
    return new Promise((resolve) => {
      const run = { owner, resolve };
      runs.set(runId, run);
      findLaunch().then((launch) => {
        if (runs.get(runId) !== run) return;
        if (launch.state) {
          end(runId, launch);
          return;
        }
        startThread(runId, run, pythonWorkerFile, workerData, onOutput);
        startPython(runId, run, launch);
      }).catch(err => end(runId, { state: 'failed', error: err?.message || String(err) }));
    });
  }

  return {
    start,
    startPython: startPythonRun,
    stop: runId => end(runId, { state: 'stopped' }),
    stopOwner(owner) {
      for (const [runId, run] of runs) if (run.owner === owner) end(runId, { state: 'stopped' });
    },
  };
}

module.exports = { scriptWorkerFile, createScriptRuns };
