/**
 * What Measured Spectra and Measured Ellipsometry say after an action: "Added
 * 1 curve" and every other report shows in the window's control row, never
 * inside the notice badge, a success clears itself, and a warning or an error
 * stays until the next report.
 *
 * The windows run here as their hooks run in the app, through the hook harness,
 * so a curve can be applied from the curve editor and the window drawn again
 * afterwards; a server render keeps no state between two renders.
 * Run: node tests/measured_window_reports.mjs
 */
import assert from 'node:assert/strict';
import RealReact from 'react';
import { makeHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

// Every window module reads its hooks off the global React as it loads, so the
// global delegates to whichever harness is drawing, one per window.
let drawing = null;
const delegate = name => (...args) => drawing.React[name](...args);
const contextValues = new Map();
globalThis.React = {
    ...RealReact,
    useState: delegate('useState'), useRef: delegate('useRef'), useMemo: delegate('useMemo'),
    useCallback: delegate('useCallback'), useEffect: delegate('useEffect'), useLayoutEffect: delegate('useLayoutEffect'),
    useContext: context => (contextValues.has(context) ? contextValues.get(context) : context._currentValue),
};

// Timers with a delay are held here and run by hand.
const timers = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
    if (!(ms > 0)) return realSetTimeout(fn, ms, ...args);
    timers.push({ fn, ms, live: true });
    return timers.length;
};
globalThis.clearTimeout = handle => {
    if (typeof handle === 'number' && timers[handle - 1]) timers[handle - 1].live = false;
    else realClearTimeout(handle);
};
const liveTimers = () => timers.filter(timer => timer.live);
const runTimers = () => liveTimers().forEach(timer => { timer.live = false; timer.fn(); });

const { DesignContext } = await loadApp();
contextValues.set(DesignContext, makeDesignCtx(makeSampleDesign()));
const { SpectrumExchange } = await import('../src/components/windows/dataExchange/spectrumExchange/SpectrumExchange.js');
const { MeasuredEllipsometry } = await import(
    '../src/components/windows/dataExchange/measuredEllipsometry/MeasuredEllipsometry.js');

const c = makeTheme();
const t = makeLocale();
const ce = t.curveEditor;

// Every element of a window's tree, the components named in `open` drawn by
// calling them; a control row's trailing slot is walked as its children are.
const elements = (node, open, found = []) => {
    if (Array.isArray(node)) node.forEach(child => elements(child, open, found));
    else if (node && typeof node === 'object' && node.props) {
        found.push(node);
        if (open.includes(node.type?.name)) elements(node.type(node.props), open, found);
        else elements([node.props.children, node.props.trailing], open, found);
    }
    return found;
};

/** Draw a window once and read what it shows. */
function drawWindow(runtime, Window) {
    drawing = runtime;
    const tree = runtime.render(() => Window({ c, t }));
    const found = elements(tree, ['ReportAndNotices', 'ActionStatus']);
    const report = found.find(node => node.props.role === 'status') || null;
    const badged = found.filter(node => node.type?.name === 'NoticeBadge')
        .flatMap(node => node.props.notices.map(notice => notice.label));
    const controller = found.find(node => node.type?.name === 'ImportTab').props.controller;
    return { controller, report: report && { text: report.props.children, title: report.props.title }, badged };
}

/** Type `rows` into a new curve and press Apply, as the curve editor does. */
function applyNewCurve(runtime, Window, rows) {
    drawWindow(runtime, Window).controller.curveEditor.openNew();
    const { editorProps } = drawWindow(runtime, Window).controller.curveEditor;
    editorProps.onApply({ ...editorProps.table, rows }, { rebuild: false });
    return drawWindow(runtime, Window);
}

// ── Measured Spectra ─────────────────────────────────────────────────────────
{
    const runtime = makeHookRuntime();
    const draw = () => drawWindow(runtime, SpectrumExchange);
    assert.equal(draw().report, null, 'nothing to report before anything is done');

    const added = applyNewCurve(runtime, SpectrumExchange, [[1530, 50], [1540, 60]]);
    assert.equal(added.report?.text, ce.added(1), '"Added 1 curve." shows in the window');
    assert.equal(added.report.title, ce.added(1), 'with its whole text as the tooltip');
    assert.ok(!added.badged.includes(ce.added(1)), 'and not behind the notice badge');

    assert.equal(liveTimers().length, 1, 'a success clears itself');
    runTimers();
    assert.equal(draw().report, null);

    // Create MF target with no curve to fit is refused, and says so until the
    // next action reports.
    draw().controller.onCreateFitOperand();
    const refused = draw();
    assert.equal(refused.report?.text, t.spectrumExchange.fitErrors.empty);
    assert.ok(!refused.badged.includes(t.spectrumExchange.fitErrors.empty));
    assert.equal(liveTimers().length, 0, 'an error stays');
    assert.equal(applyNewCurve(runtime, SpectrumExchange, [[400, 10]]).report?.text, ce.added(1),
        'until the next report replaces it');
    runTimers();

    // A file read with rows dropped says so, and that stays.
    const api = window.electronAPI;
    window.electronAPI = {
        spectrumPickFile: async () => ({ success: true, fileName: 'scan.csv', text: 'nm,T\n500,50\n550,x\n600,60\n' }),
    };
    await draw().controller.onImport();
    window.electronAPI = api;
    const sx = t.spectrumExchange;
    assert.equal(draw().report?.text, `${sx.loaded('scan.csv', 2, 1)}. ${sx.skippedRows(1)}`);
    assert.equal(liveTimers().length, 0, 'a read that dropped rows stays until the next report');
}

// ── Measured Ellipsometry ────────────────────────────────────────────────────
{
    const runtime = makeHookRuntime();
    const draw = () => drawWindow(runtime, MeasuredEllipsometry);
    const added = applyNewCurve(runtime, MeasuredEllipsometry, [[500, 30, 100], [600, 31, 101]]);
    assert.equal(added.report?.text, ce.added(2), 'a Ψ and Δ pair reports two curves in the window');
    assert.ok(!added.badged.includes(ce.added(2)));
    runTimers();
    assert.equal(draw().report, null);

    // A file that states no angle is read with a warning, which stays.
    const api = window.electronAPI;
    window.electronAPI = {
        spectrumPickFile: async () => ({ success: true, fileName: 'scan.csv', text: 'nm,Psi,Delta\n500,30,100\n600,31,101\n' }),
    };
    await draw().controller.onImport();
    window.electronAPI = api;
    const read = draw();
    const mx = t.measuredEllipsometry;
    assert.equal(read.report?.text, mx.loadedNoAoi('scan.csv', 2));
    assert.ok(!read.badged.includes(mx.loadedNoAoi('scan.csv', 2)));
    assert.equal(liveTimers().length, 0, 'a warning stays until the next report');
}

globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;
console.log('PASS: measured_window_reports');
