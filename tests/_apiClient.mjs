/**
 * Test helper: a client of the API server (src/apiServer/server.js) on a
 * process started with `command` and `args`, reading and writing lines as
 * wire.js does.
 *
 *   hello              resolves to the server's first message
 *   call(name, args, { hooks, onProgress, stopped })
 *                      sends the request, with `stopped` when it is given, and
 *                      resolves to the answer, { id, result } or { id, error },
 *                      with `progress`, the run's progress messages in order,
 *                      each with `at`, the Date.now() it arrived at;
 *                      onProgress(progress, id) is called as each arrives.
 *                      A report that comes after the answer is dropped, as a
 *                      client that returns at the answer drops it.
 *   answerTo(id)       resolves to the next answer that carries `id`
 *   stop(id), write(message or line)
 *
 * `lines` holds every line the server wrote to stdout, `stderr` its log. An
 * answer that has not come after REPLY_LIMIT_MS, or by the time the server
 * exits, resolves to an error, so a test fails instead of waiting for ever.
 */
import { spawn } from 'node:child_process';
import { encode, parse } from '../src/apiServer/wire.js';

// The longest run a test here makes takes seconds; an answer this late is not coming.
const REPLY_LIMIT_MS = 120000;

export function startApiClient(command, args, options = {}) {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    const client = { child, lines: [], stderr: '', seq: 0 };
    const waiting = new Map();
    const progress = new Map();
    let greet;
    client.hello = new Promise(resolve => { greet = resolve; });

    const take = message => {
        if ('hello' in message) greet(message);
        else if ('progress' in message) {
            const report = { ...message.progress, at: Date.now() };
            progress.get(message.id)?.(report);
        } else {
            const wake = waiting.get(message.id);
            waiting.delete(message.id);
            progress.delete(message.id);
            wake?.(message);
        }
    };
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
            try { message = parse(line); } catch (_) { continue; }
            if (message && typeof message === 'object') take(message);
        }
    });
    child.stderr.on('data', chunk => { client.stderr += chunk; });
    client.exited = new Promise(resolve => child.on('exit', code => {
        greet({ exited: code });
        for (const [id, wake] of waiting) wake({ id, error: { message: `the server exited (${code})` } });
        waiting.clear();
        resolve(code);
    }));

    client.write = message => child.stdin.write(`${typeof message === 'string' ? message : encode(message)}\n`);
    client.answerTo = id => new Promise(resolve => {
        if (child.exitCode !== null) { resolve({ id, error: { message: 'the server has exited' } }); return; }
        const timer = setTimeout(() => resolve({ id, error: { message: 'no answer' } }), REPLY_LIMIT_MS);
        waiting.set(id, answer => { clearTimeout(timer); resolve(answer); });
    });
    client.call = async (call, args = [], { hooks, onProgress, stopped } = {}) => {
        const id = ++client.seq;
        const reports = [];
        progress.set(id, report => { reports.push(report); onProgress?.(report, id); });
        const answer = client.answerTo(id);
        client.write({ id, call, args, ...(hooks ? { hooks } : {}), ...(stopped !== undefined ? { stopped } : {}) });
        const answered = await answer;
        progress.delete(id);
        return { ...answered, progress: reports };
    };
    client.stop = id => client.write({ stop: id });
    return client;
}

/** Whether every line the server wrote to stdout is a message, an object of JSON. */
export const onlyMessages = lines => lines.every(line => {
    try {
        const message = parse(line);
        return !!message && typeof message === 'object';
    } catch (_) {
        return false;
    }
});
