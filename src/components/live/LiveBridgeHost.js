/**
 * Answers a program, a Python program or an AI agent, working through the
 * live link (LiveDialogs.js) from the designs the app holds, with
 * utils/live/liveAnswers.js. It draws nothing; a write the program makes shows
 * as a notice that names the design and says Ctrl+Z undoes it.
 *
 * It sits inside DesignProvider and keeps what the design context held at its
 * latest render, so a request that comes right after an edit sees that edit.
 * An agent's write is rendered before it is answered (flushSync), so the
 * answer carries the design as the store now holds it, with the token of that
 * state for the agent's next write.
 */

import { useDesign } from '../../state/DesignContext.js';
import { answerLiveRequest } from '../../utils/live/liveAnswers.js';

const { useEffect, useRef } = React;

/** `notify` raises a notice (useNoticeStack); `dirtyDesigns` is the store's map of unsaved designs. */
export function LiveBridgeHost({ t, notify, dirtyDesigns }) {
    const context = useDesign();
    const latest = useRef(null);
    latest.current = { context, t, notify, dirtyDesigns };

    useEffect(() => {
        const appNow = () => {
            const now = latest.current;
            return {
                designs: now.context.designs, activeDesignId: now.context.activeDesignId,
                isOptimizing: now.context.isOptimizing, folders: now.context.folders, dirtyDesigns: now.dirtyDesigns,
                write: (patch) => {
                    ReactDOM.flushSync(() => now.context.updateDesign(patch));
                    return appNow();
                },
                notify: (name) => now.notify({ type: 'info', message: now.t.dialogs.agentChanged(name) }),
            };
        };
        const off = window.electronAPI?.onLiveRequest?.((request) => {
            window.electronAPI.liveReply(request.id, answerLiveRequest(request, appNow()));
        });
        return typeof off === 'function' ? off : undefined;
    }, []);

    return null;
}
