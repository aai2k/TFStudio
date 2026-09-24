/**
 * The Monte-Carlo report block describes the run it prints.
 *
 *   - A run keeps the error settings, the corridor width and the geometry it
 *     was made with, and its corridor is mean ± kσ at that k.
 *   - The Monte-Carlo window hands its corridor width to the run.
 *   - The report reads every figure it prints from the run, never from what the
 *     window is set to now, and prints the run's seed and the 95 % Wilson
 *     interval of the yield.
 *
 * Run: node tests/report_monte_carlo_run.mjs
 */

import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { runErrorAnalysisMC } = await import('../src/utils/physics/errorAnalysis.js');
const { evaluateQualifiers } = await import('../src/utils/synthesis/qualifiers.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { composeReport } = await import('../src/utils/report/template.js');
const { executeRun } = await import('../src/components/windows/analysis/errorAnalysis/useErrorAnalysis.js');

const tr = makeLocale('en').report;

let failures = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('  ok', name);
    } catch (error) {
        failures++;
        console.error('FAIL', name, '\n    ', error.message);
    }
}

const constMat = (n) => ({ getNK: () => [n, 0] });
const materials = { Air: constMat(1), Sub: constMat(1.52), H: constMat(2.3), L: constMat(1.46) };
const resolveMat = (id) => materials[id];
const mcDesign = {
    id: 'mc', referenceWavelength: 550, incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'Sub', thickness: 1 }, surfaceMode: 'front_only',
    frontLayers: [{ material: 'H', thickness: 58 }, { material: 'L', thickness: 94 }, { material: 'H', thickness: 58 }],
    backLayers: [],
};
const params = { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 10, theta: 10, polarization: 's' };

// A requirement at the nominal value, so about half the trials pass.
const probe = [{ enabled: true, kind: 'R_AT', lambda: 550, aoi: 10, pol: 's', cmp: 'le', target: 1, label: 'R@550' }];
const nominalR = evaluateQualifiers(probe, mcDesign, resolveMat)[0].value;
const qualifiers = [{ ...probe[0], target: nominalR }];

const RUN = {
    corridorSigma: 2, rmsAbsNm: 0.3, rmsRelPct: 1.5, rmsReN: 0.01, rmsImN: 0,
    distribution: 'uniform', theta: 10, polarization: 's',
};
const result = await runErrorAnalysisMC(mcDesign, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 60, seed: 4242,
    corridorSigma: RUN.corridorSigma, rmsAbsNm: RUN.rmsAbsNm, rmsRelPct: RUN.rmsRelPct,
    rmsReN: RUN.rmsReN, rmsImN: RUN.rmsImN, distribution: RUN.distribution,
    evaluateSpec: true, qualifiers,
});

await check('a run keeps the settings it was made with', () => {
    assert.deepEqual(result.settings, RUN);
    result.mean.forEach((mean, i) => {
        assert.equal(result.lower[i], Math.max(0, mean - 2 * result.stdev[i]), `λ ${result.lambda[i]}: corridor at 2σ`);
        assert.equal(result.upper[i], Math.min(1, mean + 2 * result.stdev[i]));
    });
    assert.ok(result.spec.yield > 0 && result.spec.yield < 1, `yield ${result.spec.yield} discriminates`);
});

await check('the window hands its corridor width to the run', async () => {
    const reportDesign = {
        id: 'w', referenceWavelength: 550, incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 }, surfaceMode: 'front_only',
        frontLayers: [{ id: 'a', material: 'TiO2', thickness: 60 }, { id: 'b', material: 'SiO2', thickness: 95 }],
        backLayers: [],
    };
    let stored = null;
    let failed = null;
    await executeRun({
        design: reportDesign, params: { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50, theta: 0, polarization: 'avg' },
        evalMode: 'front', char: 'R', nTrials: 3, corridorSigma: 2.5,
        rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0, rmsImN: 0, distribution: 'gaussian',
        perMaterial: false, keepOPT: false, seed: 11, cancelledRef: { current: false },
        setError: (error) => { failed = error; }, setRunning: () => {}, setProgress: () => {},
        setResult: (value) => { stored = value; }, setSeed: () => {},
    });
    assert.equal(failed, null);
    assert.equal(stored.settings.corridorSigma, 2.5);
});

// The report design only has to render; the run above is what the block prints.
const reportDesign = {
    id: 'r', name: 'Report', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 550, surfaceMode: 'front_only',
    frontLayers: [{ id: 'a', material: 'TiO2', thickness: 60 }, { id: 'b', material: 'SiO2', thickness: 95 }],
};
function section(html, type) {
    const m = html.match(new RegExp(`<section class="tf-block tf-block-${type}[^"]*" data-block="${type}">([\\s\\S]*?)</section>`));
    return m ? m[1] : null;
}
function printed(external) {
    const blocks = [newBlock('monteCarlo', { tableStep: 50, envelope: false })];
    const items = [{ design: reportDesign, data: gatherDesignData(reportDesign, blocks, external) }];
    return section(composeReport({ tr, blocks, designs: items }), 'monteCarlo');
}

await check('the report prints the run, whatever the window is set to now', () => {
    // What the window shows after the run: every figure changed.
    const now = {
        corridorSigma: 3, rmsAbsNm: 1, rmsRelPct: 5, rmsReN: 0.05, rmsImN: 0.02,
        distribution: 'gaussian', theta: 0, polarization: 'avg',
    };
    for (const external of [{ monteCarlo: () => ({ result }) }, { monteCarlo: () => ({ result, settings: now }) }]) {
        const mc = printed(external);
        assert.ok(mc.includes('−2σ') && mc.includes('+2σ') && !mc.includes('3σ'), 'the corridor width of the run');
        assert.ok(mc.includes(tr.mcThickness('1.50', '0.30')) && !mc.includes(tr.mcThickness('5.00', '1.00')),
            'the thickness errors of the run');
        assert.ok(mc.includes(tr.mcIndex('0.0100', '0.0000')), 'the index errors of the run');
        assert.ok(mc.includes(tr.mcDistribution.uniform) && !mc.includes(tr.mcDistribution.gaussian), 'the distribution of the run');
        assert.ok(mc.includes(`${tr.aoi} 10°`) && mc.includes(' · s'), 'the geometry of the run');
    }
});

await check('the report prints the seed and the yield interval', () => {
    const mc = printed({ monteCarlo: () => ({ result }) });
    const { passCount, evaluated, yieldInterval: [low, high] } = result.spec;
    assert.ok(mc.includes(tr.mcSeed(4242)), 'the seed the run was drawn from');
    assert.ok(mc.includes(tr.mcYield(passCount, evaluated, (100 * passCount / evaluated).toFixed(1))), 'the yield');
    assert.ok(mc.includes(tr.mcYieldInterval((low * 100).toFixed(1), (high * 100).toFixed(1))), 'its 95 % interval');
});

if (failures) {
    console.error(`\nreport_monte_carlo_run: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nreport_monte_carlo_run: passed');
