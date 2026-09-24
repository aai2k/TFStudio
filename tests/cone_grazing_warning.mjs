/**
 * The cone settings warn when a merit function row's angle of incidence plus
 * the half-angle passes 90°, and only for rows the cone averages.
 *
 * Run: node tests/cone_grazing_warning.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { ConeAngleControl } = await import('../src/components/windows/design/designEditor/ConeAngleControl.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');

const t = makeLocale('en');
const c = makeTheme();
const render = design => renderToStaticMarkup(React.createElement(ConeAngleControl, { design, updateDesign: () => {}, c, t }));
const cone = { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 };
const warning = t.designEditor.cone.pastGrazing(82.5);
const row = (type, aoi, extra = {}) => ({ ...makeOperand({ type, lambdaStart: 550, lambdaEnd: 650, aoi, pol: 'avg', target: 0, weight: 1 }), ...extra });

assert.ok(render({ cone, meritOperands: [row('TAV', 85)] }).includes(warning), 'a band row at 85° under a 7.5° cone warns');
assert.ok(!render({ cone, meritOperands: [row('TAV', 80)] }).includes(warning), 'a row at 80° under a 7.5° cone stays within 90°');
assert.ok(!render({ cone, meritOperands: [row('TAV', 85, { enabled: false })] }).includes(warning), 'a disabled row does not count');
assert.ok(!render({ cone: { ...cone, enabled: false }, meritOperands: [row('TAV', 85)] }).includes(warning), 'no cone, no warning');
assert.ok(!render({ cone, meritOperands: [row('PSI', 85)] }).includes(warning), 'an ellipsometry row is not cone-averaged');

console.log('PASS: cone_grazing_warning');
