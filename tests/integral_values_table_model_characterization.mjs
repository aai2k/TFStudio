import assert from 'node:assert/strict';
import {
    appendTableRow,
    cleanTableRows,
    cloneTableRows,
    deleteTableRow,
    navigateTableCell,
    pasteTableRows,
    tableKeyAction,
    tableRowsCsv,
    tableRowsTsv,
    updateTableCell,
} from '../src/components/windows/analysis/integralValues/tableModel.js';

const original = [[500, 0.5], [400, 0.4]];
const cloned = cloneTableRows(original);
assert.deepEqual(cloned, original);
assert.notStrictEqual(cloned, original);
assert.notStrictEqual(cloned[0], original[0]);

assert.deepEqual(updateTableCell(original, 0, 1, '0.75'), [[500, 0.75], [400, 0.4]]);
assert.deepEqual(updateTableCell(original, 0, 1, ''), [[500, ''], [400, 0.4]]);
assert.deepEqual(appendTableRow(original), [[500, 0.5], [400, 0.4], [410, 0]]);
assert.strictEqual(deleteTableRow([[500, 1]], 0).length, 1);
assert.deepEqual(deleteTableRow(original, 0), [[400, 0.4]]);
assert.deepEqual(
    pasteTableRows([[1, 1], [2, 2]], 1, [[20, 0.2], [30, 0.3]]),
    [[1, 1], [20, 0.2], [30, 0.3]],
);
assert.deepEqual(cleanTableRows([[500, '0.5'], ['bad', 1], [400, '0.4']]), [[400, 0.4], [500, 0.5]]);
assert.equal(tableRowsTsv([[400, 0.4], [500, 0.5]]), '400\t0.4\n500\t0.5');
assert.equal(tableRowsCsv([[500, 0.5], [400, 0.4]]), '# λ_nm, value\n500, 0.5\n400, 0.4\n');

assert.deepEqual(navigateTableCell(0, 0, 'right', 2), { focus: [0, 1] });
assert.deepEqual(navigateTableCell(0, 1, 'right', 2), { focus: [1, 0] });
assert.deepEqual(navigateTableCell(1, 1, 'down', 2), { append: true });
assert.equal(navigateTableCell(0, 0, 'up', 2), null);

const event = (key, options = {}) => ({
    key,
    shiftKey: false,
    ctrlKey: false,
    target: { selectionStart: 1, value: '1' },
    ...options,
});
assert.deepEqual(tableKeyAction(event('Enter')), { kind: 'navigate', direction: 'down' });
assert.deepEqual(tableKeyAction(event('Tab', { shiftKey: true })), { kind: 'navigate', direction: 'left' });
assert.deepEqual(tableKeyAction(event('ArrowRight')), { kind: 'navigate', direction: 'right' });
assert.equal(tableKeyAction(event('ArrowLeft')), null);
assert.deepEqual(tableKeyAction(event('Delete', { ctrlKey: true })), { kind: 'deleteRow' });
assert.deepEqual(tableKeyAction(event('c', { ctrlKey: true })), { kind: 'copyRows' });
assert.equal(tableKeyAction(event('C', { ctrlKey: true })), null);

console.log('PASS: integral_values_table_model_characterization');
