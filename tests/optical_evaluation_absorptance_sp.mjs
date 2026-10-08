/**
 * Optical Evaluation draws absorptance for s and p beside the average, the way
 * it draws T and R.
 *
 *   - On an absorbing design at 45°, As = 1 - Rs - Ts and Ap = 1 - Rp - Tp at
 *     every sample, and with unpolarized light (As + Ap) / 2 = A, in front,
 *     back and total mode.
 *   - With a cone set, As and Ap are cone averages, like Ts and Tp.
 *   - The table and the CSV carry As and Ap columns, one per angle.
 *   - Every curve the switches offer has a shape, a colour, a label and a print
 *     colour in the report, so a switch never turns on a curve nothing draws.
 *
 * Run: node tests/optical_evaluation_absorptance_sp.mjs
 */
import assert from 'node:assert/strict';
import {
    CURVE_BY_KEY, CURVE_GROUPS, buildCSV, buildTableColumns,
} from '../src/components/windows/analysis/opticalEvaluation/model.js';
import { computeOpticalSpectrum } from '../src/components/windows/analysis/opticalEvaluation/spectrum.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { coneAverageResult, makeConeSpec } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { ANALYSIS_DEFAULTS } from '../src/constants/analysisDefaults.js';
import { CURVES as REPORT_CURVES, enabledCurves } from '../src/utils/report/sections/spectrum.js';
import { defaultSettings } from '../src/utils/report/blocks.js';
import { getLocale } from '../src/constants/locales/index.js';

const close = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} vs ${expected}`);

// A thin chromium film under silica on glass, coated on both faces, so every
// mode has an absorber in it.
const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ material: 'Cr', thickness: 8 }, { material: 'SiO2', thickness: 95 }],
    backLayers: [{ material: 'Cr', thickness: 5 }],
};
const params = { lambdaStart: 450, lambdaEnd: 650, lambdaStep: 50, thetas: [45] };

// ── Energy balance per polarization ──────────────────────────────────────────
for (const mode of ['front', 'back', 'total']) {
    const { series: [at45] } = computeOpticalSpectrum(design, params, mode);
    assert.ok(at45.As && at45.Ap, `${mode}: the series carries As and Ap`);
    assert.ok(Math.min(...at45.As, ...at45.Ap) > 0.01, `${mode}: the design absorbs in both polarizations`);
    assert.ok(at45.As.some((value, i) => Math.abs(value - at45.Ap[i]) > 1e-3),
        `${mode}: s and p absorb differently at 45°`);
    at45.As.forEach((value, i) => {
        close(value, 1 - at45.Rs[i] - at45.Ts[i], `${mode} As = 1 - Rs - Ts at sample ${i}`);
        close(at45.Ap[i], 1 - at45.Rp[i] - at45.Tp[i], `${mode} Ap = 1 - Rp - Tp at sample ${i}`);
        close((value + at45.Ap[i]) / 2, at45.A[i], `${mode} (As + Ap) / 2 = A at sample ${i}`);
    });
}

// ── Cone average ─────────────────────────────────────────────────────────────
{
    const cone = { enabled: true, halfAngleDeg: 12 };
    const coned = computeOpticalSpectrum({ ...design, cone }, params, 'front').series[0];
    const plain = computeOpticalSpectrum(design, params, 'front').series[0];
    const inc = getMaterial('Air');
    const sub = getMaterial('BK7');
    const layers = design.frontLayers.map(layer => ({ material: getMaterial(layer.material), thickness: layer.thickness }));
    const reference = coneAverageResult(makeConeSpec(cone), 45,
        theta => evaluateSpectrum({ ...params, theta }, inc, sub, layers), ['As', 'Ap']);
    coned.As.forEach((value, i) => {
        close(value, reference.As[i], `cone As is the cone average at sample ${i}`);
        close(coned.Ap[i], reference.Ap[i], `cone Ap is the cone average at sample ${i}`);
    });
    assert.ok(coned.Ap.some((value, i) => Math.abs(value - plain.Ap[i]) > 1e-6),
        'the cone moves Ap off the collimated value');
}

// ── Table and CSV ─────────────────────────────────────────────────────────────
{
    const data = computeOpticalSpectrum(design, { ...params, thetas: [0, 45] }, 'front');
    const showCurves = { As: true, Ap: true };
    assert.equal(buildCSV(data, showCurves).split('\n')[0], 'lambda_nm,As_0deg,Ap_0deg,As_45deg,Ap_45deg',
        'the CSV has an As and an Ap column per angle');
    const labels = getLocale('en').opticalEval.curveLabels;
    assert.deepEqual(buildTableColumns(data, showCurves, undefined, 'percent', labels).map(column => column.label),
        ['A (s) @ 0°', 'A (p) @ 0°', 'A (s) @ 45°', 'A (p) @ 45°'], 'and so does the results table');
    assert.equal(buildCSV(data, showCurves, 'OD').split('\n')[0], 'lambda_nm',
        'optical density reads transmittance only, so it parks them like A');
}

// ── Every switch has a curve to turn on ──────────────────────────────────────
{
    const colors = ANALYSIS_DEFAULTS.opticalEvaluation.colors;
    const reportKeys = new Set(REPORT_CURVES.map(curve => curve.key));
    const blockCurves = defaultSettings('spectrum').curves;
    for (const code of ['en', 'ru', 'zh', 'it']) {
        const labels = getLocale(code).opticalEval.curveLabels;
        for (const { members } of CURVE_GROUPS) {
            for (const { key } of members) assert.ok(labels[key], `${code} labels ${key}`);
        }
    }
    for (const { q, members } of CURVE_GROUPS) {
        assert.deepEqual(members.map(member => member.pol), ['avg', 's', 'p'], `${q} offers avg, s and p`);
        for (const { key } of members) {
            assert.ok(CURVE_BY_KEY[key], `${key} has a plot shape`);
            assert.match(colors[key], /^#[0-9a-f]{6}$/, `${key} has a plot colour`);
            assert.ok(reportKeys.has(key), `${key} has a print colour in the report`);
            assert.equal(blockCurves[key], key === 'T' || key === 'R', `a new report block starts with ${key} ${blockCurves[key] ? 'on' : 'off'}`);
        }
    }
    assert.deepEqual(enabledCurves({ curves: { As: true, Ap: true } }).map(curve => curve.key), ['As', 'Ap'],
        'the report spectrum block draws As and Ap when they are switched on');
}

console.log('PASS optical_evaluation_absorptance_sp');
