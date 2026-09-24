/**
 * Where a material fit ends, what a material with no usable data does, and how
 * the linear dispersion fits are solved.
 *
 * A tabulated material with an active fit reads the fit inside the fit range
 * and the table outside it, so n steps at each end by the fit's residual there.
 * Both ends belong in the material's knot list, or a GD or GDD curve draws
 * straight through the step and nothing says it is there.
 *
 * A formula number with no evaluator, or a table with no finite row, gives no
 * n at all: such a material does not resolve, and the missing-materials notice
 * names it. An AGF glass whose formula number is 0, unparsable or past the
 * Zemax set is named by the import and left out, not read as some other
 * formula.
 *
 * The linear fits solve by QR rather than through JᵀJ, whose condition number
 * for a six-term Cauchy over 400 to 800 nm is 9e11, and report a covariance.
 *
 * Run: node tests/material_fit_edge_and_placeholders.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { solveLeastSquaresQR } from '../src/utils/math/qrLeastSquares.js';
import {
    dispersionFitCodec, dispersionFitParameters, evaluateFitComponent, fitTabulatedMaterial,
} from '../src/utils/materials/dispersionFits.js';
import {
    evalN, isSupportedFormula, isZemaxFormula,
} from '../src/utils/materials/dispersionFormulas.js';
import {
    dispersionFitEdges, materialKnotWavelengths, materialOmegaResponse, materialPropagationDispersion,
} from '../src/utils/materials/materialDispersion.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { createTabulatedNKSampler } from '../src/utils/materials/pchip.js';
import { parseAGF } from '../src/utils/materials/agfParser.js';
import { getMaterialById, initCatalogs } from '../src/utils/materials/catalogManager.js';
import {
    designMaterialLookup, embedDesignMaterials, resolveDesignMaterial,
    UnresolvedDesignMaterialError, unresolvedMaterials,
} from '../src/utils/materials/designMaterials.js';
import { knotGrid, knotSteps, sampleKnots } from '../src/components/windows/analysis/knots.js';

shimBrowserGlobals();
await loadApp();
const { materialToDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const { rejectedGlassList } = await import('../src/components/windows/design/materialEditor/materialEditorActions.js');

const close = (actual, expected, tolerance, message) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected}, tolerance ${tolerance}`);

// Gaussian elimination with partial pivoting, the reference the normal
// equations are solved with here.
function gaussianElimination(matrix, rhs) {
    const rows = matrix.map((row, index) => [...row, rhs[index]]);
    const size = rhs.length;
    for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++) {
            if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        }
        [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
        for (let row = column + 1; row < size; row++) {
            const factor = rows[row][column] / rows[column][column];
            for (let item = column; item <= size; item++) rows[row][item] -= factor * rows[column][item];
        }
    }
    const solution = Array(size).fill(0);
    for (let row = size - 1; row >= 0; row--) {
        let sum = rows[row][size];
        for (let item = row + 1; item < size; item++) sum -= rows[row][item] * solution[item];
        solution[row] = sum / rows[row][row];
    }
    return solution;
}

// A deterministic normal deviate, so every run sees the same noise.
function gaussianSource(seed) {
    let state = seed >>> 0;
    const uniform = () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return () => Math.sqrt(-2 * Math.log(uniform() || 1e-300)) * Math.cos(2 * Math.PI * uniform());
}

// ── A fit narrower than its table: the ends are knots ────────────────────────

// A dielectric table from 300 to 1000 nm with a small ripple a Cauchy cannot
// follow, so the fit leaves a residual and the material steps where it ends.
const table = [];
for (let nm = 300; nm <= 1000; nm += 10) table.push([nm, 2 + 30000 / nm ** 2 + 0.002 * Math.sin(nm / 37), 0]);
const FIT_RANGE = [405, 795];
const narrowFit = fitTabulatedMaterial(table, { nModel: 'cauchy', rangeNm: FIT_RANGE });
const record = { id: 'ripple', name: 'Rippled oxide', formulaNum: -1, tabData: table, dispersionFit: narrowFit };
const material = { ...record, getNK: makeGetNK(record) };
const tableOnly = createTabulatedNKSampler(table);

const knots = materialKnotWavelengths(material);
assert.ok(knots.includes(405) && knots.includes(795), `both ends of the fit are knots: ${knots.join(', ')}`);
assert.ok(!knots.some(knot => knot > 405 && knot < 795), 'and no table knot inside the fit is');
assert.ok(knots.includes(400) && knots.includes(800), 'while the table knots outside it still are');

const edges = dispersionFitEdges(material);
assert.deepEqual(edges.map(edge => edge.wavelengthNm), FIT_RANGE, 'the step is reported at each end');
for (const edge of edges) {
    close(edge.dn, material.getNK(edge.wavelengthNm)[0] - tableOnly(edge.wavelengthNm)[0], 0,
        `the step at ${edge.wavelengthNm} nm is the fit minus the table`);
}
assert.ok(Math.abs(edges[0].dn) > 1e-4, `the step is real, ${edges[0].dn}`);

// At an end the fit is read by default, as getNK reads it, and each side asked
// for gives its own model: the table below the lower end and above the upper.
const at = (nm, side) => materialOmegaResponse(material, nm, side);
close(at(405).nk[0], material.getNK(405)[0], 1e-12, 'the lower end reads the fit by default');
close(at(405, 'left').nk[0], tableOnly(405)[0], 1e-12, 'the side below it reads the table');
close(at(405, 'right').nk[0], material.getNK(405)[0], 1e-12, 'the side above it reads the fit');
close(at(795, 'left').nk[0], material.getNK(795)[0], 1e-12, 'below the upper end is the fit');
close(at(795, 'right').nk[0], tableOnly(795)[0], 1e-12, 'above it the table');
assert.equal(at(405).onKnot, true, 'an end is reported as a knot');
assert.equal(at(405).continuousOrder, -1, 'where the value itself is discontinuous');
assert.equal(at(600).onKnot, false, 'inside the fit there is no knot');
assert.equal(at(600).continuousOrder, 3, 'and the fit is smooth to every order');

// Material Dispersion draws the jump as a step, which it only does at a knot it
// samples and for an order above the continuity the spectrum reports.
{
    const slab = (nm, side) => materialPropagationDispersion(material, nm, 1, side);
    const grid = knotGrid(Array.from({ length: 601 }, (_, index) => 350 + index), knots, 350, 950);
    const values = grid.wavelengths.map(nm => slab(nm));
    const continuousOrder = Math.min(...values.map(value => value.phaseContinuousOrder));
    assert.equal(continuousOrder, -1, 'the spectrum says its value jumps');
    const samples = sampleKnots(grid.wavelengths, grid.knots, slab);
    const lower = samples.find(sample => sample.wavelengthNm === 405);
    const gdSteps = knotSteps(samples, 'gd', { order: 1, continuousOrder });
    const [below, above] = gdSteps.get(lower.index);
    assert.ok(Math.abs(above - below) > 0.1, `GD steps at the lower end of the fit: ${below} to ${above} fs`);
}

// A fit over the whole table ends where the table does. The material's data
// ends there anyway, as it does at a table's own end rows, so no knot is added.
{
    const whole = fitTabulatedMaterial(table, { nModel: 'cauchy', rangeNm: [300, 1000] });
    const wholeRecord = { ...record, dispersionFit: whole };
    const wholeMaterial = { ...wholeRecord, getNK: makeGetNK(wholeRecord) };
    assert.deepEqual(dispersionFitEdges(wholeMaterial), [], 'a fit over the whole table has no inner end');
    assert.ok(!materialKnotWavelengths(wholeMaterial).includes(300), 'and adds no knot at the table end');
}

// The Material Editor names the two steps under the fit.
{
    const me = makeLocale().materialEditor;
    const html = renderToStaticMarkup(React.createElement(UserMaterialForm, {
        draft: materialToDraft('user_lab', record),
        onChange() {}, onSave() {}, onRevert() {}, onDelete() {},
        dirty: false, catalogs: [], workingNm: [400, 800], c: makeTheme(), t: makeLocale(),
    }));
    const expected = me.fitEdgeSteps(`405 nm: Δn ${edges[0].dn.toExponential(2)}; 795 nm: Δn ${edges[1].dn.toExponential(2)}`);
    assert.ok(html.includes(expected), `the editor states the steps: ${expected}`);
    assert.ok(html.includes(' ± '), 'and the Cauchy coefficients carry their standard errors');
}

// ── No stand-in index for a material with no usable data ─────────────────────

assert.ok(Number.isNaN(evalN(14, [1, 0.1, 0.01], 0.55)), 'formula 14 has no value, not n = 1.5');
assert.ok(Number.isNaN(evalN(0, [1], 0.55)), 'nor has formula 0');
assert.equal(isSupportedFormula(14), false);
assert.equal(isSupportedFormula(102), true, 'the open-ended Cauchy series is evaluated');
assert.equal(isZemaxFormula(102), false, 'but is not an AGF formula');
assert.equal(isZemaxFormula(13), true);

assert.equal(makeGetNK({ formulaNum: 14, coefficients: [1, 0.1, 0.01], kTable: [] }), null,
    'a formula material with no evaluator has no n,k function');
assert.equal(makeGetNK({ formulaNum: -1, tabData: [] }), null, 'nor has an empty table');
assert.equal(makeGetNK({ formulaNum: -1, tabData: [[500, NaN, 0], [600, 'n/a', 0]] }), null,
    'nor a table with no finite row');

const BAD_CATALOG = {
    id: 'user_bad', name: 'Unusable', source: 'user',
    materials: {
        F14: { id: 'F14', name: 'Formula 14 glass', formulaNum: 14, coefficients: [1, 0.1, 0.01], kTable: [] },
        EMPTY: { id: 'EMPTY', name: 'Empty table', formulaNum: -1, tabData: [] },
        GOOD: { id: 'GOOD', name: 'Two rows', formulaNum: -1, tabData: [[400, 1.5, 0], [700, 1.48, 0]] },
    },
};
initCatalogs({ user_bad: BAD_CATALOG });
assert.equal(getMaterialById('user_bad:F14'), null, 'a catalog entry with no evaluator does not resolve');
assert.equal(getMaterialById('user_bad:EMPTY'), null, 'nor does an empty table');
assert.ok(getMaterialById('user_bad:GOOD'), 'a usable neighbour still does');

const design = {
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'a', material: 'user_bad:F14', thickness: 100 },
        { id: 'b', material: 'user_bad:EMPTY', thickness: 100 },
        { id: 'c', material: 'user_bad:GOOD', thickness: 100 },
    ],
    backLayers: [],
};
assert.deepEqual(unresolvedMaterials(design), ['user_bad:F14', 'user_bad:EMPTY'],
    'the missing-materials notice names both');
assert.throws(() => designMaterialLookup(design)('user_bad:F14'),
    error => error instanceof UnresolvedDesignMaterialError && error.materialId === 'user_bad:F14',
    'and a calculation refuses it instead of computing n = 1.5');

// A definition a design carries is judged the same way, and is not traded for a
// catalog entry of the same id, which would be some other material.
{
    const carried = {
        ...design,
        frontLayers: [{ id: 'a', material: 'user_bad:GOOD', thickness: 100 }],
        materials: { 'user_bad:GOOD': BAD_CATALOG.materials.F14 },
    };
    assert.equal(resolveDesignMaterial(carried, 'user_bad:GOOD').status, 'missing',
        'an embedded definition with no evaluator is missing');
    assert.deepEqual(embedDesignMaterials(carried).materials['user_bad:GOOD'], BAD_CATALOG.materials.F14,
        'and saving the design keeps it as the author wrote it');
}

// ── AGF: a formula number that is not a Zemax formula is an import error ─────

const agf = parseAGF([
    'NM GOOD 2 0 1.5168 64.17 0 0 0',
    'CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 103.560653',
    'NM F14 14 0 1.5 60 0 0 0',
    'CD 1 0.1 0.01',
    'NM F0 0 0 1.5 60 0 0 0',
    'CD 2.3 0 0.01',
    'NM FX abc 0 1.5 60 0 0 0',
    'CD 2.3 0 0.01',
    'NM FNONE',
].join('\n'), 'test');
assert.deepEqual(Object.keys(agf.materials), ['GOOD'], 'only the glass with a Zemax formula is imported');
assert.deepEqual(agf.rejected, [
    { name: 'F14', formula: '14' },
    { name: 'F0', formula: '0' },
    { name: 'FX', formula: 'abc' },
    { name: 'FNONE', formula: '' },
], 'the others are reported with the number as the file writes it');
assert.ok(!('formulaToken' in agf.materials.GOOD), 'the imported record carries nothing the parser used');
close(evalN(agf.materials.GOOD.formulaNum, agf.materials.GOOD.coefficients, 0.5875618), 1.5168, 5e-5,
    'N-BK7 still computes its catalog nd');
assert.equal(rejectedGlassList(agf.rejected), 'F14 (14), F0 (0), FX (abc), FNONE (?)',
    'the import message lists them');

// ── Linear fits by QR ─────────────────────────────────────────────────────────

// Wampler 1 of the NIST Statistical Reference Datasets: y = 1 + x + ... + x⁵ at
// x = 0 to 20, every certified coefficient exactly 1.
{
    const matrix = [];
    const rhs = [];
    for (let x = 0; x <= 20; x++) {
        matrix.push([1, x, x ** 2, x ** 3, x ** 4, x ** 5]);
        rhs.push(1 + x + x ** 2 + x ** 3 + x ** 4 + x ** 5);
    }
    const { solution } = solveLeastSquaresQR(matrix, rhs);
    solution.forEach((value, index) => close(value, 1, 1e-8, `Wampler 1 coefficient ${index}`));
}

// A straight line, whose covariance has a closed form: var(slope) = s²/Sxx,
// var(intercept) = s²(1/m + x̄²/Sxx), cov = −x̄ s²/Sxx.
{
    const xs = [0.1, 0.5, 0.9, 1.3, 2.2, 3.1, 3.5, 4.8];
    const ys = [1.1, 1.9, 2.8, 3.7, 5.2, 7.3, 7.9, 10.9];
    const { solution, covariance } = solveLeastSquaresQR(xs.map(x => [1, x]), ys);
    const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const sxx = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0);
    const slope = xs.reduce((sum, x, index) => sum + (x - mean) * ys[index], 0) / sxx;
    const intercept = ys.reduce((sum, y) => sum + y, 0) / ys.length - slope * mean;
    const variance = xs.reduce((sum, x, index) => sum + (ys[index] - intercept - slope * x) ** 2, 0) / (xs.length - 2);
    close(solution[1], slope, 1e-13, 'slope');
    close(covariance[1][1], variance / sxx, 1e-15, 'variance of the slope');
    close(covariance[0][0], variance * (1 / xs.length + mean ** 2 / sxx), 1e-15, 'variance of the intercept');
    close(covariance[0][1], -mean * variance / sxx, 1e-15, 'their covariance');
}
assert.equal(solveLeastSquaresQR([[1, 2], [2, 4], [3, 6]], [1, 2, 3]), null, 'dependent columns do not solve');
assert.equal(solveLeastSquaresQR([[1, 2]], [1]), null, 'nor do fewer rows than parameters');

// A six-term Cauchy over 400 to 800 nm with noise of 1e-4 in n.
const TRUE_CAUCHY = [2.05, 0.018, 0.0021, -0.00012, 0.00001, 0];
const NOISE = 1e-4;
const trueIndex = nm => TRUE_CAUCHY.reduce((sum, value, order) => sum + value * (nm / 1000) ** (-2 * order), 0);
const noisyRows = (gaussian) => {
    const rows = [];
    for (let nm = 400; nm <= 800; nm += 2) rows.push([nm, trueIndex(nm) + NOISE * gaussian(), 0]);
    return rows;
};
const rows = noisyRows(gaussianSource(12345));
const sixTerm = fitTabulatedMaterial(rows, { nModel: 'cauchy', nTerms: 6 });
const { covariance } = sixTerm.n;
assert.ok(Array.isArray(covariance) && covariance.length === 6, 'the fit returns a covariance');
covariance.forEach((row, i) => row.forEach((value, j) => {
    assert.ok(Number.isFinite(value), `covariance entry ${i},${j} is finite`);
    close(value, covariance[j][i], 1e-12 * Math.sqrt(covariance[i][i] * covariance[j][j]), 'and symmetric');
    if (i !== j) assert.ok(Math.abs(value) <= Math.sqrt(covariance[i][i] * covariance[j][j]), '|ρ| ≤ 1');
}));
assert.ok(covariance.every((row, i) => row[i] > 0), 'every coefficient has a positive variance');

// The same curve the normal equations gave: the directions they lose digits in
// are the ones that cancel in n(λ).
{
    const design6 = rows.map(row => Array.from({ length: 6 }, (_, order) => (row[0] / 1000) ** (-2 * order)));
    const normal = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 },
        (_, j) => design6.reduce((sum, features) => sum + features[i] * features[j], 0)));
    const rhs = Array.from({ length: 6 }, (_, i) => design6.reduce((sum, features, index) => sum + features[i] * rows[index][1], 0));
    const viaNormal = { kind: 'cauchy', coefficients: gaussianElimination(normal, rhs) };
    let largest = 0;
    for (let nm = 400; nm <= 800; nm += 0.5) {
        largest = Math.max(largest, Math.abs(evaluateFitComponent(sixTerm.n, nm) - evaluateFitComponent(viaNormal, nm)));
    }
    assert.ok(largest < 1e-9, `the fitted curve agrees with the normal-equation one to ${largest}`);
    assert.ok(sixTerm.residuals.n.rms < 1.1 * NOISE, 'and leaves the noise, not more');
}

// The covariance predicts the spread of the coefficients over repeated noise:
// the mean predicted variance of each coefficient against the variance seen.
{
    const trials = 400;
    const gaussian = gaussianSource(2026);
    const coefficients = [];
    const predicted = Array(6).fill(0);
    for (let trial = 0; trial < trials; trial++) {
        const fit = fitTabulatedMaterial(noisyRows(gaussian), { nModel: 'cauchy', nTerms: 6 }).n;
        coefficients.push(fit.coefficients);
        fit.covariance.forEach((row, index) => { predicted[index] += row[index] / trials; });
    }
    for (let index = 0; index < 6; index++) {
        const mean = coefficients.reduce((sum, values) => sum + values[index], 0) / trials;
        const seen = coefficients.reduce((sum, values) => sum + (values[index] - mean) ** 2, 0) / (trials - 1);
        const ratio = seen / predicted[index];
        assert.ok(ratio > 0.8 && ratio < 1.25,
            `coefficient ${index}: variance seen over ${trials} noise draws is ${ratio.toFixed(3)} of the one predicted`);
    }
}

// The editor lists each coefficient with its standard error, and a fit moved
// against a measured spectrum does not carry the table fit's covariance.
{
    const shown = dispersionFitParameters(sixTerm).parameters;
    shown.slice(0, 6).forEach((parameter, index) => close(parameter.standardError,
        Math.sqrt(covariance[index][index]), 0, `standard error of ${parameter.label}`));
    const codec = dispersionFitCodec(sixTerm);
    const moved = codec.decode(codec.encode().map(value => value * 1.01));
    assert.ok(!('covariance' in moved.n), 'moved coefficients are not described by the old covariance');
    assert.ok(dispersionFitParameters(moved).parameters.every(parameter => parameter.standardError === undefined));
}

console.log('PASS: material_fit_edge_and_placeholders');
