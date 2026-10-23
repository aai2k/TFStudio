/**
 * Python source read as Python reads it, as far as the API Reference needs:
 * its logical lines, each with the string literals in it, and a docstring's
 * text as inspect.cleandoc gives it. For tools/api-reference/pyDocstrings.mjs
 * and the generator, which read the tfstudio package without running Python.
 */

const DEPTH = { '(': 1, '[': 1, '{': 1, ')': -1, ']': -1, '}': -1 };
const PREFIX = /^[rRbBuUfF]{0,2}/;
const isQuote = ch => ch === '"' || ch === "'";
const tripleAt = (text, at) => text.startsWith('"""', at) || text.startsWith("'''", at);

// Where the line holding `at` ends.
function lineEnd(text, at) {
    const end = text.indexOf('\n', at);
    return end < 0 ? text.length : end;
}

// Where a string literal starts at `i`, past an r, b, u or f prefix, or -1.
function stringStart(text, i) {
    const prefix = PREFIX.exec(text.slice(i, i + 2))[0];
    if (prefix && /\w/.test(text[i - 1] ?? '')) return -1;
    return isQuote(text[i + prefix.length]) ? i + prefix.length : -1;
}

// The end of the string literal that opens at `at`, past its escapes.
function stringEnd(text, at) {
    const quote = tripleAt(text, at) ? text.slice(at, at + 3) : text[at];
    for (let i = at + quote.length; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text.startsWith(quote, i)) return i + quote.length;
    }
    throw new Error(`an unclosed string at ${at}`);
}

// What the logical line does at `i`: where it goes on, and how deep in brackets
// that leaves it. A string literal it passes is added to `strings`, each
// { quote, value } with the value as written.
function step(text, i, strings) {
    const at = stringStart(text, i);
    if (at >= 0) {
        const end = stringEnd(text, at);
        const quote = tripleAt(text, at) ? 3 : 1;
        strings.push({ quote, value: text.slice(at + quote, end - quote) });
        return { next: end, depth: 0 };
    }
    if (text[i] === '#') return { next: lineEnd(text, i), depth: 0 };
    if (text[i] === '\\' && /^\r?\n/.test(text.slice(i + 1, i + 3))) return { next: lineEnd(text, i) + 1, depth: 0 };
    return { next: i + 1, depth: DEPTH[text[i]] ?? 0 };
}

// Where the logical line that starts at `at` ends: at a line break outside
// strings and brackets.
function logicalEnd(text, at, strings) {
    let depth = 0;
    for (let i = at; i < text.length;) {
        if (text[i] === '\n' && depth === 0) return i;
        const moved = step(text, i, strings);
        depth += moved.depth;
        i = moved.next;
    }
    return text.length;
}

// Where the next logical line starts at or after `from`, past blank lines and
// comments, with its indent; null at the end.
function nextStart(text, from) {
    for (let i = from; i < text.length; i = lineEnd(text, i) + 1) {
        const line = text.slice(i, lineEnd(text, i));
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const indent = line.length - line.trimStart().length;
            return { at: i + indent, indent };
        }
    }
    return null;
}

/**
 * The logical lines of Python source `text`: { indent, text, strings }, each
 * with the column its first line starts at, its text from there to its end
 * (strings, brackets and backslashes spanning physical lines), and the string
 * literals in it, each { quote, value }, `quote` 3 for a triple-quoted one.
 */
export function logicalLines(text) {
    const lines = [];
    for (let start = nextStart(text, 0); start;) {
        const strings = [];
        const end = logicalEnd(text, start.at, strings);
        lines.push({ indent: start.indent, text: text.slice(start.at, end).replace(/\r$/, ''), strings });
        start = nextStart(text, end + 1);
    }
    return lines;
}

const ESCAPES = { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" };

/** A string literal's value with its escapes read, as Python reads one that has no prefix. */
export const unescaped = value => value.replace(/\\(.)/gs, (_, ch) => ESCAPES[ch] ?? `\\${ch}`);

/** A docstring as inspect.cleandoc gives it: the first line and the rest dedented, blank lines at its ends gone. */
export function cleandoc(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const rest = lines.slice(1).filter(line => line.trim());
    const margin = rest.length ? Math.min(...rest.map(line => line.length - line.trimStart().length)) : 0;
    const out = [lines[0].trim(), ...lines.slice(1).map(line => line.slice(margin).trimEnd())];
    while (out.length && !out[0]) out.shift();
    while (out.length && !out[out.length - 1]) out.pop();
    return out.join('\n');
}
