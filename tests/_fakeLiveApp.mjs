/**
 * Test helper: the app's side of the live link without Electron. The window's
 * answers (src/utils/live/liveAnswers.js) over designs held here, the way the
 * window gives them, and `forward`, which the pipe server
 * (src/main/liveBridge.js) hands each request to, as the main process does.
 *
 * `edit(id, patch)` stands in for an edit the user makes; `writes` counts the
 * undo steps the agent's writes made; `notices` holds the design names the
 * notices named. Set `hang` and requests are never answered.
 */
import { answerLiveRequest } from '../src/utils/live/liveAnswers.js';
import liveProtocol from '../src/main/liveProtocol.js';

/** The hello an MCP server that holds `secret` sends, with `nonce` as its nonce, for the program named `program`. */
export const agentHello = (secret, nonce = 'a test nonce', program = null) => ({
    hello: liveProtocol.PROTOCOL, nonce, proof: liveProtocol.proof(secret, nonce, 'agent'), program,
});

export function makeFakeApp(designs, activeDesignId) {
    const app = {
        designs, activeDesignId, isOptimizing: false, dirtyDesigns: {},
        folders: [{ id: 'Coatings/AR', items: Object.keys(designs).map(id => ({ id })) }],
        writes: 0, notices: [], requests: [], hang: false,
    };
    // The app as a request finds it, with the write the window makes.
    const now = () => ({
        ...app,
        write: (patch) => {
            const id = app.activeDesignId;
            app.designs = { ...app.designs, [id]: { ...app.designs[id], ...patch } };
            app.dirtyDesigns = { ...app.dirtyDesigns, [id]: true };
            app.writes++;
            return now();
        },
        notify: (name) => app.notices.push(name),
    });
    app.edit = (id, patch) => { app.designs = { ...app.designs, [id]: { ...app.designs[id], ...patch } }; };
    // What crosses the IPC is a copy, as Electron's structured clone makes one.
    app.forward = (method, params) => {
        app.requests.push(method);
        if (app.hang) return new Promise(() => {});
        return Promise.resolve(JSON.parse(JSON.stringify(answerLiveRequest({ method, params }, now()))));
    };
    return app;
}

/** A client of the pipe at `address` that writes lines and reads the lines it gets back. */
export async function rawClient(net, address) {
    const socket = net.connect(address);
    const lines = [];
    const waiting = [];
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
            lines.push(JSON.parse(buffer.slice(0, at)));
            buffer = buffer.slice(at + 1);
            waiting.splice(0).forEach(wake => wake());
        }
    });
    const closed = new Promise(resolve => socket.on('close', resolve));
    socket.on('error', () => {});
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    return {
        socket, lines, closed,
        send: (message) => socket.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`),
        // The next line not yet taken, once it has come.
        next: async function next() {
            while (this.taken >= lines.length) await new Promise(resolve => waiting.push(resolve));
            return lines[this.taken++];
        },
        taken: 0,
    };
}
