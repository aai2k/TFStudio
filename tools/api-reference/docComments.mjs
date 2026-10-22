/**
 * The API's calls as their doc comments describe them, for the API Reference
 * generator (tools/gen_api_reference.mjs): each function src/api/index.js
 * exports, in the order index.js lists them, read from the doc comment right
 * above its export:
 *
 *   lead paragraphs      what the call does
 *   @param name text     an argument; [name] is optional and [name=value] has
 *                        a default. A dotted name (options.from, rows[].type)
 *                        is a field of an argument
 *   @returns text        what the call returns
 *   @property name text  a field of what it returns
 *   @throws text         a refusal
 *   @async               the call returns a promise, though its declaration
 *                        does not say so
 *   @example             the lines after it: a script that runs in the console
 *
 * A tag the reference does not read, or an export without a doc comment, is
 * refused, so a misspelt tag cannot drop a line from the page.
 */
import fs from 'node:fs';
import path from 'node:path';

const TAGS = new Set(['param', 'returns', 'property', 'throws', 'async', 'example']);

const joined = lines => lines.map(line => line.trim()).filter(Boolean).join(' ');
const paragraphs = lines => lines.join('\n').split(/\n\s*\n/).map(p => joined(p.split('\n'))).filter(Boolean);

// The lead lines and the tags of a doc comment's body, each line without its
// leading ' * ', so an example keeps its own indentation.
function parseDoc(body) {
    const doc = { lead: [], tags: [] };
    let current = null;
    for (const raw of body.split(/\r?\n/)) {
        const line = raw.replace(/^\s*\*(?: |$)/, '');
        const tag = line.match(/^@(\w+)\s?(.*)$/);
        if (tag) doc.tags.push(current = { tag: tag[1], lines: [tag[2]] });
        else (current ? current.lines : doc.lead).push(line);
    }
    return doc;
}

// Where the bracket that opens `text` closes, past brackets and quotes inside.
function closingBracket(text) {
    let depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '\'' || ch === '"') quote = ch;
        else if (ch === '[') depth++;
        else if (ch === ']' && --depth === 0) return i;
    }
    throw new Error(`unclosed [ in @param ${text}`);
}

function paramOf(text) {
    if (!text.startsWith('[')) {
        const [name] = text.split(/\s/, 1);
        return { name, value: null, required: true, text: text.slice(name.length).trim() };
    }
    const end = closingBracket(text);
    const [name, ...value] = text.slice(1, end).split('=');
    return { name, value: value.length ? value.join('=') : null, required: false, text: text.slice(end + 1).trim() };
}

function fieldOf(text) {
    const [name] = text.split(/\s/, 1);
    return { name, text: text.slice(name.length).trim() };
}

function exampleOf(tags) {
    const example = tags.find(t => t.tag === 'example');
    return example ? example.lines.slice(1).join('\n').replace(/\s+$/, '') : null;
}

// The call `name` as its doc comment in `file` describes it.
function callOf(name, file) {
    const source = fs.readFileSync(file, 'utf8');
    const found = source.match(new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*export (async )?(?:function|const) ${name}\\b`));
    if (!found) throw new Error(`${file}: ${name} has no doc comment right above its export`);
    const { lead, tags } = parseDoc(found[1]);
    const unknown = tags.find(t => !TAGS.has(t.tag));
    if (unknown) throw new Error(`${name}: @${unknown.tag} is not a tag the reference reads`);
    const texts = tag => tags.filter(t => t.tag === tag).map(t => joined(t.lines));
    return {
        name,
        lead: paragraphs(lead),
        params: texts('param').map(paramOf),
        returns: texts('returns')[0] ?? null,
        properties: texts('property').map(fieldOf),
        throws: texts('throws'),
        async: !!found[2] || tags.some(t => t.tag === 'async'),
        example: exampleOf(tags),
    };
}

/** Each call the index.js in `apiDir` exports, in its order, as its doc comment describes it. */
export function apiCalls(apiDir) {
    const index = fs.readFileSync(path.join(apiDir, 'index.js'), 'utf8');
    return [...index.matchAll(/^export \{([^}]+)\} from '\.\/([\w.]+)';/gm)]
        .flatMap(([, names, file]) => names.split(',').map(name => callOf(name.trim(), path.join(apiDir, file))));
}
