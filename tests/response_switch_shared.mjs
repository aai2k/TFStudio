/**
 * Transmitted or reflected light is one switch, the same in every window that
 * picks between the two: T with a blue dot and R with a red one.
 *
 *   1. GD/GDD, Pulse Analysis and Color Evaluation each render the shared
 *      switch in every language, and only once.
 *   2. So do the report's color and GD/GDD block settings.
 *   3. Pulse Analysis offers T alone for the whole part, which it computes in
 *      transmission only.
 *   4. No component builds a list of choices holding R and T without A, so no
 *      window draws its own. A list with A is a T, R and A switch, left as is.
 *
 * Run: node tests/response_switch_shared.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const { ResponseChoice } = await import('../src/components/windows/analysis/chrome/controls.js');
const { GDGDDEvaluation } = await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');
const { PulseAnalysis } = await import('../src/components/windows/analysis/pulseAnalysis/PulseAnalysis.js');
const { pulseSession } = await import('../src/components/windows/analysis/pulseAnalysis/sessionState.js');
const { ColorEvaluation } = await import('../src/components/windows/analysis/colorEvaluation/ColorEvaluation.js');
const { BlockSettingsPanel } = await import('../src/components/windows/information/report/BlockSettings.js');
const { newBlock } = await import('../src/utils/report/blocks.js');

const c = makeTheme();
const design = makeSampleDesign();
const WINDOWS = { 'GD/GDD': GDGDDEvaluation, 'Pulse Analysis': PulseAnalysis, 'Color Evaluation': ColorEvaluation };

const rendered = (Window, t) => renderToStaticMarkup(withDesign(React.createElement(Window, { c, t, theme: c }), design));
const switchMarkup = (t, activeId, ids) =>
    renderToStaticMarkup(React.createElement(ResponseChoice, { c, t, activeId, onSelect() {}, ids }));
const shows = (html, t) => ['T', 'R'].some(id => html.includes(switchMarkup(t, id)));
const count = (text, part) => text.split(part).length - 1;

// ── 1. The windows ───────────────────────────────────────────────────────────
for (const lang of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(lang);
    const group = `aria-label="${t.analysisChrome.response}"`;
    for (const [name, Window] of Object.entries(WINDOWS)) {
        const html = rendered(Window, t);
        assert.ok(shows(html, t), `${lang}: ${name} shows the shared T and R switch`);
        assert.equal(count(html, group), 1, `${lang}: ${name} shows it once`);
    }
}
{
    const t = makeLocale('en');
    const html = switchMarkup(t, 'T');
    assert.ok(html.indexOf('>T<') < html.indexOf('>R<'), 'T comes first, as in the T, R and A switches');
    assert.ok(html.includes(`title="${t.analysisChrome.transmission}"`) && html.includes(`title="${t.analysisChrome.reflection}"`),
        'the words are on hover');
}

// ── 2. The report's block settings ───────────────────────────────────────────
{
    const t = makeLocale('en');
    for (const type of ['color', 'gdGdd']) {
        const html = renderToStaticMarkup(React.createElement('div', null, BlockSettingsPanel({
            c, W: t.report.window, t, block: newBlock(type), index: 0, count: 1, design: null,
            onChange() {}, onMove() {}, onRemove() {}, onClose() {},
        })));
        assert.ok(shows(html, t), `the report's ${type} block settings show the shared switch`);
    }
}

// ── 3. The whole part in Pulse Analysis ──────────────────────────────────────
{
    const t = makeLocale('en');
    pulseSession.read(design);
    pulseSession.write(design, { side: 'whole', target: 'T' });
    assert.ok(rendered(PulseAnalysis, t).includes(switchMarkup(t, 'T', ['T'])),
        'Pulse Analysis through the whole part offers T alone');
    pulseSession.reset();
}

// ── 4. No component builds its own ───────────────────────────────────────────
{
    const root = fileURLToPath(new URL('../src/components/', import.meta.url));
    const sources = readdirSync(root, { recursive: true }).filter(name => name.endsWith('.js'));
    for (const name of sources) {
        const text = readFileSync(root + name, 'utf8');
        for (const [, list] of text.matchAll(/\[([^[\]]*)\]/g)) {
            const holds = id => list.includes(`id: '${id}'`);
            assert.ok(!(holds('R') && holds('T') && !holds('A')),
                `${name} builds its own R and T switch instead of ResponseChoice`);
        }
    }
}

console.log('response_switch_shared: passed');
