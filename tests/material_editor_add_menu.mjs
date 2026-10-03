/**
 * The Material Editor's Add menu, and ⋯ holding catalog actions only.
 *
 * The ways of getting a material in were reachable only through ⋯, whose
 * tooltip says "Catalog actions", and "+ New" showed only inside a user
 * catalog, so the window as it opens, on All catalogs, offered no way to make
 * a material at all.
 *
 *   1. Add shows in every catalog and holds a blank material, the
 *      refractiveindex.info browser and the material-file import.
 *   2. ⋯ names the selected catalog and holds rename, duplicate and delete,
 *      then the two ways of making a catalog: empty, or from an AGF file.
 *   3. A blank material goes into the selected catalog when it is one of the
 *      user's own; otherwise into theirs: the only one, the one picked from
 *      several, or a new one when there is none. It counts a catalog another
 *      window made after the editor last loaded its list.
 *
 * Run: node tests/material_editor_add_menu.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs, getCatalogs, createUserCatalog } = await import('../src/utils/materials/catalogManager.js');
const { DESIGN_CATALOG_ID } = await import('../src/utils/materials/designCatalog.js');
const { renderLeftPanel } = await import(
    '../src/components/windows/design/materialEditor/materialEditorLeftPanel.js');
const { ActionMenu } = await import('../src/components/windows/design/materialEditor/actionMenu.js');
const { newMaterial, startBlankMaterial } = await import(
    '../src/components/windows/design/materialEditor/materialEditorMaterialActions.js');
const { renderNewMaterialPickerModal } = await import(
    '../src/components/windows/design/materialEditor/materialEditorModals.js');

const c = makeTheme();
const me = makeLocale().materialEditor;
const noop = () => {};

const findAll = (node, match, out = []) => {
    if (Array.isArray(node)) { for (const child of node) findAll(child, match, out); return out; }
    if (!node || typeof node !== 'object' || !node.props) return out;
    if (match(node)) out.push(node);
    findAll(node.props.children, match, out);
    return out;
};

// The left panel with both menus open, for the catalog `current` (null: All).
function panelFor(current, extra = {}) {
    const calls = [];
    const spy = name => (...args) => calls.push([name, ...args]);
    const s = {
        c, me, catFilter: current?.id || 'all', setCatFilter: noop, setEditDraft: noop,
        browseCatalogs: [], currentCatalog: current, isUserCatalog: current?.source === 'user',
        importing: false, query: '', setQuery: noop, results: [], notification: null,
        editDraft: null, selectedId: null, handleSelectMaterial: noop,
        menuOpen: true, setMenuOpen: noop, menuTriggerRef: { current: null },
        addMenuOpen: true, setAddMenuOpen: noop, addMenuTriggerRef: { current: null },
        handleNewMaterial: spy('blank'), handleImportFiles: spy('files'), setShowRii: spy('rii'),
        handleImport: spy('agf'), handleCreateCatalog: spy('new'), handleRenameCatalog: spy('rename'),
        handleDuplicateCatalog: spy('dup'), handleRemoveCatalog: spy('del'),
        ...extra,
    };
    const panel = renderLeftPanel(s);
    const menus = findAll(panel, node => node.type === ActionMenu);
    const catalogMenu = menus.find(m => m.props.triggerRef === s.menuTriggerRef)?.props.items;
    const addMenu = menus.find(m => m.props.triggerRef === s.addMenuTriggerRef)?.props.items;
    const addButton = findAll(panel, node => node.type === 'button' && node.props.title === me.addMaterialsTip)[0];
    return { catalogMenu, addMenu, addButton, calls };
}
const ids = items => items.map(item => item.id);
const disabled = items => items.filter(item => item.disabled).map(item => item.id);

// Every entry of a menu carries its own outline icon, drawn at 16 px.
function assertIcons(items, name) {
    const entries = items.filter(item => !item.separator && !item.header);
    const icons = entries.map(item => item.icon);
    assert.equal(new Set(icons).size, entries.length, `every ${name} entry has an icon of its own`);
    const html = renderToStaticMarkup(React.createElement(ActionMenu, { items, onClose: noop, c, triggerRef: { current: null } }));
    assert.equal((html.match(/<svg width="16" height="16"/g) || []).length, entries.length,
        `and every one of them draws, at 16 px`);
}

const userCat = { id: 'user_lab', name: 'Lab films', source: 'user', materials: {} };
const builtin = { id: 'builtin', name: 'Built-in', source: 'builtin', materials: {} };
const designCat = { id: DESIGN_CATALOG_ID, name: me.designCatalog, source: 'design', materials: {} };

// ── 1. Add, in every catalog ─────────────────────────────────────────────────
for (const [what, current] of [['All catalogs', null], ['the built-in catalog', builtin],
                               ['a user catalog', userCat], ['the design catalog', designCat]]) {
    const { addMenu, addButton } = panelFor(current);
    assert.ok(addButton, `Add shows with ${what} selected`);
    assert.deepEqual(ids(addMenu), ['blank', 'sep', 'rii', 'files'], `Add holds the same entries with ${what}`);
    assert.deepEqual(disabled(addMenu), [], `and none of them is disabled with ${what}`);
}
{
    const { addMenu, calls } = panelFor(null);
    for (const item of addMenu.filter(entry => !entry.separator)) item.onClick();
    assert.deepEqual(calls.map(call => call[0]), ['blank', 'rii', 'files'], 'each Add entry starts its own action');
    assert.deepEqual(calls[1], ['rii', true], 'the refractiveindex.info entry opens the browser');
    assert.deepEqual(addMenu.map(item => item.label),
        [me.addBlankMaterial, undefined, me.addFromRii, me.addFromFiles], 'labelled from the locale');
    assertIcons(addMenu, 'Add');
}
assert.deepEqual(disabled(panelFor(null, { importing: true }).addMenu), ['files'],
    'the file import waits while an import runs');
assert.equal(panelFor(null, { addMenuOpen: false }).addMenu, undefined, 'Add stays shut until its button is used');

// ── 2. ⋯, catalog actions only ───────────────────────────────────────────────
{
    const { catalogMenu, calls } = panelFor(userCat);
    assert.deepEqual(ids(catalogMenu), ['head', 'rename', 'dup', 'del', 'sep', 'new', 'agf'],
        '⋯ holds the catalog actions and the two ways of making a catalog, and no importer of materials');
    assert.equal(catalogMenu[0].header, true);
    assert.equal(catalogMenu[0].label, 'Lab films', 'under the name of the catalog it acts on');
    assert.deepEqual(disabled(catalogMenu), [], 'a user catalog can be renamed, duplicated and deleted');
    for (const item of catalogMenu.filter(entry => entry.onClick)) item.onClick();
    assert.deepEqual(calls, [['rename', 'user_lab'], ['dup', 'user_lab'], ['del', 'user_lab'], ['new'], ['agf']],
        'each entry acts on the selected catalog or makes a new one');
    assertIcons(catalogMenu, '⋯');
}
{
    const { catalogMenu } = panelFor(null);
    assert.equal(catalogMenu[0].label, me.allCatalogs, 'with All selected the header says so');
    assert.deepEqual(disabled(catalogMenu), ['rename', 'dup', 'del'], 'and only the two ways of making a catalog apply');
}
assert.deepEqual(disabled(panelFor(builtin).catalogMenu), ['rename', 'del'],
    'the built-in catalog can only be duplicated');
assert.deepEqual(disabled(panelFor(designCat).catalogMenu), ['rename', 'dup', 'del'],
    'the design catalog is not a catalog of the registry');
assert.deepEqual(disabled(panelFor(userCat, { importing: true }).catalogMenu), ['agf'],
    'an AGF catalog waits while an import runs');
{
    const { catalogMenu, addMenu } = panelFor(userCat);
    const icons = [...catalogMenu, ...addMenu].filter(item => item.icon).map(item => item.icon);
    assert.equal(new Set(icons).size, icons.length, 'no icon stands for two things across the two menus');
}

// ── 3. Where a blank material goes ───────────────────────────────────────────
const film = (id, name) => ({ id, name, source: 'user', materials: {} });
// The editor's copy of the catalog list is `catalogs`; the registry may hold more.
function blankFrom(catFilter, catalogs = getCatalogs()) {
    const state = { catFilter, draft: null, picker: null, selectedId: 'builtin:SiO2', reloads: 0 };
    const ctx = {
        me, catFilter, catalogs, loadCatalogs: () => { state.reloads += 1; },
        setCatFilter: value => { state.catFilter = value; },
        setSelectedId: value => { state.selectedId = value; },
        setEditDraft: value => { state.draft = value; },
        setNewMaterialPicker: value => { state.picker = value; },
    };
    newMaterial(ctx);
    return { state, ctx };
}
const userCatalogs = () => getCatalogs().filter(cat => cat.source === 'user');

{
    initCatalogs({ user_a: film('user_a', 'Coating runs'), user_b: film('user_b', 'Lab films') });
    const { state } = blankFrom('user_b');
    assert.equal(state.draft?.catalogId, 'user_b', 'with one of the user\'s catalogs selected, it goes there');
    assert.equal(state.draft.isNew, true);
    assert.equal(state.catFilter, 'user_b');
    assert.equal(state.selectedId, null, 'and the read-only selection gives way to the form');
    assert.notEqual(state.picker, true, 'without asking');
}
{
    initCatalogs({ user_a: film('user_a', 'Coating runs'), user_b: film('user_b', 'Lab films') });
    const { state, ctx } = blankFrom('all');
    assert.equal(state.picker, true, 'with several user catalogs and none selected, it asks which');
    assert.equal(state.draft, null, 'and opens no form before the answer');

    const picker = renderNewMaterialPickerModal({
        catalogs: getCatalogs(), handleNewMaterialIn: id => startBlankMaterial(id, ctx),
        setNewMaterialPicker: ctx.setNewMaterialPicker, me, c,
    });
    const rows = findAll(picker, node => node.key === 'user_a' || node.key === 'user_b');
    assert.deepEqual(rows.map(row => row.key), ['user_a', 'user_b'], 'the picker offers the user\'s catalogs only');
    assert.equal(findAll(picker, node => node.props.children === me.newMaterialPickTitle).length, 1,
        'under its own title');
    rows[1].props.onClick();
    assert.equal(state.draft?.catalogId, 'user_b', 'the picked catalog gets the material');
    assert.equal(state.catFilter, 'user_b', 'and is selected, so the list shows where it will be saved');
    assert.equal(state.picker, false, 'and the picker closes');
}
for (const from of ['all', 'builtin', DESIGN_CATALOG_ID]) {
    initCatalogs({ user_a: film('user_a', 'Coating runs') });
    const { state } = blankFrom(from);
    assert.equal(state.draft?.catalogId, 'user_a', `with ${from} selected and one user catalog, it goes there`);
    assert.equal(state.catFilter, 'user_a');
    assert.notEqual(state.picker, true, 'without asking');
    assert.equal(userCatalogs().length, 1, 'and no catalog is made');
}
{
    initCatalogs({});
    let reloads = 0;
    const state = { draft: null };
    newMaterial({
        me, catFilter: 'all', catalogs: getCatalogs(), loadCatalogs: () => { reloads += 1; },
        setCatFilter: value => { state.catFilter = value; }, setSelectedId: noop,
        setEditDraft: value => { state.draft = value; }, setNewMaterialPicker: noop,
    });
    const made = userCatalogs();
    assert.equal(made.length, 1, 'with no user catalog, it makes one');
    assert.equal(made[0].name, me.newCatalogDefault, 'under the default name for a new catalog');
    assert.equal(state.draft?.catalogId, made[0].id, 'and the material goes into it');
    assert.equal(state.catFilter, made[0].id, 'which is selected');
    assert.ok(reloads >= 1, 'and the selector is reloaded so it lists the new catalog');
}
{
    initCatalogs({});
    const before = getCatalogs();
    const made = createUserCatalog('Characterized films');
    const { state } = blankFrom('all', before);
    assert.deepEqual(userCatalogs().map(cat => cat.name), ['Characterized films'],
        'a catalog another window made counts as the only one: no second catalog is made');
    assert.equal(state.draft?.catalogId, made.id, 'and the material goes into it');
    assert.ok(state.reloads >= 1, 'with the editor\'s list reloaded so the selector shows it');
}
{
    initCatalogs({ user_a: film('user_a', 'Coating runs') });
    const before = getCatalogs();
    createUserCatalog('Characterized films');
    const { state } = blankFrom('all', before);
    assert.equal(state.picker, true, 'with one catalog in the editor\'s list and two in the registry, it asks which');
    assert.equal(state.draft, null);
    assert.ok(state.reloads >= 1, 'and the picker lists both, from the reloaded list');
}

console.log('material_editor_add_menu: passed');
