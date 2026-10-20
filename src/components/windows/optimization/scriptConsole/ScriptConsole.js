/**
 * Script Console: a JavaScript script run on the open design with the
 * TFStudio API. The script is the body of an async function of (tf, console,
 * require): tf is the headless API (src/api) with tf.design the open design,
 * or null with none open, console prints to the output pane, and require is
 * Node's. It runs on a thread of the desktop app with the rights of the app.
 *
 * A design the script leaves in tf.design, replaced or changed in place, is
 * applied to the open design as one undo step when the run ends, if that
 * design is still the open one and unchanged; otherwise the output says why
 * it was not. Opening a script only reads it, and so does taking back the
 * last script when the window opens empty. Open asks before it replaces text
 * that is not saved to a file, or has changed since it was.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useWindowSession } from '../../windowSession.js';
import { useActionStatus } from '../../dataExchange/chrome/actionStatus.js';
import { keepNewest } from '../../../../scripts/outputBounds.js';
import { ScriptConsoleLayout } from './ScriptConsoleLayout.js';
import { loadLastScript, saveLastScript, scriptConsoleSession } from './sessionState.js';
import { useScriptFiles } from './useScriptFiles.js';
import { useScriptRun } from './useScriptRun.js';

const { createElement: h, useCallback, useEffect, useMemo, useRef } = React;

// What a script runs as when it has no file yet; it is also the name Save offers.
const UNSAVED_NAME = 'script.js';

// The editor's script is kept as the last script whenever its text or its
// file changes. A copy being drawn, when it opens or its tab is shown again,
// changes neither, so it does not put its own script over another copy's
// newer one. A copy that opens with an empty editor takes the last script.
function useLastScript(session, patch) {
    const opened = useRef(false);
    useEffect(() => {
        if (opened.current) {
            saveLastScript(session);
            return;
        }
        opened.current = true;
        const last = session.text ? null : loadLastScript();
        if (last?.text) patch(last);
    }, [session.text, session.fileName, session.filePath, session.fileText]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ScriptConsole({ c, t, setInputDialog }) {
    const z = t.scriptConsole;
    const context = useDesign();
    // The values belong to no design, so the store is read without one.
    const [session, setField, patch] = useWindowSession(scriptConsoleSession, null);
    useLastScript(session, patch);
    const { status, flash, clear } = useActionStatus();
    const append = useCallback((lines, dropped = 0) => {
        if (!lines.length && !dropped) return;
        patch(now => {
            const kept = keepNewest(now.output.concat(lines));
            return { output: kept.lines, outputHidden: now.outputHidden + dropped + kept.left };
        });
    }, [patch]);
    const clearOutput = useCallback(() => patch({ output: [], outputHidden: 0 }), [patch]);
    const script = useMemo(() => ({
        text: session.text, fileName: session.fileName || UNSAVED_NAME, filePath: session.filePath || null,
    }), [session.text, session.fileName, session.filePath]);
    const run = useScriptRun({ z, script, context, append, clearOutput });
    // Text the file it came from does not hold, or that has no file at all.
    const unsaved = !!session.text.trim() && session.text !== session.fileText;
    const files = useScriptFiles({ z, script, unsaved, patch, flash, clear, setInputDialog });

    return h(ScriptConsoleLayout, {
        c, t, z, session, setField, status,
        running: run.running, runStatus: run.status, onRun: run.run, onStop: run.stop,
        onOpen: files.open, onSave: files.save,
    });
}
