/**
 * What the Monitor Worksheet exports: its table and the signal curves its chart
 * draws, written as the export settings say.
 *
 * The worksheet could only copy or save its table as a fixed CSV. It now
 * writes the table and the curves as one file for the run or one per witness
 * chip, under a conditions header, column names only or none, with the
 * delimiter, decimals and decimal mark the Process Exporter offers.
 *
 * Run: node tests/monitor_worksheet_export.mjs
 */
import assert from 'node:assert/strict';

const { WORKSHEET_OUTPUT, curveFiles, outputFrom, tableFiles } = await import(
    '../src/components/windows/simulation/monitorWorksheet/exportModel.js');

const meta = { designName: 'Edge filter', char: 'T', theta: 0, pol: 'avg', chipGlass: 'BK7 (Schott)', witnessRatio: 1 };
const columns = [
    { key: 'step', label: '#' }, { key: 'chip', label: 'Chip' }, { key: 'material', label: 'Material' },
    { key: 'lambda', label: 'λ (nm)' }, { key: 'signal', label: 'Signal (%)' }, { key: 'turningPoints', label: 'Turning points' },
];
const tableRows = [
    { step: 1, chip: 1, material: 'SiO2, fused', lambda: 550, signal: 93.15, turningPoints: 1 },
    { step: 2, chip: 1, material: 'Ta2O5', lambda: 550, signal: 69.4912345, turningPoints: 1 },
    { step: 3, chip: 2, material: 'SiO2, fused', lambda: 632.8, signal: 91.57, turningPoints: 0 },
];
const output = options => outputFrom(options);
const lines = file => file.content.split('\r\n').slice(0, -1);

// ── Options ──────────────────────────────────────────────────────────────────
assert.deepEqual(outputFrom(null), { ...WORKSHEET_OUTPUT });
assert.deepEqual(outputFrom('junk'), { ...WORKSHEET_OUTPUT }, 'a saved value of the wrong shape is ignored');
assert.equal(outputFrom({ decimals: 2 }).decimals, 2);

// ── The table, one file ──────────────────────────────────────────────────────
{
    const files = tableFiles({ columns, rows: tableRows, meta, output: output({ decimals: 2 }) });
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, 'Edge_filter_monitor_worksheet.csv');
    assert.deepEqual(lines(files[0]), [
        '# Edge filter',
        '# Monitor: T at AOI 0 deg, polarization average',
        '# Chip glass: BK7 (Schott), witness ratio 1',
        '#,Chip,Material,λ (nm),Signal (%),Turning points',
        '1,1,"SiO2, fused",550,93.15,1',
        '2,1,Ta2O5,550,69.49,1',
        '3,2,"SiO2, fused",632.8,91.57,0',
    ], 'layer and chip numbers stay whole, the wavelength is as entered, a value takes the decimals, a field holding the delimiter is quoted');
}

// ── Header choices and the decimal comma ─────────────────────────────────────
{
    const names = tableFiles({ columns, rows: tableRows, meta, output: output({ header: 'names' }) })[0];
    assert.equal(lines(names)[0], '#,Chip,Material,λ (nm),Signal (%),Turning points', 'column names only');
    const none = tableFiles({ columns, rows: tableRows, meta, output: output({ header: 'none', decimals: 1 }) })[0];
    assert.deepEqual(lines(none)[0], '1,1,"SiO2, fused",550,93.2,1', 'numbers only');
    const comma = tableFiles({
        columns, rows: tableRows, meta: { ...meta, theta: 7.5, witnessRatio: 1.25 },
        output: output({ decimalMark: ',', delimiter: ';', decimals: 3 }),
    })[0];
    assert.equal(lines(comma)[1], '# Monitor: T at AOI 7,5 deg, polarization average', 'the header takes the decimal mark too');
    assert.equal(lines(comma)[2], '# Chip glass: BK7 (Schott), witness ratio 1,25');
    assert.equal(lines(comma).at(-1), '3;2;SiO2, fused;632,8;91,570;0', 'a decimal comma under a semicolon delimiter');
}

// ── One file per chip ────────────────────────────────────────────────────────
{
    const files = tableFiles({ columns, rows: tableRows, meta, output: output({ files: 'chip', decimals: 2 }) });
    assert.deepEqual(files.map(f => f.filename),
        ['Edge_filter_monitor_worksheet_chip-1.csv', 'Edge_filter_monitor_worksheet_chip-2.csv']);
    assert.deepEqual(lines(files[1]).slice(0, 4), [
        '# Edge filter, witness chip 2',
        '# Monitor: T at AOI 0 deg, polarization average',
        '# Monitoring wavelength: 632.8 nm',
        '# Chip glass: BK7 (Schott), witness ratio 1',
    ], 'a chip file names its chip and the wavelength its layers share');
    assert.equal(lines(files[0]).filter(line => /^\d/.test(line)).length, 2, 'chip 1 holds its two layers');
}

// ── Signal curves ────────────────────────────────────────────────────────────
{
    const curveRows = [
        {
            step: 1, chip: 1, lambda: 550, thickness: 100, xCut: 1, signal: 0.5,
            curve: { thickness: [0, 50, 100, 150], x: [0, 0.5, 1, 1.5], y: [0.95, 0.7, 0.5, 0.7] },
        },
        {
            step: 2, chip: 2, lambda: 600, thickness: 80, xCut: 1.8, signal: 0.8,
            curve: { thickness: [0, 40, 75, 120], x: [1, 1.4, 1.75, 2.2], y: [0.5, 0.65, 0.78, 0.9] },
        },
        { step: 3, chip: 2, lambda: 600, thickness: 60, xCut: 2, signal: 0.6, curve: null },
    ];
    const names = { step: '#', chip: 'Chip', lambda: 'λ (nm)', thickness: 'Thickness in layer (nm)', position: 'QWOT', signal: 'Signal (%)' };
    const [file] = curveFiles({ rows: curveRows, names, meta, output: output({ header: 'names', decimals: 2 }) });
    assert.equal(file.filename, 'Edge_filter_signal_curves.csv');
    assert.deepEqual(lines(file), [
        '#,Chip,λ (nm),Thickness in layer (nm),QWOT,Signal (%)',
        '1,1,550,0.00,0.00,95.00',
        '1,1,550,50.00,0.50,70.00',
        '1,1,550,100.00,1.00,50.00',
        '2,2,600,0.00,1.00,50.00',
        '2,2,600,40.00,1.40,65.00',
        '2,2,600,75.00,1.75,78.00',
        '2,2,600,80.00,1.80,80.00',
    ], 'each layer runs from its start to its cut and ends on the cut; nothing past the cut, nothing for a layer with no curve');
    const perChip = curveFiles({ rows: curveRows, names, meta, output: output({ files: 'chip' }) });
    assert.deepEqual(perChip.map(f => f.filename), ['Edge_filter_signal_curves_chip-1.csv', 'Edge_filter_signal_curves_chip-2.csv']);
}

console.log('PASS: monitor_worksheet_export');
