/**
 * The languages a Script Console script is written in: JavaScript, which runs
 * on a thread of the desktop app, and Python, which runs in the user's own
 * Python (src/main/pythonLaunch.js). A script's language follows the file it
 * was opened from, by its extension, and the picker in the console's row;
 * Save writes a file of that language.
 */

export const LANGUAGES = ['javascript', 'python'];

const EXTENSIONS = { javascript: '.js', python: '.py' };

/** The language of a file named `fileName`, or `fallback` for one whose extension is neither's. */
export function languageOfFile(fileName, fallback) {
    const name = String(fileName || '').toLowerCase();
    return LANGUAGES.find(language => name.endsWith(EXTENSIONS[language])) || fallback;
}

/** `name`, a file's name or path, with the extension of `language` in place of a .js or .py one; script.js or script.py for none. */
export function withExtension(name, language) {
    const base = String(name || '').replace(/\.(js|py)$/i, '');
    return `${base || 'script'}${EXTENSIONS[language]}`;
}

/**
 * What the console and Preferences > Automation say of the Python a Python
 * script runs in, from what the main process found (findPython): { type,
 * text }, type 'success' for a Python found and 'error' for one missing.
 */
export function pythonStatus(z, answer) {
    if (answer?.found) return { type: 'success', text: z.python.found(answer.found.version, answer.found.path) };
    const missing = answer?.missing || { reason: 'none' };
    if (missing.reason === 'old') return { type: 'error', text: z.python.old(missing.version, missing.path) };
    if (missing.reason === 'setPath') return { type: 'error', text: z.python.setPath(missing.path) };
    return { type: 'error', text: z.python.none };
}
