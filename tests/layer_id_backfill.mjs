/**
 * Regression — layers without a unique `id` (React duplicate/undefined key).
 *
 * Some layer producers emit layers without an `id` (e.g. a Zemax COATING.DAT
 * import: coatToTfLayers returns {material,thickness,locked}). Rendered in the
 * Design Editor's LayerList (key: layer.id), that triggered React's
 * "Each child in a list should have a unique key" warning and made
 * updateLayer/removeLayer target the wrong row. DesignContext.ensureLayerIds
 * backfills ONLY missing/duplicate ids and preserves the array reference when
 * nothing changes (so the optimizer's transient streaming is a no-op).
 *
 * Run: node tests/layer_id_backfill.mjs
 */
// DesignContext.js reads a UMD-style global `React` at module eval; stub it
// (ensureLayerIds itself uses no React) so this pure-logic test can import it.
globalThis.React = { createContext: () => ({}), useContext: () => ({}), useState: () => [], useCallback: (f) => f, useRef: () => ({}), useMemo: (f) => f(), useEffect: () => {} };
const { ensureLayerIds } = await import('../src/state/DesignContext.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };

// 1. Missing ids are backfilled, uniquely.
{
    const layers = [{ material: 'TiO2', thickness: 40 }, { material: 'SiO2', thickness: 120 }];
    const out = ensureLayerIds(layers);
    ok(out.every(l => l.id), 'every layer gets an id');
    ok(new Set(out.map(l => l.id)).size === out.length, 'backfilled ids are unique');
    ok(out !== layers, 'a changed list returns a new array');
}
// 2. Duplicate ids are de-duplicated.
{
    const out = ensureLayerIds([{ id: 'x', material: 'A', thickness: 1 }, { id: 'x', material: 'B', thickness: 2 }]);
    ok(new Set(out.map(l => l.id)).size === 2, 'duplicate id is reassigned');
    ok(out[0].id === 'x', 'first occurrence keeps the original id');
}
// 3. All-unique input is a no-op (same reference -> no re-render churn).
{
    const layers = [{ id: 'a', material: 'A', thickness: 1 }, { id: 'b', material: 'B', thickness: 2 }];
    ok(ensureLayerIds(layers) === layers, 'unchanged list returns the SAME reference');
}
// 4. Empty / non-array tolerated.
ok(ensureLayerIds([]).length === 0, 'empty array tolerated');
ok(ensureLayerIds(undefined) === undefined, 'undefined tolerated');

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
