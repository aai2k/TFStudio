/**
 * The documentation site ships an English tree and a Chinese mirror of it.
 * Nothing but this check keeps them in step, and a page updated on one side
 * and not the other still builds, so the drift is invisible until a reader
 * hits it.
 *
 * Three things are checked, all language-neutral so the wording is free to
 * differ:
 *
 *   1. Every English page has a Chinese counterpart at the same slug, and no
 *      Chinese page is orphaned.
 *   2. Fenced blocks have the same shape: the same number of fences per page,
 *      each with the same number of lines. A fence holds formulas, units or a
 *      file snippet, so a line added to one side and not the other is the
 *      cheapest reliable signal that a page has fallen behind. Line content is
 *      deliberately not compared, because some fences carry a commentary
 *      column that is translated. This is what would have caught the CDC
 *      definition being added to the English Group Delay page alone.
 *   3. Outside the fences, the pages have the same headings, paragraphs, list
 *      items and table rows (blockShape).
 *
 * Run: node tests/docs_locale_parity.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DOCS = path.join(process.cwd(), 'docs-site', 'src', 'content', 'docs');
const MIRROR = 'zh';

// The site's own top-level pages are not mirrored per language.
const UNMIRRORED = new Set(['index.mdx', '404.md']);

function pagesUnder(root, prefix = '') {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const slug = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            return entry.name === MIRROR ? [] : pagesUnder(path.join(root, entry.name), slug);
        }
        return /\.mdx?$/.test(entry.name) ? [slug] : [];
    });
}

/** The line count of each fenced block on a page, in document order. */
function fenceShape(text) {
    return (text.match(/^```[\s\S]*?^```/gm) || [])
        .map(block => block.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trim())
        .filter(Boolean)
        .map(block => block.split('\n').length);
}

const english = pagesUnder(DOCS).filter(slug => !UNMIRRORED.has(slug));
const chinese = pagesUnder(path.join(DOCS, MIRROR)).filter(slug => !UNMIRRORED.has(slug));

assert.ok(english.length > 20, `the English docs tree was found (${english.length} pages)`);

assert.deepEqual(english.filter(slug => !chinese.includes(slug)), [],
    `every English page has a ${MIRROR} counterpart`);
assert.deepEqual(chinese.filter(slug => !english.includes(slug)), [],
    `every ${MIRROR} page has an English source`);

const drifted = [];
for (const slug of english) {
    const source = fenceShape(fs.readFileSync(path.join(DOCS, slug), 'utf8'));
    const mirror = fenceShape(fs.readFileSync(path.join(DOCS, MIRROR, slug), 'utf8'));
    if (source.join() !== mirror.join()) {
        drifted.push(`${slug}: English ${source.join('/') || 'none'}, ${MIRROR} ${mirror.join('/') || 'none'}`);
    }
}
assert.deepEqual(drifted, [],
    `every fenced block is the same size in an English page and its ${MIRROR} counterpart`);

/**
 * The block shape of a page outside its fences: the level of each heading,
 * and how many paragraphs, list items and table rows it has. A block is a run
 * of non-blank lines; a line that continues a wrapped paragraph or list item
 * belongs to the block above it. Translation keeps every one of these, so a
 * paragraph, bullet or row added to one language and not the other shows up
 * here. This is what would have caught eighteen Chinese pages falling behind
 * their English pages in September 2026.
 */
function blockShape(text) {
    const shape = { headings: [], paragraphs: 0, listItems: 0, tableRows: 0 };
    let inFence = false, inBlock = false;
    for (const raw of text.replace(/^---[\s\S]*?---/, '').split(/\r?\n/)) {
        const line = raw.trim();
        const fence = line.startsWith('```');
        if (fence) inFence = !inFence;
        if (fence || inFence || !line) { inBlock = false; continue; }
        const kind = lineKind(line);
        if (kind === 'heading') shape.headings.push(line.match(/^#+/)[0].length);
        else if (kind === 'row') shape.tableRows++;
        else if (kind === 'item') shape.listItems++;
        else if (kind === 'text' && !inBlock) shape.paragraphs++;
        inBlock = kind !== 'heading';
    }
    return shape;
}

// What a line outside a fence is: a heading, a table row, a table's separator
// rule, a list item, markup (HTML, an MDX import, a quote), or text.
function lineKind(line) {
    if (/^#{1,6}\s/.test(line)) return 'heading';
    if (line.startsWith('|')) return /^\|[\s:|-]+\|$/.test(line) ? 'rule' : 'row';
    if (/^([-*+]|\d+\.)\s/.test(line)) return 'item';
    return /^(<|import |>)/.test(line) ? 'markup' : 'text';
}

const reshaped = [];
for (const slug of english) {
    const source = blockShape(fs.readFileSync(path.join(DOCS, slug), 'utf8'));
    const mirror = blockShape(fs.readFileSync(path.join(DOCS, MIRROR, slug), 'utf8'));
    const differs = ['paragraphs', 'listItems', 'tableRows']
        .filter(key => source[key] !== mirror[key])
        .map(key => `${key} ${source[key]}/${mirror[key]}`);
    if (source.headings.join() !== mirror.headings.join()) differs.unshift(`headings ${source.headings.join('')}/${mirror.headings.join('')}`);
    if (differs.length) reshaped.push(`${slug}: ${differs.join(', ')} (English/${MIRROR})`);
}
assert.deepEqual(reshaped, [],
    `every English page and its ${MIRROR} counterpart have the same headings, paragraphs, list items and table rows`);

console.log(`PASS: docs_locale_parity (${english.length} pages mirrored)`);
