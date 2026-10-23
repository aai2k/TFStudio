/**
 * The tfstudio Python package's objects as their docstrings describe them,
 * read from the package's source without running Python (pySource.mjs), for
 * the API Reference generator (tools/gen_api_reference.mjs).
 *
 * Each class the package's __all__ lists, with its docstring and each public
 * method and attribute of it: a def (a property's getter gives the docstring
 * and a setter marks it settable), and an attribute assigned in the class body
 * whose value holds a triple-quoted string, its docstring. len(), [] and a for
 * loop are __len__, __getitem__ and __iter__. A docstring is read as the
 * package writes them:
 *
 *   lead paragraphs     what it does
 *   Args:               each argument, `name: text`, the text going on in the
 *                       lines indented under it; a closing "Default X."
 *                       sentence is its default, X a Python literal, and a
 *                       closing "Default: text." says what it is without one
 *   Returns:            what it returns
 *   Raises:             each refusal, `Error: text`
 *   Example::           the lines indented under it: an example
 *
 * A section the reference does not read is refused, so a misspelt heading
 * cannot drop a part from the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleandoc, logicalLines, unescaped } from './pySource.mjs';

const SECTIONS = new Set(['Args', 'Returns', 'Raises', 'Example']);
const OPERATORS = new Set(['__len__', '__getitem__', '__iter__']);
// A Python literal as a default is written: a number, a string, True, False,
// None, or a list or tuple of them.
const LITERAL = /^(-?\d[\d.e+-]*|"[^"]*"|'[^']*'|True|False|None|\[[^\]]*\]|\([^)]*\))$/;

const joined = lines => lines.map(line => line.trim()).filter(Boolean).join(' ');
const paragraphs = lines => lines.join('\n').split(/\n\s*\n/).map(p => joined(p.split('\n'))).filter(Boolean);
const indentOf = line => line.length - line.trimStart().length;

function dedented(lines) {
    const used = lines.filter(line => line.trim());
    const margin = used.length ? Math.min(...used.map(indentOf)) : 0;
    return lines.map(line => line.slice(margin));
}

// The entries of an Args or Raises section, `name: text` each, the text going
// on in the lines indented under the entry.
function entriesOf(lines, where) {
    const entries = [];
    for (const line of lines.filter(l => l.trim())) {
        const entry = /^(\S[^:]*?):\s+(.*)$/.exec(line);
        if (indentOf(line) === 0 && entry) entries.push({ name: entry[1], lines: [entry[2]] });
        else if (entries.length && indentOf(line) > 0) entries.at(-1).lines.push(line);
        else throw new Error(`${where}: "${line}" is no entry`);
    }
    return entries.map(({ name, lines: text }) => ({ name, text: joined(text) }));
}

// An argument's text without its closing default: { name, text, value,
// without }, `value` the default as a Python literal, `without` what it is
// without one, said in words.
function argumentOf({ name, text }, where) {
    const literal = /^(.*?)\s*Default ([^:\s].*?)\.$/.exec(text);
    if (literal) {
        if (!LITERAL.test(literal[2])) throw new Error(`${where}: ${name}'s default "${literal[2]}" is not a Python literal; write "Default: text." for one in words`);
        return { name, text: literal[1], value: literal[2], without: null };
    }
    const without = /^(.*?)\s*Default: (.+?)\.$/.exec(text);
    return without ? { name, text: without[1], value: null, without: without[2] } : { name, text, value: null, without: null };
}

// A docstring's lines by the section they are in, `lead` before the first.
function sectionsOf(doc, where) {
    const parts = { lead: [] };
    let section = 'lead';
    for (const line of doc.split('\n')) {
        const heading = indentOf(line) === 0 && /^(\w+)(::?)$/.exec(line.trim());
        if (!heading) { parts[section].push(line); continue; }
        if (!SECTIONS.has(heading[1])) throw new Error(`${where}: ${heading[1]}${heading[2]} is not a section the reference reads`);
        section = heading[1];
        parts[section] = [];
    }
    return parts;
}

/** A docstring, as cleandoc gives it, read into { lead, args, returns, raises, example }. */
export function readDocstring(doc, where) {
    const parts = sectionsOf(doc, where);
    const body = name => (parts[name] ? dedented(parts[name]) : []);
    return {
        lead: paragraphs(parts.lead),
        args: entriesOf(body('Args'), `${where} Args`).map(entry => argumentOf(entry, where)),
        returns: parts.Returns ? joined(body('Returns')) : null,
        raises: entriesOf(body('Raises'), `${where} Raises`).map(({ name, text }) => ({ error: name, text })),
        example: parts.Example ? body('Example').join('\n').replace(/^\n+|\s+$/g, '') : null,
    };
}

const docOf = (literal, where) => (literal ? readDocstring(cleandoc(unescaped(literal.value)), where) : null);
const isDocstring = (line, margin) => !!line && line.indent > margin && /^[rRuU]?("""|''')/.test(line.text);
const isPublic = name => !name.startsWith('_') || OPERATORS.has(name);

// A class body's statements at its own indent, each with the decorators
// above it and the line after it.
function statements(body) {
    const margin = body[0]?.indent;
    const found = [];
    let decorators = [];
    body.forEach((line, i) => {
        if (line.indent !== margin) return;
        if (line.text.startsWith('@')) { decorators.push(line.text.slice(1)); return; }
        found.push({ line, next: body[i + 1], decorators, margin });
        decorators = [];
    });
    return found;
}

// A statement as a member: a def, with the docstring under it and the text of
// its parameters, or an assignment, with the last triple-quoted string in it.
function memberOf({ line, next, decorators, margin }) {
    const def = /^def (\w+)\s*\(/.exec(line.text);
    if (def) {
        const params = line.text.slice(line.text.indexOf('(') + 1, line.text.lastIndexOf(')'));
        return { name: def[1], kind: decorators.includes('property') ? 'property' : 'method', literal: isDocstring(next, margin) ? next.strings[0] : null, params };
    }
    const assigned = /^(\w+)\s*=/.exec(line.text);
    return assigned ? { name: assigned[1], kind: 'attribute', literal: line.strings.filter(s => s.quote === 3).at(-1) ?? null, params: null } : null;
}

// The members of the class whose body is `body`: by name, each { kind, doc,
// settable, params }.
function membersOf(body, where) {
    const members = {};
    for (const statement of statements(body)) {
        const member = memberOf(statement);
        const skipped = !member || !isPublic(member.name) || statement.decorators.some(d => d === 'classmethod' || d === 'staticmethod');
        if (skipped) continue;
        if (statement.decorators.some(d => d.endsWith('.setter'))) members[member.name].settable = true;
        else members[member.name] = { kind: member.kind, settable: false, params: member.params, doc: docOf(member.literal, `${where}.${member.name}`) };
    }
    return members;
}

// The names the package's __init__.py lists in __all__.
function listed(lines) {
    const all = lines.find(line => line.indent === 0 && /^__all__\s*=/.test(line.text));
    if (!all) throw new Error('the package has no __all__');
    return all.strings.map(s => s.value);
}

// The classes of `lines`, a file's logical lines, that `all` lists, by name.
function classesIn(lines, all, file) {
    const classes = {};
    lines.forEach((line, i) => {
        const declared = line.indent === 0 && /^class (\w+)/.exec(line.text);
        if (!declared || !all.includes(declared[1])) return;
        const end = lines.findIndex((next, j) => j > i && next.indent === 0);
        const body = lines.slice(i + 1, end < 0 ? lines.length : end);
        const docLine = isDocstring(body[0], line.indent) ? body[0] : null;
        classes[declared[1]] = { file, doc: docOf(docLine?.strings[0], declared[1]), members: membersOf(docLine ? body.slice(1) : body, declared[1]) };
    });
    return classes;
}

/**
 * The classes of the package in `packageDir` (the folder holding
 * __init__.py) that its __all__ lists, as { all, classes }: each class by
 * name, { doc, members, file }.
 */
export function pyObjects(packageDir) {
    const read = file => logicalLines(fs.readFileSync(path.join(packageDir, file), 'utf8'));
    const all = listed(read('__init__.py'));
    const files = fs.readdirSync(packageDir).filter(name => name.endsWith('.py')).sort();
    return { all, classes: Object.assign({}, ...files.map(file => classesIn(read(file), all, file))) };
}
