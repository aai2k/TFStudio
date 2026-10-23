/**
 * The JavaScript and Python forms of the object API side by side, for the API
 * Reference generator (tools/gen_api_reference.mjs).
 *
 * A name is the same in both languages when the Python one, read as the
 * package reads a keyword argument (python/tfstudio/_names.py), is the
 * JavaScript one: score_on is scoreOn. A text is said once when the two
 * languages say the same in their own words: the same words, with Python's
 * True, False, None, inf and -inf for JavaScript's true, false, null,
 * Infinity and -Infinity, its snake_case names for camelCase ones, double
 * quotes for single ones, and code marks or none. The text is then
 * JavaScript's, each word that differs given in both forms, as
 * `scoreOn` / `score_on`. Texts that say more than that differ are both
 * shown, each under its language.
 */

const TO_JS_LITERAL = { True: 'true', False: 'false', None: 'null', inf: 'Infinity', '-inf': '-Infinity' };
const PY_LITERAL = /(?<![\w-])(True|False|None|-?inf)(?![\w])/g;
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** The package's camelCase name of a snake_case `name`, `exceptions` those whose capitals it spells out. */
export function apiName(name, exceptions) {
    if (exceptions[name]) return exceptions[name];
    const [first, ...rest] = name.split('_');
    return first + rest.map(part => part.slice(0, 1).toUpperCase() + part.slice(1)).join('');
}

/** The Python name of the API's `name`, as the package's python_name() makes it. */
export const pythonName = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Python's reST ``code`` marks as Markdown's. */
export const markdownOf = text => text.replace(/``([^`]+)``/g, '`$1`');

// A word as both languages' texts compare it.
const unmarked = word => word.replace(/`/g, '').replace(/"/g, "'");
const compared = word => unmarked(word).replace(SNAKE, snake => apiName(snake, {})).replace(PY_LITERAL, literal => TO_JS_LITERAL[literal]);

// A word without its closing punctuation, and that punctuation.
const split = word => /^(.*?)([.,;:]*)$/.exec(word).slice(1);

// The JavaScript word `js` with the Python word `py` beside it when the two
// differ by more than their marks.
function bothForms(js, py) {
    if (unmarked(js) === unmarked(py)) return js;
    const [jsCore, tail] = split(unmarked(js));
    const [pyCore] = split(py.replace(/`/g, ''));
    return `\`${jsCore}\` / \`${pyCore}\`${tail}`;
}

/**
 * The JavaScript text `js` and the Python text `py` as one text, when they
 * say the same in their own words, or null.
 */
export function merged(js, py) {
    // A refusal ends with a full stop in Python and without one in JavaScript.
    const pyText = js.endsWith('.') ? py : py.replace(/\.$/, '');
    const jsWords = js.trim().split(/\s+/), pyWords = markdownOf(pyText).trim().split(/\s+/);
    if (jsWords.length !== pyWords.length) return null;
    if (jsWords.some((word, i) => compared(word) !== compared(pyWords[i]))) return null;
    return jsWords.map((word, i) => bothForms(word, pyWords[i])).join(' ');
}

/**
 * What an entry says for one part, from the JavaScript text `js` and the
 * Python text `py`, either of which may be missing: { text } once, or
 * { js, py } each in its language. Null when neither says anything.
 */
export function said(js, py) {
    if (!js && !py) return null;
    if (!js || !py) return { text: js || markdownOf(py) };
    const one = merged(js, py);
    return one === null ? { js, py: markdownOf(py) } : { text: one };
}

/** A default value as a JavaScript literal, from a Python literal. */
export function jsLiteral(value) {
    return value.replace(/"/g, "'").replace(PY_LITERAL, literal => TO_JS_LITERAL[literal]);
}
