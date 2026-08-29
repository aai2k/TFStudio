/**
 * The ribbon's four tabs (src/components/Toolbar.js).
 *
 * A ribbon entry is three things that have to agree: an icon, a label in every
 * locale, and a tool the click actually reaches. Any one of them can go missing
 * without an error at runtime — a wrong id renders a blank button that opens
 * nothing, a missing locale key renders an empty label — so each is asserted
 * here against its own source of truth.
 *
 * Run: node tests/ribbon_tabs.mjs
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { Toolbar, makeTabs, searchRibbon, ICONS, RIBBON_TABS, iconColorForTool } =
    await import('../src/components/Toolbar.js');
const { TitleBar } = await import('../src/components/TitleBar.js');
const { WINDOW_REGISTRY } = await import('../src/components/docking/windowRegistry.js');

const c = makeTheme();
const t = makeLocale('en');
const tabs = makeTabs(t);
const idsOf = (tab) => tab.groups.flatMap(g => g.items.map(i => i.id));
const allIds = tabs.flatMap(idsOf);

// Ribbon ids that open a renderer-level dialog instead of a docked window, so
// they are absent from WINDOW_REGISTRY on purpose. Mirrors handleToolAction.
const RENDERER_HANDLED = new Set([
    'new-design', 'open-project', 'save', 'save-as', 'undo', 'redo',
    'stack-formula', 'filter-design', 'bbm-simulator', 'mono-simulator',
    'report-gen', 'help-docs', 'preferences',
]);

// The title bar repeats these; they are on the Design tab as well, deliberately.
const QUICK_ACCESS = ['new-design', 'open-project', 'save', 'undo', 'redo'];

// ── Structure ─────────────────────────────────────────────────────────────────

assert.deepEqual(tabs.map(x => x.key), RIBBON_TABS,
    'RIBBON_TABS must list the tabs in the order they are rendered');

assert.equal(new Set(allIds).size, allIds.length,
    'a tool must appear on exactly one tab');

for (const tab of tabs) {
    assert.ok(tab.groups.length > 0, `tab ${tab.key} has no groups`);
    for (const g of tab.groups) {
        assert.ok(g.items.length > 0, `group ${tab.key}/${g.key} has no buttons`);
    }
}

// Quick access is a repeat of the Design tab, not a home of its own: anything in
// the title bar has to be findable on a tab too.
for (const id of QUICK_ACCESS) {
    assert.ok(allIds.includes(id),
        `${id} is in the title bar's quick access but on no tab, so it is unfindable`);
}

// New / Open / Save / Save As are the first thing on the first tab.
const setupTab = tabs.find(x => x.key === 'setup');
assert.equal(setupTab.groups[0].key, 'project',
    'the Setup tab opens with the project group');
assert.deepEqual(setupTab.groups[0].items.map(i => i.id),
    ['new-design', 'open-project', 'save', 'save-as']);
assert.equal(setupTab.groups[1].key, 'edit', 'undo/redo/history are their own block');
assert.deepEqual(setupTab.groups[1].items.map(i => i.id), ['undo', 'redo', 'history']);
assert.ok(setupTab.groups.some(g => g.items.some(i => i.id === 'preferences')),
    'Preferences is on the Setup tab');

// Everything the help menu used to hold is a tab of its own now.
const helpTab = tabs.find(x => x.key === 'help');
const helpIds = idsOf(helpTab);
for (const id of ['welcome', 'tutorials', 'help-docs', 'about', 'check-updates']) {
    assert.ok(helpIds.includes(id), `${id} is missing from the Help tab`);
}
// The ones that run an application action rather than opening a tool say so.
for (const id of ['welcome', 'tutorials', 'about', 'check-updates']) {
    const item = helpTab.groups.flatMap(g => g.items).find(i => i.id === id);
    assert.ok(item.action, `${id} has no action to run`);
}

// Filter Design generates a design by optimizing toward a target, so it belongs
// with the synthesis tools, not with the editors.
const optimizationTab = tabs.find(x => x.key === 'optimization');
assert.ok(optimizationTab.groups.some(g => g.items.some(i => i.id === 'filter-design')),
    'Filter Design is on the Optimization tab');

// ── Icons ─────────────────────────────────────────────────────────────────────

for (const id of [...allIds, ...QUICK_ACCESS]) {
    assert.ok(ICONS[id], `no icon for ribbon tool '${id}'`);
    assert.ok(iconColorForTool(id), `no family color for ribbon tool '${id}'`);
}

// ── Routing ───────────────────────────────────────────────────────────────────

const routable = (item) =>
    !!item.action || !!WINDOW_REGISTRY[item.id] || RENDERER_HANDLED.has(item.id);

for (const tab of tabs) {
    for (const item of tab.groups.flatMap(g => g.items)) {
        assert.ok(routable(item),
            `ribbon button '${item.id}' opens nothing: not a registered window, not handled by the renderer, and carries no action`);
    }
}

// ── Labels, in every locale ───────────────────────────────────────────────────

for (const code of ['en', 'ru', 'zh']) {
    const tl = makeLocale(code);
    const tb = tl.toolbar;
    for (const tab of makeTabs(tl)) {
        assert.ok(tab.label, `${code}: no label for tab ${tab.key}`);
        for (const g of tab.groups) {
            assert.ok(g.label, `${code}: no label for group ${g.key}`);
            for (const item of g.items) {
                assert.ok(item.label, `${code}: no button label for '${item.id}'`);
                assert.ok(item.title, `${code}: no tooltip for '${item.id}'`);
            }
        }
    }
    for (const id of QUICK_ACCESS) {
        assert.ok(tb.tooltips[id], `${code}: no quick-access tooltip for '${id}'`);
    }
    // A group string nothing places on a tab is a string that will never show.
    const placed = new Set(makeTabs(tl).flatMap(x => x.groups.map(g => g.key)));
    for (const key of Object.keys(tb.groups)) {
        assert.ok(placed.has(key), `${code}: toolbar.groups.${key} is on no tab`);
    }
}

// ── Render ────────────────────────────────────────────────────────────────────

// React escapes these five when it writes an attribute.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const render = (tabKey) => {
    localStorage.setItem('tfstudio-ribbon-tab', tabKey);
    localStorage.setItem('tfstudio-ribbon-collapsed', '0');
    return renderToStaticMarkup(React.createElement(Toolbar, {
        c, t, onToolAction: () => {}, onMenuAction: () => {}, devAllowed: false,
    }));
};

for (const tab of tabs) {
    const html = render(tab.key);

    assert.ok(html.includes(`data-tour="ribbon-${tab.key}"`),
        `${tab.key}: the guided tour's anchor is missing from the ribbon body`);

    // Every tab label is always on the strip; only the active tab's buttons are.
    for (const other of tabs) {
        assert.ok(html.includes(esc(other.label)), `${tab.key}: tab strip is missing ${other.key}`);
        for (const item of idsOf(other)) {
            const tip = esc(t.toolbar.tooltips[item]);
            const present = html.includes(`title="${tip}"`);
            if (other.key === tab.key) assert.ok(present, `${tab.key}: '${item}' did not render`);
            else assert.ok(!present, `${tab.key}: '${item}' belongs to ${other.key} but rendered here`);
        }
    }
}

// Collapsed, the strip stays and the body goes.
localStorage.setItem('tfstudio-ribbon-tab', 'analysis');
localStorage.setItem('tfstudio-ribbon-collapsed', '1');
const collapsed = renderToStaticMarkup(React.createElement(Toolbar, {
    c, t, onToolAction: () => {}, onMenuAction: () => {}, devAllowed: false,
}));
assert.ok(collapsed.includes(esc(t.toolbar.tabs.analysis)), 'collapsed: tab strip disappeared');
assert.ok(!collapsed.includes('data-tour="ribbon-analysis"'), 'collapsed: ribbon body still rendered');

// The dev-only entries are built into the application menu, not the ribbon body,
// so devAllowed must not change what the tabs show.
localStorage.setItem('tfstudio-ribbon-collapsed', '0');
const asDev = renderToStaticMarkup(React.createElement(Toolbar, {
    c, t, onToolAction: () => {}, onMenuAction: () => {}, devAllowed: true,
}));
assert.equal(asDev, render('analysis'), 'devAllowed changed the rendered ribbon');

// ── Quick access ──────────────────────────────────────────────────────────────

const titleBar = renderToStaticMarkup(React.createElement(TitleBar, {
    c, t, activeDesign: { name: 'Smoke Design' }, isDirty: false, onToolAction: () => {},
}));
for (const id of QUICK_ACCESS) {
    assert.ok(titleBar.includes(`title="${esc(t.toolbar.tooltips[id])}"`),
        `quick access is missing '${id}'`);
}

const withoutHandler = renderToStaticMarkup(React.createElement(TitleBar, {
    c, t, activeDesign: null, isDirty: false,
}));
assert.ok(!withoutHandler.includes(`title="${esc(t.toolbar.tooltips['save'])}"`),
    'quick access rendered without an action handler to call');

// With nothing to report the update indicator takes no room, rather than leaving
// an empty button parked in the title bar: the only buttons there are the
// quick-access ones and the three window controls.
assert.equal((titleBar.match(/<button/g) || []).length, QUICK_ACCESS.length + 3,
    'an idle update badge must not render at all');

// ── Ribbon search ─────────────────────────────────────────────────────────────

// A tool is findable by name from any tab, and the hit says where it lives.
const needleHits = searchRibbon(tabs, 'needle');
assert.ok(needleHits.length >= 2, 'both needle tools should match "needle"');
assert.ok(needleHits.every(x => x.tabKey === 'optimization'));
assert.ok(needleHits.some(x => x.id === 'needle') && needleHits.some(x => x.id === 'needle-manual'));

// A label that starts with the query outranks one that merely mentions it.
const monteCarlo = searchRibbon(tabs, t.toolbar.buttons['error-analysis'].slice(0, 4));
assert.equal(monteCarlo[0].id, 'error-analysis');

// The tooltip is searched too, so the words a tool is described by find it even
// when the button label is an abbreviation.
assert.ok(searchRibbon(tabs, 'zemax').some(x => x.id === 'zemax-coatings'));
assert.ok(searchRibbon(tabs, 'admittance').some(x => x.id === 'admittance'));

// The tool id is a fallback, which is what makes a search from any locale work.
assert.ok(searchRibbon(tabs, 'ri-profiler').some(x => x.id === 'ri-profiler'));

assert.deepEqual(searchRibbon(tabs, ''), [], 'an empty query offers nothing');
assert.deepEqual(searchRibbon(tabs, '   '), [], 'whitespace is an empty query');
assert.deepEqual(searchRibbon(tabs, 'zzzznotatool'), []);
assert.ok(searchRibbon(tabs, 'e').length <= 8, 'the result list is capped');

// Every hit is a real, routable button.
for (const hit of searchRibbon(tabs, 'a')) {
    assert.ok(routable(hit), `search offered '${hit.id}', which opens nothing`);
    assert.ok(RIBBON_TABS.includes(hit.tabKey));
}
// Including the ones that are actions rather than tools.
assert.ok(searchRibbon(tabs, 'tutorial').some(x => x.id === 'tutorials'));

// The box itself is on the strip, in every locale.
for (const code of ['en', 'ru', 'zh']) {
    const tl = makeLocale(code);
    assert.ok(tl.toolbar.searchPlaceholder, `${code}: toolbar.searchPlaceholder is missing`);
}
assert.ok(render('design').includes(`placeholder="${esc(t.toolbar.searchPlaceholder)}"`),
    'the search box is missing from the tab strip');

console.log('PASS ribbon_tabs');
