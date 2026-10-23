/**
 * Each member of an object API class in both languages, as an entry of the
 * API Reference shows it, for the generator (tools/gen_api_reference.mjs): a
 * side per language, { name, form, lead, args, returns, refuses, raises,
 * example }, from jsObjects.mjs's JavaScript member or pyDocstrings.mjs's
 * Python one, and the two paired by name as the package pairs a keyword
 * argument with the API's name for it (python/tfstudio/_names.py).
 */
import fs from 'node:fs';
import path from 'node:path';
import { logicalLines } from './pySource.mjs';
import { apiName, pythonName } from './pairs.mjs';
import { ROOT } from './markdown.mjs';

const PACKAGE = path.join(ROOT, 'python', 'tfstudio');

/** The string literals of the dict assigned to `name` in the package's `file`, as [key, value] pairs. */
export function pythonDict(file, name) {
    const line = logicalLines(fs.readFileSync(path.join(PACKAGE, file), 'utf8')).find(l => l.indent === 0 && l.text.startsWith(`${name} =`));
    if (!line) throw new Error(`python/tfstudio/${file} has no ${name}`);
    const values = line.strings.map(s => s.value);
    return Array.from({ length: values.length / 2 }, (_, i) => [values[2 * i], values[2 * i + 1]]);
}

// The names whose camelCase spells out capitals, as the package keeps them.
const EXCEPTIONS = Object.fromEntries(pythonDict('_names.py', '_EXCEPTIONS'));
/** The JavaScript name of the Python name `name`. */
export const jsNameOf = name => apiName(name, EXCEPTIONS);
/** The Python name of the JavaScript name `name`. */
export const pyNameOf = name => Object.keys(EXCEPTIONS).find(key => EXCEPTIONS[key] === name) ?? pythonName(name);

// Python's operators by the JavaScript members in their place: [] is [n],
// which Layers take through a proxy (jsObjects.mjs), and Materials and
// Integrals take get(), since an object's [] in JavaScript reads its
// properties.
const OPERATORS = { __len__: () => 'length', __iter__: () => '[Symbol.iterator]', __getitem__: cls => (['Materials', 'Integrals'].includes(cls) ? 'get' : '[n]') };

// The forms of an attribute: read, and set where it can be.
const attributeForms = (at, name, settable) => (settable ? [`${at}.${name}`, `${at}.${name} = value`] : [`${at}.${name}`]);

function jsForm(cls, name, member) {
    const at = cls.receiver;
    if (name === '[Symbol.iterator]') return [`for (const ${cls.item} of ${at})`];
    if (member.kind === 'index') return [`${at}[${member.doc.params[0].name}]`];
    if (member.kind !== 'method') return attributeForms(at, name, member.settable);
    const params = member.doc.params;
    const plain = params.filter(p => !p.name.includes('.') && p.name !== 'options').map(p => p.name);
    const options = params.filter(p => p.name.startsWith('options.')).map(p => p.name.slice('options.'.length));
    const args = [...plain, ...(options.length ? [`{ ${options.join(', ')} }`] : [])].join(', ');
    return [`${member.async ? 'await ' : ''}${at}.${name}(${args})`];
}

// A JavaScript member as an entry shows it: its form and what its doc says.
function jsSide(cls, name, member) {
    const doc = member.doc;
    const args = doc.params.filter(p => p.text).map(p => ({ name: p.name.replace(/^options\./, ''), value: p.value, text: p.text }));
    return { name, form: jsForm(cls, name, member), lead: doc.lead, args, returns: doc.returns, refuses: doc.throws, raises: [], example: doc.example };
}

/** A Python docstring's arguments as an entry shows them: a default said in words goes with the text. */
export const argsOf = doc => doc.args.map(a => ({ name: a.name, value: a.value, text: a.without ? `${a.text} Without it, ${a.without}.` : a.text }));
/** Arguments as a call passes them by keyword, each with its default, or ... for one given in words. */
export const keywordForm = args => args.map(a => `${a.name}=${a.value ?? '...'}`);

// The names a def takes by place: those before any * and without a default.
function positional(params) {
    const names = params.split(',').map(p => p.trim()).filter(p => p && p !== 'self');
    const starred = names.findIndex(p => p.startsWith('*'));
    return (starred < 0 ? names : names.slice(0, starred)).filter(p => !p.includes('='));
}

const OPERATOR_FORMS = {
    __len__: cls => `len(${cls.receiver})`,
    __iter__: cls => `for ${cls.item} in ${cls.receiver}:`,
    __getitem__: (cls, member) => `${cls.receiver}[${member.doc.args[0].name}]`,
};

function pyForm(cls, name, member) {
    if (OPERATOR_FORMS[name]) return [OPERATOR_FORMS[name](cls, member)];
    if (member.kind !== 'method') return attributeForms(cls.receiver, name, member.settable);
    const bare = positional(member.params);
    const args = argsOf(member.doc);
    return [`${cls.receiver}.${name}(${[...bare, ...keywordForm(args.filter(a => !bare.includes(a.name)))].join(', ')})`];
}

/** A Python member as an entry shows it, the refusals apart from the errors other than TFStudioError it raises. */
export function pySide(cls, name, member) {
    const doc = member.doc;
    const refuses = doc.raises.filter(r => r.error === 'TFStudioError').map(r => r.text);
    const raises = doc.raises.filter(r => r.error !== 'TFStudioError');
    return { name, form: pyForm(cls, name, member), lead: doc.lead, args: argsOf(doc), returns: doc.returns, refuses, raises, example: doc.example };
}

/**
 * The members of the class `cls` ({ name, receiver, item }) in both
 * languages, paired: { id, js, py }, each side null where the language has
 * no such member.
 */
export function pairsOf(cls, jsClass, pyClass) {
    const pyMembers = Object.entries(pyClass?.members ?? {});
    const jsNamed = pyName => OPERATORS[pyName]?.(cls.name) ?? jsNameOf(pyName);
    const pairs = Object.entries(jsClass?.members ?? {}).map(([name, member]) => {
        const py = pyMembers.find(([pyName]) => jsNamed(pyName) === name);
        return { id: name, js: jsSide(cls, name, member), py: py ? pySide(cls, py[0], py[1]) : null };
    });
    for (const [pyName, member] of pyMembers.filter(([pyName]) => !pairs.some(pair => pair.py?.name === pyName))) {
        pairs.push({ id: pyName, js: null, py: pySide(cls, pyName, member) });
    }
    return pairs;
}
