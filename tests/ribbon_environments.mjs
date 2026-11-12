/**
 * The Environment group of the Setup ribbon.
 *
 *   1. On a design with one environment the group holds the Environments
 *      button alone, under its own caption.
 *   2. With environments it holds Previous and Next as well, each off at its
 *      end of the list, and its caption names the current environment.
 *   3. Each button has an icon, a family colour, somewhere to go, and a label
 *      and a tooltip in every locale, the Environments tooltip a whole
 *      sentence.
 *
 * Run: node tests/ribbon_environments.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { Toolbar, makeTabs, ICONS, iconColorForTool } = await import('../src/components/Toolbar.js');
const { WINDOW_REGISTRY } = await import('../src/components/docking/windowRegistry.js');
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');

const h = React.createElement;
const c = makeTheme();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const group = (t, environment) => makeTabs(t, environment).find(tab => tab.key === 'setup').groups.find(g => g.key === 'environments');
const IDS = ['environments', 'environment-previous', 'environment-next'];
// How the Environments tooltip ends in each locale: one column per environment.
const COLUMN_EACH = {
    en: 'one column each', ru: 'по столбцу на каждые условия', zh: '每个环境一列', it: 'una colonna ciascuna',
};

// ── 1 and 2. What the group holds ────────────────────────────────────────────
{
    const t = makeLocale('en');
    const plain = group(t);
    assert.deepEqual(plain.items.map(item => item.id), ['environments'], 'one environment: the Environments button alone');
    assert.equal(plain.label, t.toolbar.groups.environments);
    assert.equal(group(t, null).label, plain.label);

    const first = group(t, { number: 1, count: 3 });
    assert.deepEqual(first.items.map(item => item.id), IDS);
    assert.equal(first.label, t.toolbar.environmentCaption(1, 3), 'the caption names the current environment');
    assert.deepEqual(first.items.map(item => !!item.disabled), [false, true, false], 'no previous before environment 1');
    assert.deepEqual(group(t, { number: 3, count: 3 }).items.map(item => !!item.disabled), [false, false, true], 'no next after the last');
}

// ── 3. Icons, colours, routes and words ──────────────────────────────────────
for (const id of IDS) {
    assert.ok(ICONS[id], `${id}: an icon`);
    assert.ok(iconColorForTool(id), `${id}: a family colour`);
}
{
    const items = group(makeLocale('en'), { number: 2, count: 3 }).items;
    assert.ok(WINDOW_REGISTRY.environments?.component, 'Environments opens its window');
    assert.ok(items.slice(1).every(item => item.action === item.id), 'Previous and Next run the ribbon\'s own action');
}
for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    for (const item of group(t, { number: 2, count: 3 }).items) {
        assert.ok(item.label && item.title, `${code}: ${item.id} has a label and a tooltip`);
    }
    assert.ok(t.toolbar.groups.environments && t.toolbar.environmentCaption(2, 3).includes('2/3'), `${code}: the captions`);
    assert.ok(t.toolbar.tooltips.environments.endsWith(COLUMN_EACH[code]), `${code}: the tooltip ends on its whole last phrase`);
}

// ── The ribbon as drawn ──────────────────────────────────────────────────────
{
    const t = makeLocale('en');
    const tb = t.toolbar;
    localStorage.setItem('tfstudio-ribbon-tab', 'setup');
    localStorage.setItem('tfstudio-ribbon-collapsed', '0');
    const draw = design => renderToStaticMarkup(withDesign(h(Toolbar, { c, t, onToolAction() {}, onMenuAction() {}, devAllowed: false }), design));
    const button = (html, id) => (html.match(/<button [^>]*>/g) || []).find(tag => tag.includes(`title="${esc(tb.tooltips[id])}"`));

    const plain = draw(oneEnvironmentDesign());
    assert.ok(button(plain, 'environments'), 'the Environments button is always there');
    assert.ok(!button(plain, 'environment-previous') && !button(plain, 'environment-next'), 'no Previous or Next on one environment');

    const design = threeEnvironmentDesign();
    currentEnvironmentSession.write(design, { current: 'env2' });
    const html = draw(design);
    currentEnvironmentSession.write(design, { current: 'base' });
    assert.ok(html.includes(`>${esc(tb.environmentCaption(2, 3))}</div>`), 'the caption follows the current environment');
    assert.ok(!button(html, 'environment-previous').includes('disabled') && !button(html, 'environment-next').includes('disabled'),
        'both arrows on in environment 2');
    assert.ok(button(draw(design), 'environment-previous').includes('disabled=""'), 'Previous is off in environment 1');
}

console.log('PASS ribbon_environments');
