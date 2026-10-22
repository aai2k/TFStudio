// The MCP server's end of the live link (src/main/liveProtocol.js): it reads
// the live link file the open app writes while its switch is on, connects to
// the pipe the file names, proves it holds the secret, takes nothing from a
// server that cannot prove it too, and asks the app for its designs.
//
// A connection is kept while it works. After any failure the next request reads
// the file again and connects anew, so the link follows the app through a
// restart, or the switch being turned off and on.
//
// A request that fails rejects with an error whose `code` says why: 'off' (the
// app is not running, its switch is off, the connection was lost, or what
// answered at the pipe does not hold the secret), 'timeout' (no answer in
// time), 'protocol' (the app speaks another version of the link), or the code
// the app answered with.

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import liveProtocol from '../main/liveProtocol.js';

const { PROTOCOL, lineReader, proof } = liveProtocol;

// The app answers from memory, or says within 15 s that its window did not
// (src/main/ipc/liveBridge.js); this is that and room for a loaded machine.
const ANSWER_TIMEOUT_MS = 20000;

const failure = (code, message) => Object.assign(new Error(message), { code });
const OFF = () => failure('off', 'TFStudio is not running, or its live link is off');
const NO_ANSWER = () => failure('timeout', 'TFStudio did not answer');

// Calls `fail` unless the answer comes within ANSWER_TIMEOUT_MS; the returned
// function says it came.
function deadline(fail) {
    const timer = setTimeout(fail, ANSWER_TIMEOUT_MS);
    return () => clearTimeout(timer);
}

// A connection to the app the live link file `file` names, resolved once the
// app has taken its hello; `onEnd` is called when it closes.
function connect(file, onEnd) {
    let link;
    try { link = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return Promise.reject(OFF()); }
    return new Promise((resolve, reject) => {
        const socket = net.connect(link.pipe);
        const nonce = crypto.randomBytes(16).toString('hex');
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
                socket.write(`${JSON.stringify({ id, method, params })}\n`);
            }),
            close: () => socket.destroy(),
        };
        const helloArrived = deadline(() => { reject(NO_ANSWER()); socket.destroy(); });
        const hello = message => {
            helloArrived();
            if (message?.hello !== PROTOCOL || message.proof !== proof(link.secret, nonce, 'app')) {
                reject(message?.error?.code === 'protocol' ? failure('protocol', message.error.message) : OFF());
                socket.destroy();
                return;
            }
            greeted = true;
            connection.version = message.version ?? null;
            resolve(connection);
        };
        socket.setEncoding('utf8');
        socket.on('connect', () => socket.write(`${JSON.stringify({ hello: PROTOCOL, nonce, proof: proof(link.secret, nonce, 'agent') })}\n`));
        socket.on('data', lineReader(line => {
            let message = null;
            try { message = JSON.parse(line); } catch (_) { /* not a message: nothing waits on it */ }
            if (!greeted) hello(message);
            else pending.get(message?.id)?.(message);
        }, () => socket.destroy()));
        // Every failure ends in 'close', which answers what is still waiting.
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
 * The link to the app through the live link file `file`. request(method,
 * params) resolves to the app's result; appVersion() is the version of the app
 * last connected to; close() ends the connection.
 */
export function createLiveLink(file) {
    let current = null;
    let version = null;
    const connection = () => {
        if (!current) {
            const opening = connect(file, () => { if (current === opening) current = null; });
            opening.then(c => { version = c.version; }, () => { if (current === opening) current = null; });
            current = opening;
        }
        return current;
    };
    return {
        request: async (method, params = {}) => (await connection()).ask(method, params),
        appVersion: () => version,
        close: () => { current?.then(c => c.close(), () => {}); current = null; },
    };
}
