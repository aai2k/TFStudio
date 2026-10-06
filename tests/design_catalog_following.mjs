/**
 * A catalog edit reaches every window through the design it is given.
 *
 * Windows key their memos on the design, and saving a material in the Material
 * Editor leaves the design as it was, so the provider hands out a copy of a
 * design that uses a catalog material when a catalog changes; otherwise a
 * window would keep the old n,k (and any material lookup it memoized) until
 * the design itself was edited. A design made only of built-in materials,
 * which no catalog edit can touch, stays the same object.
 *
 * The provider also gives back the material of a Herpin layer that a file
 * written by 1.6.3 to 1.8.4 lacks.
 *
 * Run: node tests/design_catalog_following.mjs
 */
import assert from 'node:assert/strict';
import { makeSampleDesign, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
// Window events that are delivered: Node's global has none, and the shim's
// are no-ops.
const events = new EventTarget();
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);

const runtime = makeHookRuntime();
Object.assign(runtime.React, { createElement: React.createElement, createContext: React.createContext });
const { DesignProvider } = await importWithHookRuntime('../src/state/DesignContext.js', runtime);
const { initCatalogs, getMaterialById, saveUserMaterial } = await import('../src/utils/materials/catalogManager.js');

const H = { id: 'H', name: 'H', formulaNum: -1, tabData: [[300, 2.3, 0], [2000, 2.3, 0]] };
initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: { H: { ...H } } } });

// The provider reads React.useRef at call time, so the harness stands in for
// React while it renders.
function provide(design) {
    const props = { activeDesignId: design.id, designs: { [design.id]: design }, onDesignChange: () => {}, folders: [] };
    const render = () => {
        const real = globalThis.React;
        globalThis.React = runtime.React;
        try { return runtime.render(() => DesignProvider(props)).props.value; } finally { globalThis.React = real; }
    };
    return render;
}

const usesCatalog = { ...makeSampleDesign(), id: 'cat', frontLayers: [{ id: 'l1', material: 'user_lab:H', thickness: 60 }] };
const before = provide(usesCatalog)();
assert.equal(before.design, usesCatalog, 'before any catalog change windows get the stored design');
for (const effect of runtime.pendingEffects()) effect();

saveUserMaterial('user_lab', { ...getMaterialById('user_lab:H'), tabData: [[300, 2.1, 0], [2000, 2.1, 0]] });
const after = provide(usesCatalog)();
assert.notEqual(after.design, usesCatalog, 'a catalog save hands windows a new design object');
assert.deepEqual(after.design, usesCatalog, 'with the same content');
assert.ok(after.catalogRevision > before.catalogRevision, 'and the revision a multi-design window can follow moves');

const builtinOnly = { ...makeSampleDesign(), id: 'builtin' };
assert.equal(provide(builtinOnly)().design, builtinOnly,
    'a design of built-in materials only stays the same object');

// A Herpin layer from a file written by 1.6.3 to 1.8.4 has no material in the
// file. Windows get it back, so the Design Editor shows the layer's QW and
// rescales it with λ0 as the engine computes it.
{
    const { nmToUnit, rescaleLayersPreserveQWOT } = await import('../src/components/windows/design/designEditor/units.js');
    const herpinId = 'herpin-old';
    const old = {
        ...makeSampleDesign(), id: 'old-herpin',
        frontLayers: [{ id: 'h1', material: herpinId, thickness: 80, herpin: { version: 1, equivalentIndex: 1.8932, referenceWavelength: 550 } }],
    };
    const seen = provide(old)().design;
    assert.ok(seen.materials?.[herpinId], 'the window\'s design carries the Herpin layer\'s material');
    assert.equal(nmToUnit(80, herpinId, 550, 'QWOT', seen.materials).toFixed(4), (4 * 1.8932 * 80 / 550).toFixed(4),
        'so the layer\'s QW cell has a value');
    assert.notEqual(rescaleLayersPreserveQWOT(seen.frontLayers, 550, 650, seen.materials)[0].thickness, 80,
        'and a new λ0 rescales it');
    assert.equal(provide(old)().design, provide(old)().design, 'the same object on every render');
    assert.equal(old.materials, undefined, 'the stored design is left as it was');
}

console.log('PASS: design_catalog_following');
