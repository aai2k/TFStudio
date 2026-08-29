// Validate the shared spectrum-table parser / normalizer / CSV
// exporter in src/utils/io/spectrumTable.js.
// Run: node tests/spectrum_table_import.mjs
import {
    parseSpectrumTable, makeMeasuredCurve, curvesToCsv, tableToCsv,
    parseNumber, sniffDelimiter, detectDecimal, detectXUnit, detectQuantity,
    detectIsPercent, xToNm, nmToX, absorbanceToT, guessXUnitFromRange,
    measuredCurveData, X_UNITS,
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
ok('sniff semicolon with decimal X and Y', sniffDelimiter(['400,0;88,51', '401,0;88,62'], ',') === ';');
ok('sniff tab with decimal X and Y', sniffDelimiter(['400,0\t88,51', '401,0\t88,62'], ',') === '\t');
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
ok('quantity transmission', detectQuantity('Transmission [%]') === 'T');
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
ok('nmToX um', approx(nmToX(550, X_UNITS.UM), 0.55));
ok('nmToX cm-1', approx(nmToX(500, X_UNITS.CM1), 20000));
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

// ── parse: decimal-comma values in both X and Y ───────────────────────────────
{
    const csv = `Wellenlänge (nm);Transmission [%]\n400,0;88,51\n401,0;88,62\n`;
    const r = parseSpectrumTable(csv);
    ok('de decimal X/Y parses', r.ok);
    ok('de decimal X/Y delimiter', r.delimiter === ';');
    ok('de decimal X/Y values', approx(r.x[0], 400) && approx(r.columns[0].values[0], 88.51));
}

{
    const txt = `Wellenlänge (nm)\tTransmission [%]\n400,0\t88,51\n401,0\t88,62\n`;
    const r = parseSpectrumTable(txt);
    ok('tab decimal X/Y parses', r.ok);
    ok('tab decimal X/Y delimiter', r.delimiter === '\t');
    ok('tab decimal X/Y values', approx(r.x[1], 401) && approx(r.columns[0].values[1], 88.62));
}

// ── parse: multi-column (T and R) ───────────────────────────────────────────────
{
    const csv = `Wavelength (nm),%T,%R\n400,90,8\n500,92,6\n`;
    const r = parseSpectrumTable(csv);
    ok('multi 2 cols', r.columns.length === 2);
    ok('multi col0 T', r.columns[0].quantity === 'T');
    ok('multi col1 R', r.columns[1].quantity === 'R');
}

// ── parse: Cary-style repeated wavelength/sample groups ──────────────────────
{
    const csv = `Sample A,,Sample B,\nWavelength (nm),%T,Wavelength (nm),%T\n400,90,400,80\n500,92,500,82\n`;
    const r = parseSpectrumTable(csv);
    ok('repeated X parse ok', r.ok);
    ok('repeated X omitted as data', r.columns.length === 2);
    ok('repeated X source indexes', r.columns[0].index === 1 && r.columns[1].index === 3);
    ok('repeated X column grids', r.columns[0].x[1] === 500 && r.columns[1].x[1] === 500);
    ok('repeated names qualified', r.columns[0].name === 'Sample A: %T' && r.columns[1].name === 'Sample B: %T');
    ok('repeated quantities', r.columns.every(column => column.quantity === 'T'));
}

// ── parse: marker after the real column header ────────────────────────────────
{
    const txt = `Instrument export\nWavelength (nm)\tTransmission [%]\tReflection [%]\n>>>>>Begin Spectral Data<<<<<\n400\t90\t8\n500\t92\t6\n`;
    const r = parseSpectrumTable(txt);
    ok('marker parse ok', r.ok && r.columns.length === 2);
    ok('marker not used as name', r.columns[0].name === 'Transmission [%]' && r.columns[1].name === 'Reflection [%]');
    ok('transmission and reflection typed', r.columns[0].quantity === 'T' && r.columns[1].quantity === 'R');
    ok('marker removed from header', !r.headerText.includes('Begin Spectral Data'));
}

// ── measured-curve measurement conditions and JSON persistence ───────────────
{
    const curve = makeMeasuredCurve({
        name: 'conditions', x: [500], xUnit: X_UNITS.NM, y: [0.5], quantity: 'T',
        aoi: 8, pol: 'p', side: 'back',
    });
    const saved = JSON.parse(JSON.stringify(curve));
    ok('curve conditions stored', saved.aoi === 8 && saved.pol === 'p' && saved.side === 'back');
    const defaults = makeMeasuredCurve({ name: 'defaults', x: [500], y: [0.5] });
    ok('curve condition defaults', defaults.aoi === 0 && defaults.pol === 'avg' && defaults.side === 'front');
}

// ── non-destructive trim view ────────────────────────────────────────────────
{
    const curve = makeMeasuredCurve({ name: 'trim', x: [400, 500, 600], y: [0.4, 0.5, 0.6] });
    curve.trimMin = 450;
    curve.trimMax = 550;
    const view = measuredCurveData(curve);
    ok('trim filters view', view.x.length === 1 && view.x[0] === 500 && view.y[0] === 0.5);
    ok('trim preserves source arrays', curve.x.length === 3 && curve.y.length === 3);
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

// CSV export: requested X unit, Y scale, and trim bounds.
{
    const curve = makeMeasuredCurve({
        name: 'T', x: [400, 500, 600], xUnit: X_UNITS.NM,
        y: [0.9, 0.8, 0.7], quantity: 'T', isPercent: false,
    });
    curve.trimMin = 450;
    curve.trimMax = 550;
    const csv = curvesToCsv([curve], { xUnit: X_UNITS.UM, asPercent: false });
    ok('csv export unit header', csv.startsWith('Wavelength (µm),T T\r\n'));
    ok('csv export trim and fraction', csv.includes('\r\n0.5,0.8\r\n') && !csv.includes('0.4,0.9'));
}

// Requested units and scale survive export → re-import to the plan's 1e-12 tolerance.
{
    const source = makeMeasuredCurve({
        name: 'Precise T', x: [412.345678901, 523.456789012], xUnit: X_UNITS.NM,
        y: [0.123456789012, 0.876543210987], quantity: 'T', isPercent: false,
    });
    const csv = curvesToCsv([source], { xUnit: X_UNITS.CM1, asPercent: false });
    const parsed = parseSpectrumTable(csv);
    const restored = makeMeasuredCurve({
        name: parsed.columns[0].name,
        x: parsed.x,
        xUnit: parsed.xUnit,
        y: parsed.columns[0].values,
        quantity: parsed.columns[0].quantity,
        isPercent: parsed.columns[0].isPercent,
    });
    ok('csv option round-trip x 1e-12', source.x.every((value, index) => approx(value, restored.x[index], 1e-12)));
    ok('csv option round-trip y 1e-12', source.y.every((value, index) => approx(value, restored.y[index], 1e-12)));
}

{
    const curve = makeMeasuredCurve({ name: 'A', x: [500], y: [0.1], quantity: 'A' });
    const csv = curvesToCsv([curve], { xUnit: X_UNITS.CM1, asPercent: true });
    ok('csv A percent and wavenumber', csv === 'Wavenumber (cm-1),A %A\r\n20000,10\r\n');
}

// CSV export: user-controlled names are RFC-style escaped.
{
    const curve = makeMeasuredCurve({
        name: 'A,B "quoted"\nline', x: [500], xUnit: X_UNITS.NM,
        y: [0.5], quantity: 'T', isPercent: false,
    });
    const csv = curvesToCsv([curve]);
    ok('csv name escaping', csv === 'Wavelength (nm),"A,B ""quoted""\nline %T"\r\n500,50\r\n');
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

{
    const csv = tableToCsv({ x: [500], columns: [{ name: 'A,B "quoted"', values: [50] }] });
    ok('tableToCsv name escaping', csv === 'Wavelength (nm),"A,B ""quoted"""\r\n500,50\r\n');
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

// ── Layouts taken from real instrument exports ──────────────────────────────
// Each block reproduces the shape of a file that a real instrument writes, with
// invented numbers. The originals and what each one used to do are recorded in
// the corpus these were built from; the numbers here are not measurements.

// PerkinElmer PEDS ASCII: a long header of bare settings, one of which reads as
// two numbers and a word, then #DATA. Without the marker the header's own
// values are read as the start of the spectrum.
{
    const text = [
        'PE FL                   SPECTRUM    ASCII       PEDS        1.60',
        '  -1', 'SAMPLE01.TXT', '07/12/10', '#GR', 'NM', '',
        '350.00', '4.50', '405 350 NORM', '181', '106.949666', '27.150000',
        '#DATA',
        '405.000000\t27.150000', '405.500000\t32.344666', '406.000000\t33.378666',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('peds parses', t.ok && t.nRows === 3);
    ok('peds starts at the data marker', t.x[0] === 405 && t.x[2] === 406);
    ok('peds takes no name from a settings line', t.columns[0].name === 'Column 2');
    ok('peds first value', approx(t.columns[0].values[0], 27.15));
}

// A marker that closes the data rather than introducing it must not take the
// whole file with it.
{
    const text = [
        'Wavelength\tT', '400\t88.5', '401\t88.7', '>>>>>End Spectral Data<<<<<',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('trailing marker still imports', t.ok && t.nRows === 2 && t.x[0] === 400);
}

// ADAP reflectometer: every row is tagged with the measurement it belongs to.
{
    const text = [
        'Measured data written by ADAP', 'nm',
        'uR  402.523800  0.000000  0.237728  0.010000',
        'uR  405.837300  0.000000  0.253238  0.010000',
        'uR  409.149400  0.000000  0.262970  0.010000',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('row tag parses', t.ok && t.nRows === 3);
    ok('row tag dropped from x', approx(t.x[0], 402.5238));
    ok('row tag leaves three y columns', t.columns.length === 3);
    ok('row tag y value', approx(t.columns[1].values[0], 0.237728));
}

// A tagged file whose header names the tag column: the names still line up.
{
    const text = [
        'SE PSI DELTA', 'AOI\t 75.7',
        'SE 239.986\t0.73023\t-0.026679',
        'SE 240.100\t0.744085\t-0.0293415',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('tagged header names', t.columns.map(c => c.name).join('|') === 'PSI|DELTA');
    ok('tagged header skips the AOI line', t.nRows === 2 && approx(t.x[0], 239.986));
    ok('ellipsometry quantities detected',
        t.columns[0].quantity === 'PSI' && t.columns[1].quantity === 'DEL');
    ok('ellipsometry angles are not percentages',
        !t.columns[0].isPercent && !t.columns[1].isPercent);
    ok('tagged ellipsometry AOI preserved',
        t.aoi === 75.7 && t.columns.every(column => column.aoi === 75.7));
}

// A variable-angle export repeats the wavelengths once per angle in one flat
// table. It is split into one Psi/Delta pair per AOI; the AOI column itself is a
// measurement condition, not a plottable spectrum.
{
    const text = [
        'Wavelength (nm)\tAOI (deg)\tPsi (deg)\tDelta (deg)',
        '400\t65\t22.1\t174.2', '500\t65\t24.3\t161.8',
        '400\t70\t20.7\t169.4', '500\t70\t23.1\t154.6',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('variable-angle table parses', t.ok && t.columns.length === 4);
    ok('AOI column is not a spectrum', !t.columns.some(column => /^AOI/i.test(column.name)));
    ok('variable AOIs preserved', t.aois.join('|') === '65|70');
    ok('pairs are typed and split',
        t.columns.map(column => `${column.quantity}@${column.aoi}`).join('|')
            === 'PSI@65|PSI@70|DEL@65|DEL@70');
    ok('split grids retain matching rows',
        t.columns[1].x.join('|') === '400|500' && t.columns[1].values.join('|') === '20.7|23.1');
}

// Ψ and Δ are read from a column's own name, never from the file header as a
// whole. An ellipsometry export names them in its header text and then writes
// half a dozen other columns beside them; matching the header would type the
// exposure time and the region of interest as Ψ along with the real pair.
{
    const text = [
        '#ROIidx\tAOI\tLambda\tExposureTime\tDelta\tPsi',
        '#-\tdeg\tnm\tus\tdeg\tdeg',
        '0\t40.000\t365.0\t115908\t179.785\t32.536',
        '0\t40.000\t370.0\t113546\t179.816\t32.514',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('only the named columns are angular',
        t.columns.filter(column => column.quantity === 'PSI').length <= 1
        && t.columns.filter(column => column.quantity === 'DEL').length <= 1);
    ok('a header mentioning Psi does not type an unnamed column',
        detectQuantity('#ROIidx AOI Lambda Delta Psi', { angular: false }) === null);
    ok('a column named Psi still is Psi', detectQuantity('Psi (deg)') === 'PSI');
}

// Ellipsometry software works in photon energy. An eV axis and a µm axis cover
// the same numbers, so eV is taken from the header only: an unlabelled 1.5 stays
// 1.5 µm, and calling it eV would put the point at 1500 nm instead of 827 nm.
{
    const text = [
        'Photon Energy (eV)\tPsi (deg)\tDelta (deg)',
        '1.5\t22.14\t152.4', '2.0\t24.31\t141.8', '3.0\t27.02\t128.6',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('eV axis detected from the header', t.xUnit === X_UNITS.EV);
    ok('eV converts through Planck', approx(xToNm(1.5, X_UNITS.EV), 826.561322, 1e-5));
    ok('eV round-trips', approx(nmToX(xToNm(2.0, X_UNITS.EV), X_UNITS.EV), 2.0, 1e-9));

    const curve = makeMeasuredCurve({
        name: 'Psi', x: t.x, xUnit: t.xUnit, y: t.columns[0].values,
        quantity: 'PSI', aoi: 70,
    });
    ok('eV curve lands on the right wavelengths',
        approx(curve.x[0], 413.280661, 1e-5) && approx(curve.x[2], 826.561322, 1e-5));
    ok('an unlabelled small axis is still µm',
        guessXUnitFromRange([1.5, 2.0, 3.0]) === X_UNITS.UM);
    ok('a wavelength unit in the header beats eV',
        detectXUnit('Wavelength (nm), scanned 1.5-6.5 eV') === X_UNITS.NM);
}

// Avantes AvaSoft: names on one line, units on the next. The units belong to
// their own column, so a neighbour's [%] must not set the scale of [counts].
{
    const text = [
        'Data measured with spectrometer [name]: 1209167U1',
        'Wave   ;Sample   ;Dark     ;Reflectance',
        '[nm]   ;[counts] ;[counts] ;[%]',
        ' 300.00;    0.400;    0.200;42.5',
        ' 301.00;    0.410;    0.200;43.1',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('two-line header names', t.columns.map(c => c.name).join('|') === 'Sample|Dark|Reflectance');
    ok('two-line header units', t.columns.map(c => c.unit).join('|') === '[counts]|[counts]|[%]');
    ok('unit percent does not leak', t.columns[0].isPercent === false && t.columns[2].isPercent === true);
    ok('two-line header quantity', t.columns[2].quantity === 'R');
}

// A header line commented out with a marker has one field more than it has
// columns, which used to shift every name onto its neighbour.
{
    const text = [
        '; ENVI/IDL output', '; Wavelength S000 S001 S002',
        '1100.0 0.0367 0.0119 -0.1638', '1107.0 0.0371 0.0122 -0.1601',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('comment header names', t.columns.map(c => c.name).join('|') === 'S000|S001|S002');
}

// Shimadzu UV-Probe: quoted header, and the percent sign after the letter.
{
    const text = [
        '"R_0.spc - RawData"', '"Wavelength nm.","R%"',
        '400.00,21.563', '401.00, ', '402.00,21.396', '403.00, ', '404.00,21.244',
    ].join('\n');
    const t = parseSpectrumTable(text);
    ok('quoted header name', t.columns[0].name === 'R%');
    ok('R% is reflectance', t.columns[0].quantity === 'R');
    ok('blank value rows are dropped', t.nRows === 3);
    ok('blank value rows are counted', t.skippedRows === 2);
}

// A header that numbers its samples is still a header, not a tagged data row.
{
    const text = ['Wavelength,1,2,3', '400,0.1,0.2,0.3', '401,0.11,0.21,0.31'].join('\n');
    const t = parseSpectrumTable(text);
    ok('numeric column names kept', t.columns.map(c => c.name).join('|') === '1|2|3');
    ok('numeric header not read as data', t.nRows === 2 && t.x[0] === 400);
}

// Export and re-import must not change what the curve measures.
{
for (const quantity of ['T', 'R', 'A']) {
        const curve = makeMeasuredCurve({
            name: 'Sample', x: [400, 500, 600], xUnit: X_UNITS.NM,
            y: [0.10, 0.20, 0.30], quantity,
        });
        const back = parseSpectrumTable(curvesToCsv([curve]));
        ok(`csv round trip keeps ${quantity}`, back.columns[0].quantity === quantity);
        ok(`csv round trip keeps ${quantity} values`,
            approx(back.columns[0].values[0], 10) && back.columns[0].isPercent);
    }
}

// Ellipsometric angles stay in degrees even when measured curves are exported
// with the ordinary photometric "percent" option enabled.
{
    const psi = makeMeasuredCurve({
        name: 'Psi', x: [500, 600], y: [23.5, 24.1], quantity: 'PSI', isPercent: true,
    });
    const delta = makeMeasuredCurve({
        name: 'Delta', x: [500, 600], y: [179.5, 181.2], quantity: 'DEL', isPercent: true,
    });
    ok('ellipsometry curve stores degrees', psi.y[0] === 23.5 && delta.y[1] === 181.2);
    const back = parseSpectrumTable(curvesToCsv([psi, delta]));
    ok('ellipsometry CSV round trip keeps quantities',
        back.columns[0].quantity === 'PSI' && back.columns[1].quantity === 'DEL');
    ok('ellipsometry CSV round trip keeps degrees',
        back.columns[0].values[0] === 23.5 && back.columns[1].values[1] === 181.2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
