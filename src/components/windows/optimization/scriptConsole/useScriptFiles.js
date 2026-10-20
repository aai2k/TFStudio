/**
 * Open and Save for the Script Console. A script is a .js file; opening one
 * puts its text in the editor and nothing more, so a script runs only when Run
 * is pressed. Open replaces the editor's text, so when that text is not saved
 * to a file, or has changed since it was, the window asks first in the app's
 * confirm dialog.
 */

const { useCallback } = React;

// The name a path ends in, on either kind of separator.
const baseName = filePath => String(filePath || '').split(/[\\/]/).pop();

async function openScript({ z, flash, clear, patch }) {
    clear();
    try {
        const result = await window.electronAPI.openScriptFile();
        if (result?.success) {
            patch({ text: result.text, fileName: result.fileName || '', filePath: result.filePath || '', fileText: result.text });
            flash('success', z.opened(result.fileName || ''));
        } else if (!result?.canceled) flash('error', z.errOpen(result?.error || ''));
    } catch (error) {
        flash('error', z.errOpen(error.message));
    }
}

// The dialog starts at the file the script came from, when it has one.
async function saveScript({ z, flash, clear, patch, script }) {
    clear();
    try {
        const result = await window.electronAPI.saveScriptFile(script.text, script.filePath || script.fileName);
        if (result?.success) {
            patch({ fileName: baseName(result.filePath), filePath: result.filePath, fileText: script.text });
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
 * { open, save }: `script` is { text, fileName, filePath }, `unsaved` whether
 * the editor holds text its file does not, `patch` writes the window's
 * session, `flash` and `clear` its report line, and `setInputDialog` shows the
 * app's confirm dialog.
 */
export function useScriptFiles({ z, script, unsaved, patch, flash, clear, setInputDialog }) {
    const open = useCallback(() => {
        const read = () => openScript({ z, flash, clear, patch });
        if (unsaved && setInputDialog) return confirmDiscard({ z, setInputDialog }, read);
        return read();
    }, [z, unsaved, flash, clear, patch, setInputDialog]);
    const save = useCallback(() => saveScript({ z, flash, clear, patch, script }), [z, flash, clear, patch, script]);
    return { open, save };
}
