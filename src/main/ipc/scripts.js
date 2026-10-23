// IPC: the Script Console.
//   scripts:run(runId, { text, fileName, filePath, design, language })  runs a
//       script, in JavaScript on a thread of its own, or with language
//       'python' in the user's Python (scriptRuns.js), and resolves to its
//       answer; what it prints arrives meanwhile on scripts:output as (runId,
//       lines, dropped), `dropped` being how many older lines a batch left out
//   scripts:stop(runId)  ends a run at once; that run's scripts:run then
//       answers { state: 'stopped' }
//   scripts:open  open dialog for a .js or .py file, whose text it returns;
//       opening never runs anything
//   scripts:save(text, suggestedName, language)  save dialog for the
//       language's files, then the text as UTF-8
//   scripts:find-python(setPath)  the Python a Python script would run in
//       (pythonLaunch.js findPython), for the path given, or with none given
//       for the one set in Preferences > Automation
//   scripts:choose-python  open dialog for a Python executable: { path } or
//       { canceled }
//
// A script runs with the rights of the app, so a run is started only for the
// app's own page: a page that came from anywhere else gets { state:
// 'refused' }. Looking for a Python runs the program looked at, so that too is
// done only for the app's own page; any other is answered as if none were
// found, and nothing runs. Every run a page started is stopped when the page
// is closed or loads again, since nothing would be left to take its answer.
//
// CommonJS, Electron-free (deps via ctx).

const { fileURLToPath } = require('url');
const { saveTextFile } = require('./saveTextFile');
const { createScriptRuns, scriptWorkerFile } = require('../scriptRuns');
const { findPython, packageHome, pythonLaunch } = require('../pythonLaunch');

// The files of each language, as the save dialog filters them.
const SCRIPT_FILES = {
  javascript: { name: 'JavaScript', extensions: ['js'] },
  python: { name: 'Python', extensions: ['py'] },
};

function register(ipcMain, ctx) {
  const runs = createScriptRuns({
    workerFile: scriptWorkerFile(ctx), pythonWorkerFile: scriptWorkerFile(ctx, 'pythonWorker.js'), log: ctx.log,
  });
  const watched = new WeakSet();
  ipcMain.handle('scripts:run', async (event, runId, request) => handleRun(ctx, { runs, watched }, event, runId, request));
  ipcMain.handle('scripts:stop', async (event, runId) => runs.stop(runId));
  ipcMain.handle('scripts:open', async () => handleOpen(ctx));
  ipcMain.handle('scripts:save', async (event, text, suggestedName, language) => saveTextFile(ctx, 'scripts:save', text, {
    title: 'Save Script',
    defaultPath: suggestedName || 'script.js',
    filters: [SCRIPT_FILES[language] || SCRIPT_FILES.javascript],
  }));
  ipcMain.handle('scripts:find-python', async (event, setPath) => handleFindPython(ctx, event, setPath));
  ipcMain.handle('scripts:choose-python', async () => handleChoosePython(ctx));
}

// The Python path set in Preferences > Automation, which the renderer keeps
// in settings.json; '' for none.
function savedPythonPath(ctx) {
  const settings = ctx.settingsPath ? ctx.readJsonSafe(ctx.settingsPath) : null;
  return typeof settings?.pythonPath === 'string' ? settings.pythonPath : '';
}

// Whether the call came from the page the app loads, index.html on disk,
// rather than from anything a window might have been navigated to.
function fromAppPage(ctx, event) {
  const url = event.senderFrame?.url || '';
  if (!url.startsWith('file:')) return false;
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return same(ctx.path.resolve(fileURLToPath(url)), ctx.path.resolve(ctx.appIndexFile));
}

// Whether `channel` is answered for the page that called it, the app's page
// alone; a call from any other is written to the log.
function allowedFor(ctx, event, channel) {
  if (fromAppPage(ctx, event)) return true;
  ctx.log(`${channel} refused for ${event.senderFrame?.url || 'a page with no address'}`);
  return false;
}

function watchSender(sender, { runs, watched }) {
  if (watched.has(sender)) return;
  watched.add(sender);
  sender.on('destroyed', () => runs.stopOwner(sender));
  sender.on('did-start-navigation', (details, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) runs.stopOwner(sender);
  });
}

function handleFindPython(ctx, event, setPath) {
  if (!allowedFor(ctx, event, 'scripts:find-python')) return { missing: { reason: 'none' } };
  return findPython({ setPath: setPath ?? savedPythonPath(ctx) });
}

// How the run's Python starts, or the answer of a run that does not start: a
// saved script whose folder, which it runs in, is gone, or no Python to run in.
async function launchFor(ctx, filePath) {
  const folder = filePath ? ctx.path.dirname(filePath) : null;
  if (folder && !ctx.fs.existsSync(folder)) return { state: 'noFolder', folder };
  const python = await findPython({ setPath: savedPythonPath(ctx) });
  if (python.missing) return { state: 'noPython', missing: python.missing };
  return pythonLaunch({ found: python.found, filePath, dataDir: ctx.userDocsDir, packageHome: packageHome(ctx) });
}

function handleRun(ctx, state, event, runId, request) {
  if (!allowedFor(ctx, event, 'scripts:run')) return { state: 'refused' };
  const { sender } = event;
  watchSender(sender, state);
  const workerData = {
    environment: {
      dataDir: ctx.userDocsDir,
      wasmPath: ctx.isPackaged ? ctx.path.join(ctx.resourcesDir, 'tmm_kernel.wasm') : null,
    },
    text: String(request?.text ?? ''),
    fileName: request?.fileName || 'script.js',
    filePath: request?.filePath || null,
    design: request?.design ?? null,
  };
  const onOutput = (lines, dropped) => {
    if (!sender.isDestroyed()) sender.send('scripts:output', runId, lines, dropped);
  };
  if (request?.language !== 'python') return state.runs.start(runId, sender, workerData, onOutput);
  const version = ctx.app?.getVersion?.() ?? null;
  return state.runs.startPython(runId, sender, { ...workerData, version }, () => launchFor(ctx, workerData.filePath), onOutput);
}

async function handleOpen(ctx) {
  const { dialog, getMainWindow, path, log, readTextAuto } = ctx;
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Open Script',
      filters: [
        { name: 'Scripts', extensions: ['js', 'py'] }, SCRIPT_FILES.javascript, SCRIPT_FILES.python,
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const filePath = result.filePaths[0];
    return { success: true, text: readTextAuto(filePath), fileName: path.basename(filePath), filePath };
  } catch (err) {
    log(`scripts:open error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function handleChoosePython(ctx) {
  const { dialog, getMainWindow, log } = ctx;
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Python',
      filters: process.platform === 'win32' ? [{ name: 'Python', extensions: ['exe'] }] : [],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { path: result.filePaths[0] };
  } catch (err) {
    log(`scripts:choose-python error: ${err.message}`);
    return { canceled: true };
  }
}

module.exports = { register };
