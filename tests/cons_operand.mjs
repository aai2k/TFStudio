/**
 * A CONS row is a fixed number for the math rows to read: its value is its own
 * target, and it adds nothing to the merit.
 *
 *   1. PROD of a TAV row and a CONS of 2 reads twice the TAV, and its analytic
 *      Jacobian row is twice the TAV's. The CONS row's own Jacobian row is
 *      zero, and it leaves the Newton system as it was.
 *   2. A CONS row adds nothing to the merit at any weight: MF, OMF, the weight
 *      sum, the share column and the optimizer's residuals are those of the
 *      merit without it. Synthesis does not count it as an optical row.
 *   3. A design with CONS rows saves and loads back, a CONS of 0.99 included,
 *      and so does a saved merit function loaded into a design.
 *   4. Percent: a math row reading a CONS takes its other reference's unit, so
 *      PROD of TAV and CONS shows its target in percent. A CONS row is a plain
 *      number in the table, the cell editor and on the clipboard.
 *   5. σ: a CONS has none. DIFF, SUMM and PROD of a row and a CONS take that
 *      row's σ, so SUMM of MXWT and CONS 10 with a target of 560 nm scores as
 *      MXWT with a target of 550 nm. A row reading only constants keeps 1.
 *   6. A CONS row reads no wavelength, angle or polarization, and the table,
 *      the report and the wavelength span show it none. A new row starts at 0.
 *
 * Run: node tests/cons_operand.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const {
    makeOperand, calcMF, calcOMF, mfWeightDenominator, operandContributions, residualScaleIn,
    evaluateOperands, buildEvalContext, DLSOptimizer, mathTargetInPercent, polFromType, isFractionalUnit,
    operandSampleLambdas, operandWavelengthSpan, targetDomain,
} = await import('../src/utils/physics/optimizer.js');
const { operandSpectrumReads } = await import('../src/utils/physics/optimizer/evalCore/operands/index.js');
const { addCurvature } = await import('../src/utils/physics/optimizer/newtonAssembly/curvature.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { merit, setMerit } = await import('../src/api/merit.js');
const { openDesign, saveDesign } = await import('../src/api/designs.js');
const MFE = '../src/components/windows/optimization/meritFunctionEditor';
const { addOperands, editOperand, makeRowOperand, retypeOperand } = await import(`${MFE}/meritOperandModel.js`);
const { reIdOperands } = await import(`${MFE}/presetOperands.js`);
const {
    dynamicHeaderLabels, editableColsForRow, fmtCurrent, fmtTargetDisplay, residualTooltip, rowDisplayMeta, typeRgba,
} = await import(`${MFE}/mfTable/operandViewModel.js`);
const { rowRenderers } = await import(`${MFE}/mfTable/OperandCells.js`);
const { targetInitialValue } = await import(`${MFE}/mfTable/editModel.js`);
const { parseOperandsTsv, serializeOperandsTsv } = await import(`${MFE}/mfTable/operandClipboard.js`);
const { meritOperandsSummary } = await import('../src/utils/report/reportData/sectionData.js');
const { buildMerit } = await import('../src/utils/report/sections/otherSections.js');
const { DASH } = await import('../src/utils/report/sections/format.js');
const { countsOptically, targetPoints } = await import('../src/utils/synthesis/deepSynthesis/points.js');
const { getLocale } = await import('../src/constants/locales/index.js');

const resolveMat = id => getMaterial(id);
// The dash a merit table cell shows for a column the row does not carry.
const TABLE_DASH = String.fromCharCode(0x2014);
const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

// A low-finesse Fabry-Perot of TiO2 and SiO2 on BK7, resonant near 550 nm.
const H = ['TiO2', 57], L = ['SiO2', 94];
const rep = (n, pair) => Array.from({ length: n }, () => pair).flat();
const stack = [...rep(2, [H, L]), H, ['SiO2', 188], H, ...rep(2, [L, H])];
const design = {
    name: 'Fabry-Perot', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: stack.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};
const ctx = buildEvalContext(design, resolveMat);
const engineFor = rows => new DLSOptimizer(rows, structuredClone(design), resolveMat, {});
const freeAll = engine => engine.thicknesses.map((_, k) => k);

const band = (weight, target = 0.9) => makeOperand({ type: 'TAV', lambdaStart: 480, lambdaEnd: 620, target, weight });
const peak = (target = 0, weight = 0) => makeOperand({ type: 'MXWT', lambdaStart: 500, lambdaEnd: 600, target, weight });
const constant = (target, weight = 1) => makeOperand({ type: 'CONS', target, weight });
const pair = (type, a, b, target, weight = 1) => makeOperand({ type, refId1: a.id, refId2: b.id, target, weight });
const single = (type, ref, target, weight = 1) => makeOperand({ type, refId: ref.id, target, weight });

// ── 1. PROD of TAV and CONS 2, its slope, and the Newton system ──────────────
{
    const tav = band(0), two = constant(2);
    const rows = [tav, two, pair('PROD', tav, two, 0)];
    const values = evaluateOperands(rows, ctx);
    assert.equal(values[1], 2, 'a CONS row reads its target');
    assert.equal(values[2], 2 * values[0], 'PROD of TAV and CONS 2 reads twice the TAV');

    const engine = engineFor(rows);
    const thk = engine.thicknesses.slice();
    const J = engine._analyticJacobian(thk, freeAll(engine));
    assert.ok(J, 'the Jacobian stays analytic with a CONS row in the merit');
    assert.equal(J.length, engine._residuals(thk).length, 'one Jacobian row per residual');
    assert.ok(J[1].every(v => v === 0), 'the CONS row has no slope');
    const lone = engineFor([band(1)]);
    const [tavSlopes] = lone._analyticJacobian(thk, freeAll(lone));
    assert.ok(tavSlopes.some(v => v !== 0), 'the TAV row moves with the layers');
    tavSlopes.forEach((slope, k) => near(J[2][k], 2 * slope, `PROD row, layer ${k + 1}: twice the TAV slope`));

    const t = makeOperand({ type: 'T', lambdaStart: 550, lambdaEnd: 550, target: 0.5, weight: 1 });
    const withConstant = engineFor([constant(3, 3), t]);
    const without = engineFor([t]);
    assert.ok(withConstant._fullNewtonSupported('front_only', false), 'a CONS row keeps the full Newton system');
    assert.deepEqual(withConstant._newtonSystem(thk, freeAll(withConstant)), without._newtonSystem(thk, freeAll(without)),
        'and adds nothing to it');
    // Its residual is always 0, so the curvature it would add is 0 too; the
    // Newton step does not sample the stack for it at all.
    const curvature = [[0]];
    addCurvature(curvature, [constant(2)], [2], { r0: [0], nFree: 1, at: () => assert.fail('a CONS row was sampled') });
    assert.deepEqual(curvature, [[0]], 'a CONS row has no curvature');
}

// ── 2. Nothing added to the merit at any weight ──────────────────────────────
{
    const tav = band(1);
    const [tavValue] = evaluateOperands([tav], ctx);
    const alone = { mf: calcMF([tav], [tavValue]), omf: calcOMF([tav], [tavValue]), w: mfWeightDenominator([tav], [tavValue]) };
    assert.ok(alone.mf > 0, 'the TAV row misses its target');
    for (const weight of [0, 1, 5, -1, NaN]) {
        // Set after makeOperand, which replaces a weight the merit cannot take with 1.
        const rows = [tav, { ...constant(7), weight }];
        const values = [tavValue, 7];
        assert.equal(calcMF(rows, values), alone.mf, `weight ${weight}: MF`);
        assert.equal(calcOMF(rows, values), alone.omf, `weight ${weight}: OMF`);
        assert.equal(mfWeightDenominator(rows, values), alone.w, `weight ${weight}: weight sum`);
        assert.deepEqual(operandContributions(rows, values), [1, null], `weight ${weight}: share of MF²`);
    }

    const rows = [tav, constant(7, 5)];
    const engine = engineFor(rows);
    const thk = engine.thicknesses.slice();
    const residuals = engine._residuals(thk);
    assert.equal(residuals.length, 2, 'one residual per row');
    assert.equal(residuals[1], 0, 'the CONS row has no residual');
    const sumOfSquares = residuals.reduce((sum, r) => sum + r * r, 0);
    near(Math.sqrt(sumOfSquares / mfWeightDenominator(rows, evaluateOperands(rows, ctx))), engine.mfAt(thk),
        'the optimizer minimizes the merit it reports');
    near(engine.mfAt(thk), alone.mf, 'which is the merit without the CONS row');

    assert.equal(countsOptically(constant(1)), false, 'synthesis does not count a CONS row as an optical row');
    const pass = makeOperand({ type: 'T', lambdaStart: 550, lambdaEnd: 550, target: 1, weight: 1 });
    assert.equal(targetPoints({ operands: [pass, constant(1)], incident: 'Air', n: () => 1 }).allPassStop, true,
        'a CONS row leaves a merit of pass and stop points as it is');
}

// ── 3. Saved and loaded back ─────────────────────────────────────────────────
{
    const rows = [
        { id: 'band', type: 'TAV', lambdaStart: 480, lambdaEnd: 620, target: 0.9, weight: 0 },
        { id: 'two', type: 'CONS', target: 2 },
        { id: 'k', type: 'CONS', target: 0.99 },
        { id: 'doubled', type: 'PROD', refId1: 'band', refId2: 'two', target: 0.9, weight: 1 },
        { id: 'scaled', type: 'PROD', refId1: 'band', refId2: 'k', target: 0.9, weight: 1 },
    ];
    const file = path.join(os.tmpdir(), `cons-operand-${process.pid}.tfs`);
    fs.writeFileSync(file, JSON.stringify({ tfs_version: '1.2', ...design }, null, 2));
    try {
        const saved = setMerit(openDesign(file), rows);
        saveDesign(saved, file, { overwrite: true });
        const loaded = openDesign(file);
        assert.deepEqual(loaded.meritOperands, saved.meritOperands, 'the rows load back as they were saved');
        assert.deepEqual(loaded.meritOperands.filter(op => op.type === 'CONS').map(op => op.target), [2, 0.99],
            'a CONS of 0.99 keeps its value');
        const before = merit(saved), after = merit(loaded);
        assert.ok(before.total > 0, 'the PROD rows miss their targets');
        assert.equal(after.total, before.total, 'and score the same after a load');
        assert.deepEqual(after.rows.map(row => row.value), before.rows.map(row => row.value));
        assert.equal(after.rows[3].value, 2 * after.rows[0].value, 'PROD reads twice the TAV');

        // A saved merit function loaded into a design takes fresh ids.
        const fresh = reIdOperands(loaded.meritOperands);
        assert.deepEqual(fresh.map(op => op.target), loaded.meritOperands.map(op => op.target),
            'a merit function loaded into a design keeps its targets');
        assert.equal(fresh[3].refId2, fresh[1].id, 'and the rows its math rows read');
        assert.equal(fresh[4].refId2, fresh[2].id);
    } finally {
        fs.rmSync(file, { force: true });
    }
}

// ── 4. Percent ───────────────────────────────────────────────────────────────
{
    const tav = band(0), mxwt = peak(), two = constant(2), ten = constant(10);
    const prod = pair('PROD', tav, two, 0.9);
    const rows = [tav, mxwt, two, ten, prod];
    const byId = new Map(rows.map(op => [op.id, op]));
    assert.equal(mathTargetInPercent(prod, byId), true, 'PROD of TAV and CONS is in percent, as the TAV is');
    assert.equal(mathTargetInPercent(pair('SUMM', two, tav, 0), byId), true, 'with the CONS read first too');
    assert.equal(mathTargetInPercent(pair('PROD', mxwt, two, 0), byId), false, 'PROD of MXWT and CONS is in nm');
    assert.equal(mathTargetInPercent(pair('SUMM', two, ten, 0), byId), false, 'SUMM of two constants is a plain number');
    assert.equal(mathTargetInPercent(single('OPVA', two, 0), byId), false, 'OPVA of a constant is a plain number');
    assert.equal(mathTargetInPercent(two, byId), false, 'a CONS row is a plain number');

    assert.equal(fmtTargetDisplay(prod, rowDisplayMeta(prod, 0.6, true)), '90.00', 'a PROD target of 0.9 shows as 90.00');
    assert.equal(editOperand(rows, prod.id, 'target', '90').at(-1).target, 0.9, 'a target typed as 90 is stored as 0.9');
    assert.equal(editOperand(rows, two.id, 'target', '2.5')[2].target, 2.5, 'a CONS target is stored as typed');

    const meta = rowDisplayMeta(two, 2, false);
    assert.equal(fmtTargetDisplay(two, meta), '2.000', 'a CONS target shows as a plain number');
    assert.equal(fmtCurrent(2, meta), '2.000', 'and so does its value');
    assert.equal(residualTooltip(meta), null, 'it has no miss to show');
    assert.equal(targetInitialValue(two, false), '2', 'the cell editor starts from the number');
    assert.equal(isFractionalUnit('CONS'), false);

    const [pasted] = addOperands([], parseOperandsTsv(serializeOperandsTsv([two], new Set([two.id]))), 0).operands;
    assert.deepEqual([pasted.type, pasted.target], ['CONS', 2], 'a copied CONS row pastes as itself');
}

// ── 5. σ ─────────────────────────────────────────────────────────────────────
{
    const mxwt = peak(), ten = constant(10), two = constant(2);
    const scaleOf = rows => residualScaleIn(rows)(rows.at(-1));
    for (const type of ['DIFF', 'SUMM', 'PROD']) {
        assert.equal(scaleOf([mxwt, ten, pair(type, mxwt, ten, 0)]), 500, `${type} of MXWT and CONS: 500 nm`);
        assert.equal(scaleOf([mxwt, ten, pair(type, ten, mxwt, 0)]), 500, `${type} of CONS and MXWT: 500 nm`);
        assert.equal(scaleOf([ten, two, pair(type, ten, two, 0)]), 1, `${type} of two constants: 1`);
    }
    const sum = pair('SUMM', mxwt, ten, 0);
    assert.equal(scaleOf([mxwt, ten, sum, single('OPGT', sum, 0)]), 500, 'OPGT on that SUMM: 500 nm');
    assert.equal(scaleOf([ten, single('OPVA', ten, 0)]), 1, 'OPVA of a constant: 1');
    assert.equal(scaleOf([ten]), 1, 'a CONS row itself: 1');

    const offset = [peak(), constant(10)];
    offset.push(pair('SUMM', offset[0], offset[1], 560));
    const direct = [peak(550, 1)];
    const reference = calcMF(direct, evaluateOperands(direct, ctx));
    assert.ok(reference > 0, 'the MXWT row misses 550 nm');
    near(calcMF(offset, evaluateOperands(offset, ctx)), reference,
        'SUMM of MXWT and CONS 10 with a target of 560 nm scores as MXWT with a target of 550 nm');
}

// ── 6. No wavelength, angle or polarization ──────────────────────────────────
{
    const two = constant(2), tav = band(1);
    assert.equal(polFromType('CONS'), null, 'the S that ends CONS is not s-polarization');
    assert.deepEqual(operandSampleLambdas(two), [], 'a CONS row samples no wavelength');
    assert.equal(operandWavelengthSpan([two]), null, 'and spans none');
    assert.deepEqual(operandWavelengthSpan([tav, two]), operandWavelengthSpan([tav]), 'nor widens the span of other rows');
    assert.equal(operandSpectrumReads(two), null, 'it reads no spectrum');
    assert.equal(targetDomain('CONS'), 'raw');

    assert.equal(makeRowOperand({ type: 'CONS' }).target, 0, 'a new CONS row starts at 0');
    assert.equal(retypeOperand(tav, 'CONS').target, 0, 'and so does a row retyped to CONS');
    assert.equal(makeOperand({ type: 'CONS', target: 0.99 }).target, 0.99, 'a CONS row given 0.99 keeps it');

    const en = getLocale('en');
    assert.equal(typeRgba('CONS', 0.2), typeRgba('PROD', 0.2), 'a CONS row is tinted as the math rows are');
    assert.deepEqual(editableColsForRow(two), ['enabled', 'type', 'target'], 'only Type and Target can be changed');
    const header = dynamicHeaderLabels(two, en.meritFunctionEditor.cols);
    assert.deepEqual([header.lambdaStart, header.lambdaEnd, header.flag], [TABLE_DASH, TABLE_DASH, TABLE_DASH]);
    const meta = rowDisplayMeta(two, 2, false);
    const renderers = rowRenderers(two, meta);
    const cell = {
        op: two, meta, rowIdx: 0, c: { text: '#000', textDim: '#888' }, tdBase: () => ({}),
        startEdit() {}, cellDown() {}, cellEnter() {},
    };
    for (const colKey of ['lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'flag', 'weight']) {
        assert.equal(renderers[colKey](cell, colKey, 40).props.children, TABLE_DASH, `its ${colKey} cell is a dash`);
    }
    assert.equal(renderers.target(cell, 'target', 60).props.children, '2.000', 'its Target cell shows the number');

    const html = buildMerit({
        block: { id: 'blk', type: 'merit' }, tr: en.report,
        data: { blocks: { blk: meritOperandsSummary({ meritOperands: [{ ...two, weight: 3 }] }) } },
    });
    const cells = html.split('<tr>').slice(1)
        .map(chunk => [...chunk.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1]))
        .filter(row => row.length);
    assert.deepEqual(cells, [['1', 'CONS', DASH, DASH, DASH, '2.0000', DASH]],
        'the report shows a CONS row with its type and target only');

    for (const code of ['en', 'ru', 'zh', 'it']) {
        assert.equal(getLocale(code).meritFunctionEditor.operandTypes.CONS?.group, 'math', `${code}: CONS is in the Math group`);
    }
}

console.log('cons_operand: passed');
