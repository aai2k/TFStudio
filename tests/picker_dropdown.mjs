/**
 * The pickers open on what is already chosen.
 *
 * A material list runs to hundreds of entries and the operand list to dozens.
 * Opening either at the top and leaving the selection somewhere below the fold
 * makes the user search for a value the picker already knows.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shimBrowserGlobals, loadApp, makeTheme } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { scrollToActive, overlayEl },
    { PickerTabs, scrollTabIntoView, stripEdges, pagedOffset, fadeMask },
    { designEntries, rowIsCurrent, currentGroupOf },
    { initCatalogs },
] = await Promise.all([
    import('../src/components/ui/PickerDropdown.js'),
    import('../src/components/ui/pickerTabs.js'),
    import('../src/components/ui/MaterialPicker.js'),
    import('../src/utils/materials/catalogManager.js'),
]);

initCatalogs({});

// ── The selected row is centred in the list ───────────────────────────────────

const list = (scrollHeight, clientHeight) => ({
    ref: { current: { scrollHeight, clientHeight, scrollTop: 0 } },
});
const row = (offsetTop, offsetHeight = 20) => ({ current: { offsetTop, offsetHeight } });

const middle = list(2000, 300);
scrollToActive(middle.ref, row(1000));
assert.equal(middle.ref.current.scrollTop, 1000 - (300 - 20) / 2,
    'a row far down the list is centred');

const nearTop = list(2000, 300);
scrollToActive(nearTop.ref, row(10));
assert.equal(nearTop.ref.current.scrollTop, 0,
    'a row near the top does not scroll past the start of the list');

const nearBottom = list(2000, 300);
scrollToActive(nearBottom.ref, row(1990));
assert.equal(nearBottom.ref.current.scrollTop, 1700,
    'a row near the end does not scroll past the end of the list');

const shortList = list(120, 300);
scrollToActive(shortList.ref, row(40));
assert.equal(shortList.ref.current.scrollTop, 0,
    'a list shorter than its viewport does not scroll');

// A closed or empty list is not an error: the effect runs on every open,
// including one where nothing is selected.
assert.doesNotThrow(() => scrollToActive({ current: null }, row(10)));
assert.doesNotThrow(() => scrollToActive(list(2000, 300).ref, { current: null }));

// ── The tab strip scrolls sideways ────────────────────────────────────────────

const strip = (scrollLeft) => ({ scrollWidth: 900, clientWidth: 300, scrollLeft });
const tab = (offsetLeft, offsetWidth = 60) => ({ offsetLeft, offsetWidth });

const offRight = strip(0);
scrollTabIntoView(offRight, tab(600));
assert.equal(offRight.scrollLeft, 600,
    'the tab the list opened filtered to is brought to the left edge, whole');

const offLeft = strip(400);
scrollTabIntoView(offLeft, tab(100));
assert.equal(offLeft.scrollLeft, 100, 'the same from the other side');

const alreadyVisible = strip(100);
scrollTabIntoView(alreadyVisible, tab(150));
assert.equal(alreadyVisible.scrollLeft, 100,
    'a tab already on screen does not move the strip under the pointer');

assert.doesNotThrow(() => scrollTabIntoView(null, tab(10)));
assert.doesNotThrow(() => scrollTabIntoView(strip(0), null));

// ── The row rests only on tab boundaries ──────────────────────────────────────

// Tabs 80 wide, so a 300-wide row shows just under four of them.
const starts = [0, 80, 160, 240, 320, 400, 480, 560];

assert.equal(pagedOffset(starts, 0, 300, 1), 240,
    'a forward page lands on the boundary nearest a screenful along, never mid-name');
assert.equal(pagedOffset(starts, 240, 300, -1), 0, 'and back the same way');
assert.equal(pagedOffset(starts, 560, 300, 1), 560,
    'at the last tab there is nowhere further to go');
assert.equal(pagedOffset(starts, 0, 300, -1), 0, 'and none before the first');
assert.equal(pagedOffset(starts, 30, 300, 1), 240,
    'a row left off a boundary by a wheel is put back on one');

assert.equal(fadeMask({ overflowing: false, atStart: true, atEnd: true }), undefined,
    'a row that fits is not faded at all');
assert.match(fadeMask({ overflowing: true, atStart: true, atEnd: false }),
    /^linear-gradient\(to right, black 0, black calc\(100% - \d+px\), transparent 100%\)$/,
    'at the start only the far edge is soft: there is nothing off the near one');

// Which arrows are offered. Without them the strip can only be scrolled by
// wheel, which a trackpad-less user has no way to guess at.
assert.deepEqual(stripEdges({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 }),
    { overflowing: false, atStart: true, atEnd: true },
    'a strip that fits shows no arrows');
assert.deepEqual(stripEdges(strip(0)),
    { overflowing: true, atStart: true, atEnd: false },
    'at the start only the forward arrow does anything');
assert.deepEqual(stripEdges(strip(600)),
    { overflowing: true, atStart: false, atEnd: true },
    'and at the end only the back one');
assert.deepEqual(stripEdges(strip(300)),
    { overflowing: true, atStart: false, atEnd: false },
    'in between, both');

// ── The active design's own materials are pickable ────────────────────────────

const design = {
    incidentMedium: 'builtin:Air',
    exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'f1', material: 'lab:Ta2O5_run7', thickness: 100 },
        { id: 'f2', material: 'builtin:SiO2', thickness: 80 },
        { id: 'f3', material: 'gone:Nb2O5', thickness: 60 },
    ],
    backLayers: [],
    // Travelling designs carry the definition of every material outside the
    // built-in library, and that definition is what the design was computed
    // with, so the picker must be able to assign it to another layer.
    materials: {
        'lab:Ta2O5_run7': {
            id: 'Ta2O5_run7', name: 'Ta2O5 (run 7)',
            formulaNum: -1, tabData: [[400, 2.25, 0], [800, 2.13, 0]],
        },
    },
};

const ids = designEntries(design, '').map(entry => entry.id);
assert.deepEqual(ids, ['builtin:Air', 'builtin:BK7', 'lab:Ta2O5_run7', 'builtin:SiO2'],
    'every resolvable material the design references is offered, media and substrate included');
assert.ok(!ids.includes('gone:Nb2O5'),
    'an id that resolves nowhere has no dispersion data to assign');

const embedded = designEntries(design, '').find(entry => entry.id === 'lab:Ta2O5_run7');
assert.equal(embedded.status, 'embedded',
    'the embedded definition is preferred over the local catalogs');
assert.equal(embedded.material.name, 'Ta2O5 (run 7)');

assert.deepEqual(designEntries(design, 'ta2o5').map(entry => entry.id), ['lab:Ta2O5_run7'],
    'the search box filters the design group by id and name');
assert.deepEqual(designEntries(null, '').map(entry => entry.id), [],
    'a picker mounted outside a design provider offers the catalogs only');

// ── The picker opens on the catalog the material comes from ───────────────────

assert.equal(currentGroupOf(design, 'builtin:BK7'), 'builtin',
    'a catalog material opens on its own catalog, not on the design group that repeats it');
assert.equal(currentGroupOf(design, 'BK7'), 'builtin',
    'a legacy bare id resolves to the built-in library');
assert.equal(currentGroupOf(design, 'lab:Ta2O5_run7'), 'design',
    'a definition that travelled inside the file has no catalog here, so the design group is where it is');
assert.equal(currentGroupOf(design, 'gone:Nb2O5'), 'all',
    'an id that resolves nowhere has no row in any group, so the full list is what opens');

const designRow  = { id: 'builtin:BK7', matId: 'BK7', catalogId: 'builtin', group: 'design' };
const catalogRow = { id: 'builtin:BK7', matId: 'BK7', catalogId: 'builtin', group: 'builtin' };
const args = { value: 'builtin:BK7', resolvedId: 'builtin:BK7', inCatalog: true };
assert.ok(rowIsCurrent(catalogRow, args), 'the catalog row carries the selection');
assert.ok(!rowIsCurrent(designRow, args),
    'the design group does not also claim it, so the list marks one row');

const embeddedRow = { id: 'lab:Ta2O5_run7', matId: 'Ta2O5_run7', catalogId: 'lab', group: 'design' };
assert.ok(rowIsCurrent(embeddedRow, { value: 'lab:Ta2O5_run7', resolvedId: 'lab:Ta2O5_run7', inCatalog: false }),
    'a material no catalog holds is marked in the design group');

// ── The overlay's own layout ──────────────────────────────────────────────────

const c = makeTheme();
const overlay = overlayEl({
    dropRef: { current: null }, listRef: { current: null }, activeRef: { current: null },
    searchRef: { current: null }, dropPos: { top: 0, left: 0, width: 300, maxH: 320 },
    c, query: '', setQuery: () => {}, searchPlaceholder: 'Search',
    groups: [{ id: 'g1', label: 'One' }, { id: 'g2', label: 'Two' }],
    catFilter: 'all', allLabel: 'All', setCatFilter: () => {},
    sections: true, emptyText: 'nothing',
    activeOf: item => item.id === 'b', select: () => {},
    search: () => [{ id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g1' }],
});

const listEl = overlay.props.children[2];
assert.equal(listEl.props.style.position, 'relative',
    'the list is the offset parent of its rows: scrollToActive reads row.offsetTop, '
    + 'which measured from the fixed overlay instead is high by the search box and tab strip');

const header = listEl.props.children.find(el => el.key === 'hdr-g1');
assert.equal(header.props.style.backgroundColor, c.panel,
    'the section header is opaque, so rows scrolling under it do not show through');

const tabs = overlay.props.children[1];
assert.equal(tabs.type, PickerTabs, 'the filter tabs sit between the search box and the list');
assert.equal(tabs.props.catFilter, 'all');

// ── The trigger closes the picker it opened ───────────────────────────────────
//
// Outside-click dismissal deliberately excludes the trigger, so a click on an
// open picker reaches the trigger's own handler and nothing else. Unless that
// handler closes, the picker can only be left by picking a value, by Escape, or
// by clicking somewhere else entirely. Read from the source because the suite
// renders without a DOM and cannot dispatch the click.
const pickerSource = await readFile(
    new URL('../src/components/ui/PickerDropdown.js', import.meta.url), 'utf8');

assert.match(pickerSource, /const onTrigger = \(\) => \{\s*if \(open\) \{ setOpen\(false\); return; \}/,
    'a click on an open picker closes it instead of re-opening it');
assert.match(pickerSource, /!triggerRef\.current\?\.contains\(e\.target\)\) setOpen\(false\)/,
    'and dismissal still ignores the trigger, so the two do not fight over the same click');

console.log('PASS: picker_dropdown');
