/**
 * A new layer-thickness row starts at a target that does not fight the design:
 * MNT at a 10 nm floor, MXT at the 1000 nm ceiling the merit wizard's
 * thickness limits start at. An MXT row used to start at 10 nm too, which asks
 * every layer to be at most 10 nm thick.
 *
 * Run: node tests/constraint_row_defaults.mjs
 */
import assert from 'node:assert/strict';
import { makeConstraintOperand } from '../src/utils/physics/optimizer.js';
import {
    makeRowOperand, retypeOperand,
} from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';

assert.equal(makeRowOperand({ type: 'MXT' }).target, 1000, 'an MXT row from the type picker');
assert.equal(retypeOperand(makeRowOperand({ type: 'BLNK', comment: '' }), 'MXT').target, 1000, 'a comment row retyped to MXT');
assert.equal(makeRowOperand({ type: 'MNT' }).target, 10, 'an MNT row keeps its 10 nm floor');
assert.equal(makeConstraintOperand({ type: 'MXT', target: 250 }).target, 250, 'a target given is kept');

console.log('PASS constraint_row_defaults');
