// IPC: the live link that lets a program, a Python program or an AI agent,
// work on the open design (liveBridge.js has the pipe, liveProtocol.js the
// messages). The app listens for programs, with the pipe open, while either
// of these is on:
//   Interactive, the button on the Optimization tab, from its click until
//       Terminate. Every program that proves the secret comes in.
//   "Start listening when TFStudio starts" in Preferences > Automation. A
//       program comes in once the user lets it: each program is asked about
//       once for as long as the app runs, and the answer stands after that
//       until Terminate, below.
// While Interactive is on or a program is in, the window holds the rest of
// the app (components/live/LiveDialogs.js).
//
// Terminate gives the app back for the rest of the run: a program it lets go
// is turned away from then on with no question and the code 'off', the one it
// gets when Terminate closes the pipe, until Interactive lets it in again.
// Otherwise, with the switch on, a program the user allowed would come back
// on its next call and hold the app again, and the hold covers Preferences,
// where the switch is turned off.
//
//   live:set(on)           the switch; resolves to { open, error } for its row
//   live:interactive       Interactive; resolves to { open, error }
//   live:terminate         Terminate: the programs in are let go, Interactive
//       ends, and the pipe closes unless the switch keeps it open
//   live:state             main to the window: { interactive, programs }, the
//       programs in by name, one per connection, null for one that gave none;
//       sent each time either changes
//   live:ask               main to the window: { id, program }, a program that
//       asks to come in while the switch listens, which the window answers with
//   live:answer(id, allowed)
//   live:request           main to the window: { id, method, params, deadline },
//       a request from a program, which the window answers with
//   live:reply(id, answer) { result } or { error: { code, message } }
// `deadline` is the time, as Date.now() gives it, after which main has
// answered the program itself that the window did not answer.
//
// Only the app's main window turns the link on and answers it: the designs
// live in its React tree. When that window closes, loads again or its page
// crashes, the pipe closes, Interactive ends, a question the user has not
// answered counts as Deny, and the requests the window had not answered are
// answered 'off'; the page that loads next opens the pipe again once it has
// read its settings. Main never reads the switch itself, so the pipe is open
// only while a window is there to answer.
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
const NOT_MAIN = { open: false, error: 'only the main window turns the link on' };
const LET_GO = { code: 'off', message: 'Terminate let this program go; Interactive lets it in again' };

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

// The user's answers to the programs that asked to come in while the switch
// listened, by program name, kept for as long as the app runs, and LET_GO for
// a program Terminate let go. A program that gives no name cannot be told from
// another, so it is asked about each time. Two connections of one program wait
// on one question. `contents()` is the window that asks.
function createAdmission(contents) {
  const answers = new Map();
  const pending = new Map();
  let lastId = 0;
  return {
    // As createLiveBridge's admit takes it.
    admit(program, asking) {
      if (answers.has(program)) return answers.get(program);
      const target = contents();
      if (!target) return false;
      asking();
      const open = program !== null && [...pending.values()].find(ask => ask.program === program);
      if (open) return open.answer;
      const id = ++lastId;
      const ask = { program };
      ask.answer = new Promise(resolve => { ask.resolve = resolve; });
      pending.set(id, ask);
      target.send('live:ask', { id, program });
      return ask.answer;
    },
    answer(id, allowed) {
      const ask = pending.get(id);
      if (!ask) return;
      pending.delete(id);
      if (ask.program !== null) answers.set(ask.program, allowed === true);
      ask.resolve(allowed === true);
    },
    // Every question still open, answered Deny and not kept.
    withdraw() {
      for (const ask of pending.values()) ask.resolve(false);
      pending.clear();
    },
    // The programs Terminate lets go, by name.
    letGo(programs) {
      for (const program of programs) if (program !== null) answers.set(program, LET_GO);
    },
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

// The link as the switch and Interactive have it, answered by the window
// `contents()` returns: the pipe open while either is on, and the window told
// when Interactive or the programs in change.
function createLink(ctx, contents) {
  const requests = createRequests(contents);
  const admission = createAdmission(contents);
  const state = { listening: false, interactive: false, programs: [] };
  // Also called while the window goes away, when its page may be gone already.
  const report = () => {
    const target = contents();
    if (target && !target.isDestroyed?.()) target.send('live:state', { interactive: state.interactive, programs: state.programs });
  };
  const bridge = createLiveBridge({
    file: ctx.path.join(ctx.userDataPath, LINK_FILE), log: ctx.log, version: ctx.app.getVersion(), forward: requests.forward,
    admit: (program, asking) => state.interactive || admission.admit(program, asking),
    onPrograms: programs => { state.programs = programs; report(); },
  });
  const follow = () => {
    if (state.listening || state.interactive) return bridge.open();
    bridge.close();
    requests.settleAll(OFF);
    return { open: false };
  };
  return {
    requests, admission,
    listen(on) {
      state.listening = !!on;
      return follow();
    },
    async interactive() {
      const status = await bridge.open();
      if (status.open && !state.interactive) {
        state.interactive = true;
        report();
      }
      return status;
    },
    // Before the drop, which empties state.programs.
    terminate() {
      admission.letGo(state.programs);
      state.interactive = false;
      bridge.drop();
      follow();
      report();
    },
    stop() {
      state.listening = false;
      state.interactive = false;
      admission.withdraw();
      follow();
    },
  };
}

function register(ipcMain, ctx) {
  const mainContents = () => {
    const win = ctx.getMainWindow();
    return win && !win.isDestroyed() ? win.webContents : null;
  };
  const link = createLink(ctx, mainContents);
  const watched = new WeakSet();
  // Whether `event` comes from the main window, which the link then stops with.
  const fromMain = event => {
    const main = event.sender === mainContents();
    if (main && !watched.has(event.sender)) {
      watched.add(event.sender);
      stopWith(event.sender, link.stop);
    }
    return main;
  };

  ipcMain.handle('live:set', async (event, on) => (fromMain(event) ? link.listen(on) : NOT_MAIN));
  ipcMain.handle('live:interactive', async (event) => (fromMain(event) ? link.interactive() : NOT_MAIN));
  ipcMain.handle('live:terminate', async (event) => {
    if (fromMain(event)) link.terminate();
  });
  ipcMain.on('live:answer', (event, id, allowed) => {
    if (event.sender === mainContents()) link.admission.answer(id, allowed);
  });
  ipcMain.on('live:reply', (event, id, answer) => {
    if (event.sender === mainContents()) link.requests.settle(id, answer);
  });
}

module.exports = { register, ANSWER_TIMEOUT_MS };
