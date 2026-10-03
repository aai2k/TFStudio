/**
 * The curve editor's model: units, pasted and imported text, the spreadsheet
 * operations, undo, Apply, resampling, smoothing, what the tool panels say,
 * and the merit blocks rebuilt from an edited curve.
 * Run: node tests/curve_editor_model.mjs
 */
import assert from 'node:assert/strict';
import {
    fromStored, toStored, unitsFor, valueProblem, xProblem,
} from '../src/components/windows/dataExchange/curveEditor/units.js';
import {
    addColumn, clearCells, deleteRows, emptyTable, insertRows, setCells, tableFromCurve, tableFromWeights,
} from '../src/components/windows/dataExchange/curveEditor/curveTable.js';
import {
    pasteIntoTable, readPastedText, tableCsv, tableFromText,
} from '../src/components/windows/dataExchange/curveEditor/tableText.js';
import { changeCells, fillCells, fillProblem } from '../src/components/windows/dataExchange/curveEditor/cellOps.js';
import { resamplePlan, resampleTable, smoothCells } from '../src/components/windows/dataExchange/curveEditor/curveOps.js';
import {
    applyProblem, curvesFromTable, editedCurve, pointsFromTable,
} from '../src/components/windows/dataExchange/curveEditor/curveApply.js';
import {
    blockFitOptions, curveBlocks, rebuiltMeritOperands,
} from '../src/components/windows/dataExchange/curveEditor/meritRebuild.js';
import { commitTable, redoTable, startHistory, undoTable } from '../src/components/windows/dataExchange/curveEditor/history.js';
import {
    savitzkyGolayProblem, savitzkyGolayWeights, smoothSavitzkyGolay,
} from '../src/utils/math/savitzkyGolay.js';
import { makeMeasuredCurve, parseSpectrumTable } from '../src/utils/io/spectrumTable.js';
import { fractionFromLog, logValue } from '../src/utils/physics/optimizer.js';
import { measuredFitSnapshot } from '../src/components/windows/dataExchange/spectrumExchange/model.js';
import { ellipsometryFitSnapshot } from '../src/components/windows/dataExchange/measuredEllipsometry/fitModel.js';
import { editorLabels } from '../src/components/windows/dataExchange/curveEditor/editorLabels.js';
import {
    changeText, fillText, resampleText, seriesText, smoothText,
} from '../src/components/windows/dataExchange/curveEditor/toolText.js';
import en from '../src/constants/locales/en.js';
import ru from '../src/constants/locales/ru.js';
import zh from '../src/constants/locales/zh.js';
import it from '../src/constants/locales/it.js';

const close = (a, b, tolerance = 1e-12) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
const cell = (rowIdx, colKey) => ({ rowIdx, colKey });
const column = (table, index) => table.rows.map(row => row[index]);
const table = (rows, columns = [{ quantity: 'T', unit: '%', name: '' }], kind = 'spectrum') =>
    ({ kind, xUnit: 'nm', columns, rows, fixed: false });

// ── Units, both ways ─────────────────────────────────────────────────────────
{
    assert.deepEqual(unitsFor('T'), ['%', 'fraction', 'dB', 'OD'], 'T reads as optical density too');
    assert.deepEqual(unitsFor('R'), ['%', 'fraction', 'dB'], 'density is transmittance only');
    assert.deepEqual(unitsFor('PSI'), ['deg']);
    assert.deepEqual(unitsFor('W'), ['rel']);

    assert.equal(toStored(45, '%'), 0.45);
    assert.equal(fromStored(0.45, '%'), 45);
    assert.equal(toStored(0.45, 'fraction'), 0.45);
    // dB = 10·log10 C and OD = -log10 T, the merit function's own readings.
    assert.ok(close(toStored(-3, 'dB'), 10 ** -0.3));
    assert.equal(toStored(-3, 'dB'), fractionFromLog('dB', -3));
    assert.ok(close(fromStored(0.5, 'dB'), 10 * Math.log10(0.5)));
    assert.equal(fromStored(0.5, 'dB'), logValue('dB', 0.5));
    assert.ok(close(toStored(2, 'OD'), 0.01));
    assert.ok(close(fromStored(0.01, 'OD'), 2));
    for (const unit of ['%', 'fraction', 'dB', 'OD', 'deg', 'rel']) {
        for (const stored of [0.001, 0.37, 0.999]) {
            assert.ok(close(toStored(fromStored(stored, unit), unit), stored), `${unit} round trip of ${stored}`);
        }
    }
    assert.ok(Number.isNaN(toStored(NaN, '%')), 'an empty cell stays empty');
}

// ── Values outside the physical range are marked ─────────────────────────────
{
    assert.equal(valueProblem('T', '%', 100.5), 'above');
    assert.equal(valueProblem('R', '%', -0.1), 'below');
    assert.equal(valueProblem('A', 'fraction', 1.01), 'above');
    assert.equal(valueProblem('T', 'dB', 0.2), 'above', 'above 0 dB is more light than came in');
    assert.equal(valueProblem('T', 'OD', -0.1), 'above', 'a negative density is a gain');
    assert.equal(valueProblem('T', '%', 100), null);
    assert.equal(valueProblem('T', 'dB', -40), null);
    assert.equal(valueProblem('PSI', 'deg', 91), 'psi');
    assert.equal(valueProblem('PSI', 'deg', -1), 'psi');
    assert.equal(valueProblem('PSI', 'deg', 45), null);
    assert.equal(valueProblem('DEL', 'deg', 400), null, 'Δ is an angle and has no range to leave');
    assert.equal(valueProblem('W', 'rel', -5), null);
    assert.equal(valueProblem('T', '%', NaN), null, 'an empty cell is not out of range');
    assert.equal(xProblem(0), 'x');
    assert.equal(xProblem(-400), 'x');
    assert.equal(xProblem(550), null);
}

// ── Pasted text is read by the importer's parser ─────────────────────────────
{
    const read = text => readPastedText(text).grid;
    assert.deepEqual(read('400\t0,5\n500\t0,7'), [[400, 0.5], [500, 0.7]], 'cells from Excel with a decimal comma');
    assert.deepEqual(read('400,5\t0,5\n500,5\t0,7'), [[400.5, 0.5], [500.5, 0.7]], 'a decimal comma in the wavelength too');
    assert.deepEqual(read('400;0,5\n500;0,7'), [[400, 0.5], [500, 0.7]], 'a semicolon CSV saved by the same Excel');
    assert.deepEqual(read('400 0.5\n500 0.7'), [[400, 0.5], [500, 0.7]], 'single spaces');
    assert.deepEqual(read('0,5'), [[0.5]], 'one value');
    assert.deepEqual(read('0,5\n0,7'), [[0.5], [0.7]], 'one column');
    const blank = read('400\t\t1\n500\t2\t3');
    assert.equal(blank[0][0], 400);
    assert.ok(Number.isNaN(blank[0][1]), 'a blank spreadsheet cell keeps its place');
    assert.deepEqual(blank[1], [500, 2, 3]);
    const headed = readPastedText('Wavelength (um)\tT (%)\n0,5\t45\n0,6\t46');
    assert.deepEqual(headed.grid, [[0.5, 45], [0.6, 46]], 'a header line is no row');
    assert.equal(headed.header.xUnit, 'um');
    assert.equal(headed.header.columns[0].isPercent, true);
}

// ── A paste fills a selection and grows the table ────────────────────────────
{
    const base = emptyTable('spectrum');
    assert.equal(base.rows.length, 10);
    // From one cell the block is laid down and right, and the table grows.
    const grid = Array.from({ length: 12 }, (_, i) => [400 + i * 10, 50 + i]);
    const pasted = pasteIntoTable(base, { grid, header: null }, { focus: cell(0, 'x'), range: null });
    assert.equal(pasted.rows.length, 12, 'rows added to hold the block');
    assert.deepEqual(pasted.rows[11], [510, 61]);
    // A wider block adds value columns to a new curve's table.
    const wide = pasteIntoTable(base, { grid: [[400, 1, 2, 3]], header: null }, { focus: cell(0, 'x'), range: null });
    assert.equal(wide.columns.length, 3);
    assert.deepEqual(wide.rows[0], [400, 1, 2, 3]);
    // A fixed table keeps its columns and drops what falls off.
    const fixed = pasteIntoTable({ ...base, fixed: true }, { grid: [[400, 1, 2]], header: null },
        { focus: cell(0, 'x'), range: null });
    assert.equal(fixed.columns.length, 1);
    assert.deepEqual(fixed.rows[0], [400, 1]);
    // One value fills a range; one row repeats down it.
    const range = { rowStart: 1, rowEnd: 3, colKeys: ['x', 'v0'] };
    const filled = pasteIntoTable(pasted, { grid: [[7, 8]], header: null }, { focus: cell(3, 'v0'), range });
    assert.deepEqual(filled.rows.slice(1, 4), [[7, 8], [7, 8], [7, 8]]);
    const single = pasteIntoTable(pasted, { grid: [[9]], header: null }, { focus: cell(3, 'v0'), range });
    assert.deepEqual(single.rows.slice(1, 4), [[9, 9], [9, 9], [9, 9]]);
    // Cells gathered with Ctrl take a single value each.
    const extraCells = new Set(['0:v0', '5:v0']);
    const gathered = pasteIntoTable(pasted, { grid: [[1]], header: null }, { focus: cell(5, 'v0'), range: null, extraCells });
    assert.equal(gathered.rows[0][1], 1);
    assert.equal(gathered.rows[5][1], 1);
    assert.equal(gathered.rows[1][1], 51, 'a cell not gathered is left alone');
    // A header names the units when the block starts at the wavelength.
    const headed = pasteIntoTable(base, readPastedText('Wavelength (um)\tR (%)\n0,5\t4\n0,6\t5'),
        { focus: cell(0, 'x'), range: null });
    assert.equal(headed.xUnit, 'um');
    assert.equal(headed.columns[0].quantity, 'R');
    assert.equal(headed.columns[0].unit, '%');
}

// ── A file reads as the importer reads it ────────────────────────────────────
{
    const text = 'Wavelength (nm),T (%),R (%)\n500,90.1,8.2\n400,88.3,9.4\n600,91.7,7.1\n';
    const { table: read } = tableFromText(text, emptyTable('spectrum'), 'scan.csv');
    assert.equal(read.columns.length, 2);
    assert.deepEqual(read.columns.map(c => [c.quantity, c.unit, c.name]),
        [['T', '%', 'scan: T (%)'], ['R', '%', 'scan: R (%)']]);
    // The importer, as Measured Spectra's import actions build a curve.
    const parsed = parseSpectrumTable(text);
    const imported = parsed.columns.map(col => makeMeasuredCurve({
        name: `scan: ${col.name}`, x: col.x || parsed.x, xUnit: parsed.xUnit, y: col.values,
        quantity: col.quantity, isPercent: col.isPercent, isAbsorbance: col.isAbsorbance,
        source: 'scan.csv', aoi: 0, pol: 'avg',
    }));
    const applied = curvesFromTable(read);
    const strip = curve => ({ ...curve, id: null });
    assert.deepEqual(applied.map(strip), imported.map(strip), 'Apply builds the curves the importer builds');
    assert.deepEqual(applied[0].x, [400, 500, 600], 'rows are sorted by wavelength on Apply');

    // A curve table in optical density and in µm is converted as on import.
    const odText = 'Wavelength (um),OD\n0.5,1\n0.6,2\n';
    const { table: od } = tableFromText(odText, emptyTable('spectrum'), 'filter.txt');
    assert.equal(od.xUnit, 'um');
    assert.deepEqual(od.columns.map(c => [c.quantity, c.unit]), [['T', 'OD']]);
    const odParsed = parseSpectrumTable(odText);
    const odImported = makeMeasuredCurve({
        name: 'filter', x: odParsed.x, xUnit: odParsed.xUnit, y: odParsed.columns[0].values,
        quantity: 'T', isPercent: false, isAbsorbance: true, source: 'filter.txt', aoi: 0, pol: 'avg',
    });
    assert.deepEqual(strip(curvesFromTable(od)[0]), strip(odImported));

    assert.deepEqual(tableFromText('no numbers here', emptyTable('spectrum')), { error: 'parse' });
}

// ── Integral Values weightings ───────────────────────────────────────────────
{
    const weights = [[400, 0.1], [500, 0.2]];
    assert.deepEqual(pointsFromTable(tableFromWeights(weights)), weights, 'a weighting opens and applies unchanged');
    const unsorted = tableFromText('lambda,weight\n600, 0.3\n400, 0.1\n500, 0.2\n', tableFromWeights([])).table;
    assert.deepEqual(pointsFromTable(unsorted), [[400, 0.1], [500, 0.2], [600, 0.3]], 'sorted on Apply');
    assert.equal(applyProblem(table([[400, 1]], [{ quantity: 'W', unit: 'rel', name: '' }], 'weight')), 'needTwoRows');
    const micrometres = { ...tableFromWeights(weights), xUnit: 'um', rows: [[0.6, 3], [0.4, 1]] };
    assert.deepEqual(pointsFromTable(micrometres), [[400, 1], [600, 3]], 'wavelengths converted to nm');
}

// ── Fill and change ──────────────────────────────────────────────────────────
{
    const rows = Array.from({ length: 5 }, () => [NaN, NaN]);
    const base = table(rows);
    const xs = rows.map((_, rowIdx) => cell(rowIdx, 'x'));
    assert.deepEqual(column(fillCells(base, xs, { mode: 'constant', a: 550 }), 0), [550, 550, 550, 550, 550]);
    assert.deepEqual(column(fillCells(base, xs, { mode: 'step', a: 400, b: 0.1 }), 0),
        [400, 400.1, 400.2, 400.3, 400.4], 'a uniform step, without binary rounding showing');
    const log = column(fillCells(base, xs, { mode: 'log', a: 1, b: 10000 }), 0);
    assert.deepEqual(log, [1, 10, 100, 1000, 10000], 'equal ratios from first to last');
    const wave = column(fillCells(base, xs, { mode: 'wavenumber', a: 400, b: 800 }), 0);
    assert.equal(wave[0], 400);
    assert.equal(wave[4], 800);
    const steps = wave.slice(1).map((value, i) => 1 / wave[i] - 1 / value);
    steps.forEach(step => assert.ok(close(step, steps[0], 1e-9)), 'equal steps in wavenumber');
    assert.equal(fillProblem({ mode: 'log', a: 0, b: 10 }), 'positive');
    assert.equal(fillProblem({ mode: 'wavenumber', a: -400, b: 800 }), 'positive');
    assert.equal(fillProblem({ mode: 'step', a: 1, b: NaN }), 'number');

    const values = table([[400, 10], [500, NaN], [600, 30]]);
    const cells = [0, 1, 2].map(rowIdx => cell(rowIdx, 'v0'));
    assert.deepEqual(column(changeCells(values, cells, { mode: 'percent', a: 10 }), 1).map(String),
        ['11', 'NaN', '33'], 'by a percentage; an empty cell stays empty');
    assert.deepEqual(column(changeCells(values, cells, { mode: 'linear', a: 2, b: -1 }), 1).map(String),
        ['19', 'NaN', '59'], "V' = a·V + b");
}

// ── Rows, columns and undo ───────────────────────────────────────────────────
{
    const base = table([[400, 1], [500, 2], [600, 3]]);
    assert.deepEqual(insertRows(base, 1, 2).rows.map(row => row[0]).map(String), ['400', 'NaN', 'NaN', '500', '600']);
    assert.deepEqual(deleteRows(base, [0, 2]).rows, [[500, 2]]);
    assert.ok(Number.isNaN(clearCells(base, [cell(1, 'v0')]).rows[1][1]));
    const edited = setCells(base, [{ rowIdx: 1, colKey: 'v0', value: 9 }]);
    assert.equal(edited.rows[0], base.rows[0], 'rows not edited are shared, not copied');
    assert.deepEqual(addColumn(base).rows[0].map(String), ['400', '1', 'NaN']);

    let history = startHistory(base);
    history = commitTable(history, edited);
    history = commitTable(history, deleteRows(edited, [0]));
    history = undoTable(history);
    assert.equal(history.present, edited);
    history = undoTable(history);
    assert.equal(history.present, base);
    assert.equal(undoTable(history), history, 'nothing before the first table');
    history = redoTable(history);
    assert.equal(history.present, edited);
    history = commitTable(history, base);
    assert.equal(history.future.length, 0, 'a new edit drops the redo');
    assert.equal(commitTable(history, history.present), history, 'an edit that changed nothing is not one');
}

// ── Apply ────────────────────────────────────────────────────────────────────
{
    const typed = table([[600, 30], [400, 10], [NaN, 5], [500, NaN], [450, 20]], [
        { quantity: 'T', unit: '%', name: 'Typed T' },
        { quantity: 'R', unit: 'dB', name: '' },
    ].slice(0, 1));
    const [curve] = curvesFromTable(typed);
    assert.deepEqual(curve.x, [400, 450, 600], 'sorted, and rows missing a number left out');
    assert.ok(close(curve.y[0], 0.1));
    assert.equal(curve.name, 'Typed T');
    assert.equal(curve.aoi, 0);
    assert.equal(curve.pol, 'avg');

    const db = table([[1530, -0.5], [1540, -1]], [{ quantity: 'T', unit: 'dB', name: '' }]);
    const [gain] = curvesFromTable(db);
    assert.equal(gain.name, 'T', 'an unnamed column is named for its quantity');
    assert.ok(close(gain.y[1], 10 ** -0.1), 'dB to a fraction');
    assert.equal(gain.yWasPercent, false);

    const microns = { ...table([[0.5, 50]]), xUnit: 'um' };
    assert.equal(curvesFromTable(microns)[0].x[0], 500, 'µm to nm');
    const wavenumber = { ...table([[20000, 50]]), xUnit: 'cm-1' };
    assert.equal(curvesFromTable(wavenumber)[0].x[0], 500, 'cm⁻¹ to nm');
    const energy = { ...table([[1239.841984 / 500, 50]]), xUnit: 'eV' };
    assert.ok(close(curvesFromTable(energy)[0].x[0], 500), 'eV to nm');

    const psi = table([[500, 30], [600, 31]], [{ quantity: 'PSI', unit: 'deg', name: '' }], 'ellipsometry');
    const [psiCurve] = curvesFromTable(psi);
    assert.equal(psiCurve.quantity, 'PSI');
    assert.equal(psiCurve.aoi, 0, 'a new Ψ has no angle; its card asks for one');
    assert.deepEqual(psiCurve.y, [30, 31], 'degrees stay degrees');

    assert.equal(applyProblem(table([[NaN, 1], [400, NaN]])), 'noPoints');
    assert.equal(applyProblem(table([[400, 1]])), null);

    // An existing curve opens and applies back unchanged.
    const stored = makeMeasuredCurve({
        name: 'Scan', x: [400, 500, 600], xUnit: 'nm', y: [12.3, 45.6, 78.9], isPercent: true,
        quantity: 'R', aoi: 8, pol: 's',
    });
    const opened = tableFromCurve({ ...stored, trimMin: 450, trimMax: 700 }, 'spectrum');
    assert.deepEqual(opened.rows, [[400, 12.3], [500, 45.6], [600, 78.9]], 'shown in the percent it was read in');
    const back = editedCurve({ ...stored, trimMin: 450, trimMax: 700 }, opened);
    assert.deepEqual(back.y, stored.y, 'percent rounding does not reach the stored values');
    assert.equal(back.id, stored.id);
    assert.equal(back.aoi, 8);
    assert.equal(back.pol, 's');
    assert.equal(back.trimMin, 450);
    assert.equal(back.trimMax, undefined, 'a trim past the points cuts nothing and is dropped');
    const moved = editedCurve(stored, setCells(opened, [{ rowIdx: 0, colKey: 'v0', value: 20 }]));
    assert.equal(moved.y[0], 0.2);
    assert.equal(moved.name, 'Scan');
}

// ── Resampling ───────────────────────────────────────────────────────────────
{
    const ten = table([[1530, 10], [1534, 12], [1538, 13], [1542, 12.5], [1546, 11], [1550, 10],
        [1554, 9.5], [1558, 10], [1562, 11], [1565, 12]]);
    const plan = resamplePlan(ten, 1);
    assert.equal(plan.rowCount, 36);
    const { table: grid } = resampleTable(ten, 1);
    assert.equal(grid.rows.length, 36);
    assert.equal(grid.rows[0][0], 1530);
    assert.equal(grid.rows[35][0], 1565);
    assert.equal(grid.rows[4][1], 12, 'a typed point is kept where the grid passes through it');
    assert.ok(grid.rows.every(row => row[1] >= 9.5 && row[1] <= 13), 'no overshoot past the typed extremes');

    const offGrid = resampleTable(table([[400.3, 1], [402.6, 2]]), 1).table;
    assert.deepEqual(offGrid.rows.map(row => row[0]), [401, 402], 'the grid lands on whole steps');
    assert.equal(resamplePlan(ten, 0).problem, 'step');
    assert.equal(resamplePlan(table([[400, 1]]), 1).problem, 'points');
    assert.equal(resamplePlan(ten, 1e-6).problem, 'rows');

    // Δ is resampled as an unwrapped angle, not through 180°.
    const delta = table([[400, 350], [410, 10]], [{ quantity: 'DEL', unit: 'deg', name: '' }], 'ellipsometry');
    const across = resampleTable(delta, 5).table;
    assert.ok(close(across.rows[1][1], 0) || close(across.rows[1][1], 360), `midpoint ${across.rows[1][1]}`);
}

// ── Savitzky-Golay ───────────────────────────────────────────────────────────
{
    // Savitzky & Golay (1964), Table I: five points, quadratic or cubic.
    savitzkyGolayWeights(5, 2).forEach((weight, i) =>
        assert.ok(close(weight, [-3, 12, 17, 12, -3][i] / 35), `5-point weight ${i}`));
    // Seven points, quadratic: (-2, 3, 6, 7, 6, 3, -2)/21.
    savitzkyGolayWeights(7, 2).forEach((weight, i) =>
        assert.ok(close(weight, [-2, 3, 6, 7, 6, 3, -2][i] / 21), `7-point weight ${i}`));

    // A polynomial of the fitted order comes through unchanged, on an even grid
    // and on an uneven one, ends included.
    const cubic = x => 0.002 * x ** 3 - 0.3 * x ** 2 + 4 * x - 7;
    const even = Array.from({ length: 30 }, (_, i) => i);
    const uneven = Array.from({ length: 30 }, (_, i) => i + 0.4 * Math.sin(i));
    for (const x of [even, uneven]) {
        const y = x.map(cubic);
        smoothSavitzkyGolay(x, y, 7, 3).forEach((value, i) => assert.ok(close(value, y[i], 1e-9), `cubic kept at ${i}`));
    }
    // Ripple is reduced.
    const noisy = even.map(i => 50 + (i % 2 ? 1 : -1));
    const smoothed = smoothSavitzkyGolay(even, noisy, 5, 2);
    assert.ok(smoothed.slice(2, -2).every(value => Math.abs(value - 50) < 0.5));

    assert.equal(savitzkyGolayProblem(10, 4, 2), 'window');
    assert.equal(savitzkyGolayProblem(10, 5, 5), 'order');
    assert.equal(savitzkyGolayProblem(3, 5, 2), 'points');
    assert.equal(savitzkyGolayProblem(10, 5, 2), null);

    // In the editor the selected rows are smoothed along their wavelengths.
    const rows = even.map(i => [400 + i, noisy[i], 1]);
    const base = table(rows, [{ quantity: 'T', unit: '%', name: '' }, { quantity: 'T', unit: '%', name: '' }]);
    const selected = even.map(rowIdx => cell(rowIdx, 'v0'));
    const result = smoothCells(base, selected, { window: 5, order: 2 });
    assert.equal(result.problem, null);
    assert.ok(result.table.rows.slice(2, -2).every(row => Math.abs(row[1] - 50) < 0.5));
    assert.ok(result.table.rows.every(row => row[2] === 1), 'columns not selected are left alone');
    const whole = smoothCells(base, [cell(3, 'v0')], { window: 5, order: 2 });
    assert.ok(whole.table.rows.slice(2, -2).every(row => Math.abs(row[1] - 50) < 0.5),
        'one cell smooths its whole column');
    assert.equal(smoothCells(base, selected.slice(0, 3), { window: 5, order: 2 }).problem, 'points');
}

// ── What the tool panels say ─────────────────────────────────────────────────
{
    const ce = en.curveEditor;
    const rows = Array.from({ length: 30 }, (_, i) => [400 + 10 * i, 50 + (i % 2 ? 1 : -1)]);
    rows[0] = [400, 99.95];
    rows[2] = [420, NaN];
    const base = table(rows);
    const labels = editorLabels(en, base);
    const xs = n => Array.from({ length: n }, (_, rowIdx) => cell(rowIdx, 'x'));
    const vs = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => cell(from + i, 'v0'));
    const fill = { mode: 'step', value: null, first: 400, step: 10, last: null };

    // Fill names the cells and their columns, and shows what the first column gets.
    const six = fillText(ce, labels, base, xs(6), fill);
    assert.equal(six.title, 'Fill the 6 selected cells of λ (nm)');
    assert.equal(six.preview, '400, 410, 420 … 450');
    assert.equal(six.run, 'Fill 6 cells');
    assert.equal(six.ready, true);
    assert.equal(fillText(ce, labels, base, xs(4), fill).preview, '400, 410, 420, 430', 'four values are all shown');
    const one = fillText(ce, labels, base, xs(1), fill);
    assert.deepEqual([one.title, one.preview, one.run], ['Fill the selected cell of λ (nm)', '400', 'Fill 1 cell']);
    const block = [0, 1, 2].flatMap(rowIdx => [cell(rowIdx, 'x'), cell(rowIdx, 'v0')]);
    assert.equal(fillText(ce, labels, base, block, fill).title, 'Fill the 6 selected cells of λ (nm), T 1');
    const named = table(rows, [{ quantity: 'R', unit: '%', name: 'Rear R' }]);
    assert.equal(fillText(ce, editorLabels(en, named), named, vs(0, 1), fill).title,
        'Fill the 2 selected cells of Rear R', 'a named column goes by its name');
    const log = fillText(ce, labels, base, xs(5), { ...fill, mode: 'log', first: 1, last: 10000 });
    assert.equal(log.preview, '1, 10, 100 … 10000');
    const constant = fillText(ce, labels, base, xs(3), { ...fill, mode: 'constant', value: 7 });
    assert.equal(constant.preview, '7, 7, 7');
    // A field left empty is a hint; a log step from zero cannot run at all.
    assert.deepEqual(fillText(ce, labels, base, xs(6), { ...fill, step: null }).problem,
        { text: ce.fillProblems.number, tone: 'hint' });
    const fromZero = fillText(ce, labels, base, xs(6), { ...fill, mode: 'log', first: 0, last: 10 });
    assert.deepEqual([fromZero.problem, fromZero.ready], [{ text: ce.fillProblems.positive, tone: 'error' }, false]);
    assert.equal(fillText(ce, labels, base, xs(6), { ...fill, mode: 'log', first: null, last: 10 }).problem.tone, 'hint');

    // Change counts the numbers it changes; an empty cell stays empty.
    const change = { mode: 'percent', percent: 5, a: null, b: null };
    const changed = changeText(ce, labels, base, vs(0, 5), change);
    assert.equal(changed.title, 'Change the 5 selected values of T 1');
    assert.equal(changed.preview, '99.95 becomes 104.9475');
    assert.equal(changed.run, 'Change 5 values');
    assert.equal(changeText(ce, labels, base, vs(0, 5), { mode: 'linear', percent: null, a: 2, b: -1 }).preview,
        '99.95 becomes 198.9');
    assert.equal(changeText(ce, labels, base, vs(0, 0), change).title, 'Change the selected value of T 1');
    assert.deepEqual(changeText(ce, labels, base, vs(0, 5), { ...change, percent: null }).problem,
        { text: ce.changeProblem, tone: 'hint' });
    const empty = changeText(ce, labels, base, [cell(2, 'v0')], change);
    assert.deepEqual([empty.title, empty.ready], [ce.panels.change.noValues, false]);

    // Smooth: one cell stands for its column; the wavelength is never smoothed.
    const smooth = { window: 5, order: 2 };
    const whole = smoothText(ce, labels, base, [cell(7, 'v0')], smooth);
    assert.deepEqual([whole.title, whole.ready, whole.run], ['Smooth the whole T 1 column', true, 'Smooth']);
    const span = smoothText(ce, labels, base, [...vs(2, 19), cell(4, 'x')], smooth);
    assert.equal(span.title, 'Smooth T 1, rows 3-20');
    assert.equal(smoothText(ce, labels, base, xs(6), smooth).title, ce.panels.smooth.wavelength);
    assert.equal(smoothText(ce, labels, base, xs(6), smooth).ready, false);
    assert.deepEqual(smoothText(ce, labels, base, vs(2, 19), { window: 4, order: 2 }).problem,
        { text: ce.smoothProblems.window, tone: 'error' });
    assert.equal(smoothText(ce, labels, base, vs(2, 19), { window: 5, order: 5 }).problem.text, ce.smoothProblems.order);
    const short = smoothText(ce, labels, base, vs(3, 5), smooth);
    assert.deepEqual([short.problem.text, short.ready], [ce.panels.smooth.tooFew(5), false],
        'three values cannot carry a five-point fit');

    // Nothing selected: Fill, Change and Smooth ask for cells and do nothing.
    for (const text of [
        fillText(ce, labels, base, [], fill), changeText(ce, labels, base, [], change),
        smoothText(ce, labels, base, [], smooth),
    ]) {
        assert.deepEqual([text.title, text.ready], [ce.panels.selectFirst, false]);
    }

    // Resample counts the rows of the new grid, in the wavelength column's unit.
    const scan = table([[300, 1], [550, 2], [800, 3]]);
    const grid = resampleText(ce, editorLabels(en, scan), scan, 1);
    assert.deepEqual([grid.preview, grid.run, grid.ready], ['300 to 800 nm: 501 rows', 'Resample to 501 rows', true]);
    const microns = { ...table([[0.3, 1], [0.8, 3]]), xUnit: 'um' };
    assert.equal(resampleText(ce, editorLabels(en, microns), microns, 0.1).preview, '0.3 to 0.8 µm: 6 rows');
    assert.equal(resampleText(ce, labels, scan, 0).problem.text, ce.resampleProblems.step);
    assert.equal(resampleText(ce, labels, scan, 1e-6).problem.text, ce.resampleProblems.rows(1000000));
    assert.equal(resampleText(ce, labels, table([[400, 1]]), 1).problem.text, ce.resampleProblems.points);
    assert.equal(seriesText([1.5, 2]), '1.5, 2');

    // Every language fills its sentences: no piece is missing or undefined.
    for (const locale of [en, ru, zh, it]) {
        const panels = locale.curveEditor.panels;
        const lang = editorLabels(locale, base);
        const texts = [
            fillText(locale.curveEditor, lang, base, xs(6), fill), changeText(locale.curveEditor, lang, base, vs(0, 5), change),
            smoothText(locale.curveEditor, lang, base, vs(2, 19), smooth), smoothText(locale.curveEditor, lang, base, [cell(7, 'v0')], smooth),
            resampleText(locale.curveEditor, lang, scan, 1),
        ];
        for (const text of texts) {
            assert.ok(text.ready && ![text.title, text.preview, text.run].some(part => String(part).includes('undefined')),
                `${text.title} / ${text.preview} / ${text.run}`);
        }
        assert.deepEqual(Object.values(panels.fill.rows).map(parts => parts.length), [2, 3, 3, 3]);
        assert.deepEqual(Object.values(panels.change.rows).map(parts => parts.length), [2, 3]);
        assert.equal(panels.smooth.sentence.length, 3);
        assert.equal(panels.resample.sentence('nm').length, 2);
    }
}

// ── The table as CSV reads back ──────────────────────────────────────────────
{
    const typed = table([[400, 45.5], [500, 46]]);
    const text = tableCsv(typed);
    assert.ok(text.startsWith('Wavelength (nm),T (%)'), text);
    const { table: back } = tableFromText(text, emptyTable('spectrum'));
    assert.deepEqual(back.rows, typed.rows);
    assert.deepEqual(back.columns.map(c => [c.quantity, c.unit]), [['T', '%']]);
}

// ── Merit blocks rebuilt from an edited curve ────────────────────────────────
{
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 100 }], backLayers: [],
    };
    const curve = {
        ...makeMeasuredCurve({
            name: 'Gain', x: [1530, 1540, 1550, 1560, 1570], y: [0.5, 0.6, 0.7, 0.6, 0.5], quantity: 'T',
        }),
        id: 'gain',
    };
    const fitOptions = { clipToCoverage: false };
    const linear = measuredFitSnapshot(design, curve, {
        ...fitOptions, mode: 'uniform', stepNm: 5, weight: 3, rangeMin: 1530, rangeMax: 1560,
    }).operand;
    const inDb = measuredFitSnapshot(design, curve, { ...fitOptions, mode: 'measured', scale: 'dB', weight: 2 }).operand;
    const other = { id: 'other', type: 'MCURVE', curveId: 'else', quantity: 'R', sampleLambdas: [500], sampleTargets: [0.1] };
    const withBlocks = { ...design, measuredCurves: [curve], meritOperands: [linear, { ...inDb, enabled: false, levelFree: true }, other] };
    assert.deepEqual(curveBlocks(withBlocks, 'gain').map(op => op.id), [linear.id, inDb.id]);

    const options = blockFitOptions(linear);
    assert.equal(options.mode, 'uniform');
    assert.equal(options.stepNm, 5);
    assert.equal(options.rangeMin, 1530);
    assert.equal(options.rangeMax, 1560);
    assert.equal(blockFitOptions(inDb).scale, 'dB');

    const edited = { ...curve, y: [0.25, 0.3, 0.35, 0.3, 0.25] };
    const { meritOperands, rebuilt, kept } = rebuiltMeritOperands(withBlocks, edited, 'spectrum');
    assert.equal(rebuilt, 2);
    assert.equal(kept, 0);
    const [first, second, third] = meritOperands;
    assert.equal(first.id, linear.id, 'a rebuilt block keeps its id');
    assert.equal(first.gridMode, 'uniform');
    assert.deepEqual(first.sampleLambdas, linear.sampleLambdas, 'and its grid and range');
    assert.equal(first.weight, 3, 'and its weight');
    assert.equal(first.quantity, 'T');
    assert.ok(close(first.sampleTargets[0], 0.25), 'with the edited points');
    assert.equal(second.id, inDb.id);
    assert.equal(second.quantity, 'TDB', 'a block fitted in dB stays in dB');
    assert.equal(second.enabled, false, 'and switched off if it was');
    assert.equal(second.levelFree, true, 'a gain-flattening block keeps its free level');
    assert.equal(first.levelFree, undefined, 'and one without a free level gets none');
    assert.equal(second.weight, 2);
    assert.ok(close(second.sampleTargets[0], logValue('dB', 0.25)), 'its points in dB');
    assert.equal(third, other, 'a block from another curve is not touched');

    // A Ψ curve at normal incidence yields no block, so its block is kept.
    const psi = { ...makeMeasuredCurve({ name: 'Psi', x: [500, 600], y: [20, 21], quantity: 'PSI', aoi: 70 }), id: 'psi' };
    const psiBlock = ellipsometryFitSnapshot(design, psi, { mode: 'measured', clipToCoverage: false }).operand;
    const psiDesign = { ...design, meritOperands: [psiBlock] };
    assert.equal(rebuiltMeritOperands(psiDesign, { ...psi, y: [22, 23] }, 'ellipsometry').rebuilt, 1);
    const refused = rebuiltMeritOperands(psiDesign, { ...psi, aoi: 0 }, 'ellipsometry');
    assert.equal(refused.kept, 1);
    assert.equal(refused.meritOperands[0], psiBlock);
}

console.log('PASS: curve_editor_model');
