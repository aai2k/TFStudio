/**
 * The material pool a synthesis window starts with
 * (synthesisShared/catSelection.js).
 *
 *   1. A design starts with the materials of its layers ticked, front and back
 *      coatings, and nothing else: the substrate and the media are listed under
 *      This design unticked, every other catalog is unticked.
 *   2. A design with no layers starts with nothing ticked.
 *   3. Until the user changes it, the pool follows the design on screen; a pool
 *      the user changed is stored and kept, also across a remount, except that
 *      each design's substrate and media stay unticked until ticked on that
 *      design. A pool with none of its catalogs left goes back to the design's
 *      own.
 *
 * The hook runs under a small stand-in for React that keeps hook state between
 * renders and runs an effect when its dependencies change.
 *
 * Run: node tests/synthesis_pool_default.mjs
 */
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
};

function fakeReact() {
    let slots = [];
    let cursor = 0;
    let pending = [];
    let dirty = false;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const slot = make => {
        const i = cursor++;
        if (slots.length <= i) slots[i] = make();
        return slots[i];
    };
    return {
        useState(initial) {
            const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
            return [s.value, next => {
                s.value = typeof next === 'function' ? next(s.value) : next;
                dirty = true;
            }];
        },
        useRef: initial => slot(() => ({ current: initial })),
        useMemo(fn, deps) {
            const s = slot(() => ({}));
            if (!same(s.deps, deps)) { s.value = fn(); s.deps = deps; }
            return s.value;
        },
        useCallback(fn, deps) {
            const s = slot(() => ({}));
            if (!same(s.deps, deps)) { s.value = fn; s.deps = deps; }
            return s.value;
        },
        useEffect(fn, deps) {
            const s = slot(() => ({}));
            if (deps && same(s.deps, deps)) return;
            s.deps = deps;
            pending.push(fn);
        },
        // Render until the state settles, as React re-renders after a set.
        run(render) {
            let result;
            let renders = 0;
            do {
                dirty = false;
                cursor = 0;
                pending = [];
                result = render();
                pending.splice(0).forEach(effect => effect());
                assert.ok(++renders < 10, 'the pool settles');
            } while (dirty);
            return result;
        },
        unmount() { slots = []; },
    };
}

const R = fakeReact();
globalThis.React = R;

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { DESIGN_CATALOG_ID } = await import('../src/utils/materials/designCatalog.js');
const { defaultPoolSelection, useCatSelection } = await import(
    '../src/components/windows/optimization/synthesisShared/catSelection.js');
const { getPoolMaterials, countPoolMaterials } = await import(
    '../src/components/windows/optimization/synthesisShared/catalogPool.js');

// A catalog besides the built-in one, standing in for an imported glass catalog.
initCatalogs({
    house: {
        id: 'house', name: 'House recipes', source: 'user',
        materials: { Film: { id: 'Film', name: 'Film', formulaNum: -1, tabData: [[400, 2.1, 0], [1700, 2.0, 0]] } },
    },
});

const layer = (id, material) => ({ id, material, thickness: 100 });
// A gain flattening filter: Ta2O5/SiO2 on the front, an MgF2 layer on the back,
// on BK7, with a non-air exit medium so a medium is listed too.
const gff = {
    id: 'gff', name: 'GFF', surfaceMode: 'both_independent', referenceWavelength: 1550,
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Al2O3',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [layer('f1', 'builtin:Ta2O5'), layer('f2', 'builtin:SiO2'), layer('f3', 'builtin:Ta2O5')],
    backLayers: [layer('b1', 'builtin:MgF2')],
};
const ar = {
    ...gff, id: 'ar', exitMedium: 'builtin:Air',
    frontLayers: [layer('a1', 'builtin:TiO2'), layer('a2', 'builtin:SiO2')], backLayers: [],
};
const bare = { ...gff, id: 'bare', frontLayers: [], backLayers: [] };
const onFilm = { ...ar, id: 'onFilm', substrate: { material: 'house:Film', thickness: 1 } };
const GFF_LISTED = ['builtin:Al2O3', 'builtin:BK7', 'builtin:MgF2', 'builtin:SiO2', 'builtin:Ta2O5'];

const sorted = set => [...set].sort();
const poolIds = (cats, excl, design) =>
    getPoolMaterials(cats, { excluded: excl, design }).map(entry => entry.id).sort();

// ── 1. The layers' materials, nothing else ───────────────────────────────────
{
    const { cats, excl } = defaultPoolSelection(gff);
    assert.deepEqual(sorted(cats), [DESIGN_CATALOG_ID], 'only This design is ticked');
    assert.deepEqual(sorted(excl), ['builtin:Al2O3', 'builtin:BK7'],
        'the substrate and the medium are listed but unticked');
    assert.deepEqual(poolIds(cats, excl, gff), ['builtin:MgF2', 'builtin:SiO2', 'builtin:Ta2O5'],
        'a run may insert the front and back layer materials and nothing else');
    assert.equal(countPoolMaterials(cats, excl, gff), 3, 'the size guard counts the same three');
}

// ── 2. No layers, nothing ticked ─────────────────────────────────────────────
{
    const { cats, excl } = defaultPoolSelection(bare);
    assert.equal(cats.size, 0, 'a design with no layers starts with an empty pool');
    assert.equal(excl.size, 0);
    assert.deepEqual(poolIds(cats, excl, bare), []);
    assert.equal(defaultPoolSelection(null).cats.size, 0, 'and so does no design at all');
}

// ── 3. Following the design until the user changes the pool ─────────────────
const KEY = 'tfstudio_test_selectedCats';
const mount = design => R.run(() => useCatSelection(KEY, design));
{
    store.clear(); R.unmount();
    let pool = mount(gff);
    assert.deepEqual(sorted(pool.selectedCats), [DESIGN_CATALOG_ID], 'a new window starts from the design');
    assert.deepEqual(sorted(pool.excludedMats), ['builtin:Al2O3', 'builtin:BK7']);
    assert.equal(pool.selectedCatsRef.current, pool.selectedCats, 'the run reads the pool on screen');
    assert.equal(pool.excludedMatsRef.current, pool.excludedMats);
    assert.equal(store.size, 0, 'opening the window stores nothing');

    pool = mount(ar);
    assert.deepEqual(sorted(pool.excludedMats), ['builtin:BK7'], 'an untouched pool follows a design switch');
    assert.deepEqual(poolIds(pool.selectedCatsRef.current, pool.excludedMatsRef.current, ar),
        ['builtin:SiO2', 'builtin:TiO2']);

    // The user ticks the house catalog: from here on the pool is theirs.
    pool.handleToggleCat('house', ['house:Film']);
    pool = mount(ar);
    assert.deepEqual(sorted(pool.selectedCats), [DESIGN_CATALOG_ID, 'house']);
    pool = mount(gff);
    assert.deepEqual(sorted(pool.selectedCats), [DESIGN_CATALOG_ID, 'house'], 'a changed pool stays on a design switch');
    assert.deepEqual(sorted(pool.excludedMats), ['builtin:Al2O3', 'builtin:BK7'],
        'and the substrate and medium of the design on screen stay unticked');

    // A substrate glass from a ticked catalog stays out on the design it is the
    // substrate of.
    pool = mount(onFilm);
    assert.ok(!poolIds(pool.selectedCatsRef.current, pool.excludedMatsRef.current, onFilm).includes('house:Film'),
        'a design on a glass from a ticked catalog does not get its own substrate in the pool');

    // Ticking a medium on one design ticks it there only.
    pool = mount(gff);
    pool.handleToggleMat(DESIGN_CATALOG_ID, 'builtin:Al2O3', GFF_LISTED);
    pool = mount(gff);
    assert.deepEqual(sorted(pool.excludedMats), ['builtin:BK7'], 'the medium ticked on this design stays ticked');
    const onAlumina = mount({ ...ar, id: 'ar2', exitMedium: 'builtin:Al2O3' });
    assert.ok(onAlumina.excludedMats.has('builtin:Al2O3'), 'and is not ticked on another design');
    R.unmount();
    assert.deepEqual(sorted(mount(gff).excludedMats), ['builtin:BK7'], 'also when the window opens again');

    R.unmount();
    pool = mount(bare);
    assert.deepEqual(sorted(pool.selectedCats), [DESIGN_CATALOG_ID, 'house'], 'and when the window opens again');

    // Clear stores an empty pool; with no catalog left the window opens on the
    // design's own pool again rather than on every catalog.
    pool.handleClearCats();
    assert.equal(mount(bare).selectedCats.size, 0, 'Clear empties the pool in the open window');
    R.unmount();
    pool = mount(gff);
    assert.deepEqual(sorted(pool.selectedCats), [DESIGN_CATALOG_ID], 'a stored empty pool reopens on the design');
    assert.deepEqual(sorted(pool.excludedMats), ['builtin:Al2O3', 'builtin:BK7']);
}

console.log('Synthesis pool default tests passed.');
