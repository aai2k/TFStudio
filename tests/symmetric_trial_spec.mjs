/**
 * On a symmetric design a Specification check scores the stack it is shown
 * beside.
 *
 * A Monte Carlo trial draws the back's errors apart from the front's, and the
 * Inhomogeneities window can put interlayers on one face. Both plot the two
 * faces as built, but their checks went through an evaluation that rebuilds a
 * symmetric design's back as the mirror of its front, so the yield and the
 * badge judged a stack nobody plotted.
 *
 * Checks:
 *   1. A Monte Carlo trial's T_AT check equals the trial's own T at that
 *      wavelength, on symmetric, two-sided and one-sided designs.
 *   2. The Inhomogeneities badge on a symmetric design with interlayers on the
 *      back equals the window's perturbed T.
 *
 * Run: node tests/symmetric_trial_spec.mjs
 */

const api = await import('../src/api/index.js');
const { makeQualifier, evaluateQualifiers } = await import('../src/utils/synthesis/qualifiers.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { runErrorAnalysisMC } = await import('../src/utils/physics/errorAnalysis.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const inhomogeneities = await import('../src/components/windows/analysis/inhomogeneities/model.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const same = (a, b) => Math.abs(a - b) <= 1e-12;

await api.init();
const symbols = { H: 'TiO2', L: 'SiO2' };
const check = makeQualifier({ kind: 'T_AT', lambda: 600, cmp: 'ge', target: 0.5 });
const designIn = surfaceMode => {
    let d = api.stackFromFormula(api.newDesign({ surfaceMode }), { formula: '(HL)^4 H', symbols, referenceWavelength: 550 });
    if (surfaceMode === 'both_independent') d = api.stackFromFormula(d, { side: 'back', formula: 'H (LH)^4', symbols, referenceWavelength: 550 });
    return { ...d, qualifiers: [check] };
};

// ── 1. Monte Carlo trials ──────────────────────────────────────────────────
for (const mode of ['symmetric', 'both_independent', 'front_only']) {
    const design = designIn(mode);
    const run = await runErrorAnalysisMC(design, { lambdaStart: 600, lambdaEnd: 600.5, lambdaStep: 0.5, theta: 0, polarization: 'avg' },
        designMaterialLookup(design), {
            char: 'T', evalMode: resolveEvalMode(design), nTrials: 1, rmsRelPct: 5, seed: 12345,
            evaluateSpec: true, qualifiers: [check], recordTrials: true,
        });
    const trial = run.trials[0];
    ok(`${mode}: the trial's check reads the trial's own spectrum`, same(trial.spec.results[0].value, run.mean[0]),
        `${trial.spec.results[0].value} against ${run.mean[0]}`);
}

// ── 2. Inhomogeneities ─────────────────────────────────────────────────────
{
    const design = designIn('symmetric');
    const inh = { interlayers: [], backInterlayers: [1, 3, 5].map(afterIndex => ({ afterIndex, thickness: 15, profile: 'linear', slices: 10, enabled: true })) };
    const spectra = inhomogeneities.computeInhomogeneitySpectra(design, { lambdaStart: 600, lambdaEnd: 601, lambdaStep: 1, theta: 0, polarization: 'avg' }, inh, 'total');
    const { specDesign, resolve } = inhomogeneities.buildSpecificationInputs(design, inh);
    const badge = evaluateQualifiers([check], specDesign, resolve)[0].value;
    ok('the badge reads the perturbed stack the window plots', same(badge, spectra.perturbed.T[0]), `${badge} against ${spectra.perturbed.T[0]}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
