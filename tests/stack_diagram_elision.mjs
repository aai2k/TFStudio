/**
 * Design Editor stack diagram — long coatings elide their middle.
 *
 * The row is one flex line of fixed height, so every extra layer takes width
 * from the others. Past a threshold the blocks shrink until neither their width
 * nor their material colour reads, which is precisely when a stack is complex
 * enough to be worth looking at. Each coating therefore draws its first and last
 * few layers and replaces everything between with a single marker.
 *
 * Front and back elide independently, because the substrate sits between them
 * and a marker spanning it would claim layers on both sides.
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { StackDiagram } =
    await import('../src/components/windows/design/designEditor/StackDiagram.js');

const c = makeTheme();
const t = makeLocale();
const de = t.designEditor;

const ELIDE_ABOVE = 20;
const ELIDED_ENDS = 8;

function layers(count, prefix) {
    return Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i}`,
        material: i % 2 === 0 ? 'builtin:TiO2' : 'builtin:SiO2',
        thickness: 100,
        locked: false,
    }));
}

function render(frontCount, backCount) {
    const design = {
        ...makeSampleDesign(),
        surfaceMode: 'both_independent',
        frontLayers: layers(frontCount, 'f'),
        backLayers: layers(backCount, 'b'),
    };
    return renderToStaticMarkup(React.createElement(StackDiagram, { design, c, t }));
}

// A dashed border is what separates the marker from a material block, so it is
// also the thing to count: a marker that looked like a layer would be worse
// than no elision at all.
function markerCount(html) {
    return (html.match(/1px dashed/g) || []).length;
}

// ── The threshold ────────────────────────────────────────────────────────────

{
    const html = render(ELIDE_ABOVE, 0);
    assert.equal(markerCount(html), 0, 'a coating at the threshold draws every layer');
}

{
    const html = render(ELIDE_ABOVE + 1, 0);
    assert.equal(markerCount(html), 1, 'one layer past the threshold elides');
    assert.ok(html.includes(de.elidedLayers(ELIDE_ABOVE + 1 - 2 * ELIDED_ENDS)),
        'the marker reports how many layers it stands for');
}

// ── Each coating elides on its own ───────────────────────────────────────────

{
    const html = render(99, 99);
    assert.equal(markerCount(html), 2, 'front and back each get their own marker');
    assert.ok(html.includes(de.elidedLayers(99 - 2 * ELIDED_ENDS)),
        'both markers report the layers they hide');
}

{
    // A long front and a short back: only the long one elides, and the short
    // coating still draws every layer it has.
    const html = render(60, 3);
    assert.equal(markerCount(html), 1, 'a short coating beside a long one is untouched');
    assert.ok(html.includes(de.elidedLayers(60 - 2 * ELIDED_ENDS)));
}

{
    const html = render(0, 0);
    assert.equal(markerCount(html), 0, 'a bare substrate has nothing to elide');
}

// ── Nothing is silently lost ─────────────────────────────────────────────────

{
    const html = render(99, 0);
    // The hidden layers are named on hover, so the marker says what it covers
    // rather than only how much.
    assert.ok(html.includes('TiO2') && html.includes('SiO2'),
        'the marker names the materials it spans');
    // The count under the diagram is the authority on totals and is unaffected
    // by how many blocks were drawn.
    assert.ok(html.includes(de.frontSummary(99, (99 * 100).toFixed(1))),
        'the layer-count summary still reports the true total');
}

// ── The drawn row stays short enough for its blocks to read ──────────────────

{
    // Blocks are one flex line, so the count they must share is what decides
    // whether any of them is visible. Two coatings at the threshold is the
    // widest the row can get.
    const html = render(99, 99);
    const blocks = (html.match(/<div [^>]*style="flex:/g) || []).length;
    const widest = 2 * ELIDE_ABOVE + 3;
    assert.ok(blocks <= widest,
        `a 99 + 99 stack draws ${blocks} blocks, no more than the ${widest} an unelided pair would`);
}

console.log('PASS stack_diagram_elision');
