/**
 * Correlated colour temperature is the temperature of the Planckian radiator
 * nearest the colour in CIE 1960 u, v (CIE 15:2018 §9.5), and Duv the signed
 * distance to it.
 *
 *   1. A blackbody's own chromaticity reads its temperature, from 1001 K to
 *      990000 K, with Duv zero.
 *   2. A colour moved off the locus along its normal keeps the CCT and reads
 *      the distance moved as Duv, above and below.
 *   3. Illuminants A and D65 read 2856 K and 6504 K, their CIE values.
 *   4. CCT is NaN past |Duv| 0.05 and beyond 1000 K to 10⁶ K; Duv is kept past 0.05.
 *   5. The slopes of CCT and Duv in x and y against central differences, on
 *      the locus too.
 *   6. The locus is kept per colour-matching table, so the observer given as
 *      the number 10, which cmfTable reads as the 2° table, does not stand in
 *      for the 10° locus.
 *
 * Run: node tests/cct_nearest_planckian.mjs
 */
import assert from 'node:assert/strict';
import {
    correlatedColorTemperature, planckianXyz, uv1960, whitePoint, chromaticityXy,
} from '../src/utils/physics/colorimetry.js';
import { correlatedColorTemperatureSlopes } from '../src/utils/physics/colorimetry/locusSlopes.js';
const OBS = '2';
const xyOfUv = ({ u, v }) => {
    const q = 2 * u - 8 * v + 4;
    return { x: 3 * u / q, y: 2 * v / q };
};
const locusUv = T => uv1960(planckianXyz(T, OBS));

// The point `duv` off the locus at T, along the normal, positive above.
function offLocus(T, duv) {
    const p = locusUv(T), a = locusUv(T * (1 - 1e-6)), b = locusUv(T * (1 + 1e-6));
    const tu = b.u - a.u, tv = b.v - a.v, len = Math.hypot(tu, tv);
    let nu = -tv / len, nv = tu / len;
    if (nv < 0) { nu = -nu; nv = -nv; }
    return xyOfUv({ u: p.u + duv * nu, v: p.v + duv * nv });
}

// ── 1. On the locus ──────────────────────────────────────────────────────────
for (const T of [1001, 1500, 2856, 4000, 6504, 10000, 20000, 50000, 7e5, 9.9e5]) {
    const { cct, duv } = correlatedColorTemperature(xyOfUv(locusUv(T)), OBS);
    assert.ok(Math.abs(cct - T) <= 1e-6 * T, `blackbody at ${T} K reads ${cct} K`);
    assert.ok(Math.abs(duv) < 1e-9, `blackbody at ${T} K has Duv ${duv}`);
}

// ── 2. Off the locus along its normal ────────────────────────────────────────
for (const T of [2700, 6500, 15000]) {
    for (const off of [0.02, -0.02, 0.049]) {
        const { cct, duv } = correlatedColorTemperature(offLocus(T, off), OBS);
        assert.ok(Math.abs(cct - T) <= 1e-5 * T, `${T} K moved ${off} reads ${cct} K`);
        assert.ok(Math.abs(duv - off) < 1e-8, `${T} K moved ${off} reads Duv ${duv}`);
    }
}

// ── 3. Standard illuminants ──────────────────────────────────────────────────
{
    const lambda = Array.from({ length: 81 }, (_, i) => 380 + 5 * i);
    const read = id => correlatedColorTemperature(chromaticityXy(whitePoint(lambda, OBS, id)), OBS);
    const A = read('A'), D65 = read('D65');
    assert.ok(Math.abs(A.cct - 2856) < 1, `A reads ${A.cct.toFixed(2)} K`);
    assert.ok(Math.abs(D65.cct - 6504) < 2, `D65 reads ${D65.cct.toFixed(2)} K`);
    console.log(`[3] A ${A.cct.toFixed(1)} K, Duv ${A.duv.toExponential(1)}; D65 ${D65.cct.toFixed(1)} K, Duv ${D65.duv.toFixed(4)}`);
}

// ── 4. No CCT off the locus or out of range ──────────────────────────────────
{
    const far = correlatedColorTemperature(offLocus(5000, 0.06), OBS);
    assert.ok(Number.isNaN(far.cct), 'no CCT 0.06 off the locus');
    assert.ok(Math.abs(far.duv - 0.06) < 1e-6, `Duv kept past 0.05: ${far.duv}`);
    assert.ok(Number.isNaN(correlatedColorTemperature(xyOfUv(locusUv(800)), OBS).cct), 'no CCT below 1000 K');
    assert.ok(Number.isNaN(correlatedColorTemperature(xyOfUv(locusUv(1e7)), OBS).cct), 'no CCT above 10⁶ K');
}

// ── 5. Slopes, off the locus and on it ───────────────────────────────────────
for (const [T, off] of [[2000, 0.01], [3000, -0.03], [6500, 0.004], [12000, -0.01], [30000, 0.02], [3000, 0], [6504, 0]]) {
    const xy = offLocus(T, off);
    const { dCct, dDuv } = correlatedColorTemperatureSlopes(xy, OBS);
    const h = 1e-6;
    ['x', 'y'].forEach((axis, j) => {
        const plus = { ...xy, [axis]: xy[axis] + h }, minus = { ...xy, [axis]: xy[axis] - h };
        const p = correlatedColorTemperature(plus, OBS), m = correlatedColorTemperature(minus, OBS);
        const fdCct = (p.cct - m.cct) / (2 * h), fdDuv = (p.duv - m.duv) / (2 * h);
        assert.ok(Math.abs(dCct[j] - fdCct) <= 1e-4 * Math.abs(fdCct), `${T} K, ∂CCT/∂${axis}: ${dCct[j]} against ${fdCct}`);
        assert.ok(Math.abs(dDuv[j] - fdDuv) <= 1e-5 * Math.abs(fdDuv), `${T} K, ∂Duv/∂${axis}: ${dDuv[j]} against ${fdDuv}`);
    });
}

// ── 6. The observer given as a number reads the table it names ───────────────
{
    const xy = offLocus(4000, 0.01);
    const tenFirst = correlatedColorTemperature(xy, '10').cct;
    correlatedColorTemperature(xy, 10);
    assert.equal(correlatedColorTemperature(xy, '10').cct, tenFirst, 'a call with 10 as a number leaves the 10° locus as it was');
}

console.log('PASS cct_nearest_planckian');
