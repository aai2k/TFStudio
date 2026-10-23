/**
 * The lists the API Reference reads from the code, for the generator
 * (tools/gen_api_reference.mjs): what each pair of `sides` and `scoreOn`
 * computes on, from the object API's names and the evaluation mode it
 * resolves to, with the Design Editor's labels from the locales; the
 * refinement methods with their names and iteration budgets
 * (refinement/methods.js and the Refinement window's method names); why a run
 * ends (the plain API's doc comments in src/api/runs.js); the synthesis
 * methods (api/runs.js) with their window titles, each one's settings with
 * their defaults, what they take and what they set (each run's settings.js);
 * and the merit row types this version evaluates, grouped as the Operand
 * Reference page groups them.
 *
 * `extras` gives what an entry adds from them, by the entry's key, each for
 * the page `L` as entries.mjs takes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiCalls } from './docComments.mjs';
import { pyNameOf, pythonDict } from './sides.mjs';
import { ROOT, capitalized, code, fill, literal, pageTitle, pagesAt, table } from './markdown.mjs';
import { SYNTHESIS_METHODS, FLOOR_FROM_MNT } from '../../src/api/runs.js';
import { SIDES, SCORE_ON } from '../../src/api/objects/design.js';
import { OPERAND_TYPES, resolveEvalMode } from '../../src/utils/physics/optimizer.js';
import { REFINE_METHODS, ALL_ORDER, STOCHASTIC_METHODS, defaultMaxIter } from '../../src/utils/refinement/methods.js';
import { CHECKS as NEEDLE_CHECKS, NEEDLE_DEFAULTS } from '../../src/utils/needle/settings.js';
import { CHECKS as GE_CHECKS, GE_DEFAULTS } from '../../src/utils/gradualEvolution/settings.js';
import { CHECKS as STRUCTURAL_CHECKS, RUN_DEFAULTS as STRUCTURAL_DEFAULTS } from '../../src/utils/structural/settings.js';
import en from '../../src/constants/locales/en.js';
import zh from '../../src/constants/locales/zh.js';

const LOCALES = { en, zh };

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

// The names of sides and scoreOn are the same in both languages.
for (const [js, name] of [[SIDES, 'SIDES'], [SCORE_ON, 'SCORE_ON']]) {
    if (JSON.stringify(Object.entries(js)) !== JSON.stringify(pythonDict('_design.py', name))) {
        throw new Error(`python/tfstudio/_design.py's ${name} is not src/api/objects/design.js's`);
    }
}

const PLAIN = Object.fromEntries(apiCalls(path.join(ROOT, 'src', 'api')).map(call => [call.name, call]));

// Why a run of the plain call `call` ends, as its doc comment lists the reasons.
function stopReasons(L, call) {
    const reason = PLAIN[call].properties.find(p => p.name === 'result.stopReason');
    return [`#### ${L.t.stopReasons}`, '', L.text(`${call}.property.result.stopReason`, reason.text), ''];
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

const refineExtras = L => [`#### ${L.t.methods}`, '', ...table(L.t.refineMethods, refineMethodRows(L)), ...stopReasons(L, 'refine')];

function synthesisOf(method) {
    if (!SYNTHESIS[method]) throw new Error(`the synthesis method ${method} has no window or settings in tools/api-reference/codeLists.mjs`);
    return SYNTHESIS[method];
}

// A setting's default in both languages' literals, given once where they agree.
function settingDefault(value) {
    if (value === undefined) return '';
    const js = literal(value);
    const py = js.replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None');
    return js === py ? code(js) : `${code(js)} / ${code(py)}`;
}

// A method's settings: those with a starting value in its defaults' order, then the rest.
function methodSettings(method, L) {
    const { checks, defaults } = synthesisOf(method);
    const byKey = new Map(checks.map(row => [row[0], row]));
    const keys = [...new Set([...Object.keys(defaults), ...byKey.keys()])];
    const floorFromMnt = FLOOR_FROM_MNT.has(method);
    const rows = keys.map(key => {
        if (!byKey.has(key)) throw new Error(`${method}: the default ${key} has no check`);
        const [, , takes, sets] = byKey.get(key);
        if (!sets) throw new Error(`the setting ${key} has no words for what it sets`);
        const value = key === 'dMin' && floorFromMnt ? `${settingDefault(defaults.dMin)} ${L.t.orMnt}` : settingDefault(defaults[key]);
        return [code(key), code(pyNameOf(key)), value, L.text(`${method}.setting.${key}`, `${sets} ${capitalized(takes)}.`)];
    });
    return [`#### ${fill(L.t.settingsOf, { method })}`, '', ...table(L.t.settings, rows)];
}

// The window a method runs in, by the title the app gives it, and its page.
function windowCells(method, lang) {
    const { window, slug } = synthesisOf(method);
    const title = LOCALES[lang].windowTitles[window];
    if (!title) throw new Error(`the ${lang} locale has no window title for ${window}`);
    return [title, `[${pageTitle(lang, slug)}](/${slug}/)`];
}

function synthesisExtras(L) {
    const methods = SHOWN_SYNTHESIS.map(m => [code(m), ...windowCells(m, L.lang)]);
    return [`#### ${L.t.methods}`, '', ...table(L.t.synthesisMethods, methods), ...stopReasons(L, 'synthesize'),
        ...SHOWN_SYNTHESIS.flatMap(m => methodSettings(m, L))];
}

// Each type a table of the Operand Reference page lists first in its first
// column, with the section it is in.
function operandSections(lang) {
    const found = new Map();
    let heading = null;
    for (const line of fs.readFileSync(pagesAt('design/operands')[lang], 'utf8').split(/\r?\n/)) {
        if (line.startsWith('## ')) heading = line.slice(3).trim();
        const first = line.startsWith('| `') ? line.split('|')[1] : '';
        for (const [, type] of first.matchAll(/`(\w+)`/g)) if (!found.has(type)) found.set(type, heading);
    }
    return found;
}

// The merit row types this version evaluates, by their section of the page.
function operandKinds(L) {
    const sections = operandSections(L.lang);
    const byHeading = new Map();
    for (const type of OPERAND_TYPES) {
        if (!sections.has(type)) throw new Error(`the operand ${type} is in no table of the Operand Reference page`);
        byHeading.set(sections.get(type), [...(byHeading.get(sections.get(type)) ?? []), type]);
    }
    return [...byHeading].map(([heading, types]) => [heading, types.map(code).join(L.t.listSeparator)]);
}

function meritTypes(L) {
    return [fill(L.t.operandIntro, { page: `[${pageTitle(L.lang, 'design/operands')}](/design/operands/)` }), '', ...table(L.t.operandHead, operandKinds(L))];
}

/** What an entry adds from the lists that live in code, by the entry's key. */
export const extras = { 'Design.refine': refineExtras, 'Design.synthesize': synthesisExtras, 'Merit.add': meritTypes };

// The Design Editor's controls for a pair of sides and scoreOn, in `lang`,
// by their labels in the app: Surface, and Ignore other side where it counts.
function editorCell(L, sides, scoreOn) {
    const bar = LOCALES[L.lang].modeBar;
    const both = bar.surface.both;
    const surface = { front: bar.surface.front_only, back: bar.surface.back_only, both, symmetric: fill(L.t.withLabel, { value: both, label: bar.symmetricLabel }) }[sides];
    const controls = [fill(L.t.labelled, { label: bar.surfaceLabel, value: surface })];
    if (scoreOn !== null) controls.push(fill(L.t.labelled, { label: bar.ignoreLabel, value: scoreOn === 'side' ? L.t.ticked : L.t.notTicked }));
    return controls.join(L.t.controlSeparator);
}

// What each pair of sides and scoreOn computes on, a row per pair, one row
// for a value of sides that computes on the same whichever scoreOn.
function modeRows(L) {
    const bar = LOCALES[L.lang].modeBar;
    return Object.keys(SIDES).flatMap(sides => {
        const modes = Object.keys(SCORE_ON).map(scoreOn => [scoreOn, resolveEvalMode({ surfaceMode: SIDES[sides], mfEvalMode: SCORE_ON[scoreOn] })]);
        const same = modes.every(([, mode]) => mode === modes[0][1]);
        const shownModes = same ? [[null, modes[0][1]]] : modes;
        return shownModes.map(([scoreOn, mode]) => [code(literal(sides)), scoreOn === null ? L.t.anyScoreOn : code(literal(scoreOn)),
            editorCell(L, sides, scoreOn), fill(L.t.modeCell, { mode: code(literal(mode)), label: bar.evalBadgeLabel, badge: bar.evalBadge[mode] })]);
    });
}

/**
 * The section on front, back and total: what each pair of sides and scoreOn
 * computes on, and the results, of the class names `results`, that say which
 * it was, each linked to its section as `#section:Name`, which the page then
 * makes the section's anchor.
 */
export function modesSection(L, results) {
    const named = results.map(name => `[${name}](#section:${name})`);
    const listed = fill(L.t.modesResults, { classes: `${named.slice(0, -1).join(L.t.listSeparator)}${L.t.and}${named.at(-1)}` });
    return [`## ${L.t.modesTitle}`, '', ...L.t.modesIntro.flatMap(p => [p, '']), ...table(L.t.modesHead, modeRows(L)), listed, ''];
}
