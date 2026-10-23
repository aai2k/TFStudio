/**
 * A Specification preset (.tfsq) loaded into the window gives each row it adds
 * an id of its own, whatever ids it was saved with: appended twice beside the
 * rows it was saved from, no two rows share an id, so the window, which edits
 * and deletes rows by id, changes only the row it is told to, and
 * setSpecification takes the list. Each row keeps the fields it was saved
 * with.
 *
 * Run: node tests/spec_preset_load_ids.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;
await loadApp();
const t = makeLocale('en');

const { useDiskPresets } = await import('../src/components/windows/design/specification/useDiskPresets.js');
const { updateQualifierIn } = await import('../src/components/windows/design/specification/useSpecificationState.js');
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const api = await import('../src/api/index.js');

// The window's rows, and a preset saved from them, ids included, as the
// preset store writes the list it is given.
const rows = [
    makeQualifier({ kind: 'T_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'ge', target: 0.9 }),
    makeQualifier({ kind: 'LAYER_COUNT', side: 'front', cmp: 'le', target: 12 }),
];
window.electronAPI = new Proxy({
    loadQualifierPreset: async () => ({ success: true, preset: { name: 'Spec', description: '', qualifiers: JSON.parse(JSON.stringify(rows)) } }),
}, { get: (target, name) => target[name] || (() => Promise.resolve({ success: true, presets: [] })) });

let qualifiers = rows;
const write = next => { qualifiers = next; };
async function loadPreset(mode) {
    const presets = R.run(() => useDiskPresets({
        qualifiers, writeQualifiers: write, checkpoint: () => {}, design: { name: 'Design1' }, ts: t.specification, t, setInputDialog: () => {},
    }));
    R.unmount();
    await presets.onLoadDiskPreset('Spec', mode);
}
const fieldsOf = ({ id, ...fields }) => fields;

await loadPreset('append');
await loadPreset('append');
const ids = qualifiers.map(q => q.id);
assert.equal(qualifiers.length, 6, 'the preset is appended twice');
assert.equal(new Set(ids).size, ids.length, `each row has an id of its own: ${ids.join(', ')}`);
assert.deepEqual(qualifiers.map(fieldsOf), [...rows, ...rows, ...rows].map(fieldsOf), 'each row with the fields it was saved with');

updateQualifierIn(qualifiers, write, ids[2], { target: 0.5 });
assert.deepEqual(qualifiers.map(q => q.target), [0.9, 12, 0.5, 12, 0.9, 12], 'an edit changes the one row it names');

await api.init();
assert.equal(api.setSpecification(api.newDesign(), qualifiers).qualifiers.length, 6, 'setSpecification takes the list');

console.log('spec_preset_load_ids: passed');
