// Validate the shared spectrum-table parser / normalizer / CSV
// exporter in src/utils/io/spectrumTable.js.
// Run: node tests/spectrum_table_import.mjs
import {
    parseSpectrumTable, makeMeasuredCurve, curvesToCsv, tableToCsv,
    parseNumber, sniffDelimiter, detectDecimal, detectXUnit, detectQuantity,
    detectIsPercent, xToNm, absorbanceToT, guessXUnitFromRange, X_UNITS,
} from '../src/utils/io/spectrumTable.js';
import { designSpectrumColumns } from '../src/utils/io/designSpectrum.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// ── parseNumber ─────────────────────────────────────────────────────────────────
ok('parseNumber plain', approx(parseNumber('123.45'), 123.45));
ok('parseNumber percent suffix', approx(parseNumber('4.21%'), 4.21));
ok('parseNumber decimal comma', approx(parseNumber('1,5', ','), 1.5));
ok('parseNumber sci', approx(parseNumber('1.2e-3'), 0.0012));
ok('parseNumber blank → NaN', Number.isNaN(parseNumber('')));
ok('parseNumber text → NaN', Number.isNaN(parseNumber('abc')));
ok('parseNumber thousands+comma', approx(parseNumber('1.234,5', ','), 1234.5));

// ── delimiter sniff ───────────────────────────────────────────────────────────
ok('sniff comma', sniffDelimiter(['380,4.2', '381,4.3']) === ',');
ok('sniff tab', sniffDelimiter(['380\t4.2', '381\t4.3']) === '\t');
ok('sniff semicolon', sniffDelimiter(['380;4,2', '381;4,3'], ',') === ';');
ok('sniff whitespace', sniffDelimiter(['380   4.2', '381   4.3']) === ' ');

// ── detectDecimal ───────────────────────────────────────────────────────────────
ok('decimal comma detected', detectDecimal('380;4,2\n381;4,3') === ',');
ok('decimal dot default', detectDecimal('380,4.2\n381,4.3') === '.');

// ── unit + quantity heuristics ──────────────────────────────────────────────────
ok('xunit nm', detectXUnit('Wavelength (nm)') === X_UNITS.NM);
ok('xunit cm-1', detectXUnit('Wavenumber cm-1') === X_UNITS.CM1);
ok('xunit um', detectXUnit('Wavelength (µm)') === X_UNITS.UM);
ok('xunit unknown', detectXUnit('X axis') === X_UNITS.UNKNOWN);
ok('guess nm range', guessXUnitFromRange([400, 550, 700]) === X_UNITS.NM);
ok('guess um range', guessXUnitFromRange([0.4, 0.55, 0.7]) === X_UNITS.UM);
ok('guess cm-1 range', guessXUnitFromRange([4000, 8000, 40000]) === X_UNITS.CM1);
ok('quantity T', detectQuantity('%T') === 'T');
ok('quantity R', detectQuantity('Reflectance') === 'R');
ok('quantity A', detectQuantity('Absorbance') === 'A');

// ── isPercent ───────────────────────────────────────────────────────────────────
ok('percent via %', detectIsPercent('%T', [4, 50, 90]) === true);
ok('percent via range', detectIsPercent('T', [4, 50, 90]) === true);
ok('fraction via range', detectIsPercent('T', [0.04, 0.5, 0.9]) === false);

// ── conversions ─────────────────────────────────────────────────────────────────
ok('xToNm nm', xToNm(550, X_UNITS.NM) === 550);
ok('xToNm um', xToNm(0.55, X_UNITS.UM) === 550);
ok('xToNm cm-1', approx(xToNm(20000, X_UNITS.CM1), 500));   // 1e7/20000 = 500
ok('absorbance→T A=0', approx(absorbanceToT(0), 1));
ok('absorbance→T A=1', approx(absorbanceToT(1), 0.1));
ok('absorbance→T A=2', approx(absorbanceToT(2), 0.01));

// ── parse: basic CSV with header + units row ────────────────────────────────────
{
    const csv = `Sample 7 BBAR\nWavelength (nm),%T\n380.0,4.213\n381.0,4.198\n382.0,4.180\n`;
    const r = parseSpectrumTable(csv);
    ok('basic ok', r.ok);
    ok('basic delim', r.delimiter === ',');
    ok('basic nRows', r.nRows === 3);
    ok('basic xUnit', r.xUnit === X_UNITS.NM);
    ok('basic x0', approx(r.x[0], 380));
    ok('basic 1 ycol', r.columns.length === 1);
    ok('basic quantity T', r.columns[0].quantity === 'T');
    ok('basic isPercent', r.columns[0].isPercent === true);
}

// ── parse: descending wavelength (NIR scan) → curve sorts ascending ─────────────
{
    const csv = `nm,%R\n800,10\n700,20\n600,30\n`;
    const r = parseSpectrumTable(csv);
    ok('desc parse ok', r.ok && r.nRows === 3);
    const cv = makeMeasuredCurve({ name: 'm', x: r.x, xUnit: r.xUnit, y: r.columns[0].values, quantity: r.columns[0].quantity, isPercent: r.columns[0].isPercent });
    ok('desc sorted asc', cv.x[0] === 600 && cv.x[2] === 800);
    ok('desc y follows x', approx(cv.y[0], 0.30) && approx(cv.y[2], 0.10));
    ok('desc fraction', cv.quantity === 'R');
}

// ── parse: whitespace-delimited, no header, fraction Y ──────────────────────────
{
    const txt = `400   0.043\n500   0.012\n600   0.008\n`;
    const r = parseSpectrumTable(txt);
    ok('ws delim', r.delimiter === ' ');
    ok('ws nRows', r.nRows === 3);
    const cv = makeMeasuredCurve({ name: 'm', x: r.x, xUnit: r.xUnit, y: r.columns[0].values, quantity: 'T', isPercent: r.columns[0].isPercent });
    ok('ws stays fraction', approx(cv.y[0], 0.043));
}

// ── parse: absorbance column → makeMeasuredCurve converts to T ──────────────────
{
    const csv = `Wavelength (nm),Abs\n400,2\n500,1\n600,0\n`;
    const r = parseSpectrumTable(csv);
    ok('abs detected', r.columns[0].isAbsorbance === true);
    ok('abs not percent', r.columns[0].isPercent === false);
    const cv = makeMeasuredCurve({ name: 'm', x: r.x, xUnit: r.xUnit, y: r.columns[0].values, quantity: 'A', isAbsorbance: true });
    ok('abs→T quantity', cv.quantity === 'T');
    ok('abs→T A=2→0.01', approx(cv.y[0], 0.01));
    ok('abs→T A=0→1', approx(cv.y[2], 1));
}

// ── parse: cm-1 axis → nm conversion ────────────────────────────────────────────
{
    const csv = `Wavenumber (cm-1),%T\n25000,50\n20000,60\n`;
    const r = parseSpectrumTable(csv);
    ok('cm-1 unit', r.xUnit === X_UNITS.CM1);
    const cv = makeMeasuredCurve({ name: 'm', x: r.x, xUnit: r.xUnit, y: r.columns[0].values, quantity: r.columns[0].quantity, isPercent: r.columns[0].isPercent });
    ok('cm-1→nm 25000→400', approx(cv.x[0], 400));   // 1e7/25000
    ok('cm-1→nm 20000→500', approx(cv.x[1], 500));
}

// ── parse: decimal-comma, semicolon delimiter ───────────────────────────────────
{
    const csv = `Wellenlänge (nm);%T\n380;4,2\n381;4,3\n`;
    const r = parseSpectrumTable(csv);
    ok('de decimal', r.decimal === ',');
    ok('de delim', r.delimiter === ';');
    ok('de value', approx(r.columns[0].values[0], 4.2));
}

// ── parse: multi-column (T and R) ───────────────────────────────────────────────
{
    const csv = `Wavelength (nm),%T,%R\n400,90,8\n500,92,6\n`;
    const r = parseSpectrumTable(csv);
    ok('multi 2 cols', r.columns.length === 2);
    ok('multi col0 T', r.columns[0].quantity === 'T');
    ok('multi col1 R', r.columns[1].quantity === 'R');
}

// ── CSV export: shared grid (single λ column) ───────────────────────────────────
{
    const t = makeMeasuredCurve({ name: 'T', x: [400, 500], xUnit: X_UNITS.NM, y: [0.9, 0.92], quantity: 'T', isPercent: false });
    const r = makeMeasuredCurve({ name: 'R', x: [400, 500], xUnit: X_UNITS.NM, y: [0.08, 0.06], quantity: 'R', isPercent: false });
    const csv = curvesToCsv([t, r]);
    const lines = csv.trim().split('\r\n');
    ok('csv header single λ', lines[0] === 'Wavelength (nm),T %T,R %R');
    ok('csv row pct', lines[1] === '400,90,8');
    // round-trip back through the parser
    const back = parseSpectrumTable(csv);
    ok('csv round-trip cols', back.columns.length === 2);
    ok('csv round-trip x', approx(back.x[0], 400) && approx(back.x[1], 500));
    ok('csv round-trip T pct', approx(back.columns[0].values[0], 90));
}

// ── CSV export: independent grids (paired columns) ──────────────────────────────
{
    const a = makeMeasuredCurve({ name: 'A', x: [400, 500, 600], xUnit: X_UNITS.NM, y: [0.9, 0.8, 0.7], quantity: 'T', isPercent: false });
    const b = makeMeasuredCurve({ name: 'B', x: [450, 550], xUnit: X_UNITS.NM, y: [0.5, 0.4], quantity: 'T', isPercent: false });
    const csv = curvesToCsv([a, b]);
    const lines = csv.trim().split('\r\n');
    ok('csv indep header 4 cols', lines[0].split(',').length === 4);
    ok('csv indep padded', lines[3].split(',')[2] === '' && lines[3].split(',')[3] === '');
}

// ── tableToCsv (computed-spectrum export) ───────────────────────────────────────
{
    const csv = tableToCsv({ x: [400, 500], columns: [{ name: 'T %', values: [90, 92] }, { name: 'R %', values: [8, 6] }] });
    const lines = csv.trim().split('\r\n');
    ok('tableToCsv header', lines[0] === 'Wavelength (nm),T %,R %');
    ok('tableToCsv row', lines[1] === '400,90,8');
}

// ── empty / garbage inputs ──────────────────────────────────────────────────────
ok('empty not ok', parseSpectrumTable('').ok === false);
ok('garbage not ok', parseSpectrumTable('hello world\nfoo bar baz').ok === false);

// ── designSpectrumColumns (computed-spectrum export, pure half) ──────────────────
{
    const spec = {
        lambda: [400, 500],
        series: [{ theta: 0, T: [0.9, 0.92], R: [0.08, 0.06], A: [0.02, 0.02], Ts: [0.85, 0.88], Rs: [0.13, 0.10], Tp: [0.95, 0.96], Rp: [0.03, 0.02] }],
    };
    const { x, columns } = designSpectrumColumns(spec);
    ok('dsc x', x[0] === 400 && x[1] === 500);
    ok('dsc default 3 cols', columns.length === 3);
    ok('dsc names TRA', columns.map(c => c.name).join('|') === 'T %|R %|A %');
    ok('dsc percent scale', approx(columns[0].values[0], 90));
    // fraction mode
    const frac = designSpectrumColumns(spec, { asPercent: false, quantities: ['T'] });
    ok('dsc fraction', approx(frac.columns[0].values[0], 0.9) && frac.columns[0].name === 'T');
    // s/p pols: A has no s/p → omitted for those pols
    const sp = designSpectrumColumns(spec, { pols: ['avg', 's', 'p'], quantities: ['T', 'R', 'A'] });
    const names = sp.columns.map(c => c.name);
    ok('dsc avg has A', names.includes('A %'));
    ok('dsc s has T,R not A', names.includes('T s %') && names.includes('R s %') && !names.includes('A s %'));
    ok('dsc p cols', names.includes('T p %') && names.includes('R p %'));
}
// multi-AOI suffixes
{
    const spec = {
        lambda: [400],
        series: [
            { theta: 0,  T: [0.9], R: [0.08], A: [0.02] },
            { theta: 45, T: [0.8], R: [0.15], A: [0.05] },
        ],
    };
    const { columns } = designSpectrumColumns(spec, { quantities: ['T'] });
    ok('dsc multiAoi names', columns.map(c => c.name).join('|') === 'T % @0°|T % @45°');
    ok('dsc multiAoi vals', approx(columns[0].values[0], 90) && approx(columns[1].values[0], 80));
}
const csvD = tableToCsv(designSpectrumColumns({ lambda: [400, 500], series: [{ theta: 0, T: [0.9, 0.92], R: [0.08, 0.06], A: [0.02, 0.02] }] }));
ok('dsc → tableToCsv header', csvD.split('\r\n')[0] === 'Wavelength (nm),T %,R %,A %');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
