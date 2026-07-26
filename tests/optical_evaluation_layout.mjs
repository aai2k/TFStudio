import { renderToStaticMarkup } from 'react-dom/server';
import {
    shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { OpticalEvaluation } = await import(
    '../src/components/windows/analysis/opticalEvaluation/OpticalEvaluation.js');
const { TargetToolbar } = await import(
    '../src/components/windows/analysis/opticalEvaluation/TargetToolbar.js');
const markup = renderToStaticMarkup(withDesign(
    React.createElement(OpticalEvaluation, { c: makeTheme(), theme: makeTheme(), t: makeLocale() })));
const c = makeTheme();
const oe = makeLocale().opticalEval;
const noop = () => {};
const editorMarkup = renderToStaticMarkup(React.createElement(TargetToolbar, {
    c, oe, editMode: true, editTool: 'draw', setEditTool: noop,
    editKind: 'average', setEditKind: noop, editCurve: 'R', setEditCurve: noop,
    editPol: 'avg', setEditPol: noop, snapOn: true, setSnapOn: noop,
    snapNm: 10, setSnapNm: noop, snapPct: 5, setSnapPct: noop,
}));

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error('FAIL:', message);
    }
}

const toolbarIndex = markup.indexOf('Auto-update');
const resultsIndex = markup.indexOf('Results');
const exportIndex = markup.indexOf('Export');

check(toolbarIndex >= 0, 'evaluation toolbar renders the auto-update control');
check(markup.includes('role="switch"') && markup.includes('aria-checked="true"'),
    'auto-update uses a clear switch control');
check(markup.includes('aria-pressed="true"'), 'curve groups expose their active state');
check(!markup.includes('#ffd54f'), 'target controls use theme colors instead of low-contrast yellow');
check(resultsIndex > toolbarIndex, 'results section follows the plot controls');
check(markup.includes('aria-expanded="false"'), 'results table is collapsed by default');
check(exportIndex > resultsIndex, 'consolidated export control renders in the footer');
check(editorMarkup.includes(oe.editToolDraw) && editorMarkup.includes(oe.snap),
    'expanded target editor renders the redesigned grouped controls');

if (failures) {
    console.error(`optical_evaluation_layout: ${failures} failure(s)`);
    process.exit(1);
}
console.log('optical_evaluation_layout: ALL PASS');
