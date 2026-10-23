import { createWindowSession } from '../../windowSession.js';
import { LANGUAGES, languageOfFile } from './scriptLanguage.js';

// The script, the file it was opened from or saved to, and what its last run
// printed belong to no design, so they stay across design switches.
// `fileText` is the text as it was last opened from or saved to that file, ''
// when it has none, so the window knows whether the editor holds changes the
// file does not. `language` is the script's, 'javascript' or 'python'
// (scriptLanguage.js). `output` holds the lines the run printed that the
// window keeps, newest last (src/scripts/outputBounds.js), and `outputHidden`
// how many earlier ones it left out. `errorLine` is the line of the script
// the last run's error names, 0 for none, which the editor marks until the
// script is edited or run again. `splitSizes` are the shares of the window,
// in percent, the editor and the output take, as the divider between them
// leaves them.
export const scriptConsoleSession = createWindowSession({
    text: '',
    fileName: '',
    filePath: '',
    fileText: '',
    language: 'javascript',
    output: [],
    outputHidden: 0,
    errorLine: 0,
    splitSizes: [60, 40],
});

// The last script typed or opened in any copy of the window, kept in local
// storage so it outlives closing the window and quitting the app. A copy that
// opens with an empty editor takes it; it is put in the editor, never run.
const LAST_SCRIPT_KEY = 'tfstudio-script-console-v1';

/**
 * The last script as { text, fileName, filePath, fileText, language }, or
 * null when none is kept. One kept before scripts had a language takes its
 * file's.
 */
export function loadLastScript() {
    try {
        const last = JSON.parse(localStorage.getItem(LAST_SCRIPT_KEY));
        if (!last || typeof last.text !== 'string') return null;
        const fileName = String(last.fileName || '');
        return {
            text: last.text, fileName,
            filePath: String(last.filePath || ''), fileText: String(last.fileText || ''),
            language: LANGUAGES.includes(last.language) ? last.language : languageOfFile(fileName, 'javascript'),
        };
    } catch (_) {
        return null;
    }
}

/** Keep { text, fileName, filePath, fileText, language } as the last script. */
export function saveLastScript({ text, fileName, filePath, fileText, language }) {
    try {
        localStorage.setItem(LAST_SCRIPT_KEY, JSON.stringify({ text, fileName, filePath, fileText, language }));
    } catch (_) { /* storage full or blocked */ }
}
