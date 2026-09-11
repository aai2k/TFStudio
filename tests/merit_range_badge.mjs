/**
 * The material-range badge on the optimizer control bars (MeritRangeBadge),
 * rendered server-side: present with the offender count when the merit
 * function reaches past a material's data, absent otherwise.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { MeritRangeBadge } = await import(
    '../src/components/windows/optimization/synthesisShared/MeritRangeBadge.js');
const { SynthesisControlBar } = await import(
    '../src/components/windows/optimization/synthesisShared/synthesisShell.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');

const c = makeTheme();
const t = makeLocale();
const band = (lambdaStart, lambdaEnd) => makeOperand({ type: 'RAV', lambdaStart, lambdaEnd, target: 0.01 });
const design = (meritOperands) => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { material: 'builtin:TiO2', thickness: 100 },
        { material: 'builtin:SiO2', thickness: 90 },
    ],
    backLayers: [],
    surfaceMode: 'front_only',
    meritOperands,
});
const render = (element) => renderToStaticMarkup(element);

const reaching = render(React.createElement(MeritRangeBadge, {
    design: design([band(400, 700), band(900, 1700), band(3500, 4950)]), c, t,
}));
// The badge counts conditions, as on the analysis windows; the materials the
// targets reach past are listed inside the one notice.
assert.match(reaching, /⚠<\/span>1</, 'targets past a material\'s data raise one notice');
assert.ok(reaching.includes(`title="${t.analysisChrome.notices}"`), 'it is the analysis windows\' notice badge');

const covered = render(React.createElement(MeritRangeBadge, { design: design([band(400, 700)]), c, t }));
assert.equal(covered, '', 'targets inside every material render no badge');

const empty = render(React.createElement(MeritRangeBadge, { design: design([]), c, t }));
assert.equal(empty, '', 'an empty merit function renders no badge');

// The shared control bar carries the badge next to the Optimize / Eval pills,
// so Needle, Gradual Evolution and Structural all get it.
const noop = () => {};
const reachingDesign = design([band(400, 700), band(3500, 4950)]);
const bar = render(withDesign(React.createElement(SynthesisControlBar, {
    running: false, canReset: false, onRun: noop, onStop: noop, onReset: noop, onBest: noop,
    design: reachingDesign,
    labels: { run: 'Run', stop: 'Stop', reset: 'Reset', best: 'Best' },
    metrics: [], statusMsg: '', noOperandsLabel: 'No operands', c, t,
}), reachingDesign));
assert.match(bar, /⚠<\/span>1</, 'the synthesis control bar shows the badge');

console.log('merit_range_badge: passed');
