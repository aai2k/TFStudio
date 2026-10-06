/**
 * Recolouring a material repaints the design that is open.
 *
 * The stack diagram and the layer rows that hold the material pickers are
 * memoized on the design, and the Coating Library's strip on the entry, none of
 * which a catalog edit touches. So each listens for the catalog change itself:
 * saving the material in the Material Editor asks them to redraw, and the
 * redraw shows the new colour, also where a design or a saved coating carries
 * its own copy of the material.
 *
 * Run: node tests/catalog_recolour_repaints.mjs
 */
import assert from 'node:assert/strict';
import { makeLocale, makeTheme, shimBrowserGlobals, loadApp, makeSampleDesign } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
// Window events that are delivered: Node's global has none, and the shim's
// are no-ops.
const events = new EventTarget();
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);

const GREEN = '#2e9d3a';
const YELLOW = '#e6b800';
const H = {
    id: 'H', name: 'H', color: GREEN, formulaNum: -1,
    tabData: [[300, 2.35, 0], [2000, 2.35, 0]],
};
const design = {
    ...makeSampleDesign(),
    frontLayers: [{ id: 'l1', material: 'user_lab:H', thickness: 60, locked: false }],
    materials: { 'user_lab:H': H },
};

// Both components are imported with the harness as React, before anything
// else loads the catalog-change hook they share. A redraw request is a state
// update, so the harness's useState is wrapped to count them.
const runtime = makeHookRuntime();
const harnessState = runtime.React.useState;
let redraws = 0;
Object.assign(runtime.React, {
    createElement: React.createElement, memo: React.memo, createContext: React.createContext,
    useContext: () => ({ design }),
    useState: initial => {
        const [value, set] = harnessState(initial);
        return [value, next => { redraws++; set(next); }];
    },
});
const { StackDiagram } = await importWithHookRuntime(
    '../src/components/windows/design/designEditor/StackDiagram.js', runtime);
const { MaterialPicker } = await importWithHookRuntime('../src/components/ui/MaterialPicker.js', runtime);
const { StackStrip } = await importWithHookRuntime('../src/components/windows/design/coatingLibrary/StackStrip.js', runtime);
await loadApp();
const { initCatalogs, getMaterialById, saveUserMaterial } = await import('../src/utils/materials/catalogManager.js');
const { makeCoatingEntry } = await import('../src/utils/coatingLibrary/entryModel.js');

const c = makeTheme();
const t = makeLocale();
// A saved library coating of the same material, carrying its own copy.
const entry = makeCoatingEntry({
    name: 'H coat', type: 'ar', substrate: 'builtin:BK7', band: [450, 650], referenceWavelength: 550,
    layers: [{ material: 'user_lab:H', thickness: 60 }], materials: { 'user_lab:H': H },
});
// One render of all three, in a fixed order so each keeps its own hook slots,
// with the harness standing in for React while they run.
const draw = () => {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try {
        const [diagram, picker, strip] = runtime.render(() => [
            StackDiagram.type({ design, c, t }),
            MaterialPicker({ value: 'user_lab:H', onChange: () => {}, c, t }),
            StackStrip({ entry, c }),
        ]);
        return { diagram: JSON.stringify(diagram), picker: picker.props.triggerColor, strip: JSON.stringify(strip) };
    } finally {
        globalThis.React = real;
    }
};

initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: { H: { ...H } } } });
const before = draw();
assert.ok(before.diagram.includes(GREEN));
assert.equal(before.picker, GREEN);
assert.ok(before.strip.includes(GREEN));
for (const effect of runtime.pendingEffects()) effect();

saveUserMaterial('user_lab', { ...getMaterialById('user_lab:H'), color: YELLOW });
assert.equal(redraws, 3, 'saving the material asks the stack diagram, the picker and the library strip to redraw');

const after = draw();
assert.ok(after.diagram.includes(YELLOW) && !after.diagram.includes(GREEN), 'the stack diagram redraws in the new colour');
assert.equal(after.picker, YELLOW, 'so does the layer\'s picker');
assert.ok(after.strip.includes(YELLOW) && !after.strip.includes(GREEN),
    'and the library strip, whose colours are worked out once per entry until a catalog changes');

console.log('PASS: catalog_recolour_repaints');
