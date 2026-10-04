/**
 * A dialog with its own Cancel or Close button ignores presses on its backdrop.
 *
 * Selecting text in a field means pressing inside the dialog and often letting
 * go past its edge. The browser then fires the click on the nearest element both
 * ends share, which is the backdrop, so a backdrop that closed on click threw
 * away the name being typed. Such a dialog closes only through its own buttons.
 *
 * Pickers with no close button of their own, such as the destination-catalog
 * list, still close on a press outside and are not covered here.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { InputDialog }, { AboutDialog }, { WelcomeScreen }, { TutorialsBrowser },
    { ReplaceMaterialsDialog }, { TrialsModal }, { MeasuredFitDialog }, measuredModel,
] = await Promise.all([
    import('../src/components/dialogs/InputDialog.js'),
    import('../src/components/dialogs/AboutDialog.js'),
    import('../src/components/dialogs/WelcomeScreen.js'),
    import('../src/components/dialogs/TutorialsBrowser.js'),
    import('../src/components/dialogs/ReplaceMaterialsDialog.js'),
    import('../src/components/windows/analysis/errorAnalysis/TrialsModal.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/MeasuredFitDialog.js'),
    import('../src/components/windows/dataExchange/spectrumExchange/model.js'),
]);

const h = React.createElement;
const c = makeTheme();
const t = makeLocale();
const design = makeSampleDesign();
const noop = () => {};

const PRESS_HANDLERS = ['onClick', 'onMouseDown', 'onMouseUp', 'onPointerDown', 'onPointerUp'];

// The element tree a dialog returns, taken inside a render so its hooks run.
function treeOf(Component, props) {
    let tree = null;
    function Probe() { tree = Component(props); return null; }
    renderToStaticMarkup(h(Probe));
    return tree;
}

function* walk(node) {
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    if (!node || typeof node !== 'object' || !node.props) return;
    yield node;
    yield* walk(node.props.children);
}

const ownText = el => [].concat(el.props.children ?? []).filter(x => typeof x === 'string').join('');
const pressable = (tree, label) => [...walk(tree)].find(el => typeof el.props.onClick === 'function'
    && (ownText(el) === label || el.props.label === label || el.props.title === label));

const curve = {
    id: 'm1', name: 'Measured R', quantity: 'R', x: [450, 500, 550], y: [0.1, 0.08, 0.06],
    color: '#ef5350', visible: true, aoi: 8, pol: 'p', side: 'front', yWasPercent: false,
};
const fitConfig = measuredModel.defaultMeasuredFitOptions(curve);
const trialsResult = {
    lambda: [500, 600], mean: [0.4, 0.8], stdev: [0.1, 0.3], lower: [0, 0], upper: [1, 1],
    theory: [0.5, 0.7], envLower: [0.2, 0.3], envUpper: [0.6, 1], nTrials: 2, char: 'R',
    trials: [
        { dThkF: [1, -2], dThkB: null, spec: { allPass: false } },
        { dThkF: [3, 4], dThkB: null, spec: { allPass: true } },
    ],
};

// [what the user sees, component, props given the close callback, label of its own close control]
const DIALOGS = [
    ['Text prompt', InputDialog,
        close => ({ c, t, inputDialog: { title: 'Name for the new catalog:', defaultValue: 'My catalog', onConfirm: noop, onCancel: close } }),
        t.dialogs.input.cancel],
    ['Confirm box', InputDialog,
        close => ({ c, t, inputDialog: { confirm: true, title: 'Delete Design', message: 'Delete "AR"?', onConfirm: noop, onCancel: close } }),
        t.dialogs.input.cancel],
    ['About', AboutDialog, close => ({ c, t, onClose: close }), t.dialogs.about.close],
    ['Welcome', WelcomeScreen, close => ({ c, t, onClose: close }), t.welcome.close],
    ['Tutorials', TutorialsBrowser, close => ({ c, t, onClose: close, onStart: noop }), t.tutorials.close],
    ['Replace materials', ReplaceMaterialsDialog,
        close => ({ c, t, design, updateDesign: noop, onClose: close }),
        t.designEditor.replaceMaterials.cancel],
    ['Trial inspector', TrialsModal,
        close => ({ c, t, result: trialsResult, design, corridorSigma: 2, updateDesign: noop, checkpoint: noop, onClose: close }),
        t.errorAnalysis.close || 'Close'],
    ['Fit to measured curve', MeasuredFitDialog,
        close => ({ c, sx: t.spectrumExchange, controller: {
            fitDialogCurve: curve, fitConfig,
            fitSnapshot: measuredModel.measuredFitSnapshot({ ...design, measuredCurves: [curve] }, curve, fitConfig),
            setFitOption: noop, onCreateFitOperand: noop, closeFitDialog: close, missingMaterialIds: [],
        } }),
        t.spectrumExchange.fitCancel],
];

for (const [name, Component, propsFor, closeLabel] of DIALOGS) {
    let closed = 0;
    const tree = treeOf(Component, propsFor(() => { closed++; }));
    const backdrop = tree.props;
    assert.equal(backdrop.style?.position, 'fixed', `${name}: the outer element is the backdrop`);
    for (const handler of PRESS_HANDLERS) {
        assert.equal(backdrop[handler], undefined,
            `${name}: a press on the backdrop does nothing (found ${handler})`);
    }
    const control = pressable(tree, closeLabel);
    assert.ok(control, `${name}: has its own "${closeLabel}" control`);
    control.props.onClick();
    assert.equal(closed, 1, `${name}: "${closeLabel}" closes it`);
}

console.log(`dialog_backdrop_press: ${DIALOGS.length} dialogs close only through their own buttons`);
