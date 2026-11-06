/**
 * Answers a program, a Python program or an AI agent, working through the
 * live link (LiveDialogs.js) from the designs the app holds, with
 * utils/live/liveAnswers.js. It draws nothing; a write, an add or a delete the
 * program makes shows as a notice that names the design.
 *
 * It sits inside DesignProvider and keeps what the design context held at its
 * latest render, so a request that comes right after an edit sees that edit.
 * An agent's write, and its opening a design, is rendered before it is
 * answered (flushSync), so the answer carries the design as the store now
 * holds it, with the token of that state for the agent's next write. An add or
 * a delete writes a file first and is answered once a render shows it.
 *
 * Requests are answered one at a time, in the order they came, so each finds
 * the app as the one before it left it: two adds sent at once are two designs
 * under two names, each open when it is answered.
 */

import { useDesign } from '../../state/DesignContext.js';
import { answerLiveRequest } from '../../utils/live/liveAnswers.js';

const { useEffect, useRef } = React;

// The app as a request finds it now, from what the host held at its latest
// render, with the changes the window makes for the agent (see
// answerLiveRequest). `waiting` holds the requests waiting for a render.
function appFrom(latest, waiting) {
    const now = latest.current;
    const again = () => appFrom(latest, waiting);
    const folderById = id => now.context.folders.find(folder => folder.id === id);
    return {
        designs: now.context.designs, activeDesignId: now.context.activeDesignId,
        isOptimizing: now.context.isOptimizing, folders: now.context.folders, dirtyDesigns: now.dirtyDesigns,
        selectedFolder: now.project.selectedFolder?.id ?? null,
        write: (patch) => {
            ReactDOM.flushSync(() => now.context.updateDesign(patch));
            return again();
        },
        // The click on the row selects the design; the activation that the
        // selection makes in an effect is made here too, so it is rendered
        // within flushSync.
        select: (id) => {
            const folder = now.context.folders.find(f => f.items.some(item => item.id === id));
            const item = folder.items.find(row => row.id === id);
            ReactDOM.flushSync(() => {
                now.project.handleItemClick(item, folder);
                now.activateDesign(item);
            });
            return again();
        },
        add: (design, folderId) => (design
            ? now.project.addItemFromDesign(design, folderById(folderId))
            : now.project.addItem(folderById(folderId))),
        remove: (folderId, id) => now.project.removeItemForProgram(folderId, id),
        rendered: (test) => {
            const app = again();
            if (test(app)) return Promise.resolve(app);
            return new Promise(resolve => waiting.current.push({ test, resolve }));
        },
        notify: (name, kind = 'agentChanged') => now.notify({ type: 'info', message: now.t.dialogs[kind](name) }),
    };
}

/**
 * `notify` raises a notice (useNoticeStack); `dirtyDesigns` is the store's map
 * of unsaved designs; `project` is the project tree (useProjectTree) and
 * `activateDesign` the store's.
 */
export function LiveBridgeHost({ t, notify, dirtyDesigns, project, activateDesign }) {
    const context = useDesign();
    const latest = useRef(null);
    latest.current = { context, t, notify, dirtyDesigns, project, activateDesign };
    const waiting = useRef([]);
    const queue = useRef(Promise.resolve());

    // After every render, the requests whose wait it ends go on.
    useEffect(() => {
        if (waiting.current.length === 0) return;
        const app = appFrom(latest, waiting);
        waiting.current = waiting.current.filter(({ test, resolve }) => {
            if (!test(app)) return true;
            resolve(app);
            return false;
        });
    });

    // A request that throws is left unanswered, and the main process tells the
    // agent at its deadline that the app did not answer; the next one goes on.
    useEffect(() => {
        const off = window.electronAPI?.onLiveRequest?.((request) => {
            queue.current = queue.current
                .then(() => answerLiveRequest(request, appFrom(latest, waiting)))
                .then(answer => window.electronAPI.liveReply(request.id, answer), err => console.error(err));
        });
        return typeof off === 'function' ? off : undefined;
    }, []);

    return null;
}
