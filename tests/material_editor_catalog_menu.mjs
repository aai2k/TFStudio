/**
 * The Material Editor's ⋯ and Add menus close when their button is pressed again.
 *
 * A menu closes on a press outside it, and the button that opened it is
 * outside it. When that press closed the menu, the click that followed ran the
 * button's toggle and opened it again, so the button could open the menu but
 * never close it.
 *
 *   1. A press on the button, or inside the menu, leaves the menu open; a press
 *      anywhere else, or Escape, closes it.
 *   2. Each button toggles, and it is the trigger its menu is given.
 *   3. Each button shuts the other menu. A button pressed from the keyboard
 *      sends no mouse press, so the open menu would otherwise stay under the
 *      new one.
 *
 * Run: node tests/material_editor_catalog_menu.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
runtime.React.createElement = React.createElement;
const { ActionMenu } = await importWithHookRuntime(
    '../src/components/windows/design/materialEditor/actionMenu.js', runtime);
const { renderLeftPanel } = await import(
    '../src/components/windows/design/materialEditor/materialEditorLeftPanel.js');

const c = makeTheme();
const me = makeLocale().materialEditor;

// Elements in one document, which records the listeners mounted on it.
const listeners = {};
const doc = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
};
const element = () => {
    const el = { ownerDocument: doc };
    el.contains = target => target === el;
    return el;
};

// ── 1. What closes an open menu ──────────────────────────────────────────────
{
    let closes = 0;
    const triggerRef = { current: element() };
    const menu = runtime.render(() => ActionMenu({ items: [], onClose: () => { closes += 1; }, c, triggerRef }));
    menu.ref.current = element();
    for (const effect of runtime.pendingEffects()) effect();

    listeners.mousedown({ target: triggerRef.current });
    assert.equal(closes, 0, 'a press on the button that opened it is left to the button');
    listeners.mousedown({ target: menu.ref.current });
    assert.equal(closes, 0, 'a press inside the menu does not close it');
    listeners.mousedown({ target: element() });
    assert.equal(closes, 1, 'a press anywhere else closes it');
    listeners.keydown({ key: 'Escape' });
    assert.equal(closes, 2, 'and so does Escape');
}

// ── 2 and 3. The buttons the menus hang from ─────────────────────────────────
{
    const find = (node, match) => {
        if (Array.isArray(node)) {
            for (const child of node) { const hit = find(child, match); if (hit) return hit; }
            return null;
        }
        if (!node || typeof node !== 'object' || !node.props) return null;
        return match(node) ? node : find(node.props.children, match);
    };
    const open = { catalog: false, add: false };
    const setter = name => next => { open[name] = typeof next === 'function' ? next(open[name]) : next; };
    const noop = () => {};
    const panelWith = (catalogOpen, addOpen) => {
        Object.assign(open, { catalog: catalogOpen, add: addOpen });
        const s = {
            c, me, catFilter: 'all', setCatFilter: noop, setEditDraft: noop,
            browseCatalogs: [], currentCatalog: null, isUserCatalog: false, importing: false,
            menuOpen: catalogOpen, setMenuOpen: setter('catalog'), menuTriggerRef: { current: null },
            addMenuOpen: addOpen, setAddMenuOpen: setter('add'), addMenuTriggerRef: { current: null },
            query: '', setQuery: noop, results: [], notification: null,
            editDraft: null, selectedId: null, handleSelectMaterial: noop, handleNewMaterial: noop,
        };
        return { s, panel: renderLeftPanel(s) };
    };
    const buttons = [['catalog', 'add', me.catalogMenuTip, 'menuTriggerRef'],
                     ['add', 'catalog', me.addMaterialsTip, 'addMenuTriggerRef']];
    for (const [name, other, tip, refKey] of buttons) {
        const { s, panel } = panelWith(name === 'catalog', name === 'add');
        const button = find(panel, node => node.type === 'button' && node.props.title === tip);
        const menu = find(panel, node => node.type === ActionMenu && node.props.triggerRef === s[refKey]);
        assert.ok(button && menu, `the open ${name} menu is drawn beside its button`);
        assert.equal(button.ref, s[refKey], `the ${name} button carries the editor's trigger ref`);
        button.props.onClick();
        assert.equal(open[name], false, `a click on the ${name} button with its menu open closes it`);

        const pressed = find(panelWith(name !== 'catalog', name !== 'add').panel,
            node => node.type === 'button' && node.props.title === tip);
        pressed.props.onClick();
        assert.deepEqual([open[name], open[other]], [true, false],
            `the ${name} button opens its menu and shuts the ${other} menu`);
    }
}

console.log('material_editor_catalog_menu: passed');
