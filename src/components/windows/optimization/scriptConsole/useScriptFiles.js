/**
 * Open and Save for the Script Console. A script is a .js or a .py file, and
 * its language follows the file's extension; opening one puts its text in the
 * editor and nothing more, so a script runs only when Run is pressed. Save
 * offers a file of the script's language. Open replaces the editor's text, so
 * when that text is not saved to a file, or has changed since it was, the
 * window asks first in the app's confirm dialog.
 */

import { languageOfFile, withExtension } from './scriptLanguage.js';

const { useCallback } = React;

// The name a path ends in, on either kind of separator.
const baseName = filePath => String(filePath || '').split(/[\\/]/).pop();

async function openScript({ z, script, flash, clear, patch }) {
    clear();
    try {
        const result = await window.electronAPI.openScriptFile();
        if (result?.success) {
            const fileName = result.fileName || '';
            patch({
                text: result.text, fileName, filePath: result.filePath || '', fileText: result.text,
                language: languageOfFile(fileName, script.language), errorLine: 0,
            });
            flash('success', z.opened(fileName));
        } else if (!result?.canceled) flash('error', z.errOpen(result?.error || ''));
    } catch (error) {
        flash('error', z.errOpen(error.message));
    }
}

// The dialog starts at the file the script came from, when it has one, with
// the extension of the script's language.
async function saveScript({ z, flash, clear, patch, script }) {
    clear();
    try {
        const suggested = withExtension(script.filePath || script.fileName, script.language);
        const result = await window.electronAPI.saveScriptFile(script.text, suggested, script.language);
        if (result?.success) {
            const fileName = baseName(result.filePath);
            patch({ fileName, filePath: result.filePath, fileText: script.text, language: languageOfFile(fileName, script.language) });
            flash('success', z.saved(result.filePath));
        } else if (!result?.canceled) flash('error', z.errSave(result?.error || ''));
    } catch (error) {
        flash('error', z.errSave(error.message));
    }
}

// Run `action` once the user agrees to give up the unsaved text; Cancel keeps it.
function confirmDiscard({ z, setInputDialog }, action) {
    setInputDialog({
        confirm: true, danger: true,
        title: z.unsavedTitle,
        message: z.discardConfirm,
        confirmLabel: z.discardBtn,
        onConfirm: () => { setInputDialog(null); action(); },
        onCancel: () => setInputDialog(null),
    });
}

/**
 * { open, save }: `script` is { text, language, fileName, filePath },
 * `unsaved` whether the editor holds text its file does not, `patch` writes
 * the window's session, `flash` and `clear` its report line, and
 * `setInputDialog` shows the app's confirm dialog.
 */
export function useScriptFiles({ z, script, unsaved, patch, flash, clear, setInputDialog }) {
    const open = useCallback(() => {
        const read = () => openScript({ z, script, flash, clear, patch });
        if (unsaved && setInputDialog) return confirmDiscard({ z, setInputDialog }, read);
        return read();
    }, [z, script, unsaved, flash, clear, patch, setInputDialog]);
    const save = useCallback(() => saveScript({ z, flash, clear, patch, script }), [z, flash, clear, patch, script]);
    return { open, save };
}
