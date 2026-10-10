/**
 * Saving a coating, a merit function or a spec preset under a name already in
 * use asks before replacing the one there.
 *
 *   1. The main-process store answers 'exists', with the name of the preset the
 *      file holds, instead of writing over it: for the same name, for a name
 *      that differs only in case on a file system that ignores case, and for a
 *      name that leads to the same file once the characters a file name cannot
 *      hold are replaced. A save that says overwrite writes.
 *   2. The Save coating dialog, the Merit Function Editor and the Specification
 *      window ask, with the confirmation each already uses for its own delete,
 *      and save with overwrite only on yes. The first file is untouched until
 *      then.
 *
 * Run: node tests/preset_save_asks_before_replacing.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const require = createRequire(import.meta.url);
const { safeName } = require('../src/main/paths.js');
const meritPresets = require('../src/main/ipc/meritPresets.js');
const qualifiers = require('../src/main/ipc/qualifiers.js');
const coatings = require('../src/main/ipc/coatings.js');

// ── 1. The store ─────────────────────────────────────────────────────────────

// The three preset stores on a file system that ignores case, as Windows does:
// a path names the file whatever the case it is written in.
function makeStores() {
    const files = new Map();
    const key = file => file.toLowerCase();
    const fs = {
        existsSync: file => files.has(key(file)),
        readFileSync: file => {
            if (!files.has(key(file))) throw new Error(`ENOENT ${file}`);
            return files.get(key(file));
        },
        readdirSync: () => [],
    };
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    const ctx = {
        fs, path: path.posix, log: () => {}, safeName,
        writeFileAtomic: (file, data) => files.set(key(file), data),
        meritFunctionsDir: '/merit', qualifiersDir: '/qualifiers', coatingsDir: '/coatings',
    };
    for (const module of [meritPresets, qualifiers, coatings]) module.register(ipcMain, ctx);
    return {
        call: (channel, ...args) => handlers.get(channel)(null, ...args),
        read: file => JSON.parse(files.get(key(file))),
    };
}

for (const store of [
    { channel: 'mf:save', items: 'operands', dir: '/merit', ext: '.tfsm' },
    { channel: 'qualifiers:save', items: 'qualifiers', dir: '/qualifiers', ext: '.tfsq' },
    { channel: 'coatings:save', items: 'layers', dir: '/coatings', ext: '.tfsc' },
]) {
    const { call, read } = makeStores();
    const preset = (name, marker) => ({ name, [store.items]: [{ marker }] });
    const marker = name => read(`${store.dir}/${name}${store.ext}`)[store.items][0].marker;

    assert.equal((await call(store.channel, preset('Design1 MF', 'first'))).success, true, `${store.channel}: a new name saves`);
    for (const name of ['Design1 MF', 'design1 mf']) {
        assert.deepEqual(await call(store.channel, preset(name, 'second')),
            { success: false, error: 'exists', name: 'Design1 MF' },
            `${store.channel}: a save as "${name}" comes back naming the preset already there`);
        assert.equal(marker('Design1 MF'), 'first', `${store.channel}: and the first file is untouched`);
    }

    await call(store.channel, preset('BBAR 400/700', 'first'));
    assert.deepEqual(await call(store.channel, preset('BBAR 400:700', 'second')),
        { success: false, error: 'exists', name: 'BBAR 400/700' },
        `${store.channel}: a name that leads to the same file asks too`);
    assert.equal(marker('BBAR 400_700'), 'first');

    assert.equal((await call(store.channel, preset('design1 mf', 'second'), { overwrite: true })).success, true,
        `${store.channel}: a save that says overwrite writes`);
    assert.equal(marker('Design1 MF'), 'second', `${store.channel}: and replaces the preset`);
}

// ── 2. The three save flows ──────────────────────────────────────────────────

shimBrowserGlobals();
const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;
await loadApp();
const t = makeLocale('en');
const c = makeTheme();

const [{ SaveCoatingDialog }, { useMeritPresets }, { useDiskPresets }] = await Promise.all([
    import('../src/components/windows/design/coatingLibrary/SaveCoatingDialog.js'),
    import('../src/components/windows/optimization/meritFunctionEditor/useMeritPresets.js'),
    import('../src/components/windows/design/specification/useDiskPresets.js'),
]);

// Each save answers as the store does, over names already saved.
const saves = [];
const saved = new Map();
const store = kind => async (record, options) => {
    saves.push({ kind, name: record.name, overwrite: options?.overwrite === true });
    const existing = saved.get(`${kind}:${record.name.toLowerCase()}`);
    if (existing && options?.overwrite !== true) return { success: false, error: 'exists', name: existing };
    saved.set(`${kind}:${record.name.toLowerCase()}`, record.name);
    return { success: true };
};
window.electronAPI = new Proxy({
    saveCoating: store('coating'), saveMFPreset: store('mf'), saveQualifierPreset: store('spec'),
}, { get: (target, name) => target[name] || (() => Promise.resolve({ success: true, presets: [] })) });

let confirmAnswer = false;
const asked = [];
window.confirm = (message) => { asked.push(message); return confirmAnswer; };

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const savesOf = kind => saves.filter(entry => entry.kind === kind);

// The coating dialog: Save is pressed on a dialog opened on the sample design.
{
    function expand(node) {
        if (Array.isArray(node)) return node.map(expand);
        if (!node || typeof node !== 'object') return node;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props.children) } };
    }
    function find(node, test, found = []) {
        if (Array.isArray(node)) node.forEach(child => find(child, test, found));
        else if (node && typeof node === 'object') {
            if (test(node)) found.push(node);
            find(node.props.children, test, found);
        }
        return found;
    }
    const pressSave = async () => {
        let closed = false;
        R.unmount();
        const tree = expand(R.run(() => SaveCoatingDialog({
            design: makeSampleDesign(), side: 'front', c, t, onClose: () => { closed = true; },
        })));
        const save = find(tree, node => node.type === 'button' && node.props.children === t.coatingLibrary.saveDialog.save)[0];
        await save.props.onClick();
        return closed;
    };
    const name = `${makeSampleDesign().name} front`;

    assert.equal(await pressSave(), true, 'coating: a new name saves and closes the dialog');
    assert.equal(asked.length, 0, 'coating: without asking');

    confirmAnswer = false;
    assert.equal(await pressSave(), false, 'coating: a second save under the name keeps the dialog open');
    assert.equal(asked.length, 1, 'coating: a second save under the same name asks');
    assert.equal(asked[0], t.coatingLibrary.confirmReplace(name), 'coating: naming the coating there');
    assert.deepEqual(savesOf('coating').map(entry => entry.overwrite), [false, false],
        'coating: and nothing is written over it on no');

    confirmAnswer = true;
    assert.equal(await pressSave(), true, 'coating: on yes the dialog closes');
    assert.deepEqual(savesOf('coating').map(entry => entry.overwrite), [false, false, false, true],
        'coating: having saved with overwrite');
    asked.length = 0;
}

// The Merit Function Editor asks in the app's own confirm dialog, as its
// delete does.
{
    let dialog = null;
    const presets = () => R.run(() => useMeritPresets({
        operands: [{ id: 'op1', type: 'R' }], design: { name: 'Design1' },
        te: t.meritFunctionEditor, t, setInputDialog: (next) => { dialog = next; },
        setOperands: () => {}, setSelectedId: () => {}, checkpoint: () => {},
    }));
    R.unmount();
    const saveAs = async (name) => {
        presets().onSavePreset();
        dialog.onConfirm(name);
        await settle();
    };

    await saveAs('Design1 MF');
    assert.equal(dialog, null, 'merit: a new name saves without asking');

    await saveAs('Design1 MF');
    assert.equal(dialog?.confirm, true, 'merit: a second save under the same name asks');
    assert.equal(dialog.title, t.meritFunctionEditor.confirmReplace('Design1 MF'), 'merit: naming the preset there');
    dialog.onCancel();
    await settle();
    assert.deepEqual(savesOf('mf').map(entry => entry.overwrite), [false, false], 'merit: and nothing is written over it on Cancel');

    await saveAs('design1 mf');
    assert.equal(dialog.title, t.meritFunctionEditor.confirmReplace('Design1 MF'), 'merit: a case-only variant asks about the preset there');
    dialog.onConfirm();
    await settle();
    assert.deepEqual(savesOf('mf').map(entry => entry.overwrite), [false, false, false, true], 'merit: on OK it saves with overwrite');
}

// The Specification window asks as its delete does.
{
    let dialog = null;
    const presets = () => R.run(() => useDiskPresets({
        qualifiers: [{ id: 'q1', kind: 'T_AVG' }], writeQualifiers: () => {}, checkpoint: () => {},
        design: { name: 'Design1' }, ts: t.specification, setInputDialog: (next) => { dialog = next; },
    }));
    R.unmount();
    const saveAs = async (name) => {
        presets().onSavePreset();
        dialog.onConfirm(name);
        await settle();
    };

    await saveAs('Design1 spec');
    assert.equal(asked.length, 0, 'spec: a new name saves without asking');

    confirmAnswer = false;
    await saveAs('Design1 spec');
    assert.deepEqual(asked, [t.specification.confirmReplace('Design1 spec')], 'spec: a second save under the same name asks');
    assert.deepEqual(savesOf('spec').map(entry => entry.overwrite), [false, false], 'spec: and nothing is written over it on no');

    confirmAnswer = true;
    await saveAs('Design1 spec');
    assert.deepEqual(savesOf('spec').map(entry => entry.overwrite), [false, false, false, true], 'spec: on yes it saves with overwrite');
}

console.log('preset_save_asks_before_replacing: passed');
