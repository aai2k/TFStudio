/**
 * Script Console: a script, in JavaScript or Python, run on the open design
 * with the TFStudio API. In both, tf is the object API with tf.design the
 * open design as a Design, or null (None) with none open, and what the script
 * prints goes to the output pane.
 *
 * A JavaScript script is the body of an async function of (tf, console,
 * require): tf is src/api/objects, console prints to the output pane, and
 * require is Node's. It runs on a thread of the desktop app with the rights
 * of the app. A Python script runs in the user's own Python, with tf from the
 * tfstudio package the app ships, on a server the app starts for the run
 * (src/main/scriptRuns.js); choosing Python says which Python that is, or
 * what is missing and where to set it.
 *
 * A design the script leaves in tf.design, changed or replaced by another, is
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
import { pythonStatus, withExtension } from './scriptLanguage.js';
import { loadLastScript, saveLastScript, scriptConsoleSession } from './sessionState.js';
import { useScriptFiles } from './useScriptFiles.js';
import { useScriptRun } from './useScriptRun.js';

const { createElement: h, useCallback, useEffect, useMemo, useRef } = React;

// The editor's script is kept as the last script whenever its text, its
// file or its language changes. A copy being drawn, when it opens or its tab
// is shown again, changes none of them, so it does not put its own script
// over another copy's newer one. A copy that opens with an empty editor takes
// the last script.
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
    }, [session.text, session.fileName, session.filePath, session.fileText, session.language]); // eslint-disable-line react-hooks/exhaustive-deps
}

// The language picker: the script's language is set at once; choosing Python
// says, on the row, which Python runs it or what is missing. The web demo,
// which runs no script, says nothing.
function useLanguagePicker({ z, patch, flash, clear }) {
    return useCallback(async (language) => {
        patch({ language, errorLine: 0 });
        clear();
        if (language !== 'python' || !window.electronAPI?.findPython) return;
        try {
            const status = pythonStatus(z, await window.electronAPI.findPython());
            flash(status.type, status.text);
        } catch (error) {
            flash('error', error.message);
        }
    }, [z, patch, flash, clear]);
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
    const clearOutput = useCallback(() => patch({ output: [], outputHidden: 0, errorLine: 0 }), [patch]);
    const markError = useCallback(line => patch({ errorLine: line }), [patch]);
    const onTextChange = useCallback(text => patch({ text, errorLine: 0 }), [patch]);
    // What a script runs as when it has no file yet, script.js or script.py,
    // is also the name Save offers.
    const script = useMemo(() => ({
        text: session.text, language: session.language,
        fileName: withExtension(session.fileName, session.language), filePath: session.filePath || null,
    }), [session.text, session.language, session.fileName, session.filePath]);
    const run = useScriptRun({ z, script, context, append, clearOutput, markError });
    // Text the file it came from does not hold, or that has no file at all.
    const unsaved = !!session.text.trim() && session.text !== session.fileText;
    const files = useScriptFiles({ z, script, unsaved, patch, flash, clear, setInputDialog });
    const onLanguage = useLanguagePicker({ z, patch, flash, clear });

    return h(ScriptConsoleLayout, {
        c, t, z, session, setField, status, onTextChange, onLanguage,
        running: run.running, runStatus: run.status, onRun: run.run, onStop: run.stop,
        onOpen: files.open, onSave: files.save,
    });
}
