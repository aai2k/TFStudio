/**
 * The pickers open on what is already chosen.
 *
 * A material list runs to thousands of entries and the operand list to dozens.
 * Opening either at the top and leaving the selection somewhere below the fold
 * makes the user search for a value the picker already knows. The material list
 * is also far too long to put in the DOM whole, so only the part on screen is
 * built and the rest is stood in for by two spacers.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shimBrowserGlobals, loadApp, makeTheme } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { listCells, cellTops, visibleWindow, scrollTopFor, overlayEl, dropPositionFrom },
    { PickerTabs, scrollTabIntoView, stripEdges, pagedOffset, fadeMask, keepSearchFocus },
    { designEntries, rowIsCurrent, currentGroupOf },
    { initCatalogs },
] = await Promise.all([
    import('../src/components/ui/PickerDropdown.js'),
    import('../src/components/ui/pickerTabs.js'),
    import('../src/components/ui/MaterialPicker.js'),
    import('../src/utils/materials/catalogManager.js'),
]);

initCatalogs({});

const items = (n, group) => Array.from({ length: n }, (_, i) => ({ id: `${group || 'i'}${i}`, label: `M${i}`, group }));

// ── The selected row is centred in the list ───────────────────────────────────

const flatCells = listCells(items(100), [], false);
const flatTops  = cellTops(flatCells);
const ROW_H     = flatTops[1] - flatTops[0];
const TOTAL     = flatTops[flatCells.length];

assert.equal(TOTAL, 100 * ROW_H, 'a row-only list is as tall as its rows');

assert.equal(scrollTopFor(flatTops, 48, 300), 48 * ROW_H - (300 - ROW_H) / 2,
    'a row far down the list is centred');
assert.equal(scrollTopFor(flatTops, 0, 300), 0,
    'a row near the top does not scroll past the start of the list');
assert.equal(scrollTopFor(flatTops, 99, 300), TOTAL - 300,
    'a row near the end does not scroll past the end of the list');
assert.equal(scrollTopFor(cellTops(listCells(items(5), [], false)), 2, 300), 0,
    'a list shorter than its viewport does not scroll');

// Nothing in the list is current: an id that resolves nowhere, or a query that
// filtered the current value out. The list opens at the top, not off its end.
assert.equal(scrollTopFor(flatTops, -1, 300), 0, 'no current entry means no scroll');

// ── Only the entries on screen are built ─────────────────────────────────────
//
// The material picker offers a few thousand entries on a machine carrying the
// substrate and coating libraries. Building all of them cost close to a second
// on every open and on every keystroke in the search box.

const bigGroups = [{ id: 'g1', label: 'One' }, { id: 'g2', label: 'Two' }];
const bigCells  = listCells([...items(1000, 'g1'), ...items(2000, 'g2')], bigGroups, true);
const bigTops   = cellTops(bigCells);
const HEADER_H  = bigTops[1] - bigTops[0];

assert.equal(bigCells.length, 3002, 'every result is a cell, plus one header per group');

const deep = visibleWindow(bigCells, bigTops, 30000, 320);
assert.ok(deep.to - deep.from < 40,
    'a 320px viewport builds a few dozen cells, whatever the length of the list');
assert.equal(deep.stuck.id, 'g2',
    'a list scrolled well into a catalog still carries that catalog\'s heading');
assert.equal(
    deep.padTop + HEADER_H + (bigTops[deep.to + 1] - bigTops[deep.from]) + deep.padBottom,
    bigTops[bigCells.length],
    'the spacers stand in for exactly the cells left out, so the scrollbar measures the whole list');

const atTop = visibleWindow(bigCells, bigTops, 0, 320);
assert.equal(atTop.from, 0, 'the top of the list starts at its first cell');
assert.equal(atTop.padTop, 0, 'with nothing above it to stand in for');
assert.equal(atTop.stuck, null, 'and its own heading already in the window');

assert.deepEqual(visibleWindow([], [0], 0, 320), { from: 0, to: -1, padTop: 0, padBottom: 0, stuck: null },
    'an empty result list renders no cells');

// Groups keep the order of the tab strip, and a row belonging to no listed
// group has no heading to sit under.
const ordered = listCells(
    [{ id: 'b', label: 'B', group: 'g2' }, { id: 'a', label: 'A', group: 'g1' }, { id: 'x', label: 'X', group: 'gone' }],
    bigGroups, true);
assert.deepEqual(ordered.map(cell => cell.header ? `#${cell.header.id}` : cell.item.id),
    ['#g1', 'a', '#g2', 'b'],
    'each group is a heading followed by its own rows, in tab order');

// ── The tab strip scrolls sideways ────────────────────────────────────────────

const strip = (scrollLeft) => ({ scrollWidth: 900, clientWidth: 300, scrollLeft });
const tab = (offsetLeft, offsetWidth = 60) => ({ offsetLeft, offsetWidth });

const offRight = strip(0);
scrollTabIntoView(offRight, tab(600));
assert.equal(offRight.scrollLeft, 600 - (300 - 60) / 2,
    'the tab the picker marks is centred, not left against the edge where the fade cuts it');

const offLeft = strip(400);
scrollTabIntoView(offLeft, tab(100));
assert.equal(offLeft.scrollLeft, 0,
    'centring never scrolls past the start; a tab near it is shown whole instead');

const underRightFade = strip(100);
scrollTabIntoView(underRightFade, tab(380));
assert.equal(underRightFade.scrollLeft, 380 - (300 - 60) / 2,
    'a tab the soft edge is fading, not only one off the end, is brought out from under it');

const underLeftFade = strip(200);
scrollTabIntoView(underLeftFade, tab(205));
assert.equal(underLeftFade.scrollLeft, 205 - (300 - 60) / 2, 'and the same at the near edge');

const alreadyVisible = strip(100);
scrollTabIntoView(alreadyVisible, tab(150));
assert.equal(alreadyVisible.scrollLeft, 100,
    'a tab already clear of both fades does not move the strip under the pointer');

const fits = { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 };
scrollTabIntoView(fits, tab(200));
assert.equal(fits.scrollLeft, 0, 'a row that fits has nowhere to scroll to');

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

// ── A picker opened low in the window sits against its trigger ───────────────
//
// There is no room below a row near the bottom, so the overlay flips above it.
// It must hang from its bottom edge. Positioning it by a top derived from the
// maximum height assumes the list fills all the space available, so a filter
// tab showing three entries would be pushed the full 320 px up and float near
// the top of the window, detached from the row it belongs to.
{
    const viewportHeight = 950;
    global.window.innerHeight = viewportHeight;
    global.window.innerWidth = 1400;

    const trigger = { top: 800, bottom: 823, left: 80, width: 120 };
    const low = dropPositionFrom(trigger, 260);
    assert.equal(low.top, null, 'a picker with no room below is not placed by its top edge');
    assert.equal(low.bottom, viewportHeight - trigger.top + 2,
        'the flipped overlay is pinned to the top of its trigger, whatever its height');
    assert.ok(low.maxH <= trigger.top - 4, 'it may not be taller than the room above the trigger');

    // The anchor must not move when the list gets shorter or taller, which is
    // exactly what a maxH-derived top would do.
    const narrower = dropPositionFrom(trigger, 900);
    assert.equal(narrower.bottom, low.bottom, 'the anchor does not depend on the overlay size');

    const high = dropPositionFrom({ top: 120, bottom: 143, left: 80, width: 120 }, 260);
    assert.equal(high.bottom, null, 'a picker with room below is not placed by its bottom edge');
    assert.equal(high.top, 145, 'it hangs just under its trigger');

    // The overlay applies whichever edge the position names.
    const oneCell = listCells([{ id: 'a', label: 'A' }], [], false);
    const flipped = overlayEl({
        dropRef: { current: null }, listRef: { current: null },
        searchRef: { current: null }, dropPos: low, c: makeTheme(), query: '', setQuery: () => {},
        searchPlaceholder: 'Search', groups: [], catFilter: 'all', allLabel: 'All',
        setCatFilter: () => {}, emptyText: 'nothing',
        activeOf: () => false, select: () => {}, onListScroll: () => {},
        cells: oneCell, tops: cellTops(oneCell), scrollTop: 0,
    });
    assert.equal(flipped.props.style.bottom, low.bottom, 'the flipped overlay is styled bottom-up');
    assert.equal(flipped.props.style.top, undefined, 'and carries no top that would fight it');
}

// ── The overlay's own layout ──────────────────────────────────────────────────

const c = makeTheme();
const overlayCells = listCells(
    [{ id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g1' }],
    [{ id: 'g1', label: 'One' }, { id: 'g2', label: 'Two' }], true);
const overlay = overlayEl({
    dropRef: { current: null }, listRef: { current: null },
    searchRef: { current: null }, dropPos: { top: 0, left: 0, width: 300, maxH: 320 },
    c, query: '', setQuery: () => {}, searchPlaceholder: 'Search',
    groups: [{ id: 'g1', label: 'One' }, { id: 'g2', label: 'Two' }],
    catFilter: 'all', currentGroup: 'g2', allLabel: 'All', setCatFilter: () => {},
    emptyText: 'nothing',
    activeOf: item => item.id === 'b', select: () => {}, onListScroll: () => {},
    cells: overlayCells, tops: cellTops(overlayCells), scrollTop: 0,
});

// Clicks inside the open list stay inside it. The material picker sits in a
// layer row whose own click handler focuses the layer table, which took focus
// off the search box after every tab click.
{
    let stopped = 0;
    overlay.props.onClick({ stopPropagation: () => { stopped++; } });
    overlay.props.onContextMenu({ stopPropagation: () => { stopped++; } });
    assert.equal(stopped, 2, 'a click or right-click in the overlay does not reach the host row');
}

const listEl = overlay.props.children[2];
assert.equal(typeof listEl.props.onScroll, 'function',
    'the list reports its scroll offset: that is what decides which cells are built');

const header = listEl.props.children.find(el => el.key === 'hdr-g1');
assert.equal(header.props.style.backgroundColor, c.panel,
    'the section header is opaque, so rows scrolling under it do not show through');
assert.equal(header.props.style.position, 'sticky',
    'and stays at the top while its own rows scroll past');

const tabs = overlay.props.children[1];
assert.equal(tabs.type, PickerTabs, 'the filter tabs sit between the search box and the list');
assert.equal(tabs.props.catFilter, 'all');
assert.equal(tabs.props.currentGroup, 'g2',
    'the group the value belongs to reaches the tabs, so it can be marked without filtering');

// ── The list opens unfiltered, with the current group marked ─────────────────
//
// Opening filtered to the value's group hid every other group behind a click
// on All, and that click took focus off the search box. The list now opens on
// All every time, the value's tab is underlined, and no tab click ends typing.
const tabsSource = await readFile(new URL('../src/components/ui/pickerTabs.js', import.meta.url), 'utf8');
const tabButtons = tabsSource.match(/h\('button', \{[^}]*\}/gs) || [];
assert.equal(tabButtons.length, 3, 'the All tab, the group tabs and the arrows are the strip\'s buttons');
for (const button of tabButtons) {
    assert.match(button, /onMouseDown: keepSearchFocus/, 'every button in the strip keeps focus in the search box');
}
{
    let prevented = false;
    keepSearchFocus({ preventDefault() { prevented = true; } });
    assert.ok(prevented, 'keepSearchFocus stops the mousedown that would move focus');
}

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
assert.match(pickerSource, /setCatFilter\('all'\);[\s\S]{0,120}setOpen\(true\);/,
    'opening always shows the full list; the current group is marked, never used as the filter');

console.log('PASS: picker_dropdown');
