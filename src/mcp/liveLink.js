// The servers' end of the live link (src/main/liveProtocol.js), the MCP
// server's and the API server's: it reads the live link file the open app
// writes while it listens for programs, connects to the pipe the file names,
// proves it holds the secret and names the program it serves, takes nothing
// from a server that cannot prove it too, and asks the app for its designs.
//
// A connection is kept while it works. After any failure the next request reads
// the file again and connects anew, so the link follows the app through a
// restart, or its listening being ended and started again.
//
// A request that fails rejects with an error whose `code` says why: 'off' (the
// app is not running, it is not listening, Terminate let this program go, the
// connection was lost, or what answered at the pipe does not hold the
// secret), 'timeout' (no answer in time), 'protocol' (the app speaks another
// version of the link), 'denied' (the app's user did not let the program in),
// or the code the app answered with. failureText() says each to the client.

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import liveProtocol from '../main/liveProtocol.js';

const { PROTOCOL, lineReader, proof } = liveProtocol;

// The app answers from memory, or says within 15 s that its window did not
// (src/main/ipc/liveBridge.js); this is that and room for a loaded machine.
const ANSWER_TIMEOUT_MS = 20000;

const failure = (code, message) => Object.assign(new Error(message), { code });
const OFF = () => failure('off', 'TFStudio is not running, or it is not listening for this program');
const NO_ANSWER = () => failure('timeout', 'TFStudio did not answer');
// A request whose write failed: the app hung up before it, so it never had
// the request, which can go again on a new connection.
const UNSENT = () => Object.assign(OFF(), { unsent: true });

// Why a hello was not answered as the app answers it.
function refused(message) {
    const code = message?.error?.code;
    return code === 'protocol' || code === 'denied' ? failure(code, message.error.message) : OFF();
}

// Calls `fail` unless the answer comes within ANSWER_TIMEOUT_MS; the returned
// function says it came.
function deadline(fail) {
    const timer = setTimeout(fail, ANSWER_TIMEOUT_MS);
    return () => clearTimeout(timer);
}

// A connection to the app the live link file `file` names, for the program
// named `program`, resolved once the app has taken its hello; `onEnd` is
// called once it is over. While the app asks its user whether to let the
// program in, the hello waits for as long as the user takes: the app has
// proved by then that it holds the secret, and it hangs up should it close.
function connect(file, program, onEnd) {
    let link;
    try { link = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return Promise.reject(OFF()); }
    return new Promise((resolve, reject) => {
        const socket = net.connect(link.pipe);
        const nonce = crypto.randomBytes(16).toString('hex');
        const appProof = proof(link.secret, nonce, 'app');
        const pending = new Map();
        let lastId = 0;
        let greeted = false;
        const connection = {
            version: null,
            ask: (method, params) => new Promise((answered, refused) => {
                const id = ++lastId;
                const arrived = deadline(() => { pending.delete(id); refused(NO_ANSWER()); });
                pending.set(id, message => {
                    arrived();
                    if (message.error) refused(failure(message.error.code, message.error.message));
                    else answered(message.result);
                });
                socket.write(`${JSON.stringify({ id, method, params })}\n`, err => {
                    if (!err || !pending.delete(id)) return;
                    arrived();
                    onEnd();
                    refused(UNSENT());
                });
            }),
            close: () => socket.destroy(),
        };
        const helloArrived = deadline(() => { reject(NO_ANSWER()); socket.destroy(); });
        const hello = message => {
            helloArrived();
            if (message?.asking === true && message.proof === appProof) return;
            if (message?.hello !== PROTOCOL || message.proof !== appProof) {
                reject(refused(message));
                socket.destroy();
                return;
            }
            greeted = true;
            connection.version = message.version ?? null;
            resolve(connection);
        };
        socket.setEncoding('utf8');
        socket.on('connect', () => socket.write(`${JSON.stringify({ hello: PROTOCOL, nonce, proof: proof(link.secret, nonce, 'agent'), program })}\n`));
        socket.on('data', lineReader(line => {
            let message = null;
            try { message = JSON.parse(line); } catch (_) { /* not a message: nothing waits on it */ }
            if (!greeted) hello(message);
            else pending.get(message?.id)?.(message);
        }, () => socket.destroy()));
        // Every failure ends in 'close', which answers what is still waiting.
        // The app hanging up ends the connection's use at once: 'close' comes
        // some turns of the event loop later, and a request sent in between
        // would go to an app that no longer reads it.
        socket.on('end', onEnd);
        socket.on('error', () => {});
        socket.on('close', () => {
            helloArrived();
            reject(OFF());
            for (const answer of pending.values()) answer({ error: { code: 'off' } });
            pending.clear();
            onEnd();
        });
    });
}

/**
 * The link to the app through the live link file `file`, for the program
 * `program()` names at each connection, which the app shows its user, or null
 * when it has no name. request(method, params) resolves to the app's result;
 * appVersion() is the version of the app last connected to; close() ends the
 * connection.
 */
export function createLiveLink(file, program = () => null) {
    let current = null;
    let version = null;
    const connection = () => {
        if (!current) {
            const opening = connect(file, program(), () => { if (current === opening) current = null; });
            opening.then(c => { version = c.version; }, () => { if (current === opening) current = null; });
            current = opening;
        }
        return current;
    };
    // A request the app hung up before goes once more, on a new connection.
    const request = async (method, params) => {
        try {
            return await (await connection()).ask(method, params);
        } catch (err) {
            if (!err.unsent) throw err;
            return (await connection()).ask(method, params);
        }
    };
    return {
        request: (method, params = {}) => request(method, params),
        appVersion: () => version,
        close: () => { current?.then(c => c.close(), () => {}); current = null; },
    };
}

/**
 * What a client is told when a request fails with `err`: the reason its code
 * stands for, or the app's own message for a code without one. `calls` names
 * the client's own calls that read a design from the app (`read`) and list the
 * app's designs (`list`), which the reasons point to.
 */
export function failureText(err, calls) {
    const said = {
        off: "TFStudio is not running, or it is not listening for this program. Click Interactive on TFStudio's Optimization tab, then call this again.",
        denied: "Deny was clicked in TFStudio when this program asked to work on the open design. Click Interactive on TFStudio's Optimization tab, which lets a program in without asking, then call this again.",
        timeout: 'TFStudio did not answer; it may be busy. Call this again.',
        protocol: 'The TFStudio that is open speaks another version of the live link. Start this server with the TFStudio of that install.',
        edited: `The design changed in TFStudio since it was read: an edit, an undo or a run there. Nothing was applied. Read it again with ${calls.read} and make the change on that copy.`,
        switched: 'The design it was read from is no longer the one open in TFStudio: another design or none is open, or it was closed. Nothing was applied; only the open design takes changes.',
        optimizing: 'A run is going in a TFStudio window. Nothing was applied; apply again once it ends.',
        noDesign: `No design is open in TFStudio. Open one there, or name one that ${calls.list} lists.`,
        unknown: `TFStudio holds no design under that appDesignId; ${calls.list} lists them.`,
    };
    return Object.hasOwn(said, err.code) ? said[err.code] : `TFStudio refused it: ${err.message}`;
}
