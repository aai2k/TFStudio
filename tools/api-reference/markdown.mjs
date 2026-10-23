/**
 * What the API Reference generator's parts write with: Markdown tables and
 * code, literals as the page writes them, the manual's pages by slug and
 * their titles, and the generator's fixed sentences (text.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const DOCS = path.join(ROOT, 'docs-site', 'src', 'content', 'docs');

// The fixed sentences of each page's language, and the code they show.
const { code: CODE, ...TEXT } = JSON.parse(fs.readFileSync(path.join(HERE, 'text.json'), 'utf8'));
export { CODE, TEXT };
export const LANGS = Object.keys(TEXT);

/** The manual's page at `slug` in each language, by language. */
export const pagesAt = slug => Object.fromEntries(LANGS.map(lang => [lang,
    path.join(DOCS, ...(lang === 'en' ? [] : [lang]), ...slug.split('/')) + '.md']));

export const code = text => `\`${text}\``;
export const literal = v => (Array.isArray(v) ? `[${v.map(literal).join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v));
export const capitalized = text => text[0].toUpperCase() + text.slice(1);
export const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

/** A Markdown table of `head` and `rows`, with a blank line after it. */
export function table(head, rows) {
    const cell = text => String(text).replace(/\|/g, '\\|');
    return [
        `| ${head.join(' | ')} |`,
        `| ${head.map(h => '-'.repeat(Math.max(3, h.length))).join(' | ')} |`,
        ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
        '',
    ];
}

/** The title of the manual page at `slug` in `lang`, from its front matter. */
export function pageTitle(lang, slug) {
    const title = fs.readFileSync(pagesAt(slug)[lang], 'utf8').match(/^title:\s*(.+?)\s*$/m);
    if (!title) throw new Error(`${pagesAt(slug)[lang]} has no title`);
    return title[1].replace(/^"(.*)"$/, '$1');
}
