/**
 * Test helper: an MCP client on a server process started with `command` and
 * `args`. request() resolves to the answer of its id, call() to a tool's
 * result ({ error } for a tool error, { protocolError } for a JSON-RPC one).
 * `lines` holds every line the server wrote to stdout, `stderr` its log. A
 * request the server has not answered after REPLY_LIMIT_MS, or by the time it
 * exits, is answered with an error, so a test fails instead of waiting for
 * ever.
 */
import { spawn } from 'node:child_process';

export const INIT = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } };

// The longest a call waits on a job is 50 s (src/mcp/jobs.js); an answer this
// late is not coming.
const REPLY_LIMIT_MS = 90000;

export function startClient(command, args, options = {}) {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    const client = { child, lines: [], answers: new Map(), waiting: new Map(), seq: 0, stderr: '' };
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at);
            buffer = buffer.slice(at + 1);
            client.lines.push(line);
            let message = null;
            try { message = JSON.parse(line); } catch (_) { continue; }
            client.answers.set(message.id, message);
            client.waiting.get(message.id)?.(message);
        }
    });
    child.stderr.on('data', chunk => { client.stderr += chunk; });
    client.exited = new Promise(resolve => child.on('exit', code => {
        for (const [id, wake] of client.waiting) {
            if (!client.answers.has(id)) wake({ jsonrpc: '2.0', id, error: { code: 'exited', message: `the server exited (${code})` } });
        }
        resolve(code);
    }));
    client.write = message => child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
    client.request = (method, params, id = ++client.seq) => new Promise(resolve => {
        if (child.exitCode !== null) { resolve({ jsonrpc: '2.0', id, error: { code: 'exited', message: 'the server has exited' } }); return; }
        const timer = setTimeout(() => resolve({ jsonrpc: '2.0', id, error: { code: 'timeout', message: 'no answer' } }), REPLY_LIMIT_MS);
        client.waiting.set(id, answer => { clearTimeout(timer); resolve(answer); });
        client.write({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    });
    client.call = async (name, args) => {
        const answer = await client.request('tools/call', { name, arguments: args });
        if (answer.error) return { protocolError: answer.error };
        const { content, structuredContent, isError } = answer.result;
        return isError ? { error: content[0].text } : (structuredContent ?? JSON.parse(content[0].text));
    };
    return client;
}

/** Whether every line the server wrote to stdout is a JSON-RPC message. */
export const onlyMessages = client => client.lines.every(line => {
    try { return JSON.parse(line).jsonrpc === '2.0'; } catch (_) { return false; }
});
