/**
 * Integral Values: a custom integral is made in a dialog with its name first,
 * reads at a glance in the results table, and opens again in the same dialog.
 *
 *   1. The dialog's name starts as the short name of the channel, source and
 *      detector, follows them until it is typed in, and gets #2 when another
 *      custom integral already has it.
 *   2. Add makes the integral under the dialog's name; OK on an integral the
 *      dialog was opened on changes it under its own key and in its place. A
 *      blank name does neither.
 *   3. A custom row shows its name, then what it integrates, and its band as
 *      text, with a pencil beside its trash and no field to type in. The
 *      pencil and a double-click open the dialog on it.
 *   4. The dialog lists name, channel, source, detector and band in that order,
 *      greys Add for a blank name, and ignores a press on its backdrop.
 *   5. The top bar opens the dialog with a button rather than a popover.
 *   6. A custom integral saved before the dialog existed loads, keeps its name
 *      and computes as one made now.
 *
 * Run: node tests/integral_custom_dialog.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const DIR = '../src/components/windows/analysis/integralValues';
const {
    INITIAL_BUILDER, buildIntegralDefinitions, customDraft, draftName, highestCustomCounter,
    integralTable, makeCustomDefinition, newCustomDraft,
} = await import(`${DIR}/integralModel.js`);
const { commitCustomDraft } = await import(`${DIR}/useIntegralValues.js`);
const { ResultsTable } = await import(`${DIR}/ResultsTable.js`);
const { CustomIntegralDialog } = await import(`${DIR}/CustomIntegralDialog.js`);
const { IntegralControls } = await import(`${DIR}/Controls.js`);
const { DialogFrame } = await import('../src/components/windows/analysis/chrome/dialog.js');
const { computeIntegralValueBatch } = await import('../src/utils/physics/integralValues.js');
const { buildLambdaGrid } = await import('../src/utils/physics/thinFilmMath.js');

const h = React.createElement;
const c = makeTheme();
const t = makeLocale('en');
const iv = t.integralValues;
const parts = iv.customParts;

// A custom integral as the window saved one before the dialog: named with #1.
const OLD_PRESET = {
    key: 'custom_1', label: 'T·D65·V(λ) #1', char: 'T',
    sourceSpec: { id: 'D65', T: 5778, table: null },
    detectorSpec: { id: 'photopic', table: null },
    band: [380, 780],
};
const LAMP = {
    key: 'custom_2', label: 'Lamp 3000 K', char: 'R',
    sourceSpec: { id: 'blackbody', T: 3000, table: null },
    detectorSpec: { id: 'flat', table: null },
    band: [400, 700],
};

// A tree with every hook-free component in it called in place.
function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    const children = node.props?.children;
    return { type: node.type, props: { ...node.props, children: children === undefined ? [] : [children].flat(Infinity).map(expand) } };
}
function findAll(node, test, found = []) {
    if (Array.isArray(node)) { node.forEach(child => findAll(child, test, found)); return found; }
    if (!node || typeof node !== 'object') return found;
    if (test(node)) found.push(node);
    findAll(node.props?.children, test, found);
    return found;
}
const textOf = node => (typeof node === 'string' || typeof node === 'number' ? String(node)
    : (node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(textOf).join('') : ''));

// ── 1. The name ─────────────────────────────────────────────────────────────
{
    const draft = newCustomDraft(INITIAL_BUILDER);
    assert.equal(draftName(draft, parts, []), 'T·D65·V(λ)', 'a new integral is named after its choices');
    assert.equal(draftName({ ...draft, detector: { id: 'flat' } }, parts, []), 'T·D65·flat',
        'an untouched name follows the detector');
    const typed = { ...draft, name: 'Lamp 3000 K', named: true };
    assert.equal(draftName({ ...typed, char: 'R' }, parts, []), 'Lamp 3000 K', 'a typed name stays put');
    const taken = [{ key: 'custom_1', label: 'T·D65·V(λ)' }];
    assert.equal(draftName(draft, parts, taken), 'T·D65·V(λ) #2', 'a name in use gets #2');
    assert.equal(draftName(draft, parts, [...taken, { key: 'custom_2', label: 'T·D65·V(λ) #2' }]), 'T·D65·V(λ) #3');
    assert.equal(draftName({ ...draft, name: '   ', named: true }, parts, []), '', 'a typed blank is blank');
    assert.equal(makeCustomDefinition(INITIAL_BUILDER, 4, parts).label, 'T·D65·V(λ)', 'no #N is added to a name');
}

// ── 2. Add and OK ───────────────────────────────────────────────────────────
const saved = [];
globalThis.electronAPI = { saveIntegralPreset: preset => { saved.push(preset); return Promise.resolve({ success: true }); } };

function actionContext(draft, customDefs, counter) {
    const state = { customDefs, draft, builder: null, selected: 'Tvis' };
    const context = {
        draft, customDefs, counterRef: { current: counter },
        setDefinitions: update => { state.customDefs = update(state.customDefs); },
        setBuilder: builder => { state.builder = builder; },
        setDraft: next => { state.draft = next; },
        selectedKey: 'Tvis', setSelectedKey: key => { state.selected = key; },
    };
    return { state, context };
}

{
    const draft = {
        ...newCustomDraft(INITIAL_BUILDER), char: 'R', name: 'Lamp 3000 K', named: true,
        source: { id: 'blackbody', T: 3000, table: null }, detector: { id: 'flat', table: null },
        bandMin: 400, bandMax: 700,
    };
    const { state, context } = actionContext(draft, [OLD_PRESET], 1);
    commitCustomDraft(context, parts);
    const added = state.customDefs[1];
    assert.equal(added.key, 'custom_2', 'Add makes the next key');
    assert.equal(added.label, 'Lamp 3000 K', 'under the name typed in the dialog');
    assert.deepEqual([added.char, added.sourceSpec.id, added.sourceSpec.T, added.detectorSpec.id, added.band],
        ['R', 'blackbody', 3000, 'flat', [400, 700]]);
    assert.equal(state.selected, 'custom_2', 'and selects it');
    assert.equal(state.draft, null, 'and closes the dialog');
    assert.deepEqual(state.builder, { char: 'R', source: draft.source, detector: draft.detector, bandMin: 400, bandMax: 700 },
        'the next new integral starts from these choices');
    assert.deepEqual(saved.pop(), added, 'and saves it');
}
{
    const draft = { ...newCustomDraft(INITIAL_BUILDER), name: ' ', named: true };
    const { state, context } = actionContext(draft, [], 0);
    commitCustomDraft(context, parts);
    assert.deepEqual(state.customDefs, [], 'a blank name adds nothing');
    assert.equal(state.draft, draft, 'and keeps the dialog open');
    assert.equal(saved.length, 0);
}
{
    const draft = customDraft(OLD_PRESET, parts, [OLD_PRESET, LAMP]);
    assert.deepEqual([draft.name, draft.named], ['T·D65·V(λ) #1', true], 'an opened integral keeps its name');
    const table = [[400, 1], [700, 2]];
    const changed = { ...draft, char: 'A', detector: { id: 'custom', table } };
    const { state, context } = actionContext(changed, [OLD_PRESET, LAMP], 2);
    commitCustomDraft(context, parts);
    const [first, second] = state.customDefs;
    assert.equal(first.key, 'custom_1', 'OK changes the integral under its own key, in its place');
    assert.equal(second, LAMP, 'and leaves the others alone');
    assert.deepEqual([first.label, first.char, first.detectorSpec.id, first.detectorSpec.table],
        ['T·D65·V(λ) #1', 'A', 'custom', table], 'the detector, missing from the row before, is changed');
    assert.notEqual(first.detectorSpec.table, table, 'the saved table is a copy of the one in the dialog');
    assert.equal(state.selected, 'Tvis', 'the selection stays');
    assert.deepEqual(saved.pop(), first, 'and saves it');
}
{
    // A name that is the suggestion goes on following the choices when opened.
    const plain = { ...LAMP, label: 'R·BB3000K·flat' };
    const draft = customDraft(plain, parts, [plain]);
    assert.equal(draft.named, false, 'a suggested name is not a typed one');
    assert.equal(draftName({ ...draft, detector: { id: 'photopic' } }, parts, [plain]), 'R·BB3000K·V(λ)');
}

// ── 3. The rows ─────────────────────────────────────────────────────────────
{
    const lambda = buildLambdaGrid(300, 2500, 5);
    const T = lambda.map(() => 0.9);
    const integrals = buildIntegralDefinitions([OLD_PRESET, LAMP]);
    const results = computeIntegralValueBatch({ lambda, T, R: T.map(v => 1 - v), A: T.map(() => 0) }, integrals);
    const edits = [];
    const props = {
        integrals, results, selectedKey: 'Tvis', setSelectedKey: () => {},
        onEdit: key => edits.push(key), onRemove: () => {}, c, t,
    };
    const html = renderToStaticMarkup(h(ResultsTable, props));
    const row = html.split('<tr').find(r => r.includes('>Lamp 3000 K'));
    assert.ok(row.includes('R · Blackbody 3000 K × Flat (unity)'), 'a custom row says what it integrates');
    assert.ok(row.includes('400–700 nm'), 'and its band as text');
    assert.ok(row.includes(`title="${iv.editRow}"`) && row.includes(`title="${iv.removeRow}"`), 'with a pencil and a trash');
    assert.ok(!row.includes('<input') && !row.includes('<select'), 'and nothing to type in');
    assert.ok(!html.split('<tr').find(r => r.includes('>Tvis<')).includes(`title="${iv.editRow}"`), 'a built-in row has no pencil');

    const tree = expand(ResultsTable(props));
    const rows = findAll(tree, node => node.type === 'tr');
    const lampRow = rows.find(node => textOf(node).includes('Lamp 3000 K'));
    lampRow.props.onDoubleClick();
    findAll(lampRow, node => node.type === 'button' && node.props.title === iv.editRow)[0]
        .props.onClick({ stopPropagation() {} });
    assert.deepEqual(edits, ['custom_2', 'custom_2'], 'a double-click and the pencil open the dialog on the row');
    assert.equal(rows.find(node => textOf(node).startsWith('Tvis')).props.onDoubleClick, undefined,
        'a double-click on a built-in row opens nothing');
}

// ── 4. The dialog ───────────────────────────────────────────────────────────
const dialogOf = (draft, customDefs = []) => renderToStaticMarkup(h(CustomIntegralDialog, {
    c, t,
    model: {
        draft, setDraft() {}, customDefs, openEditor() {}, closeCustom() {}, commitCustom() {},
    },
}));
{
    const html = dialogOf(newCustomDraft(INITIAL_BUILDER));
    assert.ok(html.includes('role="dialog"') && html.includes(`>${iv.newCustomTitle}<`), 'a new integral has its own title');
    const firstInput = html.slice(html.indexOf('<input')).split('>')[0];
    assert.ok(firstInput.includes('value="T·D65·V(λ)"'), 'the first field is the name, holding the suggestion');
    const at = label => html.indexOf(`>${label}</span>`);
    const order = [iv.name, iv.channel, iv.source, iv.detector, iv.band].map(at);
    assert.ok(order.every((value, index) => value > 0 && (index === 0 || value > order[index - 1])),
        'name, channel, source, detector, band, in that order');
    assert.ok(/<button[^>]*>Add<\/button>/.test(html) && !/<button[^>]*disabled=""[^>]*>Add</.test(html), 'Add is live');

    const blank = dialogOf({ ...newCustomDraft(INITIAL_BUILDER), name: '', named: true });
    assert.ok(new RegExp(`<button[^>]*title="${iv.nameNeeded}"[^>]*disabled=""[^>]*>Add<`).test(blank),
        'a blank name greys Add and says why');

    const opened = dialogOf(customDraft(LAMP, parts, [LAMP]), [LAMP]);
    assert.ok(opened.includes(`>${iv.editCustomTitle}<`) && opened.includes(`>${t.dialogs.input.ok}</button>`),
        'an opened integral is edited with OK');
    assert.ok(opened.includes('value="Lamp 3000 K"') && opened.includes('value="3000"'), 'showing its name and temperature');

    const table = dialogOf({ ...newCustomDraft(INITIAL_BUILDER), source: { id: 'custom', table: [[400, 1], [700, 1]] } });
    assert.ok(table.includes(`${iv.editTable} (2)`), 'a custom source offers its table');

    const frame = expand(DialogFrame({ c, title: 'x', onClose() {}, closeTitle: 'Cancel', width: 300, footer: null, children: null }));
    assert.equal(frame.props.role, 'dialog');
    assert.equal(frame.props.onClick, undefined, 'a press on the backdrop does nothing');
    assert.equal(frame.props.children[0].props.onClick, undefined, 'nor on the panel');
}

// ── 5. The top bar ──────────────────────────────────────────────────────────
{
    const html = renderToStaticMarkup(h(IntegralControls, {
        c, t, notices: [],
        model: {
            selected: null, integrals: [], setSelKey() {}, openNewCustom() {},
            params: { lambdaStart: 300, lambdaEnd: 2500, lambdaStep: 5, theta: 0, polarization: 'avg' }, setParams() {},
        },
    }));
    const button = html.split('<button').find(part => part.includes(`${iv.newCustom}</button>`));
    assert.ok(button, 'the top bar has the button that opens the dialog');
    assert.ok(!button.includes('aria-expanded'), 'and it is a button, not a popover');
}

// ── 6. Saved before the dialog ──────────────────────────────────────────────
{
    const lambda = buildLambdaGrid(300, 2500, 5);
    const T = lambda.map(value => 0.5 + 0.4 * Math.sin(value / 37));
    const spectrum = { lambda, T, R: T.map(v => 1 - v), A: T.map(() => 0) };
    const now = makeCustomDefinition(newCustomDraft(INITIAL_BUILDER), 2, parts, [OLD_PRESET]);
    const { definitions, results } = integralTable(spectrum, [OLD_PRESET, now]);
    assert.equal(definitions.find(d => d.key === 'custom_1').label, 'T·D65·V(λ) #1', 'an old name is kept');
    assert.ok(Number.isFinite(results.custom_1.value), 'an old integral computes');
    assert.equal(results.custom_1.value, results.custom_2.value, 'and gives what the same integral made now gives');
    assert.equal(highestCustomCounter([OLD_PRESET]), 1, 'and its key is not handed out again');
}

console.log('PASS: integral_custom_dialog');
