/**
 * The object API has the same public names in JavaScript (src/api/objects) and
 * in Python (python/tfstudio), and each JavaScript one has the doc comment the
 * JS reference is generated from.
 *
 *   1. Each class src/api/objects/index.js exports, and each public method and
 *      attribute of one, has a doc comment right above it (a setter shares its
 *      getter's), with what it does, an example, and no tag the reference does
 *      not read (tools/api-reference/docComments.mjs); start() has one too,
 *      without an example, since a script in the console has its tf already.
 *   2. With Python 3.8 or newer on PATH: each class the package's __all__
 *      lists and each public method and attribute of one, read from its source
 *      by tests/_pythonNames.py, is in JavaScript under its camelCase name, and
 *      each JavaScript one is in Python, but for the departures below, each
 *      still a departure. Python's len(), for loop and [] are length, for...of,
 *      and [n] on Layers or get() on Materials and Integrals. Without Python this part is
 *      skipped, and says so.
 *
 * The names are read from the source on both sides, with acorn here and ast
 * there, so a member that only a running object would show, such as a field,
 * counts as well.
 *
 * Run: node tests/object_api_parity.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBJECTS = path.join(ROOT, 'src', 'api', 'objects');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');

// The tags the JS reference reads, as tools/api-reference/docComments.mjs takes them.
const TAGS = new Set(['param', 'returns', 'property', 'throws', 'async', 'example']);

// What one language's objects have and the other's do not, in JavaScript's
// names, with the reason.
const PYTHON_ONLY = {
    App: 'a Python program reaches the open app through tf.app; a script in the Script Console works on tf.design, which is applied when it ends',
    AppDesign: 'as App',
    'TFStudio.app': 'as App',
    'Design.push': 'as App: the console applies tf.design when the script ends',
    'TFStudio.close': 'Python ends the TFStudio it started; JavaScript computes in its own process and has nothing to end',
    Stop: 'a JavaScript run is stopped with an AbortSignal, the language\'s own',
    TFStudioError: 'JavaScript refuses with an Error that carries the API\'s message, as the plain calls do',
    AppError: 'as TFStudioError',
    ServerError: 'as TFStudioError',
};
const JS_ONLY = {};

// Python's operators by what the JavaScript objects have in their place.
// Materials and Integrals take get(), since an object's [] in JavaScript reads
// its properties and a material's id or a row's key is any text; a layer's number is a number,
// which no property is named, so Layers take [n].
const OPERATORS = { __len__: () => 'length', __iter__: () => '[Symbol.iterator]', __getitem__: cls => (cls === 'Layers' ? '[n]' : 'get') };
const camel = name => name.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
const jsName = (cls, name) => (OPERATORS[name] ? OPERATORS[name](cls) : camel(name));

// ── 1. The JavaScript names and their docs ──────────────────────────────────
// The doc comment that ends right above `node`, or null.
function docAbove(source, comments, node) {
    const doc = comments.find(c => c.type === 'Block' && c.value.startsWith('*') && c.end <= node.start && source.slice(c.end, node.start).trim() === '');
    return doc ? doc.value : null;
}

// A class member's name: its own, or `[Symbol.iterator]` for a computed one;
// null for a constructor, a static member, an internal one (_name) and the
// inspect hook, which no program calls.
function memberName(source, member) {
    if (member.static || member.kind === 'constructor') return null;
    const name = member.computed ? `[${source.slice(member.key.start, member.key.end)}]` : member.key.name;
    return name.startsWith('_') || name === '[inspect.custom]' ? null : name;
}

// The public members of a class declaration with their doc comments, the
// first declaration of a name (a getter before its setter) giving the doc.
function membersOf(source, comments, declaration) {
    const members = {};
    for (const member of declaration.body.body) {
        const name = memberName(source, member);
        if (name && !(name in members)) members[name] = docAbove(source, comments, member);
    }
    return members;
}

// Each exported class and function of the object API's files, by name, with
// its doc comment and, for a class, its public members with theirs.
function declared() {
    const found = {};
    for (const file of fs.readdirSync(OBJECTS).filter(name => name.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(OBJECTS, file), 'utf8');
        const comments = [];
        const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
        for (const node of tree.body.filter(n => n.type === 'ExportNamedDeclaration' && n.declaration?.id)) {
            const { declaration } = node;
            const members = declaration.type === 'ClassDeclaration' ? membersOf(source, comments, declaration) : null;
            found[declaration.id.name] = { doc: docAbove(source, comments, node), members };
        }
    }
    return found;
}

const isClass = value => typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value));
const exported = Object.keys(objects);
const classes = exported.filter(name => isClass(objects[name]));
const source = declared();

// What is wrong with a doc comment, or null. Its lead is the text before the
// first tag.
function docProblem(doc, { example = true } = {}) {
    if (doc === null) return 'no doc comment right above it';
    const lines = doc.split(/\r?\n/).map(line => line.replace(/^\s*\*+ ?/, ''));
    const tags = lines.filter(line => line.startsWith('@')).map(line => line.match(/^@(\w*)/)[1]);
    const firstTag = lines.findIndex(line => line.startsWith('@'));
    const lead = (firstTag < 0 ? lines : lines.slice(0, firstTag)).join(' ').trim();
    const unknown = tags.find(tag => !TAGS.has(tag));
    if (!lead) return 'no text saying what it does';
    if (unknown) return `@${unknown}, a tag the reference does not read`;
    return example && !tags.includes('example') ? 'no @example' : null;
}

const undocumented = [];
for (const name of exported) {
    const declaration = source[name];
    if (!declaration) { undocumented.push(`${name}: not declared and exported in a file of src/api/objects`); continue; }
    const problem = docProblem(declaration.doc, { example: name !== 'start' });
    if (problem) undocumented.push(`${name}: ${problem}`);
    for (const [member, doc] of Object.entries(declaration.members ?? {})) {
        const memberProblem = docProblem(doc);
        if (memberProblem) undocumented.push(`${name}.${member}: ${memberProblem}`);
    }
}
assert.deepEqual(undocumented, [], 'every exported class, method and attribute of the object API has a doc comment with an example');
assert.deepEqual(exported.filter(name => !classes.includes(name)), ['start'], 'the object API exports its classes and start()');

// ── 2. The same names in Python ─────────────────────────────────────────────
// Python 3.8 or newer, by the names it goes by: each is asked its version,
// since a name on PATH can be an older Python or a stand-in that installs one.
// A version check takes well under a second; the limit leaves room for a cold start.
function findPython() {
    for (const [command, ...prefix] of [['python3'], ['python'], ['py', '-3']]) {
        const asked = spawnSync(command, [...prefix, '-c', 'import sys; print(sys.version_info >= (3, 8))'], { encoding: 'utf8', timeout: 30000 });
        if (asked.status === 0 && asked.stdout.trim() === 'True') return [command, ...prefix];
    }
    return null;
}
const python = findPython();
if (!python) {
    console.log('PASS: object_api_parity, the JavaScript docs; SKIP: the names in Python, with no Python 3.8 or newer on PATH');
    process.exit(0);
}
const [command, ...prefix] = python;
const asked = spawnSync(command, [...prefix, '-B', '-I', path.join(ROOT, 'tests', '_pythonNames.py'), path.join(ROOT, 'python')], { encoding: 'utf8', timeout: 30000 });
assert.equal(asked.status, 0, `tests/_pythonNames.py ran: ${asked.stderr}`);
const py = JSON.parse(asked.stdout);
assert.deepEqual(py.all.filter(name => !py.classes[name]), [], 'everything the package\'s __all__ lists is a class');

// Each class and each of its members, as Class and Class.member in
// JavaScript's names. Layers takes [n] when a layer's number reads its layer.
const pythonNames = new Set(Object.entries(py.classes).flatMap(([cls, members]) => [cls, ...members.map(m => `${cls}.${jsName(cls, m)}`)]));
const jsNames = new Set(classes.flatMap(cls => [cls, ...Object.keys(source[cls].members).map(m => `${cls}.${m}`)]));
{
    const design = new objects.Design(api.insertLayer(api.newDesign(), { material: 'SiO2', thickness: 100 }));
    if (design.layers[1] instanceof objects.Layer) jsNames.add('Layers.[n]');
}
// The members of a class Python alone has go with it.
const departed = name => name.includes('.') && !!PYTHON_ONLY[name.split('.')[0]];
const onlyPython = [...pythonNames].filter(name => !jsNames.has(name) && !PYTHON_ONLY[name] && !departed(name));
const onlyJs = [...jsNames].filter(name => !pythonNames.has(name) && !JS_ONLY[name]);
assert.deepEqual(onlyPython, [], 'every public name of the Python objects is in JavaScript, under its camelCase name');
assert.deepEqual(onlyJs, [], 'every public name of the JavaScript objects is in Python, under its snake_case name');
const stale = [...Object.keys(PYTHON_ONLY).filter(name => !pythonNames.has(name) || jsNames.has(name)),
    ...Object.keys(JS_ONLY).filter(name => !jsNames.has(name) || pythonNames.has(name))];
assert.deepEqual(stale, [], 'each departure is one still');

console.log(`PASS: object_api_parity (${jsNames.size} JavaScript names, ${pythonNames.size} Python names)`);
