/**
 * The E-field settings panel writes what its controls report.
 *
 * `Checkbox` hands its handler the native event, so a checkbox wired straight
 * to a setter stores the event object instead of a boolean. That object is
 * truthy, so the box appears stuck on and nothing says why. This drives the
 * panel's own elements to catch the mistake wherever it is made.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { EFieldControls } =
    await import('../src/components/windows/analysis/eFieldEvaluation/EFieldControls.js');
const { useEFieldState } =
    await import('../src/components/windows/analysis/eFieldEvaluation/useEFieldState.js');
const { CheckField, NumInput, SelectField } =
    await import('../src/components/windows/analysis/chrome/controls.js');
const { SettingRow } = await import('../src/components/windows/analysis/chrome/popover.js');
const { getLocale } = await import('../src/constants/locales/index.js');

// The controls this test reads. The walk stops at them: their props are the
// wiring under test, and rendering one would need a React renderer.
const CONTROLS = new Set([CheckField, NumInput, SelectField]);

function isElement(value) {
    return !!value && typeof value === 'object' && 'type' in value && 'props' in value;
}

/**
 * Every element of `type` in a tree, looking through element-valued props as
 * well as children, since the settings panel hangs off a `trailing` prop.
 *
 * A component that builds its own children is invoked to reach them. One that
 * was handed children already carries them on its props and is left alone, so
 * no hook runs outside a renderer.
 */
function findAll(node, type, out = []) {
    if (Array.isArray(node)) {
        for (const item of node) findAll(item, type, out);
        return out;
    }
    if (!isElement(node)) return out;
    if (node.type === type) { out.push(node); return out; }
    if (CONTROLS.has(node.type)) return out;
    if (typeof node.type === 'function' && node.props.children == null) {
        return findAll(node.type(node.props), type, out);
    }
    for (const value of Object.values(node.props)) findAll(value, type, out);
    return out;
}

const t = getLocale('en');
const ef = t.eField;

// A stand-in for the window's state: the setters record instead of storing, so
// the test sees exactly what each control passes on.
function makeState(overrides = {}) {
    const written = {};
    const set = key => value => { written[key] = value; };
    return {
        written,
        lambda: 550, theta: 0, pol: 'avg', side: 'front', showTable: false,
        axisRefFromDesign: true, axisRefLambda: 550,
        display: { quantity: 'amplitude', component: 'total', xUnit: 'nm' },
        setLambda: set('lambda'), setTheta: set('theta'), setPol: set('pol'),
        setSide: set('side'), setShowTable: set('showTable'),
        setQuantity: set('quantity'), setComponent: set('component'),
        setXUnit: set('xUnit'),
        setAxisRefFromDesign: set('axisRefFromDesign'),
        setAxisRefLambda: set('axisRefLambda'),
        ...overrides,
    };
}

const props = { c: makeTheme(), t, ef, state: makeState(), notices: [] };
const tree = EFieldControls(props);

// Unticking From design must write false, not the event that carried it.
const boxes = findAll(tree, CheckField);
assert.equal(boxes.length, 1, 'the settings panel has one checkbox, From design');
boxes[0].props.onChange({ target: { checked: false } });
assert.equal(props.state.written.axisRefFromDesign, false,
    'unticking From design stores false; storing the event leaves the box stuck on');
boxes[0].props.onChange({ target: { checked: true } });
assert.equal(props.state.written.axisRefFromDesign, true);

// The λ₀ row, which is where the wavelength field belongs; the Wavelength row
// above it holds one too and they are seeded from the same design.
function axisRefField(tree) {
    const row = findAll(tree, SettingRow).find(element => element.props.label === ef.axisRef);
    assert.ok(row, 'the settings panel has a λ₀ row');
    return findAll(row.props.children, NumInput)[0];
}

// λ₀ is the design's while the box is ticked, and typed when it is not.
assert.equal(boxes[0].props.checked, true);
const fwot = { quantity: 'amplitude', component: 'total', xUnit: 'FWOT' };
const ticked = EFieldControls({ ...props, state: makeState({ display: fwot }) });
assert.equal(axisRefField(ticked).props.disabled, true,
    'the λ₀ field is disabled while From design is ticked');

const freedState = makeState({ display: fwot, axisRefFromDesign: false, axisRefLambda: 1064 });
const freed = EFieldControls({ ...props, state: freedState });
const lambdaField = axisRefField(freed);
assert.equal(lambdaField.props.value, 1064, 'the λ₀ field shows the typed value');
assert.equal(lambdaField.props.disabled, false, 'clearing From design frees the λ₀ field');
lambdaField.props.onChange(900);
assert.equal(freedState.written.axisRefLambda, 900, 'a typed λ₀ reaches the window');

// A physical depth axis is measured at no wavelength, so λ₀ changes nothing
// there and the whole row is inert rather than quietly doing nothing.
const physical = EFieldControls({
    ...props, state: makeState({ axisRefFromDesign: false, axisRefLambda: 1064 }),
});
assert.equal(findAll(physical, CheckField)[0].props.disabled, true,
    'From design is inert on a physical depth axis');
assert.equal(axisRefField(physical).props.disabled, true,
    'the λ₀ field is inert on a physical depth axis');

// The depth-unit dropdown offers all four units and reports the id.
const selects = findAll(tree, SelectField);
const depthUnits = selects.find(select => select.props.options.some(o => o.id === 'FWOT'));
assert.ok(depthUnits, 'the panel offers the depth units');
assert.deepEqual(depthUnits.props.options.map(o => o.id), ['nm', 'OT', 'QWOT', 'FWOT']);
assert.deepEqual(depthUnits.props.options.map(o => o.label),
    ['nm', 'OT', 'QWOT', 'FWOT'].map(id => ef.xUnits[id]));
depthUnits.props.onChange('FWOT');
assert.equal(props.state.written.xUnit, 'FWOT');

// ── The λ₀ the box shows is the λ₀ in force ──────────────────────────────────
//
// Editing the reference wavelength in the Design Editor changes no design id,
// so the window's stored copy is not reseeded. While From design is ticked the
// box and the axis must both follow the design anyway, or the disabled box
// reads one wavelength and the axis title next to it another.
function axisLambdaFor(design) {
    let seen = null;
    const Probe = () => { seen = useEFieldState(design).axisRefLambda; return null; };
    renderToStaticMarkup(React.createElement(Probe));
    return seen;
}

const sample = makeSampleDesign();
assert.equal(axisLambdaFor(sample), 550);
assert.equal(axisLambdaFor({ ...sample, referenceWavelength: 1064 }), 1064,
    'the λ₀ box follows a reference wavelength edited on the open design');

console.log('PASS: e_field_controls_wiring');
