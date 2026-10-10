/**
 * Text fields read a typed number with a comma decimal.
 *
 * A number typed with a comma, as a comma-decimal locale writes it, went
 * through parseFloat or Number(): '94,2' became 94, or NaN. These fields now
 * read it with parseNumberStrict, as the Design Editor's thickness column and
 * the merit table do.
 *
 *   1. Specification: a qualifier field typed '94,2' commits 94.2, and a
 *      percent field '99,5' commits 0.995.
 *   2. The status-bar monitor form: a band typed '450,5' is added as 450.5.
 *   3. The Save coating dialog saves a band and angle typed with commas, and a
 *      cleared band end is reported as 0, not NaN.
 *   4. The Coating Library filter: a wavelength typed '1064,5' lists the
 *      entries that cover 1064.5 nm.
 *
 * Run: node tests/typed_numbers_read_comma.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;
const { DesignContext } = await loadApp();

const saved = [];
window.electronAPI = new Proxy({
    saveCoating: async (record) => { saved.push(JSON.parse(JSON.stringify(record))); return { success: true }; },
}, { get: (target, key) => target[key] || (() => Promise.resolve({ success: true })) });

const [{ NumberField }, { AddForm }, { SaveCoatingDialog }, { useCoatingLibrary }, { coatingLibrarySession },
    { BUILTIN_COATINGS }, { filterEntries }, { makeCoatingEntry }] = await Promise.all([
    import('../src/components/windows/design/specification/fields.js'),
    import('../src/components/SpectralMonitor.js'),
    import('../src/components/windows/design/coatingLibrary/SaveCoatingDialog.js'),
    import('../src/components/windows/design/coatingLibrary/useCoatingLibrary.js'),
    import('../src/components/windows/design/coatingLibrary/sessionState.js'),
    import('../src/utils/coatingLibrary/builtin/index.js'),
    import('../src/utils/coatingLibrary/filter.js'),
    import('../src/utils/coatingLibrary/entryModel.js'),
]);

const c = makeTheme();
const t = makeLocale('en');
DesignContext.value = makeDesignCtx(makeSampleDesign());

// The dialog's inner components have no hooks, so its tree is expanded by
// calling them; the elements of a tree are then visited in order.
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
const numberBoxes = tree => find(tree, node => node.props.inputMode === 'decimal');
const button = (tree, label) => find(tree, node => node.type === 'button' && node.props.children === label)[0];

// ── 1. Specification ─────────────────────────────────────────────────────────
const typeInto = (props, text) => {
    const committed = [];
    R.unmount();
    const input = R.run(() => NumberField({ ...props, onCommit: v => committed.push(v), c: {} }));
    input.props.onChange({ target: { value: text } });
    return committed;
};
assert.deepEqual(typeInto({ value: 550 }, '94,2'), [94.2], 'a comma decimal commits the whole number');
assert.deepEqual(typeInto({ value: 0.9, inPct: true }, '99,5'), [0.995], 'in percent too');
assert.deepEqual(typeInto({ value: 550 }, '94.2'), [94.2], 'a dot still works');
assert.deepEqual(typeInto({ value: 550 }, '94abc'), [], 'text that is not a number commits nothing');

// ── 2. Status-bar monitor form ───────────────────────────────────────────────
{
    let added = null;
    const form = () => R.run(() => AddForm({ c, t, mode: 'add', onAdd: m => { added = m; }, onCancel: () => {} }));
    R.unmount();
    const [bandStart] = numberBoxes(form());
    bandStart.props.onChange('450,5');
    button(form(), t.statusMonitors.add).props.onClick();
    assert.equal(added.lambdaStart, 450.5, 'the monitor form adds the band typed with a comma');
}

// ── 3. Save coating dialog ───────────────────────────────────────────────────
async function saveWith(typed) {
    R.unmount();
    const dialog = () => expand(R.run(() => SaveCoatingDialog({
        design: makeSampleDesign(), side: 'front', c, t, onClose: () => {},
    })));
    numberBoxes(dialog()).forEach((box, i) => box.props.onChange({ target: { value: typed[i] } }));
    const before = saved.length;
    await button(dialog(), t.coatingLibrary.saveDialog.save).props.onClick();
    const problems = find(dialog(), node => node.props.style?.color === c.error)
        .flatMap(list => find(list.props.children, node => typeof node.props.children === 'string'))
        .map(node => node.props.children);
    return { entry: saved.length > before ? makeCoatingEntry(saved.at(-1)) : null, problems };
}
{
    const { entry } = await saveWith(['450,5', '650,5', '7,5']);
    assert.ok(entry, 'a band and angle typed with commas save');
    assert.deepEqual([entry.band, entry.aoi], [[450.5, 650.5], 7.5], 'and save as the numbers typed');
    const cleared = await saveWith(['', '650', '0']);
    assert.equal(cleared.entry, null, 'a cleared band end does not save');
    assert.ok(cleared.problems.length > 0 && cleared.problems.every(p => !p.includes('NaN')),
        `a cleared band end is reported as a number: ${cleared.problems.join('; ')}`);
}

// ── 4. Coating Library filter ────────────────────────────────────────────────
{
    coatingLibrarySession.reset();
    coatingLibrarySession.write(null, { lambda: '1064,5' });
    R.unmount();
    const { visible } = R.run(() => useCoatingLibrary(t.coatingLibrary));
    const covering = filterEntries(BUILTIN_COATINGS, { lambda: 1064.5 });
    assert.ok(covering.length > 0 && covering.length < BUILTIN_COATINGS.length, 'the built-in shelf has entries on both sides of 1064.5 nm');
    assert.deepEqual(visible.map(e => e.id), covering.map(e => e.id), 'a wavelength typed with a comma filters the list');
    coatingLibrarySession.reset();
}

console.log('Typed number comma tests passed.');
