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
    { listCells, cellTops, visibleWindow, scrollTopFor, overlayEl, dropPositionFrom, restingPlace },
    { PickerTabs, scrollTabIntoView, stripEdges, pagedOffset, fadeMask, keepSearchFocus },
    { designEntries, rowIsCurrent, currentGroupOf, catalogRows },
    { initCatalogs },
    { firstRow, nextRow, scrollToShow, listKeyAction, handleListKey },
] = await Promise.all([
    import('../src/components/ui/PickerDropdown.js'),
    import('../src/components/ui/pickerTabs.js'),
    import('../src/components/ui/MaterialPicker.js'),
    import('../src/utils/materials/catalogManager.js'),
    import('../src/components/ui/pickerKeys.js'),
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

// The last tab marked: placed while the row is still as wide as it is before
// its arrows appear, it ends up cut by the edge once they take their room.
{
    const last = tab(840);
    const row = { scrollWidth: 900, clientWidth: 328, scrollLeft: 0 };
    scrollTabIntoView(row, last);
    row.clientWidth = 300;
    assert.ok(last.offsetLeft + last.offsetWidth > row.scrollLeft + row.clientWidth,
        'narrowed by the arrows, the row cuts the tab placed before them');
    scrollTabIntoView(row, last);
    assert.equal(row.scrollLeft, 600, 'placed again, it is at the end of the row, whole');
    const tabsCode = await readFile(new URL('../src/components/ui/pickerTabs.js', import.meta.url), 'utf8');
    assert.match(tabsCode, /scrollTabIntoView\(stripRef\.current, activeTabRef\.current\);[\s\S]{0,40}\}, \[markedGroup, edges\.overflowing, measure\]\)/,
        'so the tabs place the marked tab again once they know the row overflows');
}

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
    // built-in library. Where no catalog here holds the id, that definition is
    // what the design is computed with, so the picker must be able to assign
    // it to another layer.
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
    'with no catalog holding the id, the design\'s copy is used');
assert.equal(embedded.material.name, 'Ta2O5 (run 7)');

// A catalog here that holds the same id is the material the design uses: the
// picker lists it by its catalog and opens on that catalog.
initCatalogs({ lab: { id: 'lab', name: 'Lab', source: 'user', materials: {
    Ta2O5_run7: { id: 'Ta2O5_run7', name: 'Ta2O5 (lab)', formulaNum: -1, tabData: [[400, 2.1, 0], [800, 2.0, 0]] },
} } });
const held = designEntries(design, '').find(entry => entry.id === 'lab:Ta2O5_run7');
assert.equal(held.status, 'catalog', 'a catalog holding the id comes before the design\'s copy');
assert.equal(held.material.name, 'Ta2O5 (lab)');
assert.equal(currentGroupOf(design, 'lab:Ta2O5_run7'), 'lab');
initCatalogs({});

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

// ── A copy from another catalog of the same id ───────────────────────────────
// The design computes with its own copy, so the picker opens on the design
// group and marks that row. The catalog's row under that id is another
// material, which a layer picking the id would not get, so it is not offered.
{
    initCatalogs({ lab: { id: 'lab', uid: 'stamp-here', name: 'Lab', source: 'user', materials: {
        Ta2O5_run7: { id: 'Ta2O5_run7', name: 'Ta2O5 (lab)', formulaNum: -1, tabData: [[400, 2.1, 0], [800, 2.0, 0]] },
    } } });
    const received = {
        ...design,
        materials: { 'lab:Ta2O5_run7': { ...design.materials['lab:Ta2O5_run7'], catalogUid: 'stamp-there' } },
    };
    assert.equal(currentGroupOf(received, 'lab:Ta2O5_run7'), 'design', 'the picker opens on the design group');
    const stamped = { value: 'lab:Ta2O5_run7', resolvedId: 'lab:Ta2O5_run7', inCatalog: false };
    assert.ok(rowIsCurrent(embeddedRow, stamped), 'the design\'s row is marked');
    assert.ok(!rowIsCurrent({ ...embeddedRow, group: 'lab' }, stamped), 'the catalog\'s row is not');

    assert.deepEqual(catalogRows(received, '', 'lab').map(row => row.id), [],
        'the catalog\'s row under that id is not offered');
    const carriedOnly = { ...received, frontLayers: received.frontLayers.filter(l => l.material !== 'lab:Ta2O5_run7') };
    assert.deepEqual(catalogRows(carriedOnly, '', 'lab').map(row => row.id), [],
        'nor while no layer uses the id but the design still carries the copy');
    assert.deepEqual(catalogRows(design, '', 'lab').map(row => row.id), ['lab:Ta2O5_run7'],
        'while for a design whose copy follows the catalog it is');
    assert.deepEqual(catalogRows(null, '', 'lab').map(row => row.id), ['lab:Ta2O5_run7'],
        'and so it is for a picker outside a design');
    initCatalogs({});
}

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

assert.match(pickerSource, /const onTrigger = \(\) => \{\s*if \(open\) \{ close\('trigger'\); return; \}/,
    'a click on an open picker closes it instead of re-opening it');
assert.match(pickerSource, /!triggerRef\.current\?\.contains\(e\.target\)\) setOpen\(false, 'outside'\)/,
    'and dismissal still ignores the trigger, so the two do not fight over the same click');
assert.match(pickerSource, /setCatFilter\('all'\);[\s\S]{0,120}setOpen\(true\);/,
    'opening always shows the full list; the current group is marked, never used as the filter');

// ── The list is picked from by keys ──────────────────────────────────────────
//
// The merit table opens the operand picker on Enter or a typed letter, with the
// focus in its search box, and the Design Editor's material cell is a picker
// too. Without keys for the list, the only way to choose from it was the mouse.
{
    const keyGroups = [{ id: 'g1', label: 'One' }, { id: 'g2', label: 'Two' }];
    const row = (id, group) => ({ id, label: id.toUpperCase(), group });
    const cells = listCells([row('a', 'g1'), row('b', 'g1'), row('c', 'g2')], keyGroups, true);
    const tops = cellTops(cells);
    const idAt = index => cells[index]?.item?.id ?? null;

    assert.equal(idAt(firstRow(cells)), 'a', 'the first row is the one under the first heading');
    assert.equal(firstRow([]), -1, 'an empty list has no row to highlight');

    assert.equal(idAt(nextRow(cells, 2, 1)), 'c', 'Down steps over the next group\'s heading');
    assert.equal(idAt(nextRow(cells, 4, -1)), 'b', 'and Up over it the other way');
    assert.equal(idAt(nextRow(cells, 4, 1)), 'c', 'at the last row Down stays');
    assert.equal(idAt(nextRow(cells, 1, -1)), 'a', 'and at the first row Up stays, never on a heading');

    assert.deepEqual(listKeyAction('ArrowDown', cells, 1), { highlight: 2 }, 'an arrow moves the highlight');
    assert.deepEqual(listKeyAction('Enter', cells, 4), { pick: 'c' }, 'Enter picks the highlighted row');
    assert.deepEqual(listKeyAction('Enter', [], -1), {}, 'with nothing highlighted Enter picks nothing');
    assert.equal(listKeyAction('t', cells, 1), null, 'a letter is left to the search box');
    assert.equal(listKeyAction('Escape', cells, 1), null, 'and Escape to the dismissal that already closes the list');

    // Where the highlight rests: on the current entry when the list opens with
    // nothing typed, on the first match once something is.
    const currentIsC = item => item.id === 'c';
    const opened = restingPlace(cells, tops, { opening: true, query: '', activeOf: currentIsC, viewportH: 300 });
    assert.equal(idAt(opened.highlight), 'c', 'opened with nothing typed, the current entry is highlighted');

    const matches = listCells([row('b', 'g1'), row('c', 'g2')], keyGroups, true);
    const typedIn = restingPlace(matches, cellTops(matches), { opening: false, query: 'b', activeOf: currentIsC, viewportH: 300 });
    assert.deepEqual([matches[typedIn.highlight].item.id, typedIn.top], ['b', 0],
        'after typing, the first match is highlighted at the top, not the current entry further down');
    const openedByLetter = restingPlace(matches, cellTops(matches), { opening: true, query: 'b', activeOf: currentIsC, viewportH: 300 });
    assert.equal(matches[openedByLetter.highlight].item.id, 'b',
        'a picker opened by a typed letter is typed into, so it starts on the first match too');
    const notListed = restingPlace(cells, tops, { opening: true, query: '', activeOf: () => false, viewportH: 300 });
    assert.deepEqual([idAt(notListed.highlight), notListed.top], ['a', 0],
        'with no current entry in the list, the first row is highlighted');

    const deepCurrent = item => item.id === 'g21500';
    const deepRest = restingPlace(bigCells, bigTops, { opening: true, query: '', activeOf: deepCurrent, viewportH: 300 });
    assert.equal(bigCells[deepRest.highlight].item.id, 'g21500', 'far down a long list the current entry is highlighted');
    assert.equal(deepRest.top, scrollTopFor(bigTops, deepRest.highlight, 300), 'and centred, as the list always opened');

    // The highlighted row is kept in view as the arrows move it.
    assert.equal(scrollToShow(flatTops, 20, 0, 300), flatTops[21] - 300, 'a row below the view scrolls up to its bottom edge');
    assert.equal(scrollToShow(flatTops, 5, 0, 300), 0, 'a row in view does not move the list');
    assert.equal(scrollToShow(flatTops, 5, 200, 300, HEADER_H), flatTops[5] - HEADER_H,
        'a row above the view comes back clear of the sticky heading');
    assert.equal(scrollToShow(flatTops, 0, 40, 300, HEADER_H), 0, 'never past the top of the list');

    // The overlay draws the highlight and takes the keys.
    const onKeyDown = () => {};
    const keyed = overlayEl({
        dropRef: { current: null }, listRef: { current: null },
        searchRef: { current: null }, dropPos: { top: 0, left: 0, width: 300, maxH: 320 },
        c, query: '', setQuery: () => {}, searchPlaceholder: 'Search', groups: keyGroups,
        catFilter: 'all', allLabel: 'All', setCatFilter: () => {}, emptyText: 'nothing',
        activeOf: currentIsC, select: () => {}, onListScroll: () => {},
        cells, tops, scrollTop: 0, highlight: 2, onKeyDown,
    });
    assert.equal(keyed.props.onKeyDown, onKeyDown, 'keys in the search box or the tabs reach the list');
    const rows = keyed.props.children[2].props.children.filter(el => el.key?.includes('/'));
    const outlined = rows.filter(el => el.props.style.boxShadow !== 'none').map(el => el.key);
    assert.deepEqual(outlined, ['g1/b'], 'only the highlighted row is outlined');
    assert.ok(rows.find(el => el.key === 'g1/b').props.style.boxShadow.includes(c.accent));

    // The handler the overlay is given, driven with a key event.
    const keyEvent = key => {
        const event = { key, prevented: false, stopped: false };
        event.preventDefault = () => { event.prevented = true; };
        event.stopPropagation = () => { event.stopped = true; };
        return event;
    };
    const listState = (highlight, el) => {
        const state = { cells, tops, highlight, picked: null, scrolled: null, listRef: { current: el } };
        state.setHighlight = index => { state.highlight = index; };
        state.select = id => { state.picked = id; };
        state.setScrollTop = top => { state.scrolled = top; };
        return state;
    };

    const enter = listState(4, null);
    const enterKey = keyEvent('Enter');
    handleListKey(enterKey, enter);
    assert.equal(enter.picked, 'c', 'Enter picks the highlighted row');
    assert.ok(enterKey.prevented && enterKey.stopped, 'and is kept from the table holding the picker');

    // A list two rows high scrolled to its top: Down from b to c passes a
    // heading and leaves the view, so the list follows.
    const pane = { scrollTop: 0, clientHeight: 2 * (tops[2] - tops[1]) };
    const down = listState(2, pane);
    const downKey = keyEvent('ArrowDown');
    handleListKey(downKey, down);
    assert.equal(idAt(down.highlight), 'c', 'Down moves the highlight to the next row');
    assert.equal(pane.scrollTop, tops[5] - pane.clientHeight, 'and scrolls the list to show it');
    assert.equal(down.scrolled, pane.scrollTop, 'telling the windowed list where it now is');
    assert.ok(downKey.prevented && downKey.stopped, 'the arrow is kept from the table too');

    const letter = listState(1, null);
    const letterKey = keyEvent('t');
    handleListKey(letterKey, letter);
    assert.deepEqual([letter.highlight, letter.picked, letterKey.prevented], [1, null, false],
        'a letter goes on to the search box untouched');

    const empty = { ...listState(-1, { scrollTop: 0, clientHeight: 100 }), cells: [], tops: [0] };
    assert.doesNotThrow(() => handleListKey(keyEvent('ArrowUp'), empty), 'an arrow on an empty list does nothing');

    assert.match(pickerSource, /handleListKey\(e, \{/, 'the picker hands its keys to handleListKey');
    assert.match(pickerSource, /const rest = restingPlace\(/, 'and places the highlight through restingPlace');
}

// ── The trigger carries the chevron a select has ─────────────────────────────
{
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PickerDropdown } = await import('../src/components/ui/PickerDropdown.js');
    const html = renderToStaticMarkup(React.createElement(PickerDropdown, {
        value: 'i0', onChange: () => {}, c: makeTheme(), triggerLabel: 'SiO2', groups: [],
    }));
    assert.ok(html.includes('class="tf-caret"'), 'the closed picker shows the select chevron');
    assert.ok(!html.includes('▾'), 'not a typed glyph');
    assert.ok(!html.includes('data-picker-chevron'), 'opened by a click anywhere, it needs no chevron button');

    const inCell = renderToStaticMarkup(React.createElement(PickerDropdown, {
        value: 'i0', onChange: () => {}, c: makeTheme(), triggerLabel: 'SiO2', groups: [], openOnDoubleClick: true,
    }));
    assert.ok(inCell.includes('data-picker-chevron'), 'in a table cell the chevron is a button of its own');
}

// ── In a table cell a click selects the cell ─────────────────────────────────
//
// The Design Editor's Material cell is the picker's trigger. Opened by a click,
// the cell could not be clicked to select it, as every other cell is.
{
    const { triggerOpeners } = await import('../src/components/ui/pickerTrigger.js');
    const opened = [];
    const onTrigger = () => opened.push('toggle');
    const at = chevron => ({ target: { closest: selector => (chevron && selector === '[data-picker-chevron]' ? {} : null) } });

    assert.deepEqual(triggerOpeners({ onTrigger, open: false }), { onClick: onTrigger },
        'elsewhere a click anywhere on the trigger opens it');

    const cell = triggerOpeners({ onTrigger, open: false, openOnDoubleClick: true });
    cell.onClick(at(false));
    assert.deepEqual(opened.splice(0), [], 'in a cell a click on the name opens nothing');
    cell.onClick(at(true));
    assert.deepEqual(opened.splice(0), ['toggle'], 'a click on the chevron opens the list');
    cell.onDoubleClick(at(false));
    assert.deepEqual(opened.splice(0), ['toggle'], 'and so does a double-click on the name');
    cell.onDoubleClick(at(true));
    assert.deepEqual(opened.splice(0), [],
        'a double-click on the chevron opens nothing: its two clicks have opened the list and closed it');

    const openCell = triggerOpeners({ onTrigger, open: true, openOnDoubleClick: true });
    openCell.onClick(at(false));
    assert.deepEqual(opened.splice(0), ['toggle'], 'a click anywhere on an open picker closes it');
    openCell.onDoubleClick(at(false));
    assert.deepEqual(opened.splice(0), [], 'a double-click on an open one does not reopen what its clicks closed');
}

console.log('PASS: picker_dropdown');
