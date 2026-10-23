// The requests the API server answers: the API's calls by name, a run's hooks
// streamed as progress, and Stop. server.js documents the messages.
//
// A run computes on the server's own thread, as the API runs it, and takes
// the server's stdin between its steps, so other calls are answered while it
// goes and a stop reaches it. One runs at a time: a second is refused, and a
// client wanting two at once starts a second server, a process of its own.

import { parse } from './wire.js';
import { streamedHooks } from './hooks.js';

/** The calls that run: their third argument is their hooks, and one runs at a time. */
export const RUNS = new Set(['refine', 'synthesize', 'monteCarlo', 'estimateYield']);

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = id => typeof id === 'string' || Number.isInteger(id);
const isNameList = v => Array.isArray(v) && v.every(name => typeof name === 'string');

// Why the hooks of a request cannot be streamed, or null when they can. A run
// takes its hooks by name only: a third argument in args would be dropped.
function hooksProblem({ call, args = [], hooks }) {
    if (RUNS.has(call) && args.length > 2) return `${call}: its hooks go by name in hooks, not in args`;
    if (hooks === undefined) return null;
    if (!RUNS.has(call)) return `${call}: takes no hooks; the runs ${[...RUNS].join(', ')} take them`;
    return isNameList(hooks) ? null : `${call}: hooks is a list of hook names`;
}

// Why `message` is not a request the server can answer, or null when it is.
function requestProblem(s, message) {
    if (!isRecord(message) || !isId(message.id)) return 'a request is { id, call, args, hooks, stopped }, its id a string or a whole number';
    if (!s.calls.has(message.call) && !s.app.has(message.call)) return `unknown call '${message.call}'`;
    if (message.args !== undefined && !Array.isArray(message.args)) return `${message.call}: args is the list of the call's arguments`;
    if (message.stopped !== undefined && !(RUNS.has(message.call) && message.stopped === true)) {
        return `${message.call}: stopped is true on a run, or left out`;
    }
    return hooksProblem(message);
}

// The error answer for `err`, which `call` threw. The app's refusals carry the
// reason's code, and the API's refusals that an object layer words in its own
// names carry their code and fields (src/api/check.js refusal).
function errorOf(s, call, err) {
    const message = err?.message || String(err);
    if (err?.fields) return { message, code: err.code, fields: err.fields };
    return s.app.has(call) && err?.code ? { message, code: err.code } : { message };
}

// What `call` answers, { result } or { error }; an answer of undefined is null.
async function outcome(s, call, args) {
    try {
        return { result: (await (s.calls.get(call) ?? s.app.get(call))(...args)) ?? null };
    } catch (err) {
        return { error: errorOf(s, call, err) };
    }
}

// A request with stopped: true starts its run stopped, so the run ends at
// once: its client was told to stop it before asking for it, and a stop line
// of its own could reach the server after the run's first step began.
async function run(s, { id, call, args = [], hooks = [], stopped = false }) {
    if (s.running) {
        s.send({ id, error: { message: `${call}: ${s.running.call} is running on this server, which runs one at a time; open another TFStudio() for a run alongside it` } });
        return;
    }
    const stop = new AbortController();
    if (stopped) stop.abort();
    const streamed = streamedHooks(hooks, stop.signal, progress => s.send({ id, progress }));
    s.running = { id, call, stop };
    const answer = await outcome(s, call, [args[0], args[1], streamed.hooks]);
    s.running = null;
    streamed.flush();
    s.send({ id, ...answer });
}

function receive(s, line) {
    const text = line.replace(/^﻿/, '');   // a byte order mark some shells put before what they pipe
    if (!text.trim()) return;
    let message;
    try { message = parse(text); } catch (_) {
        s.send({ id: null, error: { message: 'a line is one JSON message' } });
        return;
    }
    if (isRecord(message) && 'stop' in message) {
        if (s.running?.id === message.stop) s.running.stop.abort();
        return;
    }
    const problem = requestProblem(s, message);
    if (problem) s.send({ id: isRecord(message) && isId(message.id) ? message.id : null, error: { message: problem } });
    else if (RUNS.has(message.call)) run(s, message);
    else outcome(s, message.call, message.args ?? []).then(answer => s.send({ id: message.id, ...answer }));
}

/**
 * The server's handling of what a client sends. `api` is the API module,
 * whose exports but init are the calls; `app` the calls that reach the open
 * app, a Map by name; `send(message)` writes one message. receive(line) takes
 * each line the client writes; stopAll() stops the run going, if any; `calls`
 * lists the API's calls by name.
 */
export function createSession({ api, app, send }) {
    const s = { calls: new Map(Object.entries(api).filter(([name]) => name !== 'init')), app, send, running: null };
    return { calls: [...s.calls.keys()], receive: line => receive(s, line), stopAll: () => s.running?.stop.abort() };
}
