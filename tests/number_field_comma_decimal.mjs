/**
 * The shared number field takes a comma decimal, on any Windows locale.
 *
 * A native `type="number"` box on an English Windows drops the comma keystroke
 * before the code sees it, so 94,2 typed into one arrives as 942. The shared
 * field is a text field that reads either separator, applies on Enter or when
 * it is left, and steps with the arrow keys.
 *
 *   1. 94,2 and 94.2 both give 94.2, on Enter or on leaving the field; nothing
 *      is applied while it is typed.
 *   2. Text that is not a number, such as 94abc or 550..5, puts the value back.
 *   3. Bounds: min and max clamp, and the field then shows what its window
 *      keeps, even when the window rounds the entry or limits it itself;
 *      `positive` refuses zero; `integer` cuts to a whole number; `nullable`
 *      gives null for an emptied field.
 *   4. The arrow keys step and apply at once, without binary leftovers.
 *   5. The analysis toolbar field is the same field.
 *
 * Run: node tests/number_field_comma_decimal.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const { NumberField } = await import('../src/components/ui/numberField.js');
const { NumInput } = await import('../src/components/windows/analysis/chrome/controls.js');

const c = { field: '#111', text: '#eee', textDim: '#999', border: '#333', bg: '#000', accent: '#39f' };

// The values the field hands on after `act` has been done to it, and what it
// shows then. Its window keeps what it is handed, or what `keep` makes of it.
function taken(props, act, Component = NumberField, keep = value => value) {
    const values = [];
    const held = { value: 1, ...props };
    held.onChange = (value) => { values.push(value); held.value = keep(value); };
    const field = mount(Component, held);
    act(field);
    return { values, shown: field.shown };
}

// ── 1. Either separator ──────────────────────────────────────────────────────
assert.equal(mount(NumberField, { value: 1, onChange() {} }).input().props.type, 'text', 'the field is a text field');
assert.deepEqual(taken({}, f => f.type('94,2').leave()).values, [94.2], '94,2 is 94.2');
assert.deepEqual(taken({}, f => f.type('94.2').leave()).values, [94.2], 'and so is 94.2');
assert.deepEqual(taken({}, f => f.type('94,2').press('Enter')).values, [94.2], 'Enter applies it too');
assert.deepEqual(taken({}, f => f.type('9').type('94').type('94,').type('94,2')).values, [],
    'nothing is applied while the number is typed');
assert.deepEqual(taken({}, f => f.type('1,5e3').leave()).values, [1500], 'a comma takes an exponent');

// ── 2. Text that is not a number ─────────────────────────────────────────────
for (const text of ['94abc', '550..5', '0,5,1', '']) {
    const { values, shown } = taken({ value: 7 }, f => f.type(text).leave());
    assert.deepEqual(values, [], `"${text}" is refused`);
    assert.equal(shown, '7', `and the field goes back to 7 after "${text}"`);
}

// ── 3. Bounds ────────────────────────────────────────────────────────────────
{
    const { values, shown } = taken({ value: 10, min: 0, max: 89 }, f => f.type('95').leave());
    assert.deepEqual(values, [89], 'an entry above max is clamped');
    assert.equal(shown, '89', 'and the field shows the clamped value');
    const atMax = taken({ value: 89, min: 0, max: 89 }, f => f.type('95').leave());
    assert.deepEqual(atMax.values, [], 'clamped onto the value it holds, nothing changes');
    assert.equal(atMax.shown, '89', 'and the field does not keep showing 95');
    const rounded = taken({ value: 16 }, f => f.type('16,3').leave(), NumberField, Math.round);
    assert.deepEqual(rounded.values, [16.3], 'a window that rounds is handed 16.3');
    assert.equal(rounded.shown, '16', 'and the field shows the 16 it keeps, not 16.3');
    const limited = taken({ value: 60 }, f => f.type('100').press('Enter'), NumberField, value => Math.min(value, 60));
    assert.equal(limited.shown, '60', 'a window that holds 100 to 60 shows 60');
}
assert.deepEqual(taken({ positive: true }, f => f.type('0').leave()).values, [], 'a positive field refuses 0');
assert.deepEqual(taken({ positive: true }, f => f.type('-5').leave()).values, [], 'and -5');
assert.deepEqual(taken({ positive: true }, f => f.type('0,001').leave()).values, [0.001], 'and takes 0,001');
assert.deepEqual(taken({ integer: true, value: 5 }, f => f.type('2,7').leave()).values, [2], 'a count takes 2,7 as 2');
assert.deepEqual(taken({ nullable: true, value: 5 }, f => f.type('').leave()).values, [null], 'a nullable field empties to null');

// ── 4. Arrow keys ────────────────────────────────────────────────────────────
assert.deepEqual(taken({ value: 0.1, step: 0.2 }, f => f.press('ArrowUp')).values, [0.3], 'up from 0.1 by 0.2 is 0.3');
assert.deepEqual(taken({ value: 5, step: 10, positive: true }, f => f.press('ArrowDown')).values, [],
    'a positive field does not step below zero');
assert.deepEqual(taken({ value: 3, step: 1, min: 0, max: 4 }, f => f.press('ArrowUp').press('ArrowUp')).values, [4, 4],
    'stepping stops at max');

// ── 5. The analysis toolbar field ────────────────────────────────────────────
assert.deepEqual(taken({ c, value: 400, positive: true, step: 10 }, f => f.type('94,2').leave(), NumInput).values, [94.2],
    'NumInput takes 94,2 as 94.2');
assert.equal(mount(NumInput, { c, value: 1, onChange() {} }).input().props.inputMode, 'decimal',
    'and brings up a decimal keypad on a touch screen');

console.log('number_field_comma_decimal: passed');
