/**
 * The refractiveindex.info browser marks only the page that was clicked.
 *
 * The catalog can list one data file on two pages: cubic zirconia stabilized
 * with yttria is a page of the ZrO2 book and again of the ZrO2-Y2O3 book. The
 * browser matched rows to the selection, and keyed them, by data path, so
 * clicking one of the two lit up both and the two rows shared a React key.
 *
 * Run: node tests/rii_page_selection.mjs
 */

import assert from 'node:assert/strict';

// A React stand-in that keeps the element tree, enough to read rows back.
globalThis.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };

const { searchCatalog, riiPageKey } = await import('../src/utils/materials/riiDatabase/search.js');
const { renderRiiLeftPanel } = await import('../src/components/windows/design/materialEditor/riiLeftPanel.js');

const WOOD = 'other/mixed crystals/ZrO2-Y2O3/nk/Wood.yml';
const catalogTree = [
    {
        shelf: 'main', name: 'MAIN - simple inorganic materials',
        books: [{
            book: 'ZrO2', name: 'ZrO2 (Zirconium dioxide, Zirconia)',
            pages: [
                { page: 'Wood', name: 'Wood and Nassau 1982: Cubic zirconia stabilized with yttria', dataPath: WOOD },
                { page: 'Bodurov', name: 'Bodurov et al. 2016: Nanoparticles', dataPath: 'main/ZrO2/nk/Bodurov.yml' },
            ],
        }],
    },
    {
        shelf: 'other', name: 'OTHER - miscellaneous materials',
        books: [{
            book: 'ZrO2-Y2O3', name: 'ZrO2-Y2O3 (Yttria-stabilized zirconia, YSZ)',
            pages: [{ page: 'Wood', name: 'Wood and Nassau 1982: 12 mol % Y2O3', dataPath: WOOD }],
        }],
    },
];

const c = { accent: '#0a84ff', border: '#3c3c3c', text: '#e0e0e0', textDim: '#9a9a9a', panel: '#252526' };
const rii = new Proxy({}, { get: (_, key) => (key === 'dbUpdated' ? () => '' : String(key)) });
const noop = () => {};

// Page rows are the ones carrying the selection bar on their left edge.
function pageRows(node, rows = []) {
    if (Array.isArray(node)) { node.forEach(child => pageRows(child, rows)); return rows; }
    if (!node || typeof node !== 'object') return rows;
    if (node.props?.style?.borderLeft) rows.push(node);
    (node.children || []).forEach(child => pageRows(child, rows));
    return rows;
}
const isActive = row => row.props.style.borderLeft === `2px solid ${c.accent}`;

const panelState = extra => ({
    c, rii, query: 'zro2', setQuery: noop, catalogLoading: false, loadErr: null, catalogTree,
    showNoResults: false, handleSelectResult: noop,
    expandedShelves: new Set(), expandedBooks: new Set(), toggleShelf: noop, toggleBook: noop,
    ...extra,
});

// ── Search results ───────────────────────────────────────────────────────────

const results = searchCatalog(catalogTree, 'zro2');
assert.equal(results.length, 3, 'the search finds both books');
assert.equal(results.filter(r => r.dataPath === WOOD).length, 2, 'the fixture has two pages on one data file');
assert.equal(new Set(results.map(riiPageKey)).size, 3, 'every page has its own key');

const searchRows = pageRows(renderRiiLeftPanel(panelState({ browsing: false, results, selected: results[0] })));
assert.equal(searchRows.length, 3);
assert.deepEqual(searchRows.map(isActive), [true, false, false], 'only the clicked result is highlighted');
assert.equal(new Set(searchRows.map(row => row.props.key)).size, 3, 'the result rows have distinct keys');

// ── Browse tree ──────────────────────────────────────────────────────────────

const selectedInTree = results.find(r => r.book === 'ZrO2-Y2O3');
const treeRows = pageRows(renderRiiLeftPanel(panelState({
    browsing: true, results: [], selected: selectedInTree,
    expandedShelves: new Set(['main', 'other']),
    expandedBooks: new Set(['main/ZrO2', 'other/ZrO2-Y2O3']),
})));
assert.equal(treeRows.length, 3);
assert.deepEqual(treeRows.map(isActive), [false, false, true], 'only the clicked page is highlighted in the tree');

console.log('rii_page_selection: passed');
