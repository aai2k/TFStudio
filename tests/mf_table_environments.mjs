/**
 * The merit table and its wizard on a design with environments.
 *
 *   1. A design with one environment has no Env column and no Env field in
 *      the wizard; its columns stay where they were.
 *   2. With environments, the Env column follows Type in the Merit Function
 *      Editor and in Refinement: All, or one environment, by number and name;
 *      a row scored nowhere, a constant, shows a dash.
 *   3. The value column reads the current environment and names it in its
 *      header; a row not scored there shows a dash, as does every row while
 *      the current environment is off.
 *   4. The share column adds a row's part over every environment it is
 *      scored in, and the shares add up to the whole MF².
 *   5. The Env cell is a list cell as Pol is: it opens its list, takes a pick,
 *      a pasted name and the arrow keys, copies as its name, and All leaves
 *      the row without `env`.
 *   6. The wizard's Env field, All by default, scores the rows it generates in
 *      one environment, leaving the header and the thickness limits to all.
 *   7. A pasted row keeps its environment only in the design it was copied
 *      from, while that design still has it; anywhere else it is scored in
 *      every environment.
 *   8. A row retyped to a constant or a comment leaves its environment.
 *   9. The wizard's Env field is kept per design: another design opens at All.
 *
 * Run: node tests/mf_table_environments.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const mfe = '../src/components/windows/optimization/meritFunctionEditor';
const { MeritFunctionEditor } = await import(`${mfe}/MeritFunctionEditor.js`);
const { Refinement } = await import('../src/components/windows/optimization/refinement/Refinement.js');
const { tableEnvironments } = await import(`${mfe}/mfTable/tableEnvironments.js`);
const { listEdit, listOf, listPaste } = await import(`${mfe}/mfTable/listValues.js`);
const { cellInitialText, startEdit } = await import(`${mfe}/mfTable/editModel.js`);
const { navigationTarget, tableGrid } = await import(`${mfe}/mfTable/selectionModel.js`);
const { clipboardScope, rangeText } = await import(`${mfe}/mfTable/cellClipboard.js`);
const { DASH, fmtContribution, fmtCurrent, rowDisplayMeta } = await import(`${mfe}/mfTable/operandViewModel.js`);
const { editOperand } = await import(`${mfe}/meritOperandModel.js`);
const { blockInEnvironment, wizardEnvironment } = await import(`${mfe}/wizardModel.js`);
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { environmentContributions } = await import('../src/utils/physics/environmentDisplay.js');
const { operandContributions } = await import('../src/utils/physics/optimizer.js');
const { groupRows } = await import('../src/utils/environments/environmentMerit.js');

const h = React.createElement;
const c = makeTheme();
const t = makeLocale('en');
const te = t.meritFunctionEditor;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const draw = (Window, design, current = 'base') => {
    currentEnvironmentSession.write(design, { current });
    const html = renderToStaticMarkup(withDesign(h(Window, { c, t, theme: c, setInputDialog: () => {} }), design));
    currentEnvironmentSession.write(design, { current: 'base' });
    return html;
};
const tableOf = html => html.slice(html.indexOf('<colgroup>'));
const heads = html => [...tableOf(html).split('</thead>')[0].matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(match => match[1]);
const headTags = html => tableOf(html).split('</thead>')[0].match(/<th [^>]*>/g);
// The cells of each data row, by the row's index in the table.
const rows = html => Object.fromEntries([...tableOf(html).split('</thead>')[1].matchAll(/<tr data-row="(\d+)"[^>]*>(.*?)<\/tr>/g)]
    .map(match => [match[1], [...match[2].matchAll(/<td([^>]*)>(.*?)<\/td>/g)].map(cell => ({ attributes: cell[1], text: cell[2].replace(/<[^>]*>/g, '') }))]));

const one = oneEnvironmentDesign();
const design = threeEnvironmentDesign();
const COLUMNS = ['#', '✓', te.cols.type, te.cols.lambdaLayer, te.cols.endDefault, te.cols.aoi, te.cols.pol, te.cols.flag, te.cols.target, te.cols.weight, te.cols.current, te.cols.contribution];

// ── 1. One environment ───────────────────────────────────────────────────────
for (const Window of [MeritFunctionEditor, Refinement]) {
    const html = draw(Window, one);
    assert.deepEqual(heads(html).map((text, i) => (i < 3 || i > 9 ? text : COLUMNS[i])), COLUMNS,
        `${Window.name}: the columns of a design with one environment`);
    assert.ok(!heads(html).includes(te.cols.env), `${Window.name}: no Env column`);
    assert.ok(!html.includes(`title="${esc(te.wizard.envTip)}"`), `${Window.name}: no Env field in the wizard`);
}

// ── 2. The Env column ────────────────────────────────────────────────────────
for (const Window of [MeritFunctionEditor, Refinement]) {
    const html = draw(Window, design);
    assert.equal(heads(html)[3], te.cols.env, `${Window.name}: Env follows Type`);
    assert.equal(heads(html).length, COLUMNS.length + 1);
    const cells = rows(html);
    assert.equal(cells[0][2].attributes.match(/colSpan="(\d+)"/)[1], String(COLUMNS.length + 1 - 2), 'the header row spans the Env column too');
    assert.deepEqual(['1', '2', '3', '4'].map(row => cells[row][3].text), [te.envAll, '2 · Sapphire', DASH, te.envAll],
        `${Window.name}: All, environment 2, a constant's dash, a limit's All`);
}

// ── 3. The value column reads the current environment ────────────────────────
{
    const table = meritTable(design, design.meritOperands);
    const valueIn = (env, row) => {
        const computed = table.environments.find(group => group.id === env).computed[row];
        return fmtCurrent(rowDisplayMeta(design.meritOperands[row], computed, false).cur, rowDisplayMeta(design.meritOperands[row], computed, false));
    };
    const value = html => Object.fromEntries(Object.entries(rows(html)).filter(([, cells]) => cells.length > 3)
        .map(([row, cells]) => [row, cells[cells.length - 2]]));

    const base = draw(MeritFunctionEditor, design);
    assert.equal(heads(base)[11], te.currentIn(1), 'the header names environment 1');
    assert.ok(headTags(base)[11].includes(`title="${esc(te.currentInTip(1, 'BK7'))}"`));
    assert.equal(value(base)[1].text, valueIn('base', 1), 'a row of every environment, valued in environment 1');
    assert.equal(value(base)[2].text, DASH, 'a row of environment 2 alone has no value in environment 1');
    assert.ok(value(base)[2].attributes.includes(`title="${esc(te.notScoredIn(1))}"`), 'and says why');

    const second = draw(MeritFunctionEditor, design, 'env2');
    assert.equal(heads(second)[11], te.currentIn(2));
    assert.equal(value(second)[1].text, valueIn('env2', 1), 'the same row valued on sapphire');
    assert.equal(value(second)[2].text, valueIn('env2', 2), 'the sapphire row');
    assert.notEqual(valueIn('env2', 1), valueIn('base', 1), 'the two environments differ');

    const off = draw(MeritFunctionEditor, design, 'env3');
    assert.deepEqual(Object.values(value(off)).map(cell => cell.text).filter(text => text !== DASH), [],
        'environment 3 is off: no row has a value there');
}

// ── 4. The share column ──────────────────────────────────────────────────────
{
    const table = meritTable(design, design.meritOperands);
    const shares = environmentContributions(design.meritOperands, table.environments);
    const groups = table.environments.filter(group => group.scored);
    const sum = groups.reduce((total, group) => total + group.mf ** 2, 0);
    const partOf = (group, row) => operandContributions(groupRows(design.meritOperands, group.rows), group.computed)[row] * group.mf ** 2 / sum;
    assert.ok(Math.abs(shares[1] - groups.reduce((total, group) => total + partOf(group, 1), 0)) < 1e-12,
        'a row of every environment adds its part in each');
    assert.ok(Math.abs(shares[2] - partOf(groups[1], 2)) < 1e-12, 'a row of environment 2 has its part there');
    assert.ok(Math.abs(shares.reduce((total, share) => total + (share || 0), 0) - 1) < 1e-12, 'the shares make up the whole MF²');
    assert.equal(shares[3], null, 'a constant has no share');
    const html = draw(MeritFunctionEditor, design);
    const shown = rows(html);
    assert.equal(shown[2][shown[2].length - 1].text, fmtContribution(shares[2]),
        'the column shows them whichever environment is current');
}

// ── 5. The Env cell ──────────────────────────────────────────────────────────
{
    const environments = tableEnvironments(design, 'base', te);
    const operands = design.meritOperands;
    const table = { operands, integralPresets: [], environments };
    const [, r1, r2, k1] = operands;
    assert.deepEqual(listOf(r1, 'env', table), {
        options: [{ value: null, label: te.envAll }, { value: 'base', label: '1 · BK7' }, { value: 'env2', label: '2 · Sapphire' }, { value: 'env3', label: '3' }],
        value: null, gone: false,
    });
    assert.deepEqual(listEdit(r1, 'env', 'env2', table), ['env', 'env2'], 'a pick scores the row in that environment');
    assert.deepEqual(listPaste(r2, 'env', 'all', table), ['env', null], 'a pasted name picks too');
    assert.equal(cellInitialText(r2, 'env', false, table), '2 · Sapphire', 'it copies as its name');
    const scoped = editOperand(operands, 'r1', 'env', 'env2');
    assert.equal(scoped[1].env, 'env2');
    assert.ok(!('env' in editOperand(scoped, 'r1', 'env', null)[1]), 'All leaves the row without env');
    assert.equal(listOf({ ...r1, env: 'env9' }, 'env', table).gone, true, 'an environment the design does not have is marked');

    const opened = [];
    startEdit({ operands, isMathPct: () => false, setFocusCell() {}, setEditCell: cell => opened.push(cell), onEdit() {} }, 1, 'env', null);
    assert.deepEqual(opened, [{ rowIdx: 1, colKey: 'env', initValue: '' }], 'Enter opens the list');
    startEdit({ operands, isMathPct: () => false, setFocusCell() {}, setEditCell: cell => opened.push(cell), onEdit() {} }, 3, 'env', null);
    assert.equal(opened.length, 1, 'a constant\'s dash opens nothing');

    const grid = tableGrid(environments);
    assert.equal(navigationTarget(operands, 1, 'type', 'right', grid).colKey, 'env', 'Right from Type reaches Env');
    assert.equal(navigationTarget(operands, 1, 'env', 'right', grid).colKey, 'lambdaStart');
    assert.equal(navigationTarget(operands, 1, 'type', 'right').colKey, 'lambdaStart', 'and goes past it on a design without environments');
    assert.equal(clipboardScope({ op: r2, focusCell: { rowIdx: 2, colKey: 'env' }, selectedIds: new Set(), environments }), 'cell');
    assert.equal(clipboardScope({ op: k1, focusCell: { rowIdx: 3, colKey: 'env' }, selectedIds: new Set(), environments }), 'none');
    const range = { rowStart: 1, rowEnd: 2, colKeys: ['type', 'env'] };
    assert.equal(rangeText(operands, range, () => false, [], environments), `RAV\t${te.envAll}\nR\t2 · Sapphire`, 'a rectangle copies the Env cells');
}

// ── 6. The wizard's Env field ────────────────────────────────────────────────
{
    const html = draw(MeritFunctionEditor, design);
    const field = html.match(new RegExp(`<span title="${esc(te.wizard.envTip)}"><select[^>]*>(.*?)</select>`))?.[1];
    assert.ok(field, 'the wizard has an Env field');
    assert.deepEqual([...field.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]), [te.envAll, '1 · BK7', '2 · Sapphire', '3']);
    assert.match(field, /<option value="" selected="">/, 'All by default');

    const block = [
        { type: 'DMFS', comment: 'AR' }, { type: 'RAV', id: 'a' }, { type: 'TGT', id: 'b' },
        { type: 'MNT', id: 'c' }, { type: 'MXT', id: 'd' }, { type: 'TT', id: 'e' },
    ];
    assert.equal(blockInEnvironment(block, null), block, 'All: the rows as generated');
    assert.deepEqual(blockInEnvironment(block, 'env2').map(op => op.env ?? null), [null, 'env2', 'env2', null, null, null],
        'one environment: the optical rows, not the header or the limits');
    assert.equal(wizardEnvironment(design, 'env2'), 'env2');
    assert.equal(wizardEnvironment(design, 'env9'), null, 'an environment the design does not have reads as All');
    assert.equal(wizardEnvironment(one, 'env2'), null, 'as does any on a design with one environment');
}

// ── 7. Pasted rows keep their environment only in their own design ──────────
{
    const { copySelectedOperands, operandsFromClipboard } = await import(`${mfe}/mfTable/operandClipboard.js`);
    const { doKeyDown } = await import(`${mfe}/mfTable/tableKeyboard.js`);
    const clipboard = {
        text: '', writeText(text) { this.text = text; return Promise.resolve(); }, readText() { return Promise.resolve(this.text); },
    };
    const source = tableEnvironments(design, 'base', te);
    copySelectedOperands(design.meritOperands, new Set(['r2']), clipboard, source);
    const pasted = environments => operandsFromClipboard(clipboard.text, environments)[0];
    assert.equal(pasted(source).env, 'env2', 'pasted back into its own design, the row stays in environment 2');
    assert.ok(!('env' in pasted(null)), 'into a design with one environment it is scored in every environment');
    assert.ok(!('env' in pasted(tableEnvironments({ ...design, id: 'other' }, 'base', te))),
        'into another design, whose env2 is another environment, too');
    const lost = { ...design, environments: [design.environments[0], design.environments[2]] };
    assert.ok(!('env' in pasted(tableEnvironments(lost, 'base', te))), 'and once its own design no longer has the environment');

    // Ctrl+C and Ctrl+V from the table say which design they are in.
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true });
    const added = [];
    const key = (environments, keyName, rowIdx) => doKeyDown({
        editCell: null, focusCell: null, selectedIds: new Set([design.meritOperands[rowIdx].id]), operands: design.meritOperands,
        integralPresets: [], environments, isMathPct: () => false, onAdd: items => added.push(...items),
    }, { key: keyName, ctrlKey: true, shiftKey: false, target: {}, preventDefault() {} });
    key(source, 'c', 2);
    key(tableEnvironments({ ...design, id: 'other' }, 'base', te), 'v', 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(added.length, 1);
    assert.ok(!('env' in added[0]), 'the keys paste it into another design scored everywhere');
    key(source, 'v', 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(added[1].env, 'env2', 'and into its own design in its environment');
}

// ── 8. A row retyped to one scored nowhere leaves its environment ────────────
{
    const retyped = type => editOperand(design.meritOperands, 'r2', 'type', type).find(op => op.id === 'r2');
    assert.equal(retyped('T').env, 'env2', 'a row the merit still scores stays in its environment');
    for (const type of ['CONS', 'BLNK']) assert.ok(!('env' in retyped(type)), `${type}: scored nowhere, it names no environment`);
}

// ── 9. The wizard's Env field belongs to one design ──────────────────────────
{
    const { meritWizardEnvironmentSession } = await import(`${mfe}/sessionState.js`);
    const held = html => html.match(new RegExp(`<span title="${esc(te.wizard.envTip)}"><select[^>]*>(.*?)</select>`))[1]
        .match(/<option value="([^"]*)" selected=""/)[1];
    meritWizardEnvironmentSession.write(design, { env: 'env2' });
    assert.equal(held(draw(MeritFunctionEditor, design)), 'env2', 'set on this design, it holds environment 2');
    assert.equal(held(draw(MeritFunctionEditor, { ...design, id: 'twin' })), '',
        'another design with the same environment ids opens at All');
    meritWizardEnvironmentSession.write(design, { env: null });
}

console.log('PASS mf_table_environments');
