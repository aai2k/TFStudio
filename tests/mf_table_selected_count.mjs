/**
 * The count of selected rows under the merit table reads in the UI language,
 * in the Merit Function Editor and in Refinement, which share the table.
 *
 * Run: node tests/mf_table_selected_count.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { tableToolbar } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js');

const c = makeTheme();
const noop = () => {};
const operands = ['a', 'b', 'c'].map(id => ({ id, type: 'TAV', enabled: true, lambdaStart: 500, lambdaEnd: 600 }));
const toolbar = (t, selIds) => renderToStaticMarkup(tableToolbar({
    operands, selIds, setSelIds: noop, focusCell: null, range: null, extraCells: null, clearCells: noop,
    focusAfterRemoval: noop, primarySel: null, onAdd: noop, onDelete: noop, onMoveUp: noop, onMoveDown: noop, c, t,
}));

for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    const html = toolbar(t, new Set(['a', 'b', 'c']));
    assert.ok(html.includes(`>${t.meritFunctionEditor.selectedRows(3)}</span>`), `${code}: the count reads in the language`);
    if (code !== 'en') assert.ok(!html.includes('selected'), `${code}: no English left`);
    assert.ok(!toolbar(t, new Set(['a'])).includes(t.meritFunctionEditor.selectedRows(1)), `${code}: one row shows no count`);
}

console.log('PASS: mf_table_selected_count');
