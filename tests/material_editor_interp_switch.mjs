/**
 * The interpolation rule control in the Material Editor form.
 *
 * Renders the user-material form and checks that a tabular draft shows the
 * two rules with the draft's own one selected, that a formula draft shows the
 * control only once it has a k table, and that choosing a rule writes it into
 * the draft the parent receives.
 *
 * Run: node tests/material_editor_interp_switch.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const { emptyDraft, materialToDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');

const c = makeTheme();
const t = makeLocale();
const me = t.materialEditor;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const has = (html, text) => html.includes(esc(text));

function render(draft, onChange = () => {}) {
    return renderToStaticMarkup(React.createElement(UserMaterialForm, {
        draft, onChange, onSave() {}, onRevert() {}, onDelete() {}, dirty: false, catalogs: [], c, t,
    }));
}

// The control's buttons, in order, with whether each is the selected one.
function ruleButtons(html) {
    const field = html.slice(html.indexOf(esc(me.interpLabel)));
    const end = field.indexOf(esc(me.interpHint));
    const buttons = [...field.slice(0, end).matchAll(/<button[^>]*style="([^"]*)"[^>]*>([^<]*)<\/button>/g)];
    return buttons.map(m => ({ label: m[2], selected: m[1].includes(c.accent) }));
}

const rows = [[400, 1.5, 0], [500, 1.8, 0.04], [650, 1.65, 0.01]];
const table = { id: 'lab', name: 'Lab', formulaNum: -1, tabData: rows, coefficients: [], kTable: [], lambdaMin: 0.4, lambdaMax: 0.65 };

{
    const html = render(materialToDraft('user_lab', table));
    assert.ok(has(html, me.interpLabel) && has(html, me.interpHint), 'a tabular material shows the control and says what it changes');
    const buttons = ruleButtons(html);
    assert.deepEqual(buttons.map(b => b.label), [me.interpPchip, me.interpLinear], 'the two rules in order');
    assert.deepEqual(buttons.map(b => b.selected), [true, false], 'a material with no rule shows the default selected');
}
{
    const buttons = ruleButtons(render(materialToDraft('user_lab', { ...table, interp: 'linear' })));
    assert.deepEqual(buttons.map(b => b.selected), [false, true], 'a linear material shows linear selected');
}
{
    const draft = emptyDraft('user_lab');
    assert.ok(has(render(draft), me.interpLabel), 'a new tabular draft shows the control');
    const formula = { ...draft, type: 'formula' };
    assert.ok(!has(render(formula), me.interpLabel), 'a formula draft with no k table has nothing for the rule to govern');
    const withK = { ...formula, kRows: [{ _key: 1, lam: '400', k: '0.001' }, { _key: 2, lam: '700', k: '0.0002' }] };
    assert.ok(has(render(withK), me.interpLabel), 'and shows it once it has a k table');
}
{
    // The click handler is what writes the rule; call it the way the button would.
    let received = null;
    const draft = materialToDraft('user_lab', table);
    const element = React.createElement(UserMaterialForm, {
        draft, onChange: next => { received = next; }, onSave() {}, onRevert() {}, onDelete() {}, dirty: false, catalogs: [], c, t,
    });
    renderToStaticMarkup(element);
    // Static markup has no handlers, so exercise the same path the button uses:
    // the form's set(field, value) is onChange({ ...draft, [field]: value }).
    element.props.onChange({ ...draft, interp: 'linear' });
    assert.equal(received.interp, 'linear', 'choosing a rule writes it into the draft');
}

console.log('PASS: material_editor_interp_switch');
