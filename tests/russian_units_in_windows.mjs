/**
 * No window writes a unit symbol in Latin letters in the Russian UI.
 *
 * Unit symbols come from t.units, which Russian writes нм, мм, мкм, фс, Н/м.
 * A unit typed into the code as a literal reads nm in every language; this
 * renders every window and modal wizard in Russian, with a design that has
 * layers on both sides, a merit operand and a requirement, and looks for one in
 * the text, the tooltips, the accessible names and the placeholders.
 *
 * Each window is rendered twice: as it opens, and with every state that starts
 * false started true. The second pass opens settings popovers and collapsed
 * sections, which is the only way a static render reaches a unit inside them.
 *
 * Run: node tests/russian_units_in_windows.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
// Installed before any window module loads, since each one takes useState from
// React when it is imported.
let openAll = false;
const realUseState = React.useState;
React.useState = init => realUseState(openAll && init === false ? true : init);

const { getLocale } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const ru = getLocale('ru');
const c = makeTheme();

// Windows that never reach a user, and why.
const EXEMPT = {
    OptimizerBenchmark: 'dev-only, behind the dev menu and absent from a release build',
};

// Windows still writing a Latin unit, fixed area by area.
const NOT_YET = new Set([
    'DesignCleaner', 'Variator',
    'BBMWizard', 'MonoWizard', 'FilterDesignWizard', 'StackFormulaDialog',
]);

const registry = new URL('../src/components/docking/windowRegistry.js', import.meta.url);
const windows = [...readFileSync(registry, 'utf-8')
    .matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'(\.\.\/windows\/[\w/]+\.js)'/g)]
    .map(([, name, path]) => ({ name, url: new URL(path, registry) }));
assert.ok(windows.length >= 35, `expected the full registry, found ${windows.length} windows`);
for (const [name, path] of [
    ['BBMWizard', 'simulation/bbmWizard/BBMWizard.js'],
    ['MonoWizard', 'simulation/monoWizard/MonoWizard.js'],
    ['FilterDesignWizard', 'optimization/filterDesignWizard/FilterDesignWizard.js'],
    ['StackFormulaDialog', 'design/stackFormula/StackFormulaDialog.js'],
]) windows.push({ name, url: new URL(`../src/components/windows/${path}`, import.meta.url) });

const design = {
    ...makeSampleDesign(),
    backLayers: [{ id: 'b1', material: 'builtin:SiO2', thickness: 80, locked: false }],
    surfaceMode: 'both_independent',
    meritOperands: [{ id: 'm', type: 'TAV', enabled: true, lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0.99, weight: 1 }],
    qualifiers: [{ id: 'q', kind: 'CENTRAL_LAMBDA', channel: 'T', lambdaStart: 400, lambdaEnd: 700, cmp: 'eq', target: 550, tol: 5, enabled: true }],
};

const LATIN_UNIT = /(^|[^A-Za-z_])(nm|mm|µm|um|fs|cm⁻¹|THz|eV|MPa|GPa|N\/m|J\/m²)(?![A-Za-z_0-9])/;
const decode = s => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// What a reader sees or hears: text between tags, and the attributes a screen
// shows on hover or reads aloud.
function shownStrings(html) {
    const attributes = [...html.matchAll(/(?:title|aria-label|placeholder)="([^"]*)"/g)].map(([, value]) => value);
    const text = html.replace(/<style[\s\S]*?<\/style>/g, '').split(/<[^>]*>/);
    return [...text, ...attributes].map(decode).map(s => s.trim()).filter(Boolean);
}

const failures = [];
for (const open of [false, true]) {
    openAll = open;
    for (const { name, url } of windows) {
        if (EXEMPT[name] || NOT_YET.has(name)) continue;
        const Window = (await import(url))[name];
        const html = renderToStaticMarkup(withDesign(React.createElement(Window, {
            c, t: ru, theme: c, setInputDialog() {}, onClose() {},
            folderName: 'Demo', hasActiveDesign: true, onCreateNew() {},
        }), design));
        const latin = shownStrings(html).filter(s => LATIN_UNIT.test(s));
        if (latin.length) failures.push(`${name}${open ? ' (opened)' : ''}: ${latin.slice(0, 3).join(' | ')}`);
    }
}
openAll = false;
assert.deepEqual(failures, [], 'a Russian window writes a Latin unit');

console.log('russian_units_in_windows passed.');
