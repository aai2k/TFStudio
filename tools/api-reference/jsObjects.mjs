/**
 * The object API's classes (src/api/objects) as their doc comments describe
 * them, for the API Reference generator (tools/gen_api_reference.mjs): each
 * class a file there exports, with the doc comment right above it and each
 * public member with the one right above that member, read as
 * docComments.mjs reads a doc comment. A member is a method, a getter (a
 * setter of the same name makes it settable), a field, or the iterator a
 * for...of loop takes, `[Symbol.iterator]`; a static member, the constructor,
 * a name that starts with _ and the inspect hook are left out. A class whose
 * constructor returns `new Proxy(this, HANDLER)` takes `[n]` through that
 * handler, which is the member `[n]`, with the doc comment right above the
 * declaration of HANDLER.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { readDoc } from './docComments.mjs';

// The doc comment that ends right above `node`, or null.
function docAbove(source, comments, node) {
    const doc = comments.find(c => c.type === 'Block' && c.value.startsWith('*') && c.end <= node.start && source.slice(c.end, node.start).trim() === '');
    return doc ? doc.value.slice(1) : null;
}

function memberName(source, member) {
    if (member.static || member.kind === 'constructor') return null;
    const name = member.computed ? `[${source.slice(member.key.start, member.key.end)}]` : member.key.name;
    return name.startsWith('_') || name === '[inspect.custom]' ? null : name;
}

const kindOf = member => {
    if (member.type === 'PropertyDefinition') return 'field';
    return member.kind === 'get' || member.kind === 'set' ? 'property' : 'method';
};

function membersOf(source, comments, declaration, where) {
    const members = {};
    for (const member of declaration.body.body) {
        const name = memberName(source, member);
        if (!name) continue;
        if (members[name]) {
            if (member.kind === 'set') members[name].settable = true;
            continue;
        }
        const doc = docAbove(source, comments, member);
        if (doc === null) throw new Error(`${where}.${name} has no doc comment right above it`);
        members[name] = {
            kind: kindOf(member),
            settable: member.kind === 'set' || member.type === 'PropertyDefinition',
            async: !!member.value?.async,
            doc: readDoc(doc, `${where}.${name}`),
        };
    }
    return members;
}

// The name of the handler the constructor of `declaration` returns its
// instance through, as `return new Proxy(this, HANDLER)`, or null.
function proxyHandler(declaration) {
    const constructor = declaration.body.body.find(member => member.kind === 'constructor');
    const returned = constructor?.value.body.body.find(statement => statement.type === 'ReturnStatement')?.argument;
    const handler = returned?.type === 'NewExpression' && returned.callee.name === 'Proxy' ? returned.arguments[1] : null;
    return handler?.type === 'Identifier' ? handler.name : null;
}

// The member `[n]` of the class `name`, which takes it through the handler
// `handler`, declared in `tree`.
function indexMember(source, comments, tree, handler, where) {
    const declared = tree.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(d => d.id.name === handler));
    const doc = declared ? docAbove(source, comments, declared) : null;
    if (doc === null) throw new Error(`${where}: ${handler}, through which it takes [n], has no doc comment right above it`);
    return { kind: 'index', settable: false, async: false, doc: readDoc(doc, `${where}.[n]`) };
}

/** Each class the files of `dir` export, by name: { doc, members, file }. */
export function jsObjects(dir) {
    const classes = {};
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js')).sort()) {
        const source = fs.readFileSync(path.join(dir, file), 'utf8');
        const comments = [];
        const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
        for (const node of tree.body) {
            const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : null;
            if (declaration?.type !== 'ClassDeclaration') continue;
            const name = declaration.id.name;
            const doc = docAbove(source, comments, node);
            if (doc === null) throw new Error(`${file}: ${name} has no doc comment right above it`);
            const members = membersOf(source, comments, declaration, name);
            const handler = proxyHandler(declaration);
            if (handler) members['[n]'] = indexMember(source, comments, tree, handler, `${file}: ${name}`);
            classes[name] = { file, doc: readDoc(doc, name), members };
        }
    }
    return classes;
}
