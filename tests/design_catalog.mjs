/**
 * Design-scoped material catalog (Material Editor browsing surface).
 *
 * Covers that a design's embedded definitions are inspectable without being
 * registered globally, and that the local-catalog comparison distinguishes a
 * material the recipient does not have from one they have under the same id
 * with different n,k.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { initCatalogs, getMaterialById },
    {
        DESIGN_CATALOG_ID, buildDesignCatalog, searchDesignCatalog,
        designSelectionTarget, designMaterialConflict,
    },
    { MaterialEditor },
    { renderReadOnlyMaterial },
    { poolCatalogs, getPoolMaterials, countPoolMaterials },
] = await Promise.all([
    import('../src/utils/materials/catalogManager.js'),
    import('../src/utils/materials/designCatalog.js'),
    import('../src/components/windows/design/materialEditor/MaterialEditor.js'),
    import('../src/components/windows/design/materialEditor/materialEditorReadOnly.js'),
    import('../src/components/windows/optimization/synthesisShared/catalogPool.js'),
]);

const FILM = 'user_hr:Film';
const SHARED = 'user_hr:Shared';
const embedded = (id, name, n) => ({
    id: id.slice(id.indexOf(':') + 1), name, formulaNum: -1,
    tabData: [[400, n, 0], [800, n, 0]],
});

const design = {
    id: 'catalog-coverage', name: 'Catalog coverage',
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    surfaceMode: 'front_only', referenceWavelength: 550,
    frontLayers: [
        { id: 'f1', material: FILM, thickness: 100 },
        { id: 'f2', material: SHARED, thickness: 120 },
    ],
    backLayers: [],
    materials: {
        [FILM]: embedded(FILM, 'Portable film', 2.2),
        [SHARED]: embedded(SHARED, 'Shared film', 1.9),
    },
};

// A local catalog that holds one of the two ids, with different n,k — the case
// the notice has to distinguish.
initCatalogs({
    user_hr: {
        id: 'user_hr', name: 'House recipes', source: 'user',
        materials: {
            Shared: {
                id: 'Shared', name: 'Shared film', formulaNum: -1,
                tabData: [[400, 1.75, 0], [800, 1.75, 0]],
            },
        },
    },
});

// ── The catalog itself ──────────────────────────────────────────────────────
const catalog = buildDesignCatalog(design, 'This design');
assert.equal(catalog.id, DESIGN_CATALOG_ID);
assert.equal(catalog.source, 'design');
// Every material the design is made of: layers, substrate and both media. The
// built-in ones are listed too, even though they are referenced rather than
// embedded when the file is written.
assert.deepEqual(Object.keys(catalog.materials).sort(),
    [FILM, SHARED, 'builtin:Air', 'builtin:BK7'].sort());
// Entries are usable materials: the read-only chart samples them through getNK.
assert.deepEqual(catalog.materials[FILM].getNK(550), [2.2, 0]);

// Embedded definitions win over a local catalog entry of the same id.
assert.deepEqual(catalog.materials[SHARED].getNK(550), [1.9, 0]);
assert.deepEqual(getMaterialById(SHARED).getNK(550), [1.75, 0]);

// Membership follows the design's references, not a stored block: a design gains
// its `materials` block on the way to disk, so the catalog has to be populated
// before the design has ever been saved.
const unsaved = buildDesignCatalog({ ...design, materials: undefined }, 'x');
assert.ok(unsaved.materials[SHARED],
    'materials resolved from local catalogs are listed without an embedded block');
assert.deepEqual(unsaved.materials[SHARED].getNK(550), [1.75, 0],
    'with nothing embedded, the local catalog is the source');
assert.ok(!unsaved.materials[FILM],
    'an id that resolves nowhere has no data to show and is left to the notice');

// A design built entirely from the built-in library still has a catalog: the
// question it answers is what the design is made of.
const builtinOnly = buildDesignCatalog({
    ...design, materials: undefined,
    frontLayers: [{ id: 'f1', material: 'builtin:SiO2', thickness: 100 }],
}, 'x');
assert.deepEqual(Object.keys(builtinOnly.materials).sort(),
    ['builtin:Air', 'builtin:BK7', 'builtin:SiO2'].sort());

// ── Search + selection keys ─────────────────────────────────────────────────
assert.equal(searchDesignCatalog(catalog, '').length, 4);
assert.equal(searchDesignCatalog(null, '').length, 0);

const [portable] = searchDesignCatalog(catalog, 'portable');
assert.equal(portable.material.name, 'Portable film');
assert.equal(portable.catalogId, DESIGN_CATALOG_ID);
// The key addresses the id the design references, not the material's own id.
assert.equal(portable.selectionId, `${DESIGN_CATALOG_ID}:${FILM}`);
assert.equal(designSelectionTarget(catalog, portable.selectionId), FILM);

// Keys for other catalogs, and stale keys, resolve to nothing.
assert.equal(designSelectionTarget(catalog, 'user_hr:Shared'), null);
assert.equal(designSelectionTarget(catalog, `${DESIGN_CATALOG_ID}:user_hr:Gone`), null);
assert.equal(designSelectionTarget(null, `${DESIGN_CATALOG_ID}:${FILM}`), null);

// ── Local-catalog comparison ────────────────────────────────────────────────
assert.equal(designMaterialConflict(design, FILM), 'absent');
assert.equal(designMaterialConflict(design, SHARED), 'differs');
assert.equal(designMaterialConflict(design, 'builtin:SiO2'), null);

// Same dispersion data under the same id is agreement, not a conflict; a
// differing display name alone must not be reported as one.
const agreed = {
    ...design,
    materials: {
        [SHARED]: {
            id: 'Shared', name: 'Renamed locally', formulaNum: -1,
            tabData: [[400, 1.75, 0], [800, 1.75, 0]],
        },
    },
};
assert.equal(designMaterialConflict(agreed, SHARED), 'same');

// ── Material Editor surface ─────────────────────────────────────────────────
const c = makeTheme();
const t = makeLocale();

const editor = renderToStaticMarkup(withDesign(
    React.createElement(MaterialEditor, { c, t, setInputDialog: () => {} }), design));
assert.match(editor, /This design \(4\)/,
    'the design catalog is offered in the catalog selector with its material count');
assert.match(editor, /Portable film/, 'embedded materials are listed for browsing');

// Built-in materials belong to the design too. Listing only the embedded ones
// made a design that mixes both look like it was missing half its stack.
const mixed = renderToStaticMarkup(withDesign(
    React.createElement(MaterialEditor, { c, t, setInputDialog: () => {} }),
    { ...design, materials: undefined,
      frontLayers: [{ id: 'f1', material: 'builtin:SiO2', thickness: 100 }] }));
assert.match(mixed, /This design \(3\)/);
assert.match(mixed, /SiO2/, 'a built-in layer material appears in the design catalog');

// The provenance notice states which definition produced the design's spectrum.
const panel = (designConflict) => renderToStaticMarkup(renderReadOnlyMaterial({
    selectedMat: catalog.materials[SHARED], sampledTable: [],
    chartRef: { current: null }, openCopyPicker: () => {},
    designConflict, me: t.materialEditor, t, c,
}));
assert.match(panel('differs'), /different n,k data/);
assert.match(panel('absent'), /travels with the design/);
assert.match(panel('same'), /matches the copy in your catalogs/);
assert.doesNotMatch(panel(null), /travels with the design/,
    'registry materials carry no design-provenance notice');

// ── Synthesis material pool ─────────────────────────────────────────────────
// The pool decides which films a needle/GE scan may insert, so what it offers
// and how many candidates it reports are both load-bearing.
const poolDesign = {
    ...design,
    frontLayers: [
        { id: 'f1', material: SHARED, thickness: 100 },
        // Stored compound; the builtin catalog keys the same material bare.
        { id: 'f2', material: 'builtin:SiO2', thickness: 100 },
    ],
};

const cats = poolCatalogs(poolDesign, 'This design');
assert.equal(cats[0].id, DESIGN_CATALOG_ID, 'the design is offered first');
assert.equal(cats[0].name, 'This design');

const designOnly = new Set([DESIGN_CATALOG_ID]);
const poolIds = getPoolMaterials(designOnly, { design: poolDesign }).map(p => p.id);
assert.ok(poolIds.includes(SHARED), 'the design restricts synthesis to its own materials');
assert.ok(poolIds.includes('builtin:SiO2'));
assert.ok(!poolIds.some(id => id === 'Air' || id === 'builtin:Air'),
    'air is never a candidate film');

// Selecting the design alongside the catalog that also holds a material must not
// offer that film twice — a scan would evaluate it twice and the size guard
// would disagree with the pool it guards.
const both = new Set([DESIGN_CATALOG_ID, 'builtin']);
const bothPool = getPoolMaterials(both, { design: poolDesign });
const sio2 = bothPool.filter(p => p.id === 'SiO2' || p.id === 'builtin:SiO2');
assert.equal(sio2.length, 1, 'bare and compound ids of one built-in are one candidate');
assert.equal(new Set(bothPool.map(p => p.id)).size, bothPool.length, 'no duplicate pool ids');
assert.equal(countPoolMaterials(both, null, poolDesign),
    countPoolMaterials(new Set(['builtin']), null, null) + 1,
    'the count guard sees the same dedup the pool does');

// A pool id becomes a layer's stored material, so each must resolve on its own.
for (const entry of bothPool) {
    assert.ok(getMaterialById(entry.id), `pool id ${entry.id} must resolve as a layer material`);
    assert.equal(typeof entry.mat.getNK(550)[0], 'number');
}

console.log('PASS: design_catalog');
