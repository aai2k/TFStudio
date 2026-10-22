/**
 * gen_api_reference.mjs: write the manual's API Reference,
 * docs-site/src/content/docs/automation/api-reference.md and its zh twin,
 * from the source, so the page says what the API takes.
 *
 * Each call on the Script Console's `tf` gets an entry from its doc comment
 * (api-reference/docComments.mjs says how one is read), in the order
 * src/api/index.js lists them, under the group the Script Console page's table
 * of calls puts it in. A call that table does not list is not on `tf`, and the
 * page leaves it out. An argument with fields and no text of its own is shown
 * by its fields alone.
 *
 * The lists that live in code are read from it: the refinement methods with
 * their names and iteration budgets (refinement/methods.js and the Refinement
 * window's method names), the numbers refine takes (refinement/settings.js),
 * the synthesis methods (api/runs.js) with their window titles, each one's
 * settings with their defaults, what they take and what they set (each run's
 * settings.js), and the hooks each run takes (runHooks).
 *
 * The zh page has the same structure. Its fixed sentences are in
 * api-reference/text.json. Every text read from the code is shown in Chinese
 * from api-reference/zh.json, under a key that says where the English comes
 * from, with a hash of the English it translates (api-reference/translations.mjs):
 *
 *   <call>.lead.<n>         the nth paragraph of a call's doc comment
 *   <call>.param.<name>     an argument
 *   <call>.returns          what the call returns
 *   <call>.property.<name>  a field of what it returns
 *   <call>.throws.<n>       the nth refusal
 *   <owner>.setting.<key>   a setting of refine or of a synthesis method
 *
 * A text with no zh entry, an entry whose English has changed since it was
 * written, or an entry no text uses stops the generator, naming the key, the
 * English as it is now and its hash.
 *
 * Usage: node tools/gen_api_reference.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { apiCalls } from './api-reference/docComments.mjs';
import { translatorFor, localized } from './api-reference/translations.mjs';
import { runHooks, SYNTHESIS_METHODS, FLOOR_FROM_MNT } from '../src/api/runs.js';
import { REFINE_METHODS, ALL_ORDER, STOCHASTIC_METHODS, DEFAULT_SETTINGS, defaultMaxIter } from '../src/utils/refinement/methods.js';
import { CHECKS as REFINE_CHECKS } from '../src/utils/refinement/settings.js';
import { CHECKS as NEEDLE_CHECKS, NEEDLE_DEFAULTS } from '../src/utils/needle/settings.js';
import { CHECKS as GE_CHECKS, GE_DEFAULTS } from '../src/utils/gradualEvolution/settings.js';
import { CHECKS as STRUCTURAL_CHECKS, RUN_DEFAULTS as STRUCTURAL_DEFAULTS } from '../src/utils/structural/settings.js';
import en from '../src/constants/locales/en.js';
import zh from '../src/constants/locales/zh.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOCS = path.join(ROOT, 'docs-site', 'src', 'content', 'docs');
const TEXT = JSON.parse(fs.readFileSync(path.join(HERE, 'api-reference', 'text.json'), 'utf8'));
const LANGS = Object.keys(TEXT);
const LOCALES = { en, zh };
const pagesAt = slug => Object.fromEntries(LANGS.map(lang => [lang,
    path.join(DOCS, ...(lang === 'en' ? [] : [lang]), ...slug.split('/')) + '.md']));

export const PAGES = pagesAt('automation/api-reference');
export const CONSOLE_PAGES = pagesAt('automation/script-console');

// Each synthesis method's window (its key in the locales' windowTitles), its
// page in the manual, and the settings its run takes: the checks that say what
// each setting takes and sets, and the values a run starts from.
const SYNTHESIS = {
    needle: { window: 'needle', slug: 'synthesis/needle', checks: NEEDLE_CHECKS, defaults: NEEDLE_DEFAULTS },
    ge: { window: 'gradual', slug: 'synthesis/gradual-evolution', checks: GE_CHECKS, defaults: GE_DEFAULTS },
    structural: {
        window: 'structural', slug: 'synthesis/structural-optimizer', checks: STRUCTURAL_CHECKS, defaults: STRUCTURAL_DEFAULTS,
    },
};

// Deep Synthesis stays off the page while its window is experimental, opened
// from the application menu with no page in the manual; synthesize still takes it.
const SHOWN_SYNTHESIS = SYNTHESIS_METHODS.filter(method => method !== 'deep');

// threads stays off refine's settings: through the API a run's workers take
// turns on the calling thread, each multi-start restart is perturbed from the
// seed and its own index whichever worker takes it, and DE without an
// evaluation pool scores its members one after another, so the setting
// changes neither the answer nor the time a script sees.
const REFINE_SETTINGS = REFINE_CHECKS.filter(([key]) => key !== 'threads');

const code = text => `\`${text}\``;
const literal = v => (Array.isArray(v) ? `[${v.map(literal).join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v));
const shownValue = v => (v == null ? '' : code(literal(v)));
const capitalized = text => text[0].toUpperCase() + text.slice(1);
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
const EM_DASH = String.fromCodePoint(0x2014);

function table(head, rows) {
    const cell = text => String(text).replace(/\|/g, '\\|');
    return [
        `| ${head.join(' | ')} |`,
        `| ${head.map(h => '-'.repeat(Math.max(3, h.length))).join(' | ')} |`,
        ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
        '',
    ];
}

// The title of the manual page at `slug` in `lang`, from its front matter.
function pageTitle(lang, slug) {
    const title = fs.readFileSync(pagesAt(slug)[lang], 'utf8').match(/^title:\s*(.+?)\s*$/m);
    if (!title) throw new Error(`${pagesAt(slug)[lang]} has no title`);
    return title[1].replace(/^"(.*)"$/, '$1');
}

// A settings table's rows from the checks of `owner` (refine or a synthesis
// method): [key, check, what it takes, what it sets].
function settingRows(owner, checks, defaultOf, L) {
    return checks.map(([key, , takes, sets]) => {
        if (!sets) throw new Error(`the setting ${key} has no words for what it sets`);
        const name = owner === 'refine' ? `settings.${key}` : key;
        return [code(name), defaultOf(key), L.text(`${owner}.setting.${key}`, `${sets} ${capitalized(takes)}.`)];
    });
}

// The hooks a call's doc comment describes are the ones its runs take.
function checkHooks(call, fn, names) {
    const described = fn.params.filter(p => p.name.startsWith('hooks.')).map(p => p.name.slice('hooks.'.length));
    const missing = names.filter(h => !described.includes(h));
    const extra = described.filter(h => !names.includes(h));
    if (missing.length || extra.length) {
        throw new Error(`${call}: the doc comment's hooks are not runHooks': missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}`);
    }
}

function refineMethodRows(L) {
    const seeded = ids => (ids.some(id => STOCHASTIC_METHODS.has(id)) ? L.t.yes : '');
    return REFINE_METHODS.map(id => {
        if (id === 'all') return [code('all'), fill(L.t.allMethods, { ids: ALL_ORDER.map(code).join(L.t.listSeparator) }), '', seeded(ALL_ORDER)];
        const name = LOCALES[L.lang].refinement.methods[id];
        if (!name) throw new Error(`the Refinement window has no ${L.lang} name for the method ${id}`);
        return [code(id), name, String(defaultMaxIter(id)), seeded([id])];
    });
}

function refineExtras(fn, L) {
    checkHooks('refine', fn, runHooks('refine'));
    return {
        after: 'settings.',
        rows: settingRows('refine', REFINE_SETTINGS, key => shownValue(DEFAULT_SETTINGS[key]), L),
        sections: [`#### ${L.t.methods}`, '', ...table(L.t.refineMethods, refineMethodRows(L))],
    };
}

function synthesisOf(method) {
    if (!SYNTHESIS[method]) throw new Error(`the synthesis method ${method} has no window or settings in tools/gen_api_reference.mjs`);
    return SYNTHESIS[method];
}

// A method's settings: those with a starting value in its defaults' order, then the rest.
function methodSettings(method, L) {
    const { checks, defaults } = synthesisOf(method);
    const byKey = new Map(checks.map(row => [row[0], row]));
    const rows = [...new Set([...Object.keys(defaults), ...byKey.keys()])].map(key => {
        if (!byKey.has(key)) throw new Error(`${method}: the default ${key} has no check`);
        return byKey.get(key);
    });
    // The floor a method starts from the MNT row, as synthesize gives it.
    const floorFromMnt = FLOOR_FROM_MNT.has(method);
    const defaultOf = key => (key === 'dMin' && floorFromMnt ? `${shownValue(defaults.dMin)} ${L.t.orMnt}` : shownValue(defaults[key]));
    return [`#### ${fill(L.t.settingsOf, { method })}`, '', ...table(L.t.settings, settingRows(method, rows, defaultOf, L))];
}

// The window a method runs in, by the title the app gives it, and its page.
function windowCells(method, lang) {
    const { window, slug } = synthesisOf(method);
    const title = LOCALES[lang].windowTitles[window];
    if (!title) throw new Error(`the ${lang} locale has no window title for ${window}`);
    return [title, `[${pageTitle(lang, slug)}](/${slug}/)`];
}

function synthesisExtras(fn, L) {
    checkHooks('synthesize', fn, [...new Set(SHOWN_SYNTHESIS.flatMap(runHooks))]);
    const methods = SHOWN_SYNTHESIS.map(m => [code(m), ...windowCells(m, L.lang), runHooks(m).map(code).join(L.t.listSeparator)]);
    return {
        rows: [],
        sections: [`#### ${L.t.methods}`, '', ...table(L.t.synthesisMethods, methods), ...SHOWN_SYNTHESIS.flatMap(m => methodSettings(m, L))],
    };
}

// What a call's entry adds from the lists that live in code.
const EXTRAS = { refine: refineExtras, synthesize: synthesisExtras };
const NO_EXTRAS = { rows: [], sections: [] };

function argumentRows(fn, extra, t) {
    const hasFields = p => fn.params.some(q => q.name.startsWith(`${p.name}.`) || q.name.startsWith(`${p.name}[]`));
    const defaultOf = p => (p.required ? t.required : p.value === null ? '' : code(p.value));
    const rows = fn.params.filter(p => p.text || !hasFields(p)).map(p => [code(p.name), defaultOf(p), p.text]);
    if (!extra.rows.length) return rows;
    const at = rows.findLastIndex(row => row[0].startsWith(`\`${extra.after}`)) + 1;
    return [...rows.slice(0, at), ...extra.rows, ...rows.slice(at)];
}

function returnsPart(fn, t) {
    if (!fn.returns) return [];
    const fields = fn.properties.map(f => [code(f.name), f.text]);
    return [`${t.returns}${fn.returns}`, '', ...(fields.length ? table(t.fields, fields) : [])];
}

function signature(fn) {
    const args = fn.params.filter(p => !/[.[]/.test(p.name)).map(p => p.name);
    return code(`${fn.async ? 'await ' : ''}tf.${fn.name}(${args.join(', ')})`);
}

function entry(fn, L) {
    const { t } = L;
    if (!fn.example) throw new Error(`${fn.name} has no @example`);
    const extra = EXTRAS[fn.name]?.(fn, L) ?? NO_EXTRAS;
    const rows = argumentRows(fn, extra, t);
    return [
        `### ${fn.name}`, '', signature(fn), '',
        ...fn.lead.flatMap(p => [p, '']),
        ...(rows.length ? table(t.args, rows) : []),
        ...returnsPart(fn, t),
        ...(fn.throws.length ? [t.refuses, '', ...fn.throws.map(x => `- ${x}`), ''] : []),
        '```js', fn.example, '```', '',
        ...extra.sections,
    ];
}

// The Script Console page's table of calls: each group and the calls in it.
function consoleGroups(lang) {
    return fs.readFileSync(CONSOLE_PAGES[lang], 'utf8').split(/\r?\n/)
        .filter(line => line.startsWith('|') && line.includes('`'))
        .map(line => {
            const [group, calls] = line.split('|').slice(1, 3).map(c => c.trim());
            return { group, calls: [...calls.matchAll(/`(\w+)`/g)].map(m => m[1]) };
        });
}

function sectionsOf(lang, calls) {
    const groups = consoleGroups(lang);
    const unknown = groups.flatMap(g => g.calls).find(name => !calls.some(fn => fn.name === name));
    if (unknown) throw new Error(`the Script Console page lists ${unknown}, which src/api/index.js does not export`);
    return groups.map(g => ({ title: g.group, calls: calls.filter(fn => g.calls.includes(fn.name)) }));
}

// A zh link names the page it opens by that page's title, so the reader finds
// the same name at the other end. An English link runs in its sentence instead.
function checkLinkTitles(text, lang) {
    for (const [, label, slug] of text.matchAll(/\[([^\]]+)\]\(\/([\w/-]+?)\/(?:#[^)]*)?\)/g)) {
        const title = pageTitle(lang, slug);
        if (label !== title) throw new Error(`the ${lang} page links to ${slug} as "${label}"; the page is titled "${title}"`);
    }
}

function page(lang, calls) {
    const translator = translatorFor(lang);
    const L = { lang, t: TEXT[lang], text: translator.text };
    const body = sectionsOf(lang, calls).flatMap(s => [`## ${s.title}`, '', ...s.calls.flatMap(fn => entry(localized(fn, L.text), L))]);
    translator.check();
    const text = ['---', ...L.t.frontmatter, '---', '', ...L.t.intro.flatMap(p => [p, '']), ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    if (text.includes(EM_DASH)) throw new Error(`the ${lang} page holds an em dash, which the manual does not use`);
    if (lang === 'en') return text;
    checkLinkTitles(text, lang);
    return text.replaceAll('](/', `](/${lang}/`);
}

/** Both pages as the generator writes them: { en, zh }. */
export function buildPages() {
    const calls = apiCalls(path.join(ROOT, 'src', 'api'));
    const groupsOf = lang => JSON.stringify(consoleGroups(lang).map(g => g.calls));
    if (LANGS.some(lang => groupsOf(lang) !== groupsOf('en'))) throw new Error('a Script Console page groups the calls differently from the English one');
    return Object.fromEntries(LANGS.map(lang => [lang, page(lang, calls)]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
    const pages = buildPages();
    for (const lang of LANGS) {
        fs.writeFileSync(PAGES[lang], pages[lang], 'utf8');
        console.log(`Wrote ${path.relative(ROOT, PAGES[lang])}`);
    }
}
