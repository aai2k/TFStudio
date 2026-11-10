/**
 * The files the Monitor Worksheet exports: its table, and the signal curves its
 * chart draws, as delimited text.
 *
 * The output options are the Process Exporter's, cut to what fits a worksheet:
 *
 *   files        'table': one file for the whole run.
 *                'chip': one file per witness chip.
 *   header       'conditions': design, chip, monitor and chip glass on # lines,
 *                then the column names.
 *                'names': the column names only.
 *                'none': numbers only.
 *   delimiter    ',' | ';' | '\t' | ' '
 *   decimals     decimals of every measured value; layer and chip numbers stay
 *                whole and wavelengths are written as they are
 *   decimalMark  '.' | ','
 *
 * The # lines are English, as in the Process Exporter's files; the column
 * names are the window's own.
 */

export const WORKSHEET_OUTPUT = Object.freeze({
    files: 'table', header: 'conditions', delimiter: ',', decimals: 5, decimalMark: '.',
});

const POLARIZATION = { avg: 'average', s: 's', p: 'p' };

/** The saved options over the defaults; a saved value of the wrong shape is ignored. */
export function outputFrom(saved) {
    const options = saved && typeof saved === 'object' ? saved : {};
    return { ...WORKSHEET_OUTPUT, ...options };
}

// ── Writing a table ──────────────────────────────────────────────────────────

function field(text, delimiter) {
    if (!text.includes(delimiter) && !/["\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

// Twelve decimals, trailing zeroes trimmed: a wavelength as it was entered.
const exact = value => String(Number(value.toFixed(12)));

function cellText(value, kind, output) {
    if (value == null) return '';
    if (kind === 'text') return String(value);
    if (!Number.isFinite(value)) return '';
    const text = kind === 'int' ? String(Math.round(value))
        : kind === 'exact' ? exact(value)
        : value.toFixed(output.decimals);
    return output.decimalMark === ',' ? text.replace('.', ',') : text;
}

/** `columns` [{ name, kind, value(row) }], `rows` anything value() reads. */
function tableText(columns, rows, headerLines, output) {
    const d = output.delimiter;
    const lines = output.header === 'conditions' ? [...headerLines] : [];
    if (output.header !== 'none') lines.push(columns.map(column => field(column.name, d)).join(d));
    for (const row of rows) {
        lines.push(columns.map(column => field(cellText(column.value(row), column.kind, output), d)).join(d));
    }
    return lines.join('\r\n') + '\r\n';
}

// ── What the run was ─────────────────────────────────────────────────────────

const mark = (value, output) => (output.decimalMark === ',' ? String(value).replace('.', ',') : String(value));

/**
 * The # lines of a file. `chip` is the chip the file holds, or null for the
 * whole run; a chip's file names its monitoring wavelength, which every layer
 * on a chip shares.
 */
function conditionLines(meta, output, chip, lambda) {
    const lines = [`# ${meta.designName}${chip == null ? '' : `, witness chip ${chip}`}`];
    lines.push(`# Monitor: ${meta.char} at AOI ${mark(meta.theta, output)} deg, polarization ${POLARIZATION[meta.pol] || meta.pol}`);
    if (chip != null && Number.isFinite(lambda)) lines.push(`# Monitoring wavelength: ${mark(lambda, output)} nm`);
    lines.push(`# Chip glass: ${meta.chipGlass}, witness ratio ${mark(meta.witnessRatio, output)}`);
    return lines;
}

// The design name as a file name: anything but letters, digits, dot and dash
// becomes '_', as in the table's own CSV name.
const fileBase = name => (name || 'design').replace(/[^\w.-]+/g, '_');

function chipsOf(rows) {
    return [...new Set(rows.map(row => row.chip))].sort((a, b) => a - b);
}

/**
 * The files of one export: [{ filename, content }]. `rows` are what the
 * columns read; `name` names the file after the design. One table holds every
 * row; one file per chip holds that chip's rows, in run order.
 */
function filesOf({ columns, rows, meta, output, name }) {
    const base = `${fileBase(meta.designName)}_${name}`;
    if (output.files !== 'chip') {
        return [{ filename: `${base}.csv`, content: tableText(columns, rows, conditionLines(meta, output, null), output) }];
    }
    return chipsOf(rows).map(chip => {
        const own = rows.filter(row => row.chip === chip);
        const header = conditionLines(meta, output, chip, own[0]?.lambda);
        return { filename: `${base}_chip-${chip}.csv`, content: tableText(columns, own, header, output) };
    });
}

// ── The two exports ──────────────────────────────────────────────────────────

const TABLE_KINDS = {
    step: 'int', chip: 'int', material: 'text', lambda: 'exact', turningPoints: 'int',
};

/**
 * The worksheet table as the window shows it. `columns` are the window's
 * (tableModel.js worksheetColumns), `rows` its display rows (worksheetRows).
 */
export function tableFiles({ columns, rows, meta, output }) {
    const written = columns.map(column => ({
        name: column.label, kind: TABLE_KINDS[column.key] || 'value', value: row => row[column.key],
    }));
    return filesOf({ columns: written, rows, meta, output, name: 'monitor_worksheet' });
}

/**
 * The signal curves the chart draws, as the monitor reads them: for every
 * layer, from the start of the layer to its cut, the thickness deposited in
 * the layer on the chip, the run position on the chart's axis and the signal.
 * The continuation past the cut, which the chart draws dashed, is a layer that
 * was never deposited and is left out.
 *
 * `rows` are the worksheet's own (buildMonitorWorksheet), with their curves.
 * `names` { step, chip, lambda, thickness, position, signal } are the column
 * names.
 */
export function curveFiles({ rows, names, meta, output }) {
    const points = [];
    for (const row of rows) {
        if (!row.curve) continue;
        const { thickness, x, y } = row.curve;
        const at = (d, position, signal) => ({
            step: row.step, chip: row.chip, lambda: row.lambda, thickness: d, position, signal: signal * 100,
        });
        for (let k = 0; k < thickness.length && thickness[k] < row.thickness; k++) {
            points.push(at(thickness[k], x[k], y[k]));
        }
        points.push(at(row.thickness, row.xCut, row.signal));
    }
    const columns = [
        { name: names.step, kind: 'int', value: p => p.step },
        { name: names.chip, kind: 'int', value: p => p.chip },
        { name: names.lambda, kind: 'exact', value: p => p.lambda },
        { name: names.thickness, kind: 'value', value: p => p.thickness },
        { name: names.position, kind: 'value', value: p => p.position },
        { name: names.signal, kind: 'value', value: p => p.signal },
    ];
    return filesOf({ columns, rows: points, meta, output, name: 'signal_curves' });
}
