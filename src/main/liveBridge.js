// The app's end of the live link (liveProtocol.js): the pipe an MCP server
// started with --mcp --live connects to, open while "Let AI agents work on the
// open design" is on in Preferences > Automation.
//
// Who can reach it. On Windows it is a named pipe under a random name, made
// with the default security: full access for the user running the app,
// administrators and the system, read access only for everyone else, so no
// other user can send a request or answer in the app's place by making an
// instance of the pipe. It is never made writable for all. Elsewhere it is a
// Unix socket, 0600, in a folder of its own, 0700. On top of that a connection
// is served only after it proves it holds the secret the live link file holds.
//
// Each request is checked here, then handed to `forward(method, params)`,
// which asks the window (ipc/liveBridge.js) and resolves to the answer,
// { result } or { error: { code, message } }.
//
// CommonJS, Electron-free.
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./paths');
const { validateDesign } = require('./designFile');
const { PROTOCOL, lineReader, proof } = require('./liveProtocol');

const METHODS = ['designs', 'read', 'apply'];

// Why a request cannot be handed to the window, or null when it can. The
// design an apply carries gets the checks a design file gets when it opens.
function requestProblem(message) {
  if (!message || typeof message !== 'object' || !METHODS.includes(message.method)) {
    return `the method is one of ${METHODS.join(', ')}`;
  }
  const params = message.params || {};
  if (params.appDesignId !== undefined && typeof params.appDesignId !== 'string') return 'appDesignId is a string';
  if (message.method !== 'apply') return null;
  if (typeof params.appDesignId !== 'string' || typeof params.revision !== 'string') {
    return 'an apply names the design (appDesignId) and the revision it was read at';
  }
  return validateDesign(params.design);
}

// Where the pipe goes: a name no one can guess on Windows, a socket in a fresh
// private folder elsewhere.
function newAddress() {
  const name = crypto.randomBytes(16).toString('hex');
  if (process.platform === 'win32') return { address: `\\\\.\\pipe\\tfstudio-live-${name}`, folder: null };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tfstudio-live-'));
  return { address: path.join(folder, 'pipe'), folder };
}

// The live link file goes only while it still names this pipe.
function removeLinkFile(file, address) {
  try {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).pipe === address) fs.unlinkSync(file);
  } catch (_) { /* no file, or not one this app wrote: nothing to remove */ }
}

// The message a line holds, or null for a line that is not JSON.
function parsed(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

// Why a connection's first message is not the hello it must be, or null.
function helloRefusal(message, secret) {
  if (message?.hello !== PROTOCOL) return { code: 'protocol', message: `this app speaks live link protocol ${PROTOCOL}` };
  if (message.proof !== proof(secret, message.nonce, 'agent')) return { code: 'secret', message: 'wrong secret' };
  return null;
}

// A request after the hello: refused here when it is not one the window
// answers, handed to the window otherwise, and answered under its id.
function answerRequest(message, send, forward) {
  const problem = message === null ? 'each line is one JSON message' : requestProblem(message);
  if (problem) send({ id: message?.id ?? null, error: { code: 'invalid', message: problem } });
  else forward(message.method, message.params || {}).then(answer => send({ id: message.id, ...answer }));
}

// One connection: the hello that proves the secret first, answered with the
// app's version and its own proof or hung up on, then requests.
function serveConnection(socket, { secret, version, forward, log }) {
  let greeted = false;
  const send = message => {
    if (!socket.destroyed && !socket.writableEnded) socket.write(`${JSON.stringify(message)}\n`);
  };
  const greet = message => {
    const refusal = helloRefusal(message, secret);
    if (!refusal) {
      send({ hello: PROTOCOL, version, proof: proof(secret, message.nonce, 'app') });
      greeted = true;
      return;
    }
    if (refusal.code === 'secret') log('live link: a connection without the secret was turned away');
    send({ error: refusal });
    socket.end();
  };
  socket.setEncoding('utf8');
  // A client gone mid-write leaves nothing to answer.
  socket.on('error', () => {});
  socket.on('data', lineReader(line => {
    if (socket.writableEnded) return;
    if (greeted) answerRequest(parsed(line), send, forward);
    else greet(parsed(line));
  }, () => socket.destroy()));
}

// One opening of the pipe. `ready` resolves to { open: true } once it listens
// and the live link file names it, or to { open: false, error } when it could
// not open, or to { open: false } when it was closed first.
function openPipe({ file, log, version, forward }) {
  const { address, folder } = newAddress();
  const secret = crypto.randomBytes(32).toString('hex');
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    serveConnection(socket, { secret, version, forward, log });
  });
  let settle;
  const ready = new Promise(resolve => { settle = resolve; });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    server.close();
    for (const socket of sockets) socket.destroy();
    removeLinkFile(file, address);
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    settle({ open: false });
  };
  const fail = err => {
    log(`live link: could not open: ${err.message}`);
    settle({ open: false, error: err.message });
    close();
  };
  server.on('error', fail);
  server.listen(address, () => {
    try {
      if (folder) fs.chmodSync(address, 0o600);
      writeFileAtomic(file, JSON.stringify({ pipe: address, secret }), { encoding: 'utf8', mode: 0o600 });
      log(`live link: open on ${address}`);
      settle({ open: true });
    } catch (err) {
      fail(err);
    }
  });
  return { ready, close };
}

/**
 * The live link's pipe, written to the live link file `file` while open.
 * `version` is the app's, sent in the hello; `forward` as above; `log(text)`
 * writes to the app's log. open() resolves to { open, error } as the switch's
 * row shows it, and close() ends every connection at once and removes the
 * file.
 */
function createLiveBridge({ file, log, version, forward }) {
  let pipe = null;
  return {
    open() {
      if (!pipe) {
        const opening = openPipe({ file, log, version, forward });
        pipe = opening;
        opening.ready.then(status => { if (!status.open && pipe === opening) pipe = null; });
      }
      return pipe.ready;
    },
    close() {
      pipe?.close();
      pipe = null;
    },
  };
}

module.exports = { createLiveBridge };
