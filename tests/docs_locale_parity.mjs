/**
 * The documentation site ships an English tree and a Chinese mirror of it.
 * Nothing but this check keeps them in step, and a page updated on one side
 * and not the other still builds, so the drift is invisible until a reader
 * hits it.
 *
 * Two things are checked, both language-neutral so translation is free to
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

console.log(`PASS: docs_locale_parity (${english.length} pages mirrored)`);
