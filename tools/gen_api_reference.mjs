/**
 * gen_api_reference.mjs: write the manual's API Reference,
 * docs-site/src/content/docs/automation/api-reference.md and its zh twin,
 * from the source, so the page says what the object API takes in both
 * languages.
 *
 * Each class of the object API gets a section, in the order CLASSES lists
 * them, and each public method and attribute an entry: its JavaScript form
 * beside its Python form, then what it does, its arguments with their
 * defaults, what it gives and what it refuses, and its example in each
 * language (api-reference/entries.mjs). The JavaScript side is read from the
 * doc comments of src/api/objects (api-reference/jsObjects.mjs says how), the
 * Python side from the docstrings of python/tfstudio, read from the source
 * without running Python (api-reference/pyDocstrings.mjs); the two are paired
 * by name (api-reference/sides.mjs), and where they say the same, the entry
 * says it once (api-reference/pairs.mjs says when). The lists that live in
 * code are read from it (api-reference/codeLists.mjs says which): what each
 * pair of sides and scoreOn computes on heads the page.
 *
 * The zh page has the same structure. Its fixed sentences are in
 * api-reference/text.json. Every text read from the code is shown in Chinese
 * from api-reference/zh.json, under a key that says where the English comes
 * from, with a hash of the English it translates (api-reference/translations.mjs):
 *
 *   <Class>.lead.<n>                the nth paragraph of a class's doc
 *   <Class>.<member>.lead.<n>       the nth paragraph of a member's doc
 *   <Class>.<member>.arg.<name>     an argument, by its JavaScript name
 *   <Class>.<member>.returns        what a method returns
 *   <Class>.<member>.refuses.<n>    the nth refusal
 *   <Class>.<member>.raises.<n>     the nth error Python raises besides
 *   <Class>.().arg.<name>, .raises.<n>   what making the class takes, in Python
 *   <method>.setting.<key>          a setting of a synthesis method
 *   <call>.property.result.stopReason   why a run ends
 *
 * A key ends in .js or .py for a text one language says and the other says
 * otherwise. A text with no zh entry, an entry whose English has changed
 * since it was written, or an entry no text uses stops the generator, naming
 * the key, the English as it is now and its hash.
 *
 * Usage: node tools/gen_api_reference.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { jsObjects } from './api-reference/jsObjects.mjs';
import { pyObjects } from './api-reference/pyDocstrings.mjs';
import { translatorFor } from './api-reference/translations.mjs';
import { argsOf, keywordForm, pairsOf } from './api-reference/sides.mjs';
import { argumentRows, entry, examples, formsTable, noteOf, paragraphs, refusals } from './api-reference/entries.mjs';
import { extras, modesSection } from './api-reference/codeLists.mjs';
import { CODE, LANGS, ROOT, TEXT, pageTitle, pagesAt, table } from './api-reference/markdown.mjs';

const PACKAGE = path.join(ROOT, 'python', 'tfstudio');
export const PAGES = pagesAt('automation/api-reference');

// The classes in the order the page gives them, each with the name its
// entries call one of it by, and for a list the name of one item.
const CLASSES = [
    { name: 'TFStudio', receiver: 'tf' },
    { name: 'Design', receiver: 'design' },
    { name: 'Substrate', receiver: 'design.substrate' },
    { name: 'Layers', receiver: 'design.layers', item: 'layer' },
    { name: 'Layer', receiver: 'design.layers[n]' },
    { name: 'Merit', receiver: 'design.merit' },
    { name: 'MeritRow', receiver: 'row' },
    { name: 'Specification', receiver: 'design.specification' },
    { name: 'SpecCheck', receiver: 'check' },
    { name: 'SpecReport', receiver: 'report' },
    { name: 'CheckResult', receiver: 'row' },
    { name: 'Yield', receiver: 'y' },
    { name: 'Spectrum', receiver: 's' },
    { name: 'Curve', receiver: 's.R' },
    { name: 'IndexProfile', receiver: 'profile' },
    { name: 'LayerThicknesses', receiver: 'thicknesses' },
    { name: 'Admittance', receiver: 'locus' },
    { name: 'ElectricField', receiver: 'field' },
    { name: 'RunResult', receiver: 'run' },
    { name: 'Progress', receiver: 'p' },
    { name: 'MonteCarlo', receiver: 'mc' },
    { name: 'LayerSensitivity', receiver: 'ls' },
    { name: 'SensitivityRow', receiver: 'row' },
    { name: 'CleanReport', receiver: 'report' },
    { name: 'Materials', receiver: 'tf.materials' },
    { name: 'Material', receiver: 'material' },
    { name: 'Stop', receiver: 'stop' },
    { name: 'App', receiver: 'tf.app' },
    { name: 'AppDesign', receiver: 'd' },
];
// The errors, in a section of their own.
const ERRORS = ['TFStudioError', 'AppError', 'ServerError'];
const EM_DASH = String.fromCodePoint(0x2014);

// How a program makes the class, which only Python's objects do.
function constructorPart(L, cls, pyClass) {
    const doc = pyClass.doc;
    const side = { form: [`tfstudio.${cls.name}(${keywordForm(argsOf(doc)).join(', ')})`], args: argsOf(doc), refuses: [], raises: doc.raises };
    const E = { L, key: `${cls.name}.()`, both: false };
    return [...formsTable(L, null, side, { js: noteOf(L, 'js', E.key) }), ...table(L.t.args.slice(1), argumentRows(E, null, side).map(row => row.slice(1))),
        ...refusals(E, null, side)];
}

function classSection(L, cls, js, py) {
    const jsClass = js[cls.name], pyClass = py[cls.name];
    const onlyPython = !jsClass;
    const E = { L, key: cls.name, both: !!jsClass };
    // What JavaScript has in place of a class only Python has, with its example.
    const instead = CODE[cls.name] ? ['```js', CODE[cls.name], '```', ''] : [];
    const intro = onlyPython ? [noteOf(L, 'js', cls.name), '', ...instead] : [];
    const constructor = pyClass.doc.args.length ? constructorPart(L, cls, pyClass) : [];
    return [
        `## ${cls.name}`, '', ...paragraphs(E, jsClass?.doc.lead, pyClass.doc.lead).flatMap(p => [p, '']), ...intro, ...constructor,
        ...examples(jsClass?.doc, pyClass.doc),
        ...pairsOf(cls, jsClass, pyClass).flatMap(pair => entry(L, cls, pair, onlyPython)),
    ];
}

function errorsSection(L, py) {
    const entries = ERRORS.flatMap(name => {
        const doc = py[name].doc;
        return [`### ${name}`, '', ...paragraphs({ L, key: name, both: false }, [], doc.lead).flatMap(p => [p, '']), ...examples(null, doc)];
    });
    return [`## ${L.t.errorsTitle}`, '', ...L.t.errorsIntro.flatMap(p => [p, '']), '```js', CODE.errors, '```', '', ...entries];
}

// A zh link names the page it opens by that page's title, so the reader finds
// the same name at the other end. An English link runs in its sentence instead.
function checkLinkTitles(text, lang) {
    for (const [, label, slug] of text.matchAll(/\[([^\]]+)\]\(\/([\w/-]+?)\/(?:#[^)]*)?\)/g)) {
        const title = pageTitle(lang, slug);
        if (label !== title) throw new Error(`the ${lang} page links to ${slug} as "${label}"; the page is titled "${title}"`);
    }
}

// `lines` with each link to `#section:Name` made a link to the section
// headed `## Name`, by the anchor the docs site gives it: its heading in lower
// case without punctuation, spaces as hyphens, and -1, -2 after a heading of
// the page that has the same.
function sectionLinks(lines) {
    const seen = new Map(), anchors = {};
    for (const line of lines.filter(l => /^#{2,6} /.test(l))) {
        const base = line.replace(/^#+ /, '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '').replace(/ /g, '-');
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        if (line.startsWith('## ')) anchors[line.slice(3)] = count ? `${base}-${count}` : base;
    }
    return lines.map(line => line.replace(/\(#section:(\w+)\)/g, (_, name) => `(#${anchors[name]})`));
}

// Every class of both languages is on the page, so a new one cannot be missed.
function checkClasses(js, py) {
    const listed = new Set([...CLASSES.map(c => c.name), ...ERRORS]);
    const missing = [...Object.keys(js), ...Object.keys(py)].filter(name => !listed.has(name));
    if (missing.length) throw new Error(`tools/gen_api_reference.mjs places no section for ${[...new Set(missing)].join(', ')}`);
}

function page(lang, js, py) {
    const translator = translatorFor(lang);
    const L = { lang, t: TEXT[lang], text: translator.text, extras };
    const results = CLASSES.filter(c => js[c.name]?.members.mode).map(c => c.name);
    const body = sectionLinks([...modesSection(L, results), ...CLASSES.flatMap(cls => classSection(L, cls, js, py)), ...errorsSection(L, py)]);
    translator.check();
    const text = ['---', ...L.t.frontmatter, '---', '', ...L.t.intro.flatMap(p => [p, '']), ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    if (text.includes(EM_DASH)) throw new Error(`the ${lang} page holds an em dash, which the manual does not use`);
    if (lang === 'en') return text;
    checkLinkTitles(text, lang);
    return text.replaceAll('](/', `](/${lang}/`);
}

/** The page in `lang` as the generator writes it. */
export function buildPage(lang) {
    const js = jsObjects(path.join(ROOT, 'src', 'api', 'objects'));
    const { classes: py } = pyObjects(PACKAGE);
    checkClasses(js, py);
    return page(lang, js, py);
}

/** Both pages as the generator writes them: { en, zh }. */
export function buildPages() {
    return Object.fromEntries(LANGS.map(lang => [lang, buildPage(lang)]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
    const pages = buildPages();
    for (const lang of LANGS) {
        fs.writeFileSync(PAGES[lang], pages[lang], 'utf8');
        console.log(`Wrote ${path.relative(ROOT, PAGES[lang])}`);
    }
}
