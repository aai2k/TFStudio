/**
 * An entry of the API Reference, from a member's two sides (sides.mjs), for
 * the generator (tools/gen_api_reference.mjs): the forms side by side, what
 * it does, its arguments with their defaults, what it gives and refuses, and
 * its examples. A part the two languages say alike is said once
 * (pairs.mjs); one they say otherwise is said under each language.
 *
 * An entry is written for the page `L`: { lang, t, text, extras }, `t` the
 * page's fixed sentences, `text(key, english)` a text in the page's language,
 * and `extras` what an entry adds from the lists in code, by its key.
 */
import { DEFAULT_SETTINGS } from '../../src/utils/refinement/methods.js';
import { said, jsLiteral, markdownOf } from './pairs.mjs';
import { jsNameOf } from './sides.mjs';
import { code, fill, literal, table } from './markdown.mjs';

// An entry's parts are said under the key `E.key`, with `E.both` true when
// each language has the entry and says something of it: a part one of them
// then lacks is the other's alone, and says so.

// One part: said() of the two texts, each shown in the page's language from
// the key `key`, with .js or .py for a text one language says alone.
function textOf(E, key, js, py) {
    if (E.both && !js !== !py) return js ? { js: E.L.text(`${key}.js`, js) } : { py: E.L.text(`${key}.py`, markdownOf(py)) };
    const part = said(js, py);
    if (!part) return null;
    if (part.text !== undefined) return { text: E.L.text(key, part.text) };
    return { js: E.L.text(`${key}.js`, part.js), py: E.L.text(`${key}.py`, part.py) };
}

// A part as paragraphs, or as one table cell when `inCell`.
function shown(E, part, inCell = false) {
    if (!part) return [];
    if (part.text !== undefined) return [part.text];
    const [js, py] = E.L.t.languages;
    const saidBy = (lang, text) => text && fill(E.L.t.saidBy, { lang, text });
    const each = [saidBy(js, part.js), saidBy(py, part.py)].filter(Boolean);
    return inCell ? [each.join('<br>')] : each;
}

const pairedBy = (list, i) => list?.[i] ?? null;
const longest = (a = [], b = []) => Math.max(a.length, b.length);

/** The lead paragraphs of both languages, paired by their order, under `E.key`. */
export function paragraphs(E, jsLead, pyLead) {
    return Array.from({ length: longest(jsLead, pyLead) }, (_, i) =>
        shown(E, textOf(E, `${E.key}.lead.${i + 1}`, pairedBy(jsLead, i), pairedBy(pyLead, i)))).flat();
}

// A default in both languages' literals, given once where they are written
// alike; a default the two languages disagree on stops the generator.
function defaultCell(E, jsValue, pyValue) {
    if (jsValue == null || pyValue == null) return jsValue ?? pyValue ? code(jsValue ?? pyValue) : '';
    if (pyValue.replace(/"/g, "'") === jsValue) return code(jsValue);
    if (jsLiteral(pyValue) !== jsValue) throw new Error(`${E.key}: the default is ${jsValue} in JavaScript and ${pyValue} in Python`);
    return `${code(jsValue)} / ${code(pyValue)}`;
}

// The arguments of both sides, paired by name, the JavaScript ones in order.
function argumentPairs(js, py) {
    const jsArgs = js?.args ?? [], pyArgs = py?.args ?? [];
    const pairs = jsArgs.map(arg => ({ a: arg, b: pyArgs.find(p => jsNameOf(p.name) === arg.name) ?? null }));
    return [...pairs, ...pyArgs.filter(p => !pairs.some(pair => pair.b === p)).map(arg => ({ a: null, b: arg }))];
}

// refine's settings take their defaults from the code, which the doc
// comments are not to contradict.
function codeDefault(E, name, value) {
    if (E.key !== 'Design.refine' || !(name in DEFAULT_SETTINGS)) return value;
    const fromCode = literal(DEFAULT_SETTINGS[name]);
    if (value != null && jsLiteral(value) !== fromCode) throw new Error(`${E.key}: ${name}'s default ${value} is not the code's ${fromCode}`);
    return fromCode;
}

/** The rows of an entry's table of arguments: JavaScript name, Python name, default, meaning. */
export function argumentRows(E, js, py) {
    return argumentPairs(js, py).map(({ a, b }) => {
        const name = a?.name ?? jsNameOf(b.name);
        const meaning = shown(E, textOf(E, `${E.key}.arg.${name}`, a?.text, b?.text), true)[0] ?? '';
        const value = defaultCell(E, codeDefault(E, name, a?.value ?? null), b?.value ?? null);
        return [a ? code(a.name) : '', b ? code(b.name) : '', value, meaning];
    });
}

// An item of a list, which ends without a full stop.
const item = text => text.replace(/\.$/, '');

/** The refusals, paired by their order, and the errors Python raises besides. */
export function refusals(E, js, py) {
    const jsRefuses = js?.refuses, pyRefuses = py?.refuses?.map(item);
    const items = Array.from({ length: longest(jsRefuses, pyRefuses) }, (_, i) =>
        shown(E, textOf(E, `${E.key}.refuses.${i + 1}`, pairedBy(jsRefuses, i), pairedBy(pyRefuses, i)), true)[0]);
    const raised = (py?.raises ?? []).map((r, i) => fill(E.L.t.pythonRaises, { error: r.error, text: E.L.text(`${E.key}.raises.${i + 1}`, markdownOf(item(r.text))) }));
    const all = [...items, ...raised];
    return all.length ? [E.L.t.refuses, '', ...all.map(x => `- ${x}`), ''] : [];
}

/** The forms of both sides side by side, a note in place of a side a language lacks. */
export function formsTable(L, js, py, notes) {
    const asCode = (side, note) => (side ? side.form.map(code) : [note]);
    const [a, b] = [asCode(js, notes.js), asCode(py, notes.py)];
    const rows = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i] ?? '', b[i] ?? '']);
    return table(L.t.languages, rows);
}

/** The examples of both sides, JavaScript first. */
export function examples(js, py) {
    return [...(js?.example ? ['```js', js.example, '```', ''] : []), ...(py?.example ? ['```python', py.example, '```', ''] : [])];
}

/** What one language has in place of a member or class the other lacks. */
export function noteOf(L, lang, key) {
    const note = L.t.notIn[lang][key];
    if (!note) throw new Error(`text.json has no ${L.lang} note for ${key}, which ${lang === 'js' ? 'JavaScript' : 'Python'} lacks`);
    return note;
}

const PY_LABELS = { __len__: 'len()', __iter__: 'for', __getitem__: '[]' };

// An entry's heading: its name in both languages where they differ. [n] is
// Python's [] too, so it is named once.
function headingOf(pair) {
    const pyLabel = PY_LABELS[pair.py?.name] ?? pair.py?.name;
    const jsLabel = pair.js?.name === '[Symbol.iterator]' ? 'for...of' : pair.js?.name;
    if (!jsLabel || !pyLabel || jsLabel === pyLabel || jsLabel === '[n]') return jsLabel ?? pyLabel;
    return `${jsLabel} / ${pyLabel}`;
}

/** The entry of `pair` in the section of the class `cls`, one Python alone has when `onlyPython`. */
export function entry(L, cls, pair, onlyPython) {
    const key = `${cls.name}.${pair.id}`;
    const E = { L, key, both: !!pair.js && !!pair.py };
    const notes = { js: pair.js || onlyPython ? null : noteOf(L, 'js', key), py: pair.py ? null : noteOf(L, 'py', key) };
    // A class only Python has shows its Python column alone.
    const columns = onlyPython ? row => row.slice(1) : row => row;
    const rows = argumentRows(E, pair.js, pair.py).map(columns);
    const returns = shown(E, textOf(E, `${key}.returns`, pair.js?.returns, pair.py?.returns), true)[0];
    const forms = onlyPython ? table([L.t.languages[1]], pair.py.form.map(f => [code(f)])) : formsTable(L, pair.js, pair.py, notes);
    return [
        `### ${headingOf(pair)}`, '', ...forms,
        ...paragraphs(E, pair.js?.lead, pair.py?.lead).flatMap(p => [p, '']),
        ...(rows.length ? table(columns(L.t.args), rows) : []),
        ...(returns ? [`${L.t.returns}${returns}`, ''] : []),
        ...refusals(E, pair.js, pair.py),
        ...examples(pair.js, pair.py),
        ...(L.extras[key]?.(L) ?? []),
    ];
}
