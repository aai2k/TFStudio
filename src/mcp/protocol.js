// One Model Context Protocol session over stdio: newline-delimited JSON-RPC 2.0,
// as the 2025-11-25 revision specifies it
// (modelcontextprotocol.io/specification/2025-11-25). The session opens with
// `initialize`; a client that probes for the stateless 2026-07-28 revision with
// `server/discover` gets "method not found", which tells it to fall back to
// `initialize`. The server offers tools only.

import { checkArguments } from './checkArguments.js';

/**
 * The revisions this server speaks, newest first. Earlier ones are not
 * offered: 2025-03-26 requires JSON-RPC batches, which this server does not
 * take, and older ones lack the tool titles and structured results it sends.
 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
// A request id is a string or an integer (basic protocol: never null).
const isRequestId = id => typeof id === 'string' || Number.isInteger(id);

const reply = (s, id, result) => s.send({ jsonrpc: '2.0', id, result });
const fail = (s, id, code, message) => s.send({ jsonrpc: '2.0', id, error: { code, message } });

function initialize(s, id, params) {
    const asked = params?.protocolVersion;
    const version = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
    reply(s, id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: s.serverInfo, instructions: s.instructions });
}

function listTools(s, id) {
    reply(s, id, { tools: s.tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) });
}

// A tool's answer; an error is a tool result too, so the model can act on it.
const toolResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const toolError = text => ({ content: [{ type: 'text', text }], isError: true });

async function callTool(s, id, params) {
    const tool = s.tools.find(t => t.name === params?.name);
    if (!tool) { fail(s, id, INVALID_PARAMS, `Unknown tool: ${params?.name}. Tools: ${s.tools.map(t => t.name).join(', ')}`); return; }
    const problem = checkArguments(tool.inputSchema, params.arguments ?? {});
    if (problem) { reply(s, id, toolError(`${tool.name}: ${problem}`)); return; }
    const stop = new AbortController();
    s.calls.set(id, stop);
    let answer;
    try {
        answer = toolResult(await tool.run(params.arguments ?? {}, { signal: stop.signal }));
    } catch (err) {
        answer = toolError(`${tool.name}: ${err?.message || err}`);
    } finally {
        s.calls.delete(id);
    }
    if (!stop.signal.aborted) reply(s, id, answer);
}

const METHODS = {
    initialize, ping: (s, id) => reply(s, id, {}),
    'tools/list': listTools, 'tools/call': callTool,
};

// The message a line holds, or null after answering a line that holds none.
function parseLine(s, line) {
    const text = line.replace(/^﻿/, '');   // a byte order mark some shells put before what they pipe
    if (!text.trim()) return null;
    let message;
    try { message = JSON.parse(text); } catch (_) { fail(s, null, PARSE_ERROR, 'Parse error'); return null; }
    const request = isRecord(message) && message.jsonrpc === '2.0' && typeof message.method === 'string';
    if (request && (!('id' in message) || isRequestId(message.id))) return message;
    // A response from the client (the server sends no requests) needs no answer.
    if (isRecord(message) && !('method' in message)) return null;
    fail(s, null, INVALID_REQUEST, 'Invalid Request');
    return null;
}

function receive(s, line) {
    const message = parseLine(s, line);
    if (!message) return;
    if (!('id' in message)) {
        if (message.method === 'notifications/cancelled') s.calls.get(message.params?.requestId)?.abort();
        return;
    }
    if (!Object.hasOwn(METHODS, message.method)) { fail(s, message.id, METHOD_NOT_FOUND, `Method not found: ${message.method}`); return; }
    Promise.resolve(METHODS[message.method](s, message.id, message.params)).catch(err => {
        s.log(`${message.method} failed: ${err?.stack || err}`);
        fail(s, message.id, INTERNAL_ERROR, 'Internal error');
    });
}

/**
 * A session answering `tools`, a list of { name, title, description,
 * inputSchema, run(args, { signal }) }. `send(message)` writes one message;
 * `log(text)` writes a line for whoever reads the server's stderr. Returns
 * receive(line) for each line the client writes, and stopAll() to abort every
 * call still running.
 */
export function createSession({ serverInfo, instructions, tools, send, log }) {
    const s = { serverInfo, instructions, tools, send, log, calls: new Map() };
    return {
        receive: line => {
            try { receive(s, line); } catch (err) {
                log(`a line could not be handled: ${err?.stack || err}`);
                fail(s, null, INTERNAL_ERROR, 'Internal error');
            }
        },
        stopAll: () => { for (const stop of s.calls.values()) stop.abort(); },
    };
}
