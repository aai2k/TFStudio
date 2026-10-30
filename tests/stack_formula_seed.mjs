/**
 * Stack Formula opens on a formula another window hands it.
 *
 * The shell's Stack Formula flag is true when the ribbon opens the dialog, and
 * then the formula is read from the active design. Another window can set it
 * to a formula of its own, with the symbols, reference wavelength and media
 * that formula is written for, and the dialog opens on that instead.
 *
 * Run: node tests/stack_formula_seed.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { AppModals } = await import('../src/components/AppModals.js');

const c = makeTheme();
const t = makeLocale('en');
const design = makeSampleDesign();

const seed = {
    text: '(0.4L 0.548835H 0.362701L 0.548835H 0.4L)^3',
    rows: [
        { sym: 'H', matId: 'builtin:Ta2O5', fixed: true },
        { sym: 'L', matId: 'builtin:MgF2', fixed: true },
    ],
    refLambda: 510, incidentMat: 'builtin:Air', substrateMat: 'builtin:BK7',
};

function modals(showStackFormula) {
    return renderToStaticMarkup(withDesign(React.createElement(AppModals, {
        c, t, settings: {}, welcome: {}, activeDesignId: design.id,
        dialogs: { showStackFormula, setShowStackFormula() {} },
        project: { selectedFolder: { name: 'Designs' }, addItemFromDesign() {} },
        inputDialog: null, messageNotifications: [], onDismissMessage() {},
    }), design));
}

const textarea = html => html.match(/<textarea[^>]*>([^<]*)<\/textarea>/)?.[1];

// Opened from the ribbon: the design's own two layers.
const own = modals(true);
assert.ok(own.includes(t.stackFormula.title), 'the dialog opens');
assert.notEqual(textarea(own), seed.text, 'the ribbon opens on the design, not on a handed formula');

// Handed a formula: its text, its materials, its wavelength.
const handed = modals(seed);
assert.equal(textarea(handed), seed.text, 'the dialog opens on the handed formula');
assert.ok(handed.includes(t.stackFormula.layersCount(15)), 'three five-layer periods are built');
assert.ok(handed.includes('value="510"'), 'the reference wavelength is the one the formula is written for');
for (const name of ['Ta2O5', 'MgF2']) {
    assert.ok(handed.includes(name), `the symbols map to ${name}`);
}

console.log('stack_formula_seed: passed');
