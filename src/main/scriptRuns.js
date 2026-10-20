/**
 * Script Console runs, each on a worker thread of the main process
 * (src/scripts/scriptWorker.js), so a script that computes for minutes keeps
 * neither the window nor the main process from answering, and Stop ends it at
 * once by ending its thread.
 *
 * A run resolves to one answer:
 *   { state: 'done', design?, invalid? }  the script returned; `design` is what
 *        it left in tf.design when it changed it, `invalid` why that is not a
 *        design
 *   { state: 'failed', error }  the script threw (`error` is the text the
 *        output shows), or its thread ended without an answer (`error` null)
 *   { state: 'stopped' }  Stop, or the page that started it went away
 *
 * What the thread writes to its own stdout and stderr, the engine's reports
 * among it, goes to the app log, never to the script's output.
 *
 * CommonJS, Electron-free, like the rest of the main process.
 */
const path = require('path');
const { Worker } = require('worker_threads');

/**
 * The thread's file: the bundle an installed app carries outside its asar
 * archive (tools/scriptBundle.mjs, built into build/app/scripts/), the ES
 * module in src/scripts/ in a source checkout.
 */
function scriptWorkerFile({ isPackaged, resourcesDir, srcDir }) {
  return isPackaged
    ? path.join(resourcesDir, 'app.asar.unpacked', 'build', 'app', 'scripts', 'scriptWorker.js')
    : path.join(srcDir, 'scripts', 'scriptWorker.js');
}

function onMessage(end, message, onOutput) {
  if (message.type === 'output') onOutput(message.lines, message.dropped);
  else if (message.type === 'done') end({ state: 'done', design: message.design, invalid: message.invalid });
  else if (message.type === 'error') end({ state: 'failed', error: message.text });
}

/**
 * The runs of one process. `log(line)` writes the app log. Each run belongs
 * to an `owner`, the page that started it, so all of a page's runs can be
 * stopped together.
 */
function createScriptRuns({ workerFile, log }) {
  const runs = new Map();

  function end(runId, answer) {
    const run = runs.get(runId);
    if (!run) return;
    runs.delete(runId);
    run.worker.terminate();
    run.resolve(answer);
  }

  /**
   * Starts `runId` with `workerData` ({ environment, text, fileName, filePath,
   * design }, as scriptWorker.js reads it), handing each batch of printed
   * lines to `onOutput(lines, dropped)`, `dropped` being how many older lines
   * the batch left out (src/scripts/outputBounds.js). Resolves to the run's
   * answer.
   *
   * Once a run has its answer nothing more of it is handed on: a batch the
   * thread posted just before Stop ended it still reaches this side, and
   * would show under the line that says the run was stopped.
   */
  function start(runId, owner, workerData, onOutput) {
    return new Promise((resolve) => {
      const worker = new Worker(workerFile, { workerData, stdout: true, stderr: true });
      runs.set(runId, { worker, owner, resolve });
      const toLog = chunk => log(`[script] ${String(chunk).trimEnd()}`);
      worker.stdout.on('data', toLog);
      worker.stderr.on('data', toLog);
      worker.on('message', (message) => {
        if (runs.has(runId)) onMessage(answer => end(runId, answer), message, onOutput);
      });
      worker.on('error', err => end(runId, { state: 'failed', error: err?.stack || String(err) }));
      worker.on('exit', () => end(runId, { state: 'failed', error: null }));
    });
  }

  return {
    start,
    stop: runId => end(runId, { state: 'stopped' }),
    stopOwner(owner) {
      for (const [runId, run] of runs) if (run.owner === owner) end(runId, { state: 'stopped' });
    },
  };
}

module.exports = { scriptWorkerFile, createScriptRuns };
