/**
 * setMerit refuses a list of rows in which an id is given to more than one
 * row.
 *
 * A row's id is what a math row names in refId, refId1 or refId2. Two rows
 * with one id left a math row reading whichever came last, without saying so.
 *
 *   1. Two rows given the same id are refused, and the error names the id and
 *      the places of the rows that hold it.
 *   2. Rows given different ids, rows given none (each takes a fresh id) and
 *      the rows of a design set again on another design are accepted.
 *   3. design.merit.add of the objects, which adds one row at a time, refuses an
 *      id a row of the merit function already has.
 *
 * The MCP tool setMerit takes its rows through the same call; tests/mcp_server.mjs
 * checks that it refuses a repeated id.
 *
 * Run: node tests/api_merit_repeated_ids.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const api = await import('../src/api/index.js');
await api.init();

const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2' });
const band = (lambdaStart, lambdaEnd, extra = {}) => ({ type: 'RAV', lambdaStart, lambdaEnd, target: 0, weight: 1, ...extra });

// 1. A repeated id.
assert.throws(
    () => api.setMerit(ar, [band(450, 650, { id: 'a' }), band(650, 850, { id: 'b' }), band(850, 950, { id: 'a' }), { type: 'ABSO', refId: 'a', target: 0, weight: 1 }]),
    error => /'a'/.test(error.message) && /rows? 0 and 2|0 and 2/.test(error.message) && error.message.startsWith('setMerit:'),
    'two rows with one id are refused, naming the id and the rows',
);

// 2. What stays accepted.
const distinct = api.setMerit(ar, [band(450, 650, { id: 'a' }), band(650, 850, { id: 'b' }), { type: 'ABSO', refId: 'a', target: 0, weight: 1 }]);
assert.deepEqual(distinct.meritOperands.slice(0, 2).map(row => row.id), ['a', 'b'], 'distinct ids are kept');
const unnamed = api.setMerit(ar, [band(450, 650), band(650, 850)]);
assert.notEqual(unnamed.meritOperands[0].id, unnamed.meritOperands[1].id, 'rows given no id take ids of their own');
const again = api.setMerit(ar, distinct.meritOperands);
assert.deepEqual(again.meritOperands.map(row => row.id), distinct.meritOperands.map(row => row.id), 'the rows of a design can be set again');

// merit.add of the objects takes one row at a time, so it checks the id against the rows already there.
const objects = await import('../src/api/objects/index.js');
const tf = await objects.start();
const design = tf.newDesign('Ids');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0, id: 'a' });
assert.throws(() => design.merit.add('RAV', 650, 850, { target: 0, id: 'a' }), /^Error: add: id 'a' is already the id of a row/, 'merit.add refuses an id a row has');
assert.equal(design.merit.length, 1, 'and adds nothing');
design.merit.add('RAV', 650, 850, { target: 0, id: 'b' });
design.merit.add('RAV', 850, 950, { target: 0 });
assert.equal(design.merit.length, 3, 'a row with another id, or none, is added');

console.log('PASS api_merit_repeated_ids');
process.exit(0);
