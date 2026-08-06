/**
 * Design Editor stack diagram — illumination direction.
 *
 * The diagram draws the stack left to right as incident medium → front layers →
 * substrate → back layers → exit medium, with an arrow marking where the light
 * enters. Which end that is follows resolveEvalMode(), the same source of truth
 * every analysis window reads, so the diagram cannot disagree with what is
 * actually being computed:
 *
 *   front  → entered from the incident medium, arrow on the left  (→)
 *   total  → entered from the incident medium, arrow on the left  (→)
 *   back   → entered from the exit medium,     arrow on the right (←)
 *
 * Only a back coating scored on its own is illuminated from the exit side.
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { StackDiagram } =
    await import('../src/components/windows/design/designEditor/StackDiagram.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');

const c = makeTheme();
const t = makeLocale();
const de = t.designEditor;

function render(surfaceMode, mfEvalMode) {
    const design = {
        ...makeSampleDesign(),
        surfaceMode, mfEvalMode,
        backLayers: [{ id: 'b1', material: 'builtin:MgF2', thickness: 120, locked: false }],
    };
    return {
        html: renderToStaticMarkup(React.createElement(StackDiagram, { design, c, t })),
        mode: resolveEvalMode(design),
    };
}

// The arrow glyph and the block row are both plain text in the markup, so locate
// the arrow by its position relative to the first and last stack block.
function arrowSide(html) {
    const arrowIndex = Math.max(html.indexOf('→'), html.indexOf('←'));
    assert.notEqual(arrowIndex, -1, 'the diagram draws an arrow');
    const firstBlock = html.indexOf('Air');
    assert.notEqual(firstBlock, -1, 'the diagram draws its media blocks');
    return arrowIndex < firstBlock ? 'left' : 'right';
}

const cases = [
    { surfaceMode: 'front_only',       mfEvalMode: 'side',  mode: 'front', glyph: '→', side: 'left',  title: de.lightFromIncident },
    { surfaceMode: 'back_only',        mfEvalMode: 'side',  mode: 'back',  glyph: '←', side: 'right', title: de.lightFromExit },
    { surfaceMode: 'front_only',       mfEvalMode: 'total', mode: 'total', glyph: '→', side: 'left',  title: de.lightThroughStack },
    { surfaceMode: 'back_only',        mfEvalMode: 'total', mode: 'total', glyph: '→', side: 'left',  title: de.lightThroughStack },
    { surfaceMode: 'symmetric',        mfEvalMode: 'side',  mode: 'total', glyph: '→', side: 'left',  title: de.lightThroughStack },
    { surfaceMode: 'both_independent', mfEvalMode: 'side',  mode: 'total', glyph: '→', side: 'left',  title: de.lightThroughStack },
];

for (const testCase of cases) {
    const label = `${testCase.surfaceMode} + ${testCase.mfEvalMode}`;
    const { html, mode } = render(testCase.surfaceMode, testCase.mfEvalMode);

    assert.equal(mode, testCase.mode, `${label} evaluates as '${testCase.mode}'`);
    assert.ok(html.includes(testCase.glyph), `${label} draws '${testCase.glyph}'`);
    assert.equal(arrowSide(html), testCase.side, `${label} puts the arrow on the ${testCase.side}`);
    assert.ok(html.includes(testCase.title), `${label} explains the direction on hover`);
}

// Exactly one arrow is drawn, never both.
for (const testCase of cases) {
    const { html } = render(testCase.surfaceMode, testCase.mfEvalMode);
    const arrows = (html.match(/→|←/g) || []).length;
    assert.equal(arrows, 1, `${testCase.surfaceMode} + ${testCase.mfEvalMode} draws a single arrow`);
}

// A design that predates the surface-mode fields falls back to a front-side
// evaluation, so it keeps the original left-to-right reading.
{
    const design = makeSampleDesign();
    const html = renderToStaticMarkup(React.createElement(StackDiagram, { design, c, t }));
    assert.equal(resolveEvalMode(design), 'front');
    assert.ok(html.includes('→'));
    assert.equal(arrowSide(html), 'left');
}

console.log('PASS stack_diagram_light_direction');
