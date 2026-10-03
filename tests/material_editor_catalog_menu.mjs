/**
 * The Material Editor's ⋯ catalog menu closes when its button is pressed again.
 *
 * The menu closes on a press outside it, and the ⋯ button is outside it. When
 * that press closed the menu, the click that followed ran the button's toggle
 * and opened it again, so the button could open the menu but never close it.
 *
 *   1. A press on the button, or inside the menu, leaves the menu open; a press
 *      anywhere else, or Escape, closes it.
 *   2. The button toggles, and it is the trigger the menu is given.
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
const { CatalogMenu } = await importWithHookRuntime(
    '../src/components/windows/design/materialEditor/catalogMenu.js', runtime);
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

// ── 1. What closes the open menu ─────────────────────────────────────────────
{
    let closes = 0;
    const triggerRef = { current: element() };
    const menu = runtime.render(() => CatalogMenu({ items: [], onClose: () => { closes += 1; }, c, triggerRef }));
    menu.ref.current = element();
    for (const effect of runtime.pendingEffects()) effect();

    listeners.mousedown({ target: triggerRef.current });
    assert.equal(closes, 0, 'a press on the ⋯ button is left to the button');
    listeners.mousedown({ target: menu.ref.current });
    assert.equal(closes, 0, 'a press inside the menu does not close it');
    listeners.mousedown({ target: element() });
    assert.equal(closes, 1, 'a press anywhere else closes it');
    listeners.keydown({ key: 'Escape' });
    assert.equal(closes, 2, 'and so does Escape');
}

// ── 2. The button the menu hangs from ────────────────────────────────────────
{
    const find = (node, match) => {
        if (Array.isArray(node)) {
            for (const child of node) { const hit = find(child, match); if (hit) return hit; }
            return null;
        }
        if (!node || typeof node !== 'object' || !node.props) return null;
        return match(node) ? node : find(node.props.children, match);
    };
    let menuOpen = true;
    const noop = () => {};
    const s = {
        c, me, catFilter: 'all', setCatFilter: noop, setEditDraft: noop,
        browseCatalogs: [], currentCatalog: null, isUserCatalog: false, importing: false,
        menuOpen, setMenuOpen: next => { menuOpen = next(menuOpen); },
        menuTriggerRef: { current: null },
        query: '', setQuery: noop, results: [], notification: null,
        editDraft: null, selectedId: null, handleSelectMaterial: noop, handleNewMaterial: noop,
    };
    const panel = renderLeftPanel(s);
    const button = find(panel, node => node.type === 'button' && node.props.title === me.catalogMenuTip);
    const open = find(panel, node => node.type === CatalogMenu);
    assert.ok(button && open, 'the open menu is drawn beside its button');
    assert.ok(button.ref && button.ref === s.menuTriggerRef, 'the button carries the editor\'s trigger ref');
    assert.equal(open.props.triggerRef, s.menuTriggerRef, 'and the menu is told that is its trigger');
    button.props.onClick();
    assert.equal(menuOpen, false, 'a click on the button with the menu open closes it');
}

console.log('material_editor_catalog_menu: passed');
