/**
 * The texts the API Reference reads from the code, in a page's language, for
 * the generator (tools/gen_api_reference.mjs): English as it is, another
 * language from api-reference/<lang>.json. Each entry there is
 * { hash, text } under a key that says where the English comes from (the
 * generator lists the keys), and `hash` is the start of the SHA-256 of the
 * English it translates. A text with no entry, an entry whose English has
 * changed since it was written, or an entry no text uses is refused, naming
 * the key, the English as it is now and its hash.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const hashOf = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);

/**
 * How `lang` shows the texts read from the code: `text(key, english)` gives
 * the text a page shows, and `check()`, once the page is built, refuses the
 * texts that had no current translation and the translations no text used.
 */
export function translatorFor(lang) {
    if (lang === 'en') return { text: (key, english) => english, check() {} };
    const file = path.join(HERE, `${lang}.json`);
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    const used = new Set();
    const problems = [];
    return {
        text(key, english) {
            used.add(key);
            const entry = entries[key];
            if (entry?.hash !== hashOf(english)) {
                problems.push(`${key}: ${entry ? 'the English has changed since it was translated' : 'no translation'}; `
                    + `translate ${JSON.stringify(english)} and give it the hash ${hashOf(english)}`);
            }
            return entry?.text ?? english;
        },
        check() {
            for (const key of Object.keys(entries)) if (!used.has(key)) problems.push(`${key}: no text of the page has this key`);
            if (problems.length) throw new Error(`${path.relative(ROOT, file)}:\n${problems.join('\n')}`);
        },
    };
}

/** `fn`, a call as docComments.mjs reads it, with each of its texts as `text(key, english)` gives it. */
export function localized(fn, text) {
    const of = (part, english) => text(`${fn.name}.${part}`, english);
    return {
        ...fn,
        lead: fn.lead.map((p, i) => of(`lead.${i + 1}`, p)),
        params: fn.params.map(p => (p.text ? { ...p, text: of(`param.${p.name}`, p.text) } : p)),
        returns: fn.returns && of('returns', fn.returns),
        properties: fn.properties.map(f => ({ ...f, text: of(`property.${f.name}`, f.text) })),
        throws: fn.throws.map((x, i) => of(`throws.${i + 1}`, x)),
    };
}
