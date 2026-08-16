/**
 * The pickers open on what is already chosen.
 *
 * A material list runs to hundreds of entries and the operand list to dozens.
 * Opening either at the top and leaving the selection somewhere below the fold
 * makes the user search for a value the picker already knows.
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ scrollToActive }, { designEntries }, { initCatalogs }] = await Promise.all([
    import('../src/components/ui/PickerDropdown.js'),
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

console.log('PASS: picker_dropdown');
