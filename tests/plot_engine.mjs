/**
 * Plot Engine tests — verifies the curve compute dispatch:
 *   - λ-sweep curve matches a direct evaluateSpectrum call (bit-identical)
 *   - AOI-sweep at fixed λ matches per-θ evaluateSpectrum calls
 *   - Surface mode dispatch reaches the right back/total evaluator
 *   - xSamples generates a sane grid
 *   - Channel/polarization extraction picks the right field
 *
 * Run: node tests/plot_engine.mjs
 */

import {
    makeDefaultCurve, xSamples, computeCurve,
} from '../src/utils/physics/plotQuantities.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok    = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near  = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const nearV = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((v, i) => near(v, b[i], tol));

// Minimal materials & design
const mat = (id, n, k = 0) => ({ id, name: id, getNK: () => [n, k] });
const air = mat('Air', 1.0);
const bk7 = mat('BK7', 1.52);
const tio = mat('TiO2', 2.40);
const sio = mat('SiO2', 1.46);

const FRONT = [
    { material: tio, thickness: 95 },
    { material: sio, thickness: 137 },
    { material: tio, thickness: 95 },
];
const BACK = [
    { material: sio, thickness: 137 },
];

const ctx = {
    incMat: air, subMat: bk7, exitMat: air,
    frontLayers: FRONT, backLayers: BACK,
    subThickness_mm: 1.0,
};

// ── 1) makeDefaultCurve produces unique ids and rotating colors ────────────
{
    const c1 = makeDefaultCurve();
    const c2 = makeDefaultCurve();
    const c3 = makeDefaultCurve();
    ok(c1.id !== c2.id && c2.id !== c3.id, 'makeDefaultCurve: unique ids');
    ok(c1.color !== c2.color, 'makeDefaultCurve: rotating colors');
    ok(c1.rangeFrom === 400 && c1.rangeTo === 800, 'makeDefaultCurve: default range 400–800 nm');
}

// ── 2) xSamples produces expected grid ─────────────────────────────────────
{
    const xs = xSamples({ rangeFrom: 400, rangeTo: 800, rangeStep: 100 });
    ok(xs.length === 5, `xSamples: 5 points (400/500/600/700/800), got ${xs.length}`);
    ok(xs[0] === 400 && xs[4] === 800, 'xSamples: endpoints match');
}

// ── 3) λ-sweep curve matches direct evaluateSpectrum (bit-identical) ──────
{
    const curve = makeDefaultCurve({
        xAxis: 'wavelength', yChannel: 'T', polarization: 'avg',
        surfaceMode: 'front', aoiFixed_deg: 0,
        rangeFrom: 400, rangeTo: 800, rangeStep: 50,
    });
    const { x, y } = computeCurve(curve, ctx);
    const direct = evaluateSpectrum(
        { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 50, theta: 0, polarization: 'avg' },
        air, bk7, FRONT
    );
    ok(nearV(x, direct.lambda, 1e-12), 'λ-sweep: x matches direct evaluateSpectrum');
    ok(nearV(y, direct.T, 1e-15),      'λ-sweep T: bit-identical to direct');
}

// ── 4) λ-sweep at AOI=30 with p-pol matches direct ────────────────────────
{
    const curve = makeDefaultCurve({
        xAxis: 'wavelength', yChannel: 'R', polarization: 'p',
        surfaceMode: 'front', aoiFixed_deg: 30,
        rangeFrom: 500, rangeTo: 600, rangeStep: 25,
    });
    const { x, y } = computeCurve(curve, ctx);
    const direct = evaluateSpectrum(
        { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 25, theta: 30, polarization: 'p' },
        air, bk7, FRONT
    );
    ok(nearV(x, direct.lambda, 1e-12), 'oblique λ-sweep: x matches');
    ok(nearV(y, direct.Rp, 1e-15),     'oblique λ-sweep Rp: bit-identical');
}

// ── 5) AOI-sweep at fixed λ matches per-θ evaluateSpectrum calls ──────────
{
    const curve = makeDefaultCurve({
        xAxis: 'aoi', yChannel: 'R', polarization: 's',
        surfaceMode: 'front', lambdaFixed_nm: 550,
        rangeFrom: 0, rangeTo: 60, rangeStep: 15,
    });
    const { x, y } = computeCurve(curve, ctx);
    ok(x.length === 5, `AOI-sweep: 5 points (0/15/30/45/60), got ${x.length}`);
    for (let i = 0; i < x.length; i++) {
        const r = evaluateSpectrum(
            { lambdaStart: 550, lambdaEnd: 550, lambdaStep: 1, theta: x[i], polarization: 's' },
            air, bk7, FRONT
        );
        ok(near(y[i], r.Rs[0], 1e-15), `AOI-sweep[${i}]: matches direct evaluateSpectrum at θ=${x[i]}`);
    }
}

// ── 6) Surface mode dispatch — 'back' reaches evaluateSpectrumBack ────────
{
    const curve = makeDefaultCurve({
        xAxis: 'wavelength', yChannel: 'T', polarization: 'avg',
        surfaceMode: 'back', aoiFixed_deg: 0,
        rangeFrom: 500, rangeTo: 600, rangeStep: 50,
    });
    const { x, y } = computeCurve(curve, ctx);
    const direct = evaluateSpectrumBack(
        { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50, theta: 0, polarization: 'avg' },
        air, bk7, BACK
    );
    ok(nearV(x, direct.lambda, 1e-12), 'back-mode: x matches');
    ok(nearV(y, direct.T, 1e-15),      'back-mode T: bit-identical');
}

// ── 7) Surface mode dispatch — 'total' reaches evaluateSpectrumTotal ──────
{
    const curve = makeDefaultCurve({
        xAxis: 'wavelength', yChannel: 'R', polarization: 'avg',
        surfaceMode: 'total', aoiFixed_deg: 0,
        rangeFrom: 500, rangeTo: 600, rangeStep: 50,
    });
    const { x, y } = computeCurve(curve, ctx);
    const direct = evaluateSpectrumTotal(
        { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50, theta: 0, polarization: 'avg' },
        air, bk7, air, FRONT, BACK, 1.0
    );
    ok(nearV(x, direct.lambda, 1e-12), 'total-mode: x matches');
    ok(nearV(y, direct.R, 1e-15),      'total-mode R: bit-identical');
}

// ── 8) Channel extraction picks the right pol+channel field ────────────────
{
    // Verify all 9 combinations (T/R/A × avg/s/p) by spot-checking λ-sweep dispatch
    const channels = ['T', 'R', 'A'];
    const pols = ['avg', 's', 'p'];
    for (const ch of channels) {
        for (const p of pols) {
            const curve = makeDefaultCurve({
                xAxis: 'wavelength', yChannel: ch, polarization: p,
                surfaceMode: 'front', aoiFixed_deg: 0,
                rangeFrom: 500, rangeTo: 500, rangeStep: 1,
            });
            const { y } = computeCurve(curve, ctx);
            const direct = evaluateSpectrum(
                { lambdaStart: 500, lambdaEnd: 500, lambdaStep: 1, theta: 0, polarization: p },
                air, bk7, FRONT
            );
            const expectedKey = p === 's' ? `${ch}s` : p === 'p' ? `${ch}p` : ch;
            ok(near(y[0], direct[expectedKey][0], 1e-15), `channel pick: ${ch}/${p}`);
        }
    }
}

// ── 9) Empty range → empty arrays without crashing ────────────────────────
{
    // from > to swapped — function should still produce a valid range
    const curve = makeDefaultCurve({
        xAxis: 'wavelength', rangeFrom: 800, rangeTo: 400, rangeStep: 100,
    });
    const { x } = computeCurve(curve, ctx);
    ok(x.length === 5 && x[0] === 400 && x[4] === 800, 'reversed range auto-corrected');
}

// ── 10) Safety cap on huge ranges ──────────────────────────────────────────
{
    const xs = xSamples({ rangeFrom: 0, rangeTo: 1e8, rangeStep: 1 });
    ok(xs.length <= 50001, `safety cap: ≤ 50001 points (got ${xs.length})`);
}

// ── Summary ────────────────────────────────────────────────────────────────
if (fails === 0) {
    console.log('All plot-engine tests passed.');
    process.exit(0);
} else {
    console.error(`${fails} test(s) failed.`);
    process.exit(1);
}
