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

const settingsIndex = markup.indexOf('Settings');
const resultsIndex = markup.indexOf('Results');
const exportIndex = markup.indexOf('Export');

// The window is one control row, the plot and the Results strip. The angles and
// the ranges are behind Settings, so they are not in the markup until it opens.
check(settingsIndex >= 0, 'the control row offers a Settings panel');
check(!markup.includes(oe.aoi), 'the angle control sits inside the Settings panel');
check(!markup.includes('Total thickness'), 'no status footer repeating the design summary');
// Auto-update is set from the windows that start runs. This one obeys the
// setting without offering it, so the row stays about what is plotted.
check(!markup.includes('role="switch"'), 'no auto-update switch in the analysis toolbar');
check(markup.includes('aria-pressed="true"'), 'curve groups expose their active state');
check(!markup.includes('#ffd54f'), 'target controls use theme colors instead of low-contrast yellow');
check(resultsIndex > settingsIndex, 'results section follows the plot controls');
check(markup.includes('aria-expanded="false"'), 'results table is collapsed by default');
check(exportIndex > resultsIndex, 'the export control renders in the Results strip');
// Which surface the spectrum describes has to stay readable without opening a
// panel, so the badges ride in the strip that is always on screen.
check(markup.includes('FRONT'), 'the evaluation-mode badge stays visible');
check(editorMarkup.includes(oe.editToolDraw) && editorMarkup.includes(oe.snap),
    'expanded target editor renders the redesigned grouped controls');

if (failures) {
    console.error(`optical_evaluation_layout: ${failures} failure(s)`);
    process.exit(1);
}
console.log('optical_evaluation_layout: ALL PASS');
