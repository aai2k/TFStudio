// IPC: the live link that lets an AI agent work on the open design
// (liveBridge.js has the pipe, liveProtocol.js the messages).
//   live:set(on)  opens or closes the pipe as the switch in Preferences >
//       Automation says, and resolves to { open, error } for that row
//   live:request  main to the window: { id, method, params, deadline }, a
//       request from the agent, which the window answers with
//   live:reply(id, answer)  { result } or { error: { code, message } }
// `deadline` is the time, as Date.now() gives it, after which main has
// answered the agent itself that the window did not answer.
//
// Only the app's main window turns the link on and answers it: the designs
// live in its React tree. The pipe closes when that window closes, loads again
// or its page crashes, and the requests it had not answered are answered
// 'off'; the page that loads next opens the pipe again once it has read its
// settings. Main never reads the switch itself, so the pipe is open only while
// a window is there to answer.
//
// CommonJS, Electron-free (deps via ctx).
const { createLiveBridge } = require('../liveBridge');
const { LINK_FILE } = require('../liveProtocol');

// The window answers from what it holds in memory, within milliseconds; this
// leaves room for one busy recomputing every open window after a large change,
// and stays under the 20 s the MCP server waits, so the agent hears why. Each
// request carries the end of this wait as its deadline, and the window writes
// no apply it handles after then: a message box the app shows holds requests
// back until it closes, and by then the agent has been told nothing happened.
const ANSWER_TIMEOUT_MS = 15000;

const OFF = { error: { code: 'off', message: 'the app window is gone or the link is off' } };
const NO_ANSWER = { error: { code: 'timeout', message: 'the app window did not answer' } };

// Requests handed to the window `contents()` returns, each settled by its
// reply, or by OFF with no window to ask, or by NO_ANSWER in time.
function createRequests(contents) {
  const pending = new Map();
  let lastId = 0;
  const settle = (id, answer) => {
    const resolve = pending.get(id);
    pending.delete(id);
    resolve?.(answer);
  };
  return {
    forward: (method, params) => new Promise(resolve => {
      const target = contents();
      if (!target) { resolve(OFF); return; }
      const id = ++lastId;
      const timer = setTimeout(() => settle(id, NO_ANSWER), ANSWER_TIMEOUT_MS);
      pending.set(id, answer => { clearTimeout(timer); resolve(answer); });
      target.send('live:request', { id, method, params, deadline: Date.now() + ANSWER_TIMEOUT_MS });
    }),
    settle,
    settleAll: answer => { for (const id of [...pending.keys()]) settle(id, answer); },
  };
}

// Calls `stop` when `contents` is destroyed, its page crashes, or it loads
// another page.
function stopWith(contents, stop) {
  contents.on('destroyed', stop);
  contents.on('render-process-gone', stop);
  contents.on('did-start-navigation', (details, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) stop();
  });
}

function register(ipcMain, ctx) {
  const mainContents = () => {
    const win = ctx.getMainWindow();
    return win && !win.isDestroyed() ? win.webContents : null;
  };
  const requests = createRequests(mainContents);
  const bridge = createLiveBridge({
    file: ctx.path.join(ctx.userDataPath, LINK_FILE), log: ctx.log, version: ctx.app.getVersion(), forward: requests.forward,
  });
  const stop = () => {
    bridge.close();
    requests.settleAll(OFF);
  };
  const watched = new WeakSet();

  ipcMain.handle('live:set', async (event, on) => {
    if (event.sender !== mainContents()) return { open: false, error: 'only the main window turns the link on' };
    if (!watched.has(event.sender)) {
      watched.add(event.sender);
      stopWith(event.sender, stop);
    }
    if (!on) stop();
    return on ? bridge.open() : { open: false };
  });
  ipcMain.on('live:reply', (event, id, answer) => {
    if (event.sender === mainContents()) requests.settle(id, answer);
  });
}

module.exports = { register, ANSWER_TIMEOUT_MS };
