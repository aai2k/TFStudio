/**
 * Design Editor with a material that travels inside the design.
 *
 * A design received as a .tfs from another installation, or imported from an
 * OptiLayer folder, carries definitions in its `materials` block that no
 * catalog on this machine holds. The stack diagram, the OT/QW/FW columns,
 * optical-unit entry, the λ₀ rescale and the substrate k warning must read
 * those definitions, not fall back to air; and an id that resolves nowhere
 * must show as nothing rather than as air.
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

console.log('PASS: design_editor_embedded_materials');
