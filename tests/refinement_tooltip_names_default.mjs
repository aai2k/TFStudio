/**
 * The Refinement button's tooltip on the Optimization tab names the window's
 * default method in every language, as the window's method list names it.
 *
 * Run: node tests/refinement_tooltip_names_default.mjs
 */
import assert from 'node:assert/strict';

const { getLocale, availableLocales } = await import('../src/constants/locales/index.js');
const { DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');

for (const { code } of availableLocales) {
    const t = getLocale(code);
    const method = t.refinement.methods[DEFAULT_REFINE_METHOD];
    const tooltip = t.toolbar.tooltips.refinement;
    assert.ok(tooltip.toLowerCase().includes(method.toLowerCase()), `${code}: "${tooltip}" does not name ${method}`);
}

console.log('refinement_tooltip_names_default passed.');
