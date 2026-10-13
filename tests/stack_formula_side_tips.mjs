/**
 * Stack Formula's Append and Replace tips name the side the formula goes to.
 *
 * The footer's Apply to switch sends the formula to the front, the back or
 * both, and a symmetric design takes it on the front and mirrors it to the
 * back. The tips said "front stack" whatever the switch was on.
 *
 * Run: node tests/stack_formula_side_tips.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { Footer } = await import('../src/components/windows/design/stackFormula/Footer.js');

const c = makeTheme();
const tips = (sf, side, isSym = false) => {
    const state = {
        compiled: { ok: true }, isSym, applySide: side, effSide: isSym ? 'front' : side,
        setApplySide() {}, newName: 'Formula', setNewName() {}, applyToDesign() {},
    };
    const html = renderToStaticMarkup(React.createElement(Footer, {
        state, c, sf, folderName: 'Designs', hasActiveDesign: true, onClose() {},
    }));
    return [...html.matchAll(/<button title="([^"]*)"/g)].map(match => match[1]);
};

for (const code of ['en', 'ru', 'zh', 'it']) {
    const sf = getLocale(code).stackFormula;
    for (const side of ['front', 'back', 'both']) {
        const shown = tips(sf, side);
        assert.ok(shown.includes(sf.appendTip[side]) && shown.includes(sf.replaceTip[side]), `${code} ${side}: ${shown.join(' | ')}`);
    }
    const mirrored = tips(sf, 'back', true);
    assert.ok(mirrored.includes(sf.appendTip.both) && mirrored.includes(sf.replaceTip.both),
        `${code} symmetric: the tips name both stacks, ${mirrored.join(' | ')}`);
    const texts = ['front', 'back', 'both'].flatMap(side => [sf.appendTip[side], sf.replaceTip[side]]);
    assert.equal(new Set(texts).size, texts.length, `${code}: every side has its own wording`);
}

console.log('Stack Formula side tips tests passed.');
