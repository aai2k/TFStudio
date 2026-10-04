/**
 * Refinement control-bar geometry.
 *
 * The live readout (MF, best, iteration, end-of-run reason) and the Live update
 * switch form one unit anchored to the right of the bar, so the numbers sit
 * beside the switch and the group moves to the next toolbar line together when
 * the bar is narrow. Left as separate items with a spacer between them, they
 * wrapped one at a time and changed places on every resize.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { ControlBar } = await import('../src/components/windows/optimization/refinement/ControlBar.js');

const noop = () => {};
const t = makeLocale();
const props = {
    running: false, iter: 12, mf: 0.0123, mfBest: 0.011, mfInitial: 0.2, canReset: true,
    method: 'sqp', nRestarts: 20, perturbPct: 30, restartIdx: 0, maxIter: 200, stopReason: 'stalled',
    surfaceMode: 'front_only', mfEvalMode: 'side',
    onRun: noop, onStop: noop, onReset: noop, onBest: noop,
    onMethod: noop, onNRestarts: noop, onPerturbPct: noop, onMaxIter: noop,
    t, c: makeTheme(),
};

const bar = ControlBar(props);
const children = bar.props.children.flat().filter(Boolean);
const readout = children[children.length - 1];
assert.ok(readout?.props?.['data-refinement-readout'], 'the readout is the last item on the bar');
assert.equal(readout.props.style.marginLeft, 'auto', 'and is anchored to the right of its line');
assert.equal(readout.props.style.flexWrap, 'nowrap', 'its pieces never wrap apart');
assert.ok(!children.some(child => child.props?.style?.flex === 1), 'no spacer competes with the anchor');

const html = renderToStaticMarkup(withDesign(React.createElement(ControlBar, props)));
const unit = html.slice(html.indexOf('data-refinement-readout'));
const mfAt = unit.indexOf(t.refinement.mfLabel);
const iterAt = unit.indexOf(t.refinement.iterLabel);
const switchAt = unit.indexOf(t.liveUpdate.label);
assert.ok(mfAt > 0 && iterAt > mfAt && switchAt > iterAt,
    'MF, then the iteration count, then the switch, all inside the one unit');

// The end-of-run pill ("no further improvement") is written in the theme's own
// text colour, so it reads on a light theme as on a dark one; a fixed pale tan
// vanished on light themes.
for (const theme of [{ text: '#1f2329', textDim: '#6b7280' }, { text: '#e6e7e9', textDim: '#9aa0a6' }]) {
    const c = { ...makeTheme(), ...theme };
    const pill = renderToStaticMarkup(withDesign(React.createElement(ControlBar, { ...props, c })));
    const at = pill.indexOf(`>${t.refinement.stalled}<`);
    assert.ok(at > 0, 'the stalled pill is drawn');
    const style = pill.slice(pill.lastIndexOf('<span', at), at);
    assert.match(style, new RegExp(`color:${theme.text}`, 'i'), `the pill text is the theme text ${theme.text}`);
}

console.log('refinement_control_bar_layout: passed');
