/**
 * Test helper: the app's side of the live link without Electron. The window's
 * answers (src/utils/live/liveAnswers.js) over designs held here, the way the
 * window gives them, and `forward`, which the pipe server
 * (src/main/liveBridge.js) hands each request to, as the main process does.
 *
 * The designs sit in one project folder, Coatings/AR, the one the explorer has
 * selected; a test can push more folders onto `folders`. A select opens the
 * design; an add puts the design, or a blank one, into its folder under a name
 * the folder does not hold yet and opens it; a delete takes the design out and
 * leaves no design open when it was the open one, as the window does.
 *
 * `edit(id, patch)` stands in for an edit the user makes; `writes` counts the
 * undo steps the agent's writes made; `notices` holds the design names the
 * notices named and `noticeKinds` what each said. Set `hang` and requests are
 * never answered; set `fileFails` to 'noBin' or 'failed' and a delete answers
 * so, and to 'failed' an add answers that its file could not be written.
 */
import { answerLiveRequest } from '../src/utils/live/liveAnswers.js';
import { makeDefaultDesign } from '../src/utils/io/newDesign.js';
import liveProtocol from '../src/main/liveProtocol.js';

/** The hello an MCP server that holds `secret` sends, with `nonce` as its nonce, for the program named `program`. */
export const agentHello = (secret, nonce = 'a test nonce', program = null) => ({
    hello: liveProtocol.PROTOCOL, nonce, proof: liveProtocol.proof(secret, nonce, 'agent'), program,
});

// `name`, or the first of `name (2)`, `name (3)`, ... the folder does not hold.
function freeName(folder, name) {
    const taken = new Set(folder.items.map(item => item.name));
    let free = name;
    for (let k = 2; taken.has(free); k++) free = `${name} (${k})`;
    return free;
}

// The changes the window makes, each on the stand-in app's state.
function writeDesign(app, patch) {
    const id = app.activeDesignId;
    app.designs = { ...app.designs, [id]: { ...app.designs[id], ...patch } };
    app.dirtyDesigns = { ...app.dirtyDesigns, [id]: true };
    app.writes++;
}

function selectDesign(app, id) {
    app.activeDesignId = id;
}

async function addDesign(app, design, folderId) {
    if (app.fileFails === 'failed') return null;
    const into = app.folders.find(f => f.id === folderId);
    const made = design ?? makeDefaultDesign(`Design ${into.items.length + 1}`);
    const name = freeName(into, made.name);
    app.designs = { ...app.designs, [made.id]: { ...made, name } };
    into.items = [...into.items, { id: made.id, name }];
    app.activeDesignId = made.id;
    return made.id;
}

async function removeDesign(app, folderId, id) {
    if (app.fileFails) return app.fileFails;
    const from = app.folders.find(f => f.id === folderId);
    from.items = from.items.filter(item => item.id !== id);
    app.designs = Object.fromEntries(Object.entries(app.designs).filter(([key]) => key !== id));
    if (app.activeDesignId === id) app.activeDesignId = null;
    return 'deleted';
}

// The changes above are there at once, as a render shows them.
async function shown(test, state) {
    if (!test(state)) throw new Error('the stand-in app shows another state than the request waits for');
    return state;
}

export function makeFakeApp(designs, activeDesignId) {
    const app = {
        designs, activeDesignId, isOptimizing: false, dirtyDesigns: {},
        folders: [{ id: 'Coatings/AR', items: Object.keys(designs).map(id => ({ id, name: designs[id].name })) }],
        selectedFolder: 'Coatings/AR',
        writes: 0, notices: [], noticeKinds: [], requests: [], hang: false, fileFails: null,
    };
    const andShow = change => (...args) => {
        change(app, ...args);
        return now();
    };
    // The app as a request finds it, with the changes the window makes.
    const now = () => ({
        ...app,
        write: andShow(writeDesign),
        select: andShow(selectDesign),
        add: (design, folderId) => addDesign(app, design, folderId),
        remove: (folderId, id) => removeDesign(app, folderId, id),
        rendered: test => shown(test, now()),
        notify: (name, kind = 'agentChanged') => {
            app.notices.push(name);
            app.noticeKinds.push(kind);
        },
    });
    app.edit = (id, patch) => { app.designs = { ...app.designs, [id]: { ...app.designs[id], ...patch } }; };
    // What crosses the IPC is a copy, as Electron's structured clone makes one.
    app.forward = (method, params) => {
        app.requests.push(method);
        const answered = app.hang ? new Promise(() => {}) : Promise.resolve(answerLiveRequest({ method, params }, now()));
        return answered.then(answer => JSON.parse(JSON.stringify(answer)));
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
