/**
 * Stack Formula has a help button that opens its help page.
 *
 * Its header carries the same "?" button as the Edge Filter beside it on the
 * ribbon, and the page the button opens exists in English and Chinese.
 *
 * Run: node tests/stack_formula_help.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { StackFormulaDialog, STACK_FORMULA_HELP } = await import('../src/components/windows/design/stackFormula/StackFormulaDialog.js');

const c = makeTheme();
const t = makeLocale('en');
const design = makeSampleDesign();

const html = renderToStaticMarkup(withDesign(React.createElement(StackFormulaDialog, {
    c, t, folderName: 'Designs', hasActiveDesign: true, onClose() {}, onCreateNew() {},
}), design));
assert.ok(html.includes(`title="${t.stackFormula.help}"`), 'the header has a help button');
assert.match(html, />\?<\/button>/, 'drawn as the "?" the Edge Filter has');

for (const page of [`${STACK_FORMULA_HELP}.md`, `zh/${STACK_FORMULA_HELP}.md`]) {
    assert.ok(existsSync(new URL(`../docs-site/src/content/docs/${page}`, import.meta.url)), `the button opens ${page}`);
}

console.log('stack_formula_help: passed');
