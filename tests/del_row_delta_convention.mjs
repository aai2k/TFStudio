/**
 * The sign of Δ a DEL merit row reads.
 *
 * A DEL row records its convention in `deltaConvention`. A new row, however it
 * is made, reads the Azzam-Bashara Δ the Ellipsometry window opens in, and the
 * Report's ellipsometry block gives the same number. A stored row without the
 * field reads 360° − that, as every DEL row did before rows recorded it, and
 * scores exactly as it did. Measured Ψ/Δ blocks keep scoring as they did in
 * either file convention, whole and broken into points for a run. Opening a
 * design gives such a row the field, so setMerit, a save and a copy pasted in
 * a merit table keep its sign.
 *
 * The scores of the stored row and of the measured blocks were taken from the
 * build before rows recorded their convention.
 *
 * Run: node tests/del_row_delta_convention.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initWasmForTest } from './_wasmInit.mjs';
import {
    buildEvalContext, calcMF, evaluateOperands, expandMeasuredCurveOperands, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { makeMeasuredCurve } from '../src/utils/io/spectrumTable.js';
import { computeEllipsometry } from '../src/utils/physics/thinFilmMath.js';
import { computeEllipsometrySweep } from '../src/components/windows/analysis/ellipsometryEvaluation/spectrum.js';
import { computeEllipsometrySpectrum } from '../src/utils/report/reportData/profiles.js';
import { ellipsometryFitSnapshot } from '../src/components/windows/dataExchange/measuredEllipsometry/fitModel.js';
import {
    addOperands, makeRowOperand, retypeOperand,
} from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import {
    looksLikeOperandRows, parseOperandsTsv, serializeOperandsTsv,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandClipboard.js';
import { merit, setMerit } from '../src/api/merit.js';
import { openDesign, saveDesign } from '../src/api/designs.js';

await initWasmForTest();

const resolveMat = id => getMaterial(id);
const design = {
    name: 'SiO2 on Si',
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'Si', thickness: 1 },
    frontLayers: [{ id: 'L1', material: 'SiO2', thickness: 100, locked: false }],
    backLayers: [],
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
};
const ctx = buildEvalContext(design, resolveMat);
const LAMBDA = 600;
const AOI = 70;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── The window, a new DEL row and the Report agree ───────────────────────────
{
    const windowDelta = computeEllipsometrySweep(design, {
        mode: 'spectral', side: 'front', lambdaStart: LAMBDA, lambdaEnd: LAMBDA + 10, lambdaStep: 10,
        thetaDeg: AOI, deltaConvention: 'azzam',
    }).delta[0];
    assert.equal(windowDelta.toFixed(2), '84.08', `the window reads ${windowDelta}`);

    const row = { type: 'DEL', lambdaStart: LAMBDA, aoi: AOI };
    const typed = makeRowOperand(row);
    const retyped = retypeOperand(makeRowOperand({ type: 'PSI', lambdaStart: LAMBDA, aoi: AOI }), 'DEL');
    const fromApi = setMerit(design, [row]).meritOperands[0];
    for (const [how, op] of [['typed', typed], ['retyped from PSI', retyped], ['setMerit', fromApi]]) {
        const [value] = evaluateOperands([op], ctx);
        assert.ok(close(value, windowDelta), `a DEL row ${how} reads ${value}, the window ${windowDelta}`);
        assert.equal(op.deltaConvention, 'azzam', `a DEL row ${how} records the Azzam-Bashara sign`);
    }
    const apiValue = merit(setMerit(design, [row])).rows[0].value;
    assert.ok(close(apiValue, windowDelta), `merit() reads ${apiValue}, the window ${windowDelta}`);

    const report = computeEllipsometrySpectrum(design, {
        lambdaStart: LAMBDA, lambdaEnd: LAMBDA + 10, lambdaStep: 10, thetas: [AOI],
    });
    const reportDelta = report.series[0].delta[0];
    assert.ok(close(reportDelta, windowDelta), `the Report reads ${reportDelta}, the window ${windowDelta}`);

    // A retyped DEL row is a new one even if it carried a sign from before.
    const back = retypeOperand({ ...typed, deltaConvention: 'reversed', type: 'PSI' }, 'DEL');
    assert.equal(back.deltaConvention, 'azzam');

    assert.throws(() => setMerit(design, [{ ...row, deltaConvention: 'instrument' }]),
        /deltaConvention is 'azzam' or 'reversed'/);
    assert.equal(setMerit(design, [{ ...row, deltaConvention: 'reversed' }]).meritOperands[0].deltaConvention,
        'reversed', 'setMerit keeps the sign a row gives');
}

// ── A stored DEL row without the field scores as it did ──────────────────────
{
    const stored = { id: 'old', enabled: true, type: 'DEL', lambdaStart: LAMBDA, lambdaEnd: LAMBDA, aoi: AOI, pol: 'avg', target: 270, targetEnd: null, weight: 1 };
    const [value] = evaluateOperands([stored], ctx);
    const kernel = computeEllipsometry(LAMBDA, AOI, getMaterial('Air').getNK(LAMBDA), getMaterial('Si').getNK(LAMBDA),
        [{ n: getMaterial('SiO2').getNK(LAMBDA), d: 100 }]).delta;
    assert.ok(close(value, kernel), `a stored row reads the 360° − Δ sign: ${value} against ${kernel}`);
    assert.equal(value.toFixed(2), '275.92');
    assert.equal(value, 275.9199082796117, 'the stored row reads what it read before');
    assert.equal(calcMF([stored], [value]), 0.29599541398058593, 'and scores what it scored before');
}

// ── Measured Δ blocks in each convention score as they did ───────────────────
{
    const lambdas = Array.from({ length: 21 }, (_, index) => 450 + index * 15);
    // Readings that are not the design's own, so each block scores something.
    const readings = lambdas.map((lambda, index) => (60 + 9 * index + lambda / 50) % 360);
    const expected = {
        azzam: { whole: 5.360453754715887, points: 5.360453754715885 },
        reversed: { whole: 5.104794183084876, points: 5.104794183084875 },
    };
    for (const convention of ['azzam', 'reversed']) {
        const curve = { ...makeMeasuredCurve({
            name: `Delta, ${convention}`, x: lambdas, xUnit: 'nm', y: readings, quantity: 'DEL', aoi: AOI,
            side: 'front', deltaConvention: convention,
        }), id: `curve-${convention}` };
        const { operand: block, error } = ellipsometryFitSnapshot(design, curve);
        assert.equal(error, null);
        assert.equal(block.deltaConvention, convention);
        const whole = calcMF([block], evaluateOperands([block], ctx));
        const points = expandMeasuredCurveOperands([block]);
        assert.ok(points.every(point => point.deltaConvention === 'reversed'),
            'each Δ point records the sign its target was moved into');
        const split = calcMF(points, evaluateOperands(points, ctx));
        assert.equal(whole, expected[convention].whole, `${convention} block, whole: ${whole}`);
        assert.equal(split, expected[convention].points, `${convention} block, broken into points: ${split}`);
    }
}

// ── An older design opened, given back to setMerit and saved scores as it did ──
// Its DEL row, and a copy of it pasted in a merit table, keep the sign it was
// saved in; a DEL line from outside the app pastes as a new row.
{
    const stored = { id: 'old', enabled: true, type: 'DEL', lambdaStart: LAMBDA, lambdaEnd: LAMBDA, aoi: AOI, pol: 'avg', target: 270, targetEnd: null, weight: 1 };
    const file = path.join(os.tmpdir(), `del-row-convention-${process.pid}.tfs`);
    fs.writeFileSync(file, JSON.stringify({ tfs_version: '1.2', ...design, meritOperands: [stored] }, null, 2));
    try {
        const opened = openDesign(file);
        const rows = setMerit(opened, opened.meritOperands).meritOperands;
        assert.equal(calcMF(rows, evaluateOperands(rows, ctx)), 0.29599541398058593, 'it scores as before');
        assert.equal(rows[0].deltaConvention, 'reversed', 'a load gives a stored DEL row its sign');
        saveDesign({ ...opened, meritOperands: rows }, file, { overwrite: true });
        assert.equal(openDesign(file).meritOperands[0].deltaConvention, 'reversed', 'a save keeps the sign');

        const source = rows[0];
        const text = serializeOperandsTsv(rows, new Set([source.id]));
        assert.ok(looksLikeOperandRows(text.split('\n').map(line => line.split('\t'))));
        const [pasted] = addOperands([], parseOperandsTsv(text), 0).operands;
        assert.equal(pasted.deltaConvention, 'reversed', 'a pasted copy keeps the sign of its source');
        assert.deepEqual(evaluateOperands([pasted], ctx), evaluateOperands([source], ctx));
        assert.equal(calcMF([pasted], evaluateOperands([pasted], ctx)), 0.29599541398058593);

        const [outside] = addOperands([], parseOperandsTsv('DEL\t600\t600\t70\tavg\t\t270.00\t1'), 0).operands;
        assert.equal(outside.deltaConvention, 'azzam', 'a DEL line from outside the app is a new row');
    } finally {
        fs.rmSync(file, { force: true });
    }
}

// cos Δ is the same in either sign, so a new COSDEL row reads what it did.
{
    const [cos] = evaluateOperands([makeOperand({ type: 'COSDEL', lambdaStart: LAMBDA, aoi: AOI })], ctx);
    const [del] = evaluateOperands([makeOperand({ type: 'DEL', lambdaStart: LAMBDA, aoi: AOI })], ctx);
    assert.ok(close(cos, Math.cos(del * Math.PI / 180)));
}

console.log('PASS: del_row_delta_convention');
