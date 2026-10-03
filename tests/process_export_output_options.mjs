/**
 * Process Exporter output options: CSV and text tables beside .res.
 *
 *   - .res is the default, and stays the same file whatever table options are
 *     set beside it;
 *   - a CSV step file holds the .res file's numbers, under the .res header
 *     with its layer table, under conditions lines, or under nothing;
 *   - delimiter, decimal mark, decimals and percent or fraction change how
 *     the numbers are written, never which numbers they are, and the
 *     spectrum importer reads them back, a fractional angle under a decimal
 *     comma included;
 *   - a text file is the CSV file under a .txt name;
 *   - one table per run holds every step as a column: one file for the part,
 *     one per witness chip, its file arriving on the run's last step;
 *   - the window's Settings panel shows the table options for CSV and text
 *     only, and the Save button names the format.
 *
 * Run: node tests/process_export_output_options.mjs
 */
import { buildAllProcessFiles, processFileSteps } from '../src/utils/io/processFileExport.js';
import { parseSpectrumTable, tableToCsv } from '../src/utils/io/spectrumTable.js';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const H = 'builtin:TiO2';
const L = 'builtin:SiO2';
const N = 6;

// Storage order: front layers air first, back layers substrate first.
function design(name = 'Mirror 6L') {
    const front = [];
    for (let i = 0; i < N; i++) {
        front.push({ id: `f${i}`, material: i % 2 ? L : H, thickness: i % 2 ? 94.1 : 57.3 });
    }
    return {
        id: 'opts', name, referenceWavelength: 550,
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'builtin:BK7', thickness: 1 },
        frontLayers: front,
        backLayers: [{ id: 'b0', material: 'builtin:MgF2', thickness: 95 }],
    };
}
const OPTS = {
    activeSide: 'front', secondSurface: 'bare', quantity: 'T', aoi: 12, polarization: 's',
    lambdaStart: 500, lambdaEnd: 600, lambdaStep: 0.5,
    outputDir: 'X:\\out', appVersion: 'test', projectLabel: 'Mirror 6L',
};
const CSV = { format: 'csv', files: 'step', header: 'conditions' };

const lines = content => content.split('\r\n').slice(0, -1);
const timeless = content => content.replace(/^\d\d\.\d\d\.\d{4} \d+:\d\d:\d\d$/m, 'TIME');

// The numbers of a .res file as written: wavelength and percent, as text.
function resRows(content) {
    return lines(content)
        .map(line => /^\s*(\d+\.\d{4})\s+(-?\d+\.\d{5})$/.exec(line))
        .filter(Boolean)
        .map(m => [Number(m[1]), m[2]]);
}
const resFiles = (opts = OPTS) => buildAllProcessFiles(design(), opts);
const files = (output, opts = OPTS) => buildAllProcessFiles(design(), { ...opts, output });

// ── 1. .res stays the default and stays the same file ───────────────────────
{
    const res = resFiles();
    const withTableOptions = files({
        format: 'res', files: 'table', header: 'none', delimiter: ';',
        scale: 'fraction', decimals: 2, decimalMark: ',',
    });
    ok(res.length === N && withTableOptions.length === N
        && res.every((f, i) => f.filename === withTableOptions[i].filename
            && timeless(f.content) === timeless(withTableOptions[i].content)),
       '.res is the default and ignores the table options');
}

// ── 2. A CSV step file holds the .res numbers ────────────────────────────────
{
    const res = resFiles();
    const csv = files(CSV);
    ok(csv.map(f => f.filename).join(' ') === '01.csv 02.csv 03.csv 04.csv 05.csv 06.csv'
        && csv.every(f => f.subdir === undefined),
       'one CSV per step, named like the .res files, in the chosen folder');
    const sameNumbers = csv.every((f, k) => {
        const rows = resRows(res[k].content);
        const data = lines(f.content).slice(4).map(line => line.split(','));
        return data.length === rows.length && rows.length > 0
            && data.every(([x, y], i) => Number(x) === rows[i][0] && y === rows[i][1]);
    });
    ok(sameNumbers, 'every step file writes the .res wavelengths and the .res percentages digit for digit');
    ok(lines(csv[2].content).slice(0, 4).join('\n') === [
        '# Mirror 6L',
        '# Step 3 of 6, front coating, AOI 12 deg, front side',
        '# Polarization: s',
        'Wavelength (nm),%T',
    ].join('\n'), 'the conditions header names the step, the coating, the angle and the polarization');
    const back = parseSpectrumTable(csv[2].content);
    const conditions = back.aoi === 12 && back.pol === 's' && back.side === 'front';
    const column = back.columns.length === 1 && back.columns[0].quantity === 'T' && back.columns[0].isPercent;
    ok(back.ok && conditions && column, 'the importer reads the angle, polarization, side and quantity back');
}

// ── 3. The layer-table header and no header ─────────────────────────────────
{
    const res = resFiles();
    const layered = files({ ...CSV, header: 'layers' });
    const resHead = content => timeless(content).split('\r\n Wavelength')[0];
    ok(layered.every((f, k) => timeless(f.content).startsWith(`${resHead(res[k].content)}\r\nWavelength (nm),%T\r\n`)),
       'the layer-table header is the .res header line for line, then the column names');
    const bare = files({ ...CSV, header: 'none' });
    const first = lines(bare[0].content);
    ok(first.length === resRows(res[0].content).length && /^500,\d+\.\d{5}$/.test(first[0]),
       'no header writes numbers only, without column names');
}

// ── 4. How the numbers are written ──────────────────────────────────────────
{
    const res = resFiles();
    const percent = resRows(res[2].content).map(([, y]) => Number(y));
    const variants = [
        { delimiter: ';', decimalMark: ',', scale: 'fraction', decimals: 7 },
        { delimiter: '\t', decimalMark: '.', scale: 'percent', decimals: 3 },
        { delimiter: ' ', decimalMark: '.', scale: 'fraction', decimals: 9 },
        { delimiter: ';', decimalMark: ',', scale: 'percent', decimals: 0 },
    ];
    for (const v of variants) {
        const file = files({ ...CSV, ...v })[2];
        const back = parseSpectrumTable(file.content);
        const factor = v.scale === 'fraction' ? 0.01 : 1;
        const tolerance = 0.5 * 10 ** -v.decimals + 1e-12;
        const values = back.columns[0]?.values || [];
        const row = lines(file.content)[5];
        const fields = row.split(v.delimiter);
        const read = back.ok && back.delimiter === v.delimiter && back.decimal === v.decimalMark;
        const conditions = back.aoi === 12 && back.pol === 's';
        const same = values.length === percent.length
            && values.every((y, i) => Math.abs(y - percent[i] * factor) <= tolerance + 1e-5 * factor);
        ok(read && conditions && same, `${JSON.stringify(v)}: the importer reads the same spectrum back`);
        const decimals = fields[1].split(v.decimalMark)[1] || '';
        ok(fields.length === 2 && fields[0] === (v.decimalMark === ',' ? '500,5' : '500.5')
            && decimals.length === v.decimals,
           `${JSON.stringify(v)}: the wavelength is exact and every value has ${v.decimals} decimals`);
    }
    const quoted = lines(files({ ...CSV, delimiter: ',', decimalMark: ',' })[2].content)[5];
    ok(/^"500,5","\d+,\d{5}"$/.test(quoted), 'a decimal comma under a comma delimiter is quoted');

    // The importer takes the decimal mark from every number in the file, so
    // the angle in the header is written with the mark the rows use.
    const fractional = files({ ...CSV, delimiter: ';', decimalMark: ',' }, { ...OPTS, aoi: 12.5 })[2].content;
    const angled = parseSpectrumTable(fractional);
    ok(lines(fractional)[1].endsWith('AOI 12,5 deg, front side'), 'a fractional angle is written with the decimal comma');
    ok(angled.ok && angled.aoi === 12.5 && angled.columns[0].values.length === percent.length,
       'and the importer reads the file and the angle back');
    const fraction = lines(files({ ...CSV, scale: 'fraction' })[2].content);
    ok(fraction[3] === 'Wavelength (nm),T', 'a fraction column is named without the percent sign');
}

// ── 5. Text is CSV under a .txt name ─────────────────────────────────────────
{
    const output = { ...CSV, delimiter: '\t' };
    const csv = files(output);
    const txt = files({ ...output, format: 'txt' });
    ok(txt.map(f => f.filename).join(' ') === '01.txt 02.txt 03.txt 04.txt 05.txt 06.txt'
        && txt.every((f, i) => f.content === csv[i].content),
       'a text file is the CSV file under a .txt name');
}

// ── 6. One table per run ─────────────────────────────────────────────────────
{
    const table = { ...CSV, files: 'table' };
    const steps = [...processFileSteps(design(), { ...OPTS, output: table })];
    const counted = steps.map(s => `${s.index}/${s.total}`).join() === '1/6,2/6,3/6,4/6,5/6,6/6';
    const arrives = steps.slice(0, -1).every(s => s.file === null) && Boolean(steps[N - 1].file);
    ok(counted && arrives, 'the table counts every step and arrives on the last');
    const [file] = files(table);
    ok(file.filename === 'Mirror 6L.csv' && file.subdir === undefined, 'the part is one file named for the design');
    const back = parseSpectrumTable(file.content);
    const perStep = files(CSV).map(f => parseSpectrumTable(f.content).columns[0].values);
    ok(back.ok && back.columns.length === N
        && back.columns.every((c, k) => c.name === `Step ${k + 1} %T` && c.quantity === 'T'
            && c.values.every((y, i) => y === perStep[k][i])),
       'each column is that step, equal to its step file');
    ok(lines(file.content)[1] === '# 6 steps, front coating, AOI 12 deg, front side',
       'the conditions line describes the whole run');
    const layered = files({ ...table, header: 'layers' })[0].content;
    ok(!/^\s+\d+\s+0\.000\s/m.test(layered) && layered.includes('The number of layers = 6'),
       'the layer table of a run table shows the run complete');

    const backSide = { ...OPTS, activeSide: 'back' };
    const backTable = parseSpectrumTable(files(table, backSide)[0].content);
    const backRes = resFiles(backSide).map(f => resRows(f.content).map(([, y]) => Number(y)));
    ok(backTable.columns.length === 1 && backTable.columns[0].values.every((y, i) => y === backRes[0][i]),
       'a back-side run tables its one step the way the .res file writes it');
}

// ── 7. Witness chips ─────────────────────────────────────────────────────────
{
    const chips = { chipByStep: [1, 1, 2, 2, 1, 2], chipMaterial: null, witnessRatio: 1 };
    const onChips = { ...OPTS, chips };
    const res = resFiles(onChips);
    const csv = files(CSV, onChips);
    ok(csv.map(f => `${f.subdir}/${f.filename}`).join(' ')
        === 'chip-1/01.csv chip-1/02.csv chip-1/03.csv chip-2/01.csv chip-2/02.csv chip-2/03.csv',
       'chip step files go in the chip folders, like .res');
    ok(lines(csv[2].content).slice(0, 2).join('\n')
        === '# Mirror 6L, witness chip 1\n# Step 3 of 3 on the chip, design layer 5 of 6, AOI 12 deg, front side',
       'a chip step file names the chip and the design layer');
    const tables = files({ ...CSV, files: 'table' }, onChips);
    ok(tables.map(f => `${f.subdir}/${f.filename}`).join(' ') === 'undefined/Mirror 6L_chip-1.csv undefined/Mirror 6L_chip-2.csv',
       'one table per chip, in the chosen folder');
    const chip2 = parseSpectrumTable(tables[1].content);
    const chip2Res = res.filter(f => f.subdir === 'chip-2').map(f => resRows(f.content).map(([, y]) => Number(y)));
    ok(chip2.columns.length === 3 && chip2.columns.every((c, k) => c.values.every((y, i) => y === chip2Res[k][i])),
       "a chip table's columns are that chip's step files");
    ok(lines(tables[1].content)[1] === '# 3 steps on the chip, design layers 3, 4, 6 of 6, AOI 12 deg, front side',
       'a chip table lists the design layers it carries');
    const layered = files({ ...CSV, files: 'table', header: 'layers' }, onChips)[1].content;
    ok(layered.includes('Comment: Witness chip 2, 3 layers on the chip: design layers 3, 4, 6 of 6')
        && layered.includes('Output directory:  X:\\out\\'),
       'its layer-table header maps the chip to the design and names the folder it is in');

    const single = { ...OPTS, chips: { chipByStep: [1, 1, 2, 1, 1, 1], chipMaterial: null, witnessRatio: 1 } };
    const one = files({ ...CSV, files: 'table' }, single)[1].content;
    const oneLayered = files({ ...CSV, files: 'table', header: 'layers' }, single)[1].content;
    ok(lines(one)[1] === '# 1 step on the chip, design layer 3 of 6, AOI 12 deg, front side'
        && oneLayered.includes('Comment: Witness chip 2, 1 layer on the chip: design layer 3 of 6'),
       'a chip with one layer is described in the singular');
}

// ── 8. File names and the shared writer ─────────────────────────────────────
{
    const named = buildAllProcessFiles(design('Зеркало: A/B'), { ...OPTS, output: { ...CSV, files: 'table' } });
    ok(named[0].filename === 'Зеркало_ A_B.csv', 'a run table keeps the design name, minus what Windows refuses');
    const plain = tableToCsv({ x: [400.5], columns: [{ name: 'T', values: [0.1234567890123456] }] });
    ok(plain === 'Wavelength (nm),T\r\n400.5,0.123456789012\r\n',
       'without the new options the shared writer writes what it always has');
}

// ── 9. The Settings panel and the Save button ───────────────────────────────
{
    // A React just large enough to draw the control row once.
    globalThis.React = {
        createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
        Fragment: 'fragment',
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: () => {},
        useRef: initial => ({ current: initial }),
        useCallback: fn => fn,
        useMemo: fn => fn(),
        createContext: value => ({ value }),
        useContext: context => context.value,
    };
    const { ProcessControls } = await import(
        '../src/components/windows/dataExchange/processSimulator/ProcessControls.js');
    const { PopoverButton } = await import('../src/components/windows/analysis/chrome/popover.js');
    const { DEFAULT_OUTPUT } = await import('../src/utils/io/processFileExport.js');
    const { getLocale } = await import('../src/constants/locales/index.js');
    const t = getLocale('en');
    const sp = t.processSim;

    // Draws every component in place, with the settings panel open.
    const expand = node => {
        if (!node || typeof node !== 'object') return node;
        if (node.type === PopoverButton) return { type: 'panel', props: { children: [node.props.children].flat(Infinity).map(expand) } };
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: [node.props?.children].flat(Infinity).map(expand) } };
    };
    const nodes = node => (!node || typeof node !== 'object') ? []
        : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
    const textOf = node => (!node || typeof node !== 'object') ? (node == null || node === false ? '' : String(node))
        : [node.props?.children].flat(Infinity).map(textOf).join('');
    const c = { border: '#333', bg: '#000', text: '#eee', textDim: '#999', accent: '#39f', error: '#f33', success: '#3f3', light: false };

    const draw = (output) => {
        const set = [];
        const setup = { output, setOutputOption: (key, value) => set.push([key, value]) };
        const tree = expand(ProcessControls({
            c, t, sp, setup, deposition: { N: 6 }, notices: [], chipMode: false,
            save: { saving: false, progress: null, statusMsg: null, handleSave() {} },
        }));
        const all = nodes(tree);
        const group = label => all.find(n => n.props?.role === 'group' && n.props['aria-label'] === label);
        const row = label => all.find(n => n.type === 'div' && textOf(n.props.children?.[0]) === label);
        return { set, all, group, row };
    };

    const res = draw({ ...DEFAULT_OUTPUT });
    ok(res.all.some(n => n.type === 'button' && textOf(n) === 'Save .res Files…'),
       'the Save button keeps its .res label by default');
    ok(res.group(sp.fileFormat) && !res.group(sp.headerLabel) && !res.group(sp.delimiterLabel),
       'with .res chosen the panel shows the format and none of the table options');

    const csv = draw({ ...DEFAULT_OUTPUT, format: 'csv' });
    ok(csv.all.some(n => n.type === 'button' && textOf(n) === 'Save .csv Files…'),
       'the Save button names the format chosen');
    const shown = [sp.filesLabel, sp.headerLabel, sp.delimiterLabel, t.spectrumExchange.exportScaleLabel, sp.decimalMarkLabel]
        .every(label => csv.group(label));
    ok(shown && csv.row(sp.decimalsLabel), 'with CSV chosen every table option is in the panel');
    ok(nodes(csv.group(sp.delimiterLabel)).filter(n => n.type === 'button').map(textOf).join('|') === 'comma|semicolon|tab|space',
       'the delimiters are named in words');
    nodes(csv.group(sp.headerLabel)).find(n => n.type === 'button' && textOf(n) === sp.headerNone).props.onClick();
    ok(csv.set.some(([key, value]) => key === 'header' && value === 'none'), 'picking a header sets it');

    const buttons = (drawn, label) => nodes(drawn.group(label)).filter(n => n.type === 'button');
    buttons(csv, sp.decimalMarkLabel).find(n => textOf(n) === '0,5').props.onClick();
    ok(csv.set.map(([key, value]) => `${key}=${value}`).join(' ') === 'header=none decimalMark=, delimiter=;',
       'choosing the decimal comma moves a comma delimiter to a semicolon');
    const comma = draw({ ...DEFAULT_OUTPUT, format: 'csv', delimiter: ';', decimalMark: ',' });
    ok(buttons(comma, sp.delimiterLabel).map(textOf).join('|') === 'semicolon|tab|space',
       'and the comma delimiter is not offered beside a decimal comma');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
