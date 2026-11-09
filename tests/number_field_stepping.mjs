/**
 * The number fields of the windows' settings step as the Design Editor's
 * thickness cells do.
 *
 *   1. A step is `step`, Shift ten steps, Ctrl a tenth of one, within the
 *      field's bounds, and a count never by less than one.
 *   2. The arrow keys take Shift and Ctrl; a field without the arrows steps
 *      as it did.
 *   3. Up and down arrows show at the right edge while the pointer is over
 *      the field, the text moved clear of them and back after, with the same
 *      padding properties in every state, none on a disabled field. A
 *      press steps once, Shift and Ctrl as for the keys, a held one repeats,
 *      and a half-typed entry steps from what is typed.
 *   4. Every window settings field has them: the toolbar field every analysis
 *      window uses, the Preferences rows, and the windows that draw their own.
 *
 * Run: node tests/number_field_stepping.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mount } from './_typeIntoField.mjs';

const { NumberField, stepValue } = await import('../src/components/ui/numberField.js');
const { stepScale } = await import('../src/components/ui/wheelStep.js');
const { SPIN_WIDTH } = await import('../src/components/ui/SpinArrows.js');
const { NumInput } = await import('../src/components/windows/analysis/chrome/controls.js');

const c = { field: '#111', text: '#eee', textDim: '#999', border: '#333', bg: '#000', accent: '#39f' };

// ── 1. The size of a step ────────────────────────────────────────────────────
const plain = {};
const shift = { shiftKey: true };
const ctrl = { ctrlKey: true };
assert.equal(stepScale(plain), 1);
assert.equal(stepScale(shift), 10);
assert.equal(stepScale(ctrl), 0.1);

const field = { step: 10, positive: true };
assert.equal(stepValue(400, 1, plain, field), 410, 'one step up');
assert.equal(stepValue(400, -1, plain, field), 390, 'one step down');
assert.equal(stepValue(400, 3, plain, field), 430, 'three wheel notches in one event are three steps');
assert.equal(stepValue(400, 1, shift, field), 500, 'Shift steps ten times as far');
assert.equal(stepValue(400, 1, ctrl, field), 401, 'Ctrl a tenth as far');
assert.equal(stepValue(0.3, 1, ctrl, { step: 1 }), 0.4, 'a decimal step lands on the decimal, not on binary residue');
assert.equal(stepValue(5, -1, plain, field), null, 'a positive field refuses a step to zero or below');
assert.equal(stepValue(85, 1, plain, { step: 10, min: 0, max: 89 }), 89, 'a bounded field stops at its bound');
assert.equal(stepValue(12, 1, ctrl, { step: 1, integer: true }), 13, 'Ctrl on a count still steps by one');
assert.equal(stepValue(12, 1, shift, { step: 1, integer: true }), 22);

// The values a field hands on, and the field, which keeps what it is handed.
function held(props, Component = NumberField) {
    const values = [];
    const kept = { value: 400, step: 10, ...props };
    kept.onChange = (value) => { values.push(value); kept.value = value; };
    return { values, field: mount(Component, kept) };
}
const key = (f, name, modifiers = {}) => f.input().props.onKeyDown({ key: name, ...modifiers, preventDefault() {} });

// ── 2. The arrow keys ────────────────────────────────────────────────────────
{
    const { values, field: f } = held({ c }, NumInput);
    key(f, 'ArrowUp', { shiftKey: true });
    key(f, 'ArrowDown', { ctrlKey: true });
    key(f, 'ArrowUp', { metaKey: true });
    assert.deepEqual(values, [500, 499, 500], 'Shift+Up steps ten, Ctrl+Down a tenth, Cmd as Ctrl');
}
{
    const { values, field: f } = held({});
    key(f, 'ArrowUp', { shiftKey: true });
    assert.deepEqual(values, [410], 'a field without the arrows steps one step with Shift, as before');
}

// ── 3. The arrows ────────────────────────────────────────────────────────────
const nodes = (node, test, found = []) => {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) { node.forEach(child => nodes(child, test, found)); return found; }
    if (test(node)) found.push(node);
    [node.props?.children].flat(Infinity).forEach(child => nodes(child, test, found));
    return found;
};
const frameOf = f => nodes(f.render(), node => node.type === 'span' && node.props.onMouseEnter)[0];
const arrowsOf = f => nodes(f.render(), node => node.props?.role === 'button');

// A window whose timers run only when told to.
function fakeView() {
    const timers = [];
    const add = fn => timers.push(fn) - 1;
    return {
        timers,
        setTimeout: add, setInterval: add,
        clearTimeout: id => { timers[id] = null; }, clearInterval: id => { timers[id] = null; },
    };
}
function press(arrow, view, modifiers = {}) {
    const event = {
        button: 0, ...modifiers, stopPropagation() {},
        currentTarget: { ownerDocument: { defaultView: view }, setPointerCapture() {} },
    };
    arrow.props.onPointerDown(event);
    return () => arrow.props.onPointerUp(event);
}

// The padding properties a style sets. React applies a style by its keys: a
// key gone from one draw to the next is deleted from the element, and a
// shorthand whose value did not change is not written again.
const paddingKeys = style => Object.keys(style).filter(k => k.startsWith('padding')).sort();
{
    const { values, field: f } = held({ c }, NumInput);
    assert.equal(arrowsOf(f).length, 0, 'no arrows until the pointer is over the field');
    const before = f.input().props.style;
    assert.ok(before.paddingRight != null, 'the field sets its right padding itself');
    frameOf(f).props.onMouseEnter();
    assert.deepEqual(paddingKeys(f.input().props.style), paddingKeys(before),
        'hovering sets the same padding properties, so leaving deletes none of them');
    const [up, down] = arrowsOf(f);
    assert.ok(up && down, 'the pointer over the field shows the up and down arrows');
    assert.equal(f.input().props.style.paddingRight, SPIN_WIDTH + 2, 'and moves the text clear of them');
    assert.ok(up.props.title.includes('Shift'), 'the arrows say what Shift and Ctrl do');

    // Each press and each repeat acts on the field as last drawn, so the field
    // is drawn again between them, as React draws it after every change.
    const view = fakeView();
    const upArrow = () => arrowsOf(f)[0];
    press(upArrow(), view)();
    press(arrowsOf(f)[1], view, { shiftKey: true })();
    press(upArrow(), view, { ctrlKey: true })();
    assert.deepEqual(values, [410, 310, 311], 'a press steps once, Shift ten, Ctrl a tenth');

    const release = press(upArrow(), view);
    view.timers.at(-1)();
    f.render();
    view.timers.at(-1)();
    f.render();
    view.timers.at(-1)();
    release();
    assert.deepEqual(values.slice(3), [321, 331, 341], 'a held arrow keeps stepping after its pause');
    assert.equal(view.timers.at(-1), null, 'and stops when it is released');

    f.type('500');
    press(arrowsOf(f)[0], view)();
    assert.equal(values.at(-1), 510, 'a half-typed entry steps from what is typed');
    assert.equal(f.shown, '510', 'and the field shows the step');

    frameOf(f).props.onMouseLeave();
    assert.equal(arrowsOf(f).length, 0, 'the arrows go when the pointer leaves');
    assert.deepEqual(paddingKeys(f.input().props.style), paddingKeys(before), 'and the padding properties are the ones it had');
    assert.equal(f.input().props.style.paddingRight, before.paddingRight, 'and the text goes back');
}
{
    const { field: f } = held({ c, disabled: true }, NumInput);
    frameOf(f).props.onMouseEnter();
    assert.equal(arrowsOf(f).length, 0, 'a disabled field shows no arrows');
}

// ── 4. Where the fields step ─────────────────────────────────────────────────
// Read from the source: a settings field that should step and does not is one
// the user reaches for and finds dead.
const SRC = new URL('../src/components/', import.meta.url);
const source = path => fs.readFileSync(new URL(path, SRC), 'utf8');
const numInput = /export function NumInput[\s\S]*?\r?\n}\r?\n/.exec(source('windows/analysis/chrome/controls.js'))[0];
assert.match(numInput, /spin: true, c,/, 'the toolbar field of every analysis window steps');
for (const file of ['dialogs/settings/analysis/SpectralRangeRows.js', 'dialogs/settings/analysis/FieldRows.js']) {
    assert.match(source(file), /spin: true,\s+c,/, `${file}: the Preferences rows step`);
}
const OWN_FIELDS = [
    'windows/simulation/wizardShared.js',
    'windows/optimization/needleManual/PreviewPanel.js',
    'windows/optimization/needleManual/LeftSidebar.js',
    'windows/optimization/variator/PreviewToolbar.js',
    'windows/optimization/refinement/ControlBar.js',
    'windows/design/stackFormula/FormulaPanel.js',
    'windows/optimization/optimizerBenchmark/RunBar.js',
    'windows/optimization/filterDesignWizard/ui.js',
    'windows/optimization/designCleaner/CleanerControls.js',
    'windows/design/edgeFilter/InputsPanel.js',
];
for (const file of OWN_FIELDS) {
    const text = source(file);
    const all = (text.match(/h\(NumberField, \{/g) || []).length;
    const spinning = (text.match(/h\(NumberField, \{ spin: true, c,/g) || []).length;
    assert.ok(all > 0 && spinning === all, `${file}: every number field steps (${spinning} of ${all})`);
}

console.log('PASS: number_field_stepping');
