/**
 * Monte-Carlo runs can be replayed from a seed, the specification yield carries
 * a binomial confidence interval, the spectral σ is the sample standard
 * deviation, and the draws do not depend on the plotted range.
 *
 *   - A run seeds its own Mulberry32 stream, reports the seed with the result,
 *     and the same seed with the same settings gives the same corridor and
 *     yield bit for bit.
 *   - The yield interval is the Wilson score interval at 95 % confidence
 *     (E. B. Wilson, J. Am. Stat. Assoc. 22, 209 (1927)). The reference values
 *     are the score-method column of R. G. Newcombe, Stat. Med. 17, 857 (1998),
 *     Table II.
 *   - σ(λ) divides by N - 1: two trials x1, x2 give |x1 - x2| / √2.
 *   - "Keep n·d" holds optical thickness at the design's reference wavelength,
 *     so widening the plot from 400-800 nm to 400-2500 nm leaves every draw as
 *     it was.
 *   - A draw truncated at ±3σ has variance 0.973 σ² and RMS 0.987 σ.
 *   - k + Δk is clamped at 0, so the k error on a transparent layer is
 *     one-sided and raises the mean k by E[max(0, Δk)].
 *
 * Run: node tests/mc_seed_and_uncertainty.mjs
 */

import assert from 'node:assert/strict';
import { runErrorAnalysisMC } from '../src/utils/physics/errorAnalysis.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { evaluateQualifiers } from '../src/utils/synthesis/qualifiers.js';
import { sampleDeviation } from '../src/utils/physics/errorAnalysis/sampling.js';
import { makeShiftedMaterial } from '../src/utils/physics/errorAnalysis/spectrumEval.js';
import { mulberry32 } from '../src/utils/monitoring/monitoringSim/rng.js';
import * as mcResult from '../src/utils/physics/errorAnalysis/mcResult.js';

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

const constMat = (n, k = 0) => ({ getNK: () => [n, k] });
const materials = {
    Air: constMat(1),
    Sub: constMat(1.52),
    // Cauchy-like dispersion, so n at 600 nm and at 1450 nm differ clearly.
    H: { getNK: (lambda) => [2.2 + 3.0e4 / (lambda * lambda), 0] },
    L: constMat(1.46),
};
const resolveMat = (id) => materials[id];

const design = {
    id: 'mc-seed',
    referenceWavelength: 550,
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'Sub', thickness: 1 },
    surfaceMode: 'front_only',
    frontLayers: [
        { material: 'H', thickness: 58 },
        { material: 'L', thickness: 94 },
        { material: 'H', thickness: 58 },
    ],
    backLayers: [],
};
const params = { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 10, theta: 0, polarization: 'avg' };

// A requirement placed at the nominal value, so roughly half the trials pass
// and the yield is neither 0 nor 1.
const probe = [{ enabled: true, kind: 'R_AT', lambda: 550, aoi: 0, pol: 'avg', cmp: 'le', target: 1, label: 'R@550' }];
const nominalR = evaluateQualifiers(probe, design, resolveMat)[0].value;
const qualifiers = [{ ...probe[0], target: nominalR }];

const base = {
    char: 'R', evalMode: 'front', nTrials: 40,
    rmsAbsNm: 0.5, rmsRelPct: 1, rmsReN: 0.01, rmsImN: 0,
    distribution: 'gaussian',
    evaluateSpec: true, qualifiers, recordTrials: true,
};
const run = (opts, p = params) => runErrorAnalysisMC(design, p, resolveMat, { ...base, ...opts });

await check('the same seed gives the same corridor and yield bit for bit', async () => {
    const a = await run({ seed: 12345 });
    const b = await run({ seed: 12345 });
    assert.equal(a.seed, 12345, 'the result keeps the seed it was drawn from');
    assert.ok(a.spec.yield > 0 && a.spec.yield < 1, `yield ${a.spec.yield} discriminates`);
    assert.deepEqual(b, a);
});

await check('an unseeded run reports a seed that replays it', async () => {
    const fresh = await run({});
    assert.ok(Number.isInteger(fresh.seed) && fresh.seed > 0 && fresh.seed <= 0xFFFFFFFF,
        `seed ${fresh.seed} is a positive 32-bit integer`);
    const replay = await run({ seed: fresh.seed });
    assert.deepEqual(replay, fresh);
});

await check('a fresh seed covers 1 to 2^32 - 1, the range a typed seed may take', async () => {
    const { randomSeed, normalizeSeed, MAX_SEED } = await import('../src/utils/physics/errorAnalysis/mcConfig.js');
    const random = Math.random;
    try {
        Math.random = () => 0;
        assert.equal(randomSeed(), 1, 'the lowest draw gives seed 1');
        Math.random = () => 1 - 2 ** -53;
        assert.equal(randomSeed(), MAX_SEED, 'the highest draw gives seed 2^32 - 1');
    } finally {
        Math.random = random;
    }
    assert.equal(normalizeSeed(MAX_SEED), MAX_SEED);
    assert.equal(normalizeSeed(0), null, 'seed 0 would share the stream of seed 1');
    assert.equal(normalizeSeed(''), null, 'an empty field is no seed');
});

await check('a different seed gives different trials', async () => {
    const a = await run({ seed: 1 });
    const b = await run({ seed: 2 });
    assert.notDeepEqual(a.mean, b.mean);
});

await check('the Wilson interval matches the published score intervals', () => {
    assert.equal(typeof mcResult.wilsonInterval, 'function', 'wilsonInterval is exported');
    const table = [
        [81, 263, 0.2553, 0.3662],
        [15, 148, 0.0624, 0.1605],
        [0, 20, 0.0000, 0.1611],
        [1, 29, 0.0061, 0.1718],
        [29, 29, 0.8830, 1.0000],
    ];
    for (const [pass, n, low, high] of table) {
        const [lo, hi] = mcResult.wilsonInterval(pass, n);
        assert.ok(Math.abs(lo - low) < 6e-5 && Math.abs(hi - high) < 6e-5,
            `${pass}/${n}: got ${lo.toFixed(4)} to ${hi.toFixed(4)}, expected ${low} to ${high}`);
        assert.ok(lo >= 0 && hi <= 1, `${pass}/${n} stays inside [0, 1]`);
    }
    assert.equal(mcResult.wilsonInterval(0, 0), null, 'no trials, no interval');
});

await check('the run reports the Wilson interval of its own yield', async () => {
    const a = await run({ seed: 777 });
    assert.ok(Array.isArray(a.spec.yieldInterval), 'spec.yieldInterval is present');
    assert.deepEqual(a.spec.yieldInterval, mcResult.wilsonInterval(a.spec.passCount, a.spec.evaluated));
    assert.ok(a.spec.yieldInterval[0] <= a.spec.yield && a.spec.yield <= a.spec.yieldInterval[1]);
});

await check('σ is the sample standard deviation (divides by N - 1)', async () => {
    // Uniform draws are linear in rng(), and with thickness and Im(n) errors off
    // only the one Re(n) draw per trial consumes it: +Δ, then -Δ.
    const single = { ...design, frontLayers: [{ material: 'H', thickness: 120 }] };
    const sequence = [1.0, 0.0];
    let next = 0;
    const delta = 0.05;
    const mc = await runErrorAnalysisMC(single, params, resolveMat, {
        char: 'R', evalMode: 'front', nTrials: 2,
        rmsAbsNm: 0, rmsRelPct: 0, rmsReN: delta, rmsImN: 0,
        distribution: 'uniform', rng: () => sequence[next++],
    });
    const at = (dn) => evaluateSpectrum(params, materials.Air, materials.Sub, [{
        material: { getNK: (lambda) => [materials.H.getNK(lambda)[0] + dn, 0] }, thickness: 120,
    }]).R;
    const x1 = at(+delta);
    const x2 = at(-delta);
    for (let i = 0; i < x1.length; i++) {
        const expected = Math.abs(x1[i] - x2[i]) / Math.SQRT2;
        assert.ok(Math.abs(mc.stdev[i] - expected) < 1e-12,
            `λ ${params.lambdaStart + i * params.lambdaStep}: σ ${mc.stdev[i]} vs ${expected}`);
    }
});

await check('changing the plot range does not change the draws', async () => {
    // A fresh stream per run, so only the plotted range differs between the two.
    const keep = () => ({ rmsReN: 0.03, keepOpticalThickness: true, rng: mulberry32(4242), evaluateSpec: false });
    const narrow = await run(keep(), { ...params, lambdaStart: 400, lambdaEnd: 800, lambdaStep: 100 });
    const wide = await run(keep(), { ...params, lambdaStart: 400, lambdaEnd: 2500, lambdaStep: 100 });
    const draws = (result) => result.trials.flatMap((trial) => [...trial.dThkF, ...trial.dnF, ...trial.dkF]);
    const a = draws(narrow);
    const b = draws(wide);
    const worst = a.reduce((m, value, i) => Math.max(m, Math.abs(value - b[i])), 0);
    assert.ok(a.length === b.length && worst === 0,
        `400-800 nm and 400-2500 nm draws differ by up to ${worst}`);

    // n·d is held at the design's reference wavelength.
    const nRef = materials.H.getNK(design.referenceWavelength)[0];
    const trial = narrow.trials[0];
    assert.equal(trial.dThkF[0], 58 * (nRef / (nRef + trial.dnF[0]) - 1));
});

await check('a draw truncated at ±3σ has RMS 0.987 σ', () => {
    const rng = mulberry32(9);
    const bound = 3;           // B = 3σ with σ = 1
    const count = 200000;
    let sumSq = 0;
    let largest = 0;
    for (let i = 0; i < count; i++) {
        const value = sampleDeviation(bound, 'truncated', rng);
        sumSq += value * value;
        largest = Math.max(largest, Math.abs(value));
    }
    const rms = Math.sqrt(sumSq / count);
    assert.ok(largest <= bound, 'no draw exceeds the bound');
    assert.ok(Math.abs(rms - 0.9866) < 0.005, `RMS ${rms.toFixed(4)}`);
});

await check('a k error on a transparent layer is one-sided, as documented', () => {
    // k + Δk is clamped at 0, so on k = 0 the mean applied k is E[max(0, Δk)]:
    // σ/√(2π) for a Gaussian draw and B/4 for a uniform one.
    const transparent = constMat(1.46, 0);
    const count = 200000;
    for (const [distribution, expected] of [['gaussian', 1 / Math.sqrt(2 * Math.PI)], ['uniform', 0.25]]) {
        const rng = mulberry32(21);
        let sumK = 0;
        let negative = 0;
        for (let i = 0; i < count; i++) {
            const k = makeShiftedMaterial(transparent, 0, sampleDeviation(1, distribution, rng)).getNK(550)[1];
            sumK += k;
            if (k < 0) negative++;
        }
        assert.equal(negative, 0, `${distribution}: no trial has gain`);
        assert.ok(Math.abs(sumK / count - expected) < 0.005,
            `${distribution}: mean k ${(sumK / count).toFixed(4)} vs ${expected.toFixed(4)}`);
    }
});

if (failures) {
    console.error(`\nmc_seed_and_uncertainty: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nmc_seed_and_uncertainty: passed');
