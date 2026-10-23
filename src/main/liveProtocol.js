// The live link between the open app and a server started with --live, the
// MCP server (TFStudio --mcp --live) or the API server (TFStudio --api --live):
// what both ends agree on. While the app listens for programs, it listens on
// a local pipe, a named pipe on Windows and a Unix socket elsewhere, and
// writes where it is, with a secret,
// to the live link file in its data folder; the server reads that file and
// connects. In the hello each end proves it holds the secret without
// sending it. The app must prove it too: a file a crash left behind names a
// pipe that any program can open in the app's place.
//
// Each message is one line of JSON:
//   hello     -> { hello: PROTOCOL, nonce, proof: proof(secret, nonce, 'agent'), program }
//                `program` the name the app shows for the program, or null
//             <- { asking: true, proof: proof(secret, nonce, 'app') }
//                first, when the app asks its user whether to let the program
//                in; the answer below then comes once the user answers
//             <- { hello: PROTOCOL, version, proof: proof(secret, nonce, 'app') }
//                or { error }, and the app hangs up; error code 'denied' when
//                the user did not let the program in, 'off' when Terminate
//                let it go earlier in the app's run
//   request   -> { id, method, params }, method 'designs', 'read' or 'apply'
//             <- { id, result } or { id, error: { code, message } }
//
// CommonJS, Electron-free: the main process requires it, and the servers'
// end of the link (src/mcp/liveLink.js) imports it.
const crypto = require('crypto');

// Raised when the messages change shape, so a server from another build is
// turned away at the hello rather than misread.
const PROTOCOL = 1;

// The live link file, in the app's own data folder (userData).
const LINK_FILE = 'live-bridge.json';

// The longest line either end takes, in characters. A line carries one design,
// and a design of thousands of layers with its materials embedded is a few
// megabytes, so a longer line is not a design; dropping the connection then
// bounds what one connection can make the other end hold.
const MAX_LINE = 32 * 1024 * 1024;

/**
 * The proof that one end of a connection holds `secret`: an HMAC-SHA256, under
 * the secret, of the `nonce` the server drew for this connection. `side`
 * is the end that proves it, 'agent' or 'app', so the two proofs differ and
 * neither end can hand back the other's as its own.
 */
function proof(secret, nonce, side) {
  return crypto.createHmac('sha256', String(secret)).update(`${side}:${nonce}`).digest('hex');
}

/**
 * A reader of newline-ended lines from a text stream: feed it each chunk, and
 * `onLine(line)` is called for every whole line. A line that grows past
 * MAX_LINE without ending calls `onTooLong()` instead, and what it held is
 * dropped.
 */
function lineReader(onLine, onTooLong) {
  let parts = [];
  let size = 0;
  return chunk => {
    let start = 0;
    let at;
    while ((at = chunk.indexOf('\n', start)) >= 0) {
      parts.push(chunk.slice(start, at));
      const line = parts.join('');
      parts = [];
      size = 0;
      start = at + 1;
      onLine(line);
    }
    if (start < chunk.length) {
      parts.push(chunk.slice(start));
      size += chunk.length - start;
    }
    if (size > MAX_LINE) {
      parts = [];
      size = 0;
      onTooLong();
    }
  };
}

module.exports = { PROTOCOL, LINK_FILE, MAX_LINE, lineReader, proof };
