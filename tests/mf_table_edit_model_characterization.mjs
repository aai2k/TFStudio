import assert from 'node:assert/strict';
import {
    commitEdit, commitTarget, parseRampTarget, startEdit, targetInitialValue,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js';

const op = (type, extra = {}) => ({ id: type, type, enabled: true, target: 0.5, ...extra });

assert.equal(targetInitialValue(op('R', { target: 0.1234 }), false), '12.34');
assert.equal(targetInitialValue(op('TGT', { target: 0.1, targetEnd: 0.8 }), false), '10.0→80.0');
assert.equal(targetInitialValue(op('TGT', { target: 0.1 }), false), '10.0→10.0');
assert.equal(targetInitialValue(op('MNT', { target: 25 }), false), '25');
assert.equal(targetInitialValue(op('TT', { target: 1200 }), false), '1200');
assert.equal(targetInitialValue(op('MXWT', { target: 550 }), false), '550');
assert.equal(targetInitialValue(op('OPGT', { target: 0.99 }), true), '99.00');
assert.equal(targetInitialValue(op('OPGT', { target: 550 }), false), '550');

assert.deepEqual(parseRampTarget(op('RGT'), '20→80'), { target: 0.2, targetEnd: 0.8 });
assert.deepEqual(parseRampTarget(op('AGT', { rampPoints: 0 }), ' 12.5 -> 87.5 '), {
    target: 0.125, targetEnd: 0.875, rampPoints: 0,
});
assert.deepEqual(parseRampTarget(op('TGT', { rampPoints: 17 }), '-10→110'), {
    target: -0.1, targetEnd: 1.1, rampPoints: 17,
});
assert.deepEqual(parseRampTarget(op('TGT', { rampPoints: Infinity }), '1→2'), {
    target: 0.01, targetEnd: 0.02,
});
assert.equal(parseRampTarget(op('TGT'), 'bad→20'), null);
assert.equal(parseRampTarget(op('TGT'), '20->bad'), null);
assert.equal(parseRampTarget(op('TAV'), '20→80'), null);
assert.equal(parseRampTarget(op('TGT'), '20'), null);

const calls = [];
commitTarget(op('RGT', { id: 'ramp', rampPoints: 9 }), '25→75', (...args) => calls.push(args));
commitTarget(op('RGT', { id: 'bad-ramp' }), '25→bad', (...args) => calls.push(args));
commitTarget(op('R', { id: 'optical' }), '82.5', (...args) => calls.push(args));
commitTarget(op('TT', { id: 'raw' }), '1200 nm', (...args) => calls.push(args));
commitTarget(op('R', { id: 'invalid' }), 'not-a-number', (...args) => calls.push(args));
assert.deepEqual(calls, [
    ['ramp', '_patch', { target: 0.25, targetEnd: 0.75, rampPoints: 9 }],
    ['optical', 'target', 82.5],
    ['raw', 'target', 1200],
]);

const startCalls = [];
const startCtx = {
    operands: [op('R', { id: 'a', lambdaStart: 450 }), op('OPGT', { id: 'm', target: 0.9 })],
    onEdit: (...args) => startCalls.push(['edit', ...args]),
    isMathPct: operand => operand.id === 'm',
    setFocusCell: value => startCalls.push(['focus', value]),
    setEditCell: value => startCalls.push(['editing', value]),
};
startEdit(startCtx, 0, 'enabled', null);
startEdit(startCtx, 0, 'type', null);
startEdit(startCtx, 0, 'current', null);
startEdit(startCtx, 0, 'lambdaStart', null);
startEdit(startCtx, 1, 'target', '7');
assert.deepEqual(startCalls, [
    ['edit', 'a', 'enabled', false],
    ['focus', { rowIdx: 0, colKey: 'type' }],
    ['editing', { rowIdx: 0, colKey: 'lambdaStart', initValue: '450' }],
    ['editing', { rowIdx: 1, colKey: 'target', initValue: '7' }],
]);

const commitCalls = [];
const commitCtx = {
    operands: [op('R', { id: 'a' }), op('TGT', { id: 'r', target: 0.1 })],
    setEditCell: value => commitCalls.push(['state', value]),
    onEdit: (...args) => commitCalls.push(['edit', ...args]),
};
commitEdit(commitCtx, 0, 'weight', '3.5 kg');
commitEdit(commitCtx, 1, 'target', '30->60');
commitEdit(commitCtx, 9, 'target', '4');
commitEdit(commitCtx, 0, 'aoi', 'bad');
assert.deepEqual(commitCalls, [
    ['state', null], ['edit', 'a', 'weight', 3.5],
    ['state', null], ['edit', 'r', '_patch', { target: 0.3, targetEnd: 0.6 }],
    ['state', null],
    ['state', null],
]);

console.log('mf_table_edit_model_characterization: passed');
