/**
 * Design Editor with a material that travels inside the design.
 *
 * A design received as a .tfs from another installation, or imported from an
 * OptiLayer folder, carries definitions in its `materials` block that no
 * catalog on this machine holds. The stack diagram, the OT/QW/FW columns,
 * optical-unit entry, the λ₀ rescale and the substrate k warning must read
 * those definitions, not fall back to air; and an id that resolves nowhere
 * must show as nothing rather than as air. A catalog here that holds the same
 * id gives the whole material, colour included; the copy is read only when
 * none does.
 *
 * Run: node tests/design_editor_embedded_materials.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { nmToUnit, unitToNm, thicknessEntryToNm, rescaleLayersPreserveQWOT, materialHasNoK, resolveMaterial } =
    await import('../src/components/windows/design/designEditor/units.js');
const { StackDiagram } = await import('../src/components/windows/design/designEditor/StackDiagram.js');
const { constantIndexRecord } = await import('../src/utils/io/designImport/materialResolution.js');
const { resolveColor } = await import('../src/utils/materials/catalogManager.js');

const high = constantIndexRecord(2.35);
const metal = constantIndexRecord(0.05, 3.5);
const materials = { [high.id]: high, [metal.id]: metal };
const lam0 = 600;
const d = lam0 / (4 * 2.35);   // one quarter wave of n = 2.35

// ── Units ────────────────────────────────────────────────────────────────────
assert.ok(resolveMaterial(high.id, materials), 'an embedded id resolves through the design block');
assert.equal(resolveMaterial(high.id), null, 'and nowhere without it');
assert.equal(resolveMaterial('missing:X', materials), null, 'a missing id resolves to nothing, not to air');
assert.ok(resolveMaterial('builtin:BK7', materials), 'catalog ids still resolve beside the block');

assert.ok(Math.abs(nmToUnit(d, high.id, lam0, 'QWOT', materials) - 1) < 1e-12, 'QW of a quarter wave reads 1 with the embedded index');
assert.ok(Math.abs(nmToUnit(d, high.id, lam0, 'OT', materials) - lam0 / 4) < 1e-9, 'OT reads n·d with the embedded index');
assert.ok(Number.isNaN(nmToUnit(d, high.id, lam0, 'QWOT')), 'without the block the same id has no QW value');
assert.equal(nmToUnit(d, 'missing:X', lam0, 'nm', materials), d, 'physical nm never needs the material');
assert.ok(Number.isNaN(nmToUnit(d, 'missing:X', lam0, 'FWOT', materials)), 'an optical unit of a missing material is NaN');

assert.ok(Math.abs(unitToNm(1, high.id, lam0, 'QWOT', materials) - d) < 1e-12, 'QW → nm with the embedded index');
assert.ok(Math.abs(thicknessEntryToNm('1', high.id, lam0, 'QWOT', materials) - d) < 1e-12, 'typing 1 QW commits a quarter wave');
assert.equal(thicknessEntryToNm('1', 'missing:X', lam0, 'QWOT', materials), null, 'typing into an optical cell of a missing material commits nothing');
assert.equal(thicknessEntryToNm('12.5', 'missing:X', lam0, 'nm', materials), 12.5, 'the nm cell of a missing material still takes a value');

const layers = [
    { id: 'a', material: high.id, thickness: d, locked: false },
    { id: 'b', material: 'missing:X', thickness: 70, locked: false },
];
const rescaled = rescaleLayersPreserveQWOT(layers, lam0, 700, materials);
assert.ok(Math.abs(rescaled[0].thickness - 700 / (4 * 2.35)) < 1e-9, 'a λ₀ change keeps the embedded layer at one quarter wave');
assert.equal(rescaled[1].thickness, 70, 'a layer of a missing material keeps its thickness');

assert.equal(materialHasNoK(high.id, materials), true, 'the k warning reads the embedded definition');
assert.equal(materialHasNoK(metal.id, materials), false, 'and sees k when the definition has it');
assert.equal(materialHasNoK('missing:X', materials), false, 'a missing material raises no k warning');

// ── Stack diagram colours ───────────────────────────────────────────────────
const c = makeTheme();
const t = makeLocale();
function render(withBlock) {
    const design = {
        ...makeSampleDesign(),
        referenceWavelength: lam0,
        substrate: { material: metal.id, thickness: 1 },
        frontLayers: [{ id: 'l1', material: high.id, thickness: d, locked: false }],
        ...(withBlock ? { materials } : {}),
    };
    return renderToStaticMarkup(React.createElement(StackDiagram, { design, c, t }));
}
const highColor = resolveColor(high);
assert.ok(render(true).includes(`background-color:${highColor}`), 'the layer block takes the embedded material\'s colour');
assert.ok(!render(false).includes(`background-color:${highColor}`), 'without the block the same layer has no material colour');
assert.ok(render(true).includes(`background-color:${c.border}`) === false || render(true).split(`background-color:${c.border}`).length <= 2,
    'the fallback colour is not painted on the embedded layer');

// ── Colour from the catalog ─────────────────────────────────────────────────
// A design saved since 1.4.1 carries a copy of each user material, colour
// included. Recolouring the material in the Material Editor changes the
// catalog, not the copy, and the layers must take the new colour: in the stack
// diagram, in the layer's picker, and in the picker's list of the design's own
// materials, which is where a new layer of it is picked from.
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { MaterialPicker, designEntries } = await import('../src/components/ui/MaterialPicker.js');
const { DesignContext } = await loadApp();
const GREEN = '#2e9d3a';
const YELLOW = '#e6b800';
const copy = { ...high, id: 'H', name: 'H', color: GREEN };
const saved = {
    ...makeSampleDesign(),
    referenceWavelength: lam0,
    frontLayers: [{ id: 'l1', material: 'user_lab:H', thickness: d, locked: false }],
    materials: { 'user_lab:H': copy },
};
const shown = () => {
    const diagram = renderToStaticMarkup(React.createElement(StackDiagram, { design: saved, c, t }));
    const picker = renderToStaticMarkup(React.createElement(DesignContext.Provider, { value: { design: saved } },
        React.createElement(MaterialPicker, { value: 'user_lab:H', onChange: () => {}, c, t })));
    const listed = designEntries(saved).find(entry => entry.id === 'user_lab:H');
    return { diagram, picker, listed: resolveColor(listed.material) };
};

initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: { H: { ...copy, color: YELLOW } } } });
const recoloured = shown();
assert.ok(recoloured.diagram.includes(`background-color:${YELLOW}`) && !recoloured.diagram.includes(GREEN),
    'the layer block takes the catalog colour, not the one in the design\'s copy');
assert.ok(recoloured.picker.includes(YELLOW) && !recoloured.picker.includes(GREEN), 'so does the layer\'s picker');
assert.equal(recoloured.listed, YELLOW, 'and the design\'s own entry in the picker list');

initCatalogs({});
const received = shown();
assert.ok(received.diagram.includes(`background-color:${GREEN}`) && received.picker.includes(GREEN),
    'with no catalog holding the material, the copy keeps its colour');

console.log('PASS: design_editor_embedded_materials');
