/**
 * Design Editor move arrows: every layer row carries an up and a down arrow,
 * named in every locale, and the arrow that would push a row past either end
 * of the table is disabled.
 *
 * Run: node tests/design_editor_move_arrows.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { DesignEditor } = await import('../src/components/windows/design/designEditor/DesignEditor.js');

initCatalogs({});
const c = makeTheme();
const design = {
    ...makeSampleDesign(),
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: ['l1', 'l2', 'l3'].map(id => ({ id, material: 'builtin:SiO2', thickness: 100, locked: false })),
};

for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    const html = renderToStaticMarkup(withDesign(React.createElement(DesignEditor, { c, t }), design));
    const buttons = label => [...html.matchAll(/<button([^>]*)>/g)]
        .map(match => match[1])
        .filter(attributes => attributes.includes(`aria-label="${label}"`));
    const up = buttons(t.designEditor.moveUpRow);
    const down = buttons(t.designEditor.moveDownRow);
    assert.equal(up.length, design.frontLayers.length, `${code}: every row has an up arrow`);
    assert.equal(down.length, design.frontLayers.length, `${code}: every row has a down arrow`);
    assert.deepEqual(up.map(attributes => attributes.includes('disabled')), [true, false, false],
        `${code}: only the first row's up arrow is disabled`);
    assert.deepEqual(down.map(attributes => attributes.includes('disabled')), [false, false, true],
        `${code}: only the last row's down arrow is disabled`);
}

console.log('PASS design_editor_move_arrows');
