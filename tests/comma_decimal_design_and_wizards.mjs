/**
 * The design windows and the wizards take a comma decimal, on any Windows locale.
 *
 * A native `type="number"` box on an English Windows drops the comma keystroke
 * before the code sees it, so 94,2 typed into one arrives as 942. Each section
 * types 94,2 into a window's decimal boxes, leaves them, and checks that 94.2
 * reaches the window's handler or state; a count box is checked to be a text
 * field that still takes a typed count.
 *
 *   1. Monitoring wizards (BBM and Mono): the field, the row field and the
 *      table cell, and a cell on the Parameters Deviation page.
 *
 * Run: node tests/comma_decimal_design_and_wizards.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const c = { field: '#111', text: '#eee', textDim: '#999', border: '#333', bg: '#000', panel: '#111', accent: '#39f' };

// The values a field hands on after `text` is typed into it and it is left.
function typed(Component, props, text = '94,2', pick) {
    const values = [];
    mount(Component, { ...props, onChange: value => values.push(value) }, pick).type(text).leave();
    return values;
}

const isText = (Component, props) => mount(Component, { ...props, onChange() {} }).input().props.type === 'text';

// ── 1. Monitoring wizards ────────────────────────────────────────────────────
{
    const wizard = await import('../src/components/windows/simulation/wizardShared.js');
    for (const [name, field] of [['field', wizard.NumField], ['row field', wizard.RowField], ['table cell', wizard.cellNum]]) {
        for (const positive of [false, true]) {
            const props = { value: 5, step: 0.1, positive, c, label: 'x' };
            const what = `monitoring wizard ${name}${positive ? ', positive' : ''}`;
            assert.deepEqual(typed(field, props), [94.2], `${what}: 94,2 is 94.2`);
            assert.ok(isText(field, props), `${what}: is a text field`);
        }
    }
    // A count, such as a monitoring order, from 1 to 12.
    const order = { value: 1, step: 1, min: 1, max: 12, c };
    assert.deepEqual(typed(wizard.cellNum, order, '3'), [3], 'monitoring wizard count: 3 arrives as 3');
    assert.ok(isText(wizard.cellNum, order), 'monitoring wizard count: is a text field');

    const { PageDeviations } = await import('../src/components/windows/simulation/wizardKit/PageDeviations.js');
    const stored = [];
    const page = mount(PageDeviations, {
        p: { matDev: {}, layers: [{}], shutterMean: 0, shutterRms: 0 },
        set: (key, value) => stored.push([key, value]),
        materialIds: ['SiO2'], layers: [{ material: 'SiO2', thickness: 100 }],
        resolveMat: () => null, c, B: {},
    // Three material cells, then the layer's checkbox and its thickness error.
    }, inputs => inputs.filter(input => input.props.type !== 'checkbox')[3]);
    page.type('94,2').leave();
    assert.deepEqual(stored, [['layers', [{ relThkErr: 94.2 }]]],
        'Parameters Deviation: a relative thickness error of 94,2 % is stored as 94.2');
}

console.log('comma_decimal_design_and_wizards: passed');
