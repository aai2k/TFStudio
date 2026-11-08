/**
 * Preferences in the logo menu (components/Toolbar.js): a row with a submenu
 * of the panes of the Preferences dialog, each opening the dialog on that pane.
 *
 *   1. The row is the last in the menu, under the dialog's own name in every
 *      language, and its submenu lists the dialog's panes in the order its
 *      rail does: Automation in the desktop app, not in the web demo.
 *   2. The row carries a chevron pointing right and runs nothing itself.
 *      Hovering or clicking it opens the submenu to its right, its first row
 *      level with it, and keeps the row lit; hovering another row of the menu
 *      closes it, hovering its own rows does not; a click on a pane closes the
 *      menu and asks for that pane. Opened again, the menu shows no submenu.
 *   3. The app opens Preferences on the pane asked for, and the dialog shows
 *      that pane marked in its rail; the ribbon button still opens it on the
 *      first.
 *
 * Run: node tests/app_menu_preferences.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const RealReact = globalThis.React;

// React for the modules under test: a hook goes to the stand-in of the
// component being run (mount), or to React itself in a server render.
let current = null;
const Shim = { ...RealReact };
for (const name of ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext']) {
    Shim[name] = (...args) => (current ?? RealReact)[name](...args);
}
const mount = () => {
    const runtime = makeEffectRuntime(RealReact);
    return {
        render: draw => {
            const before = current;
            current = runtime;
            try { return runtime.run(draw); } finally { current = before; }
        },
    };
};
globalThis.React = Shim;
await loadApp();
const { appMenuItems, MenuButton } = await import('../src/components/Toolbar.js');
const { settingsCategoryIds } = await import('../src/components/dialogs/settings/categories.js');
const { SettingsModal } = await import('../src/components/dialogs/settings/SettingsModal.js');
const { useAppCommands } = await import('../src/hooks/useAppCommands.js');

const h = RealReact.createElement;
const c = makeTheme();
const t = makeLocale('en');
const LOCALES = ['en', 'ru', 'zh', 'it'];
const desktop = () => { globalThis.electronAPI = { setLiveBridge() {} }; };
const webDemo = () => { globalThis.electronAPI = {}; };

function* walk(node) {
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    if (!node || typeof node !== 'object' || !node.props) return;
    yield node;
    yield* walk(node.props.children);
}
const textOf = node => Array.isArray(node) ? node.map(textOf).join('')
    : typeof node === 'string' ? node
    : node?.props ? textOf(node.props.children) : '';

// ── 1. The row ──────────────────────────────────────────────────────────────
desktop();
assert.deepEqual(settingsCategoryIds(),
    ['appearance', 'quickAccess', 'language', 'performance', 'analysis', 'folders', 'automation'],
    'the desktop app offers every pane, in rail order');
webDemo();
assert.ok(!settingsCategoryIds().includes('automation'), 'the web demo has no Automation pane');

for (const code of LOCALES) {
    const tl = makeLocale(code);
    for (const [where, setUp] of [['desktop', desktop], ['web demo', webDemo]]) {
        setUp();
        for (const [devAllowed, gamesUnlocked] of [[false, false], [true, true]]) {
            const items = appMenuItems(tl, devAllowed, gamesUnlocked);
            const row = items.at(-1);
            assert.equal(items.at(-2).type, 'sep', `${code}, ${where}: a separator sets Preferences apart`);
            assert.equal(row.label, tl.settings.title, `${code}, ${where}: the row carries the dialog's name`);
            assert.equal(row.action, undefined, `${code}, ${where}: the row opens a submenu, it runs nothing`);
            assert.deepEqual(row.children.map(child => child.label), settingsCategoryIds().map(id => tl.settings.categories[id]),
                `${code}, ${where}: the panes, under the names the rail gives them`);
            assert.ok(row.children.every(child => child.label), `${code}, ${where}: no pane is nameless`);
            assert.deepEqual(row.children.map(child => child.action), settingsCategoryIds().map(id => `preferences:${id}`));
        }
    }
}
// ── 2. The submenu ──────────────────────────────────────────────────────────
desktop();
{
    const asked = [];
    const menu = mount();
    const props = { c, t, items: appMenuItems(t, false, false), title: 'TFStudio', onAction: action => asked.push(action), width: 240 };
    const draw = () => MenuButton(props);
    const rows = tree => [...walk(tree)].filter(el => el.type?.name === 'MenuRow');
    const row = (tree, label) => rows(tree).find(el => textOf([].concat(el.props.children)[0]) === label);
    const paneLabels = settingsCategoryIds().map(id => t.settings.categories[id]);
    const shownPanes = tree => rows(tree).map(textOf).filter(label => paneLabels.includes(label));
    // A pointer event on a row whose box ends at x = 240 and starts at y = 300.
    const at = { currentTarget: { getBoundingClientRect: () => ({ right: 240, top: 300 }) } };
    const openMenu = () => {
        [...walk(menu.render(draw))].find(el => el.type === 'button').props.onClick();
        return menu.render(draw);
    };

    assert.deepEqual(rows(menu.render(draw)), [], 'the menu starts closed');
    let tree = openMenu();
    const prefs = row(tree, t.settings.title);
    assert.ok(prefs, 'the menu offers Preferences');
    assert.equal([].concat(prefs.props.children).length, 2, 'its name and a chevron, no shortcut');
    const chevron = [].concat(prefs.props.children).at(-1);
    assert.equal(chevron.props.className, 'tf-caret', 'its chevron is the menus\' own');
    assert.equal(chevron.props.style.transform, 'rotate(-90deg)', 'turned to point right');
    assert.deepEqual(shownPanes(tree), [], 'no submenu when the menu opens');
    assert.ok(!prefs.props.active, 'and the row is not lit');

    prefs.props.onEnter(at);
    tree = menu.render(draw);
    assert.deepEqual(shownPanes(tree), paneLabels, 'hovering opens the submenu with every pane, in rail order');
    assert.deepEqual(asked, [], 'and runs nothing');
    assert.ok(row(tree, t.settings.title).props.active, 'the row stays lit while its submenu shows');
    const panel = [...walk(tree)].find(el => el.type === 'div' && el.props.style?.position === 'fixed'
        && [...walk(el.props.children)].some(child => textOf(child) === paneLabels[0]));
    assert.deepEqual([panel.props.style.left, panel.props.style.top], [245, 295],
        'the submenu sits right of the menu, its first row level with Preferences');
    assert.ok(rows(tree).filter(el => paneLabels.includes(textOf(el))).every(el => !el.props.onEnter),
        'hovering a pane leaves the submenu open');

    row(tree, t.menu.toggleFullscreen).props.onEnter(at);
    tree = menu.render(draw);
    assert.deepEqual(shownPanes(tree), [], 'hovering another row closes it');
    assert.ok(!row(tree, t.settings.title).props.active, 'and Preferences is no longer lit');

    row(tree, t.settings.title).props.onClick(at);
    tree = menu.render(draw);
    assert.deepEqual(shownPanes(tree), paneLabels, 'a click opens the submenu too');
    assert.deepEqual(asked, []);

    row(tree, t.settings.categories.language).props.onClick();
    tree = menu.render(draw);
    assert.deepEqual(asked, ['preferences:language'], 'a pane asks for itself');
    assert.deepEqual(rows(tree), [], 'and the menu closes');

    assert.deepEqual(shownPanes(openMenu()), [], 'opened again, the menu shows no submenu');
}

// ── 3. Opening on the pane ──────────────────────────────────────────────────
{
    const shown = [];
    const dialogs = { setShowSettings: value => shown.push(value) };
    const commands = mount().render(() => useAppCommands({
        store: {}, project: {}, dialogs, welcome: {}, locale: 'en', workspace: { openTool() {} },
    }));
    for (const id of settingsCategoryIds()) commands.handleMenuAction(`preferences:${id}`);
    assert.deepEqual(shown, settingsCategoryIds(), 'each pane opens Preferences on that pane');
    shown.length = 0;
    commands.handleToolAction('preferences');
    assert.deepEqual(shown, [true], 'the ribbon button still opens it as before');
}
{
    const rail = initialCategory => {
        const html = renderToStaticMarkup(h(SettingsModal, { c, t, initialCategory, theme: 'Light', ribbonStyle: 'minimalist', locale: 'en', onClose() {} }));
        return [...html.matchAll(/<button style="([^"]*)">([^<]*)<\/button>/g)]
            .filter(([, , label]) => Object.values(t.settings.categories).includes(label))
            .filter(([style]) => /font-weight:600/.test(style))
            .map(([, , label]) => label);
    };
    for (const id of settingsCategoryIds()) {
        assert.deepEqual(rail(id), [t.settings.categories[id]], `opened on ${id}, the rail marks ${id} alone`);
    }
    assert.deepEqual(rail(undefined), [t.settings.categories.appearance], 'with no pane asked for it opens on the first');
    webDemo();
    assert.deepEqual(rail('automation'), [t.settings.categories.appearance], 'a pane this build lacks opens the first');
}

console.log('PASS: app_menu_preferences');
