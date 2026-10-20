// IPC: the Script Console.
//   scripts:run(runId, { text, fileName, filePath, design })  runs a script on
//       a thread of its own (scriptRuns.js) and resolves to its answer; what
//       it prints arrives meanwhile on scripts:output as (runId, lines,
//       dropped), `dropped` being how many older lines a batch left out
//   scripts:stop(runId)  ends a run at once; that run's scripts:run then
//       answers { state: 'stopped' }
//   scripts:open  open dialog for a .js file, whose text it returns; opening
//       never runs anything
//   scripts:save(text, suggestedName)  save dialog, then the text as UTF-8
//
// A script runs with the rights of the app, so a run is started only for the
// app's own page: a page that came from anywhere else gets { state:
// 'refused' }. Every run a page started is stopped when the page is closed or
// loads again, since nothing would be left to take its answer.
//
// CommonJS, Electron-free (deps via ctx).

const { fileURLToPath } = require('url');
const { saveTextFile } = require('./saveTextFile');
const { createScriptRuns, scriptWorkerFile } = require('../scriptRuns');

function register(ipcMain, ctx) {
  const runs = createScriptRuns({ workerFile: scriptWorkerFile(ctx), log: ctx.log });
  const watched = new WeakSet();
  ipcMain.handle('scripts:run', async (event, runId, request) => handleRun(ctx, { runs, watched }, event, runId, request));
  ipcMain.handle('scripts:stop', async (event, runId) => runs.stop(runId));
  ipcMain.handle('scripts:open', async () => handleOpen(ctx));
  ipcMain.handle('scripts:save', async (event, text, suggestedName) => saveTextFile(ctx, 'scripts:save', text, {
    title: 'Save Script',
    defaultPath: suggestedName || 'script.js',
    filters: [{ name: 'JavaScript', extensions: ['js'] }],
  }));
}

// Whether the call came from the page the app loads, index.html on disk,
// rather than from anything a window might have been navigated to.
function fromAppPage(ctx, event) {
  const url = event.senderFrame?.url || '';
  if (!url.startsWith('file:')) return false;
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return same(ctx.path.resolve(fileURLToPath(url)), ctx.path.resolve(ctx.appIndexFile));
}

function watchSender(sender, { runs, watched }) {
  if (watched.has(sender)) return;
  watched.add(sender);
  sender.on('destroyed', () => runs.stopOwner(sender));
  sender.on('did-start-navigation', (details, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) runs.stopOwner(sender);
  });
}

function handleRun(ctx, state, event, runId, request) {
  if (!fromAppPage(ctx, event)) {
    ctx.log(`scripts:run refused for ${event.senderFrame?.url || 'a page with no address'}`);
    return { state: 'refused' };
  }
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
  return state.runs.start(runId, sender, workerData, (lines, dropped) => {
    if (!sender.isDestroyed()) sender.send('scripts:output', runId, lines, dropped);
  });
}

async function handleOpen(ctx) {
  const { dialog, getMainWindow, path, log, readTextAuto } = ctx;
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Open Script',
      filters: [{ name: 'JavaScript', extensions: ['js'] }, { name: 'All Files', extensions: ['*'] }],
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

module.exports = { register };
