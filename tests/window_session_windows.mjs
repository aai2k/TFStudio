/**
 * Representative window stores.
 *
 * window_session.mjs covers the shared rule and gd_gdd_session.mjs covers the
 * reseeding window. These are the other shapes a window can take: one that keeps
 * a slot per design including an expensive run result, one whose controls do not
 * depend on the design at all, and one that reseeds a side from the new design.
 *
 * Run: node tests/window_session_windows.mjs
 */

import assert from 'node:assert/strict';
import { errorAnalysisSession } from '../src/components/windows/analysis/errorAnalysis/sessionState.js';
import { materialDispersionSession } from '../src/components/windows/analysis/materialDispersion/sessionState.js';
import { eFieldSession } from '../src/components/windows/analysis/eFieldEvaluation/sessionState.js';
import { layerSensitivitySession } from '../src/components/windows/analysis/layerSensitivity/sessionState.js';

const coated = {
    id: 'coated',
    referenceWavelength: 625,
    frontLayers: [{ material: 'SiO2', thickness: 100 }],
    backLayers: [],
};
const backCoated = {
    id: 'back-coated',
    referenceWavelength: 780,
    frontLayers: [],
    backLayers: [{ material: 'TiO2', thickness: 120 }],
};

// ── Monte-Carlo: a run result is kept per design ─────────────────────────────
{
    errorAnalysisSession.reset();

    errorAnalysisSession.write(coated, { nTrials: 500, result: { yield: 0.91 } });
    errorAnalysisSession.write(backCoated, { nTrials: 50, result: { yield: 0.42 } });

    // Docking the window away and back re-reads the store from scratch.
    assert.equal(errorAnalysisSession.read(coated).nTrials, 500,
        'trial count survives a remount');
    assert.deepEqual(errorAnalysisSession.read(coated).result, { yield: 0.91 },
        'a run that took minutes is not thrown away by a layout change');
    assert.deepEqual(errorAnalysisSession.read(backCoated).result, { yield: 0.42 },
        'each design keeps its own run');

    errorAnalysisSession.reset();
    assert.equal(errorAnalysisSession.read(coated).result, null, 'reset clears the runs');
}

// ── Material Dispersion: one slot for every design ───────────────────────────
{
    materialDispersionSession.reset();

    materialDispersionSession.write(coated, { materialId: 'builtin:TiO2', quantity: 'tod' });
    const other = materialDispersionSession.read(backCoated);
    assert.equal(other.materialId, 'builtin:TiO2',
        'a material selection is about the material, so it follows the user across designs');
    assert.equal(other.quantity, 'tod');

    materialDispersionSession.reset();
}

// ── Electric Field: the side follows the newly selected design ───────────────
{
    eFieldSession.reset();

    const first = eFieldSession.read(coated);
    assert.equal(first.side, 'front', 'a front-coated design opens on the front');
    assert.equal(first.lambda, 625, 'the design reference wavelength is adopted');

    eFieldSession.write(coated, { theta: 45, pol: 'p' });

    const second = eFieldSession.read(backCoated);
    assert.equal(second.side, 'back', 'a back-coated design opens on the back');
    assert.equal(second.lambda, 780);
    assert.equal(second.theta, 45, 'the angle is a display preference and carries over');
    assert.equal(second.pol, 'p');

    eFieldSession.reset();
}

// ── Layer Sensitivity: nothing depends on the design ─────────────────────────
{
    layerSensitivitySession.reset();

    layerSensitivitySession.write(coated, { mode: 'absolute', absDeltaNm: 2.5, view: 'table' });
    const afterSwitch = layerSensitivitySession.read(backCoated);
    assert.equal(afterSwitch.mode, 'absolute', 'the perturbation mode is kept');
    assert.equal(afterSwitch.absDeltaNm, 2.5);
    assert.equal(afterSwitch.view, 'table', 'the chart/table choice is kept');

    layerSensitivitySession.reset();
}

console.log('window_session_windows: passed');
