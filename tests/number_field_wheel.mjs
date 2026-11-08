/**
 * Number fields step with the mouse wheel as the Design Editor's thickness
 * cells do: a notch is one step, Shift ten steps, Ctrl a tenth of one, within
 * the field's bounds, and a count never by less than one. The wavelength
 * ranges in the windows' settings take the wheel: every RangeField, the step
 * beside a range, the Optical Evaluation range and the Preferences defaults.
 *
 * Run: node tests/number_field_wheel.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { wheelStepValue } = await import('../src/components/ui/numberField.js');
const { stepScale } = await import('../src/components/ui/wheelStep.js');

// ── The step a notch takes ────────────────────────────────────────────────────
const plain = {};
const shift = { shiftKey: true };
const ctrl = { ctrlKey: true };
assert.equal(stepScale(plain), 1);
assert.equal(stepScale(shift), 10);
assert.equal(stepScale(ctrl), 0.1);

const field = { step: 10, positive: true };
assert.equal(wheelStepValue(400, 1, plain, field), 410, 'a notch away from the user is one step up');
assert.equal(wheelStepValue(400, -1, plain, field), 390, 'towards the user, one step down');
assert.equal(wheelStepValue(400, 3, plain, field), 430, 'three notches in one event are three steps');
assert.equal(wheelStepValue(400, 1, shift, field), 500, 'Shift steps ten times as far');
assert.equal(wheelStepValue(400, 1, ctrl, field), 401, 'Ctrl a tenth as far');
assert.equal(wheelStepValue(0.3, 1, ctrl, { step: 1 }), 0.4, 'a decimal step lands on the decimal, not on binary residue');

// ── Bounds ────────────────────────────────────────────────────────────────────
assert.equal(wheelStepValue(5, -1, plain, field), null, 'a positive field refuses a step to zero or below');
assert.equal(wheelStepValue(85, 1, plain, { step: 10, min: 0, max: 89 }), 89, 'a bounded field stops at its bound');

// ── A count never steps by a fraction ─────────────────────────────────────────
assert.equal(wheelStepValue(12, 1, ctrl, { step: 1, integer: true }), 13, 'Ctrl on a count still steps by one');
assert.equal(wheelStepValue(12, 1, shift, { step: 1, integer: true }), 22);

// ── Where the wheel is on ─────────────────────────────────────────────────────
// The fields are read from their source: a field the wheel should reach and
// does not is a wavelength range that will not step.
const SRC = new URL('../src/components/', import.meta.url);
const source = path => fs.readFileSync(new URL(path, SRC), 'utf8');
const rangeField = /export function RangeField[\s\S]*?\r?\n}\r?\n/.exec(source('windows/analysis/chrome/controls.js'))[0];
assert.equal((rangeField.match(/h\(NumInput, \{ wheel: true, /g) || []).length, 2, 'both ends of every RangeField take the wheel');

const STEP_FIELDS = [
    'windows/analysis/ellipsometryEvaluation/EllipsometryControls.js',
    'windows/analysis/integralValues/Controls.js',
    'windows/analysis/wavelengthAngleMap/MapControls.js',
    'windows/analysis/roughnessScattering/RoughnessControls.js',
    'windows/analysis/inhomogeneities/InhomogeneityControls.js',
    'windows/analysis/errorAnalysis/ErrorControls.js',
    'windows/analysis/systematicDeviations/SystematicControls.js',
    'windows/analysis/plotEngine/CurveRow.js',
    'windows/dataExchange/processSimulator/ProcessControls.js',
    'windows/dataExchange/spectrumExchange/MeasuredFitDialog.js',
    'windows/dataExchange/spectrumExchange/ExportTab.js',
    'windows/dataExchange/measuredEllipsometry/ExportTab.js',
    'windows/dataExchange/zemaxCoatings/ExportTab.js',
    'windows/dataExchange/codevCoatings/ExportTab.js',
    'windows/information/report/BlockSettings.js',
];
for (const file of STEP_FIELDS) {
    assert.ok(/wheel: true/.test(source(file)), `${file}: the step beside its range takes the wheel`);
}
const setup = /export function SpectralRange[\s\S]*?\r?\n}\r?\n/.exec(source('windows/analysis/opticalEvaluation/SetupPanel.js'))[0];
assert.equal((setup.match(/wheel: true/g) || []).length, 3, 'the Optical Evaluation range and its step take the wheel');
assert.ok(/wheel: true/.test(source('dialogs/settings/analysis/SpectralRangeRows.js')), 'and so do the Preferences defaults');

console.log('PASS: number_field_wheel');
