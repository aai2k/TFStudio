/**
 * The Monte-Carlo specification verdict must judge the SAME spectrum the trial
 * produced.
 *
 * The trial spectrum applies each layer's sampled Δn/Δk, but the qualifier pass
 * check rebuilt the design from perturbed thicknesses alone and resolved
 * nominal materials — so with index uncertainty enabled, reported yield and
 * per-qualifier fail rates described a design that was never evaluated.
 *
 * Run: node tests/mc_spec_index_errors.mjs
 */

import { runErrorAnalysisMC } from '../src/utils/physics/errorAnalysis.js';
import { evaluateQualifiers } from '../src/utils/synthesis/qualifiers.js';

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const materials = {
    Air: { getNK: () => [1, 0] },
    Sub: { getNK: () => [1.52, 0] },
    H:   { getNK: () => [2.35, 0] },
    L:   { getNK: () => [1.46, 0] },
};
const resolveMat = (id) => materials[id];

const design = {
    referenceWavelength: 550,
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'Sub', thickness: 1 },
    surfaceMode: 'front_only',
    frontLayers: [
        { id: 'F0', material: 'H', thickness: 58 },
        { id: 'F1', material: 'L', thickness: 94 },
        { id: 'F2', material: 'H', thickness: 58 },
    ],
    backLayers: [],
};
const params = { lambdaStart: 550, lambdaEnd: 550, lambdaStep: 10, theta: 0, polarization: 'avg' };

// Target sits between the nominal and the perturbed transmittance, so the
// verdict flips depending on which spectrum is judged. Qualifier targets for
// T/R/A are fractions; only the display string is a percentage.
const TARGET = 0.36;
const qualifiers = [{
    enabled: true, kind: 'T_AT', lambda: 550, aoi: 0, pol: 'avg',
    cmp: 'ge', target: TARGET, label: 'T@550',
}];

// One deterministic trial: a constant rng makes every layer take the same large
// Δn and leaves thicknesses untouched (rmsAbsNm = rmsRelPct = 0).
const run = await runErrorAnalysisMC(design, params, resolveMat, {
    char: 'T', evalMode: 'front', nTrials: 1,
    rmsAbsNm: 0, rmsRelPct: 0,
    rmsReN: 0.30, rmsImN: 0,
    distribution: 'uniform',
    evaluateSpec: true, qualifiers, recordTrials: true,
    rng: () => 0.99,
});

const trialT = run.mean[0];
const nominalT = evaluateQualifiers(qualifiers, design, resolveMat)[0].value;

ok(run.trials[0].dnF.every(dn => dn > 0.2), 'the trial drew a large index deviation');
ok(!near(trialT, nominalT, 0.01), 'the deviation moves T enough for the test to discriminate');
ok(nominalT < TARGET && trialT > TARGET, 'the target separates the nominal and perturbed spectra');

const verdict = run.trials[0].spec.results[0];
ok(near(parseFloat(verdict.value) / 100, trialT, 1e-4),
   `verdict reports the trial spectrum (got ${verdict.value}, trial ${(trialT * 100).toFixed(3)} %)`);
ok(verdict.pass === true, 'the trial passes on its own spectrum');
ok(run.spec.passCount === 1 && run.spec.yield === 1,
   'yield counts the trial as passing');
ok(run.spec.perQualifier[0].failRate === 0, 'the qualifier records no failure');

// Without index uncertainty the two spectra coincide and nothing changes.
const noIndexError = await runErrorAnalysisMC(design, params, resolveMat, {
    char: 'T', evalMode: 'front', nTrials: 1,
    rmsAbsNm: 0, rmsRelPct: 0, rmsReN: 0, rmsImN: 0,
    distribution: 'uniform',
    evaluateSpec: true, qualifiers, recordTrials: true,
    rng: () => 0.99,
});
ok(near(parseFloat(noIndexError.trials[0].spec.results[0].value) / 100, nominalT, 1e-4),
   'with no index error the verdict still matches the nominal spectrum');

console.log(`mc_spec_index_errors: ${passed} passed`);
