// A design's weighted averages of T, R and A, as design.integrals() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { exportColumns, exportRows } from '../../components/windows/analysis/integralValues/exportModel.js';
import en from '../../constants/locales/en.js';

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, an empty cell for none, a name with each comma made a
// semicolon.
function cell(value) {
    if (value == null) return '';
    return typeof value === 'number' ? String(value) : String(value).replace(/,/g, ';');
}

// The window's export rows (exportModel.js) for the rows `rows`, each named by
// its key, the built-in rows' label in the window.
function tableRows(rows) {
    const definitions = rows.map(r => ({ key: r.key, label: r.key, weighting: { lamMin: r.band[0], lamMax: r.band[1] } }));
    const results = Object.fromEntries(rows.map(r => [r.key, { value: r.value, min: r.min, lamAtMin: r.minAt, max: r.max, lamAtMax: r.maxAt }]));
    return exportRows(definitions, results, en.units);
}

/**
 * A design's weighted averages of T, R and A, as design.integrals() computes
 * them and the Integral Values window lists them: the built-in rows, Tvis to
 * RNIR, and then the rows of your own, each read by its key with get().
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('HL');
 * const iv = design.integrals();
 * console.log(iv.mode, 'Tvis', iv.get('Tvis').value.toFixed(4), 'Rsol', iv.get('Rsol').value.toFixed(4));
 */
export class Integrals {
    constructor(table) {
        this._table = table;
    }

    /**
     * The sides computed: `'front'`, `'back'` or `'total'`, the whole part.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals().mode);
     */
    get mode() { return this._table.mode; }

    /**
     * The first wavelength of the spectrum, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals({ start: 350 }).start, 'nm');
     */
    get start() { return this._table.start; }

    /**
     * The last wavelength of the spectrum, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals({ end: 1200 }).end, 'nm');
     */
    get end() { return this._table.end; }

    /**
     * The wavelength step, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals({ step: 1 }).step, 'nm');
     */
    get step() { return this._table.step; }

    /**
     * The angle of incidence, degrees in the incident medium.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals({ angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._table.angle; }

    /**
     * The polarization: `'avg'`, `'s'` or `'p'`.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals({ angle: 45, pol: 'p' }).pol);
     */
    get pol() { return this._table.pol; }

    /**
     * The rows, the built-in ones first as the window lists them, then
     * yours, each `{ key, quantity, value, min, minAt, max, maxAt, band,
     * covered, spectrumSpan }`: `quantity` `'T'`, `'R'` or `'A'`; `value` the
     * weighted average and `min` and `max` the lowest and highest value over
     * the band, fractions of 1; `minAt` and `maxAt` their wavelengths, nm;
     * `band` the band integrated, `[start, end]` in nm; `covered` whether the
     * spectrum spans the band, its numbers NaN when it does not or when the
     * weighting is 0 over the whole band;
     * `spectrumSpan` the spectrum's first and last wavelength, nm.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * for (const row of design.integrals().rows) console.log(row.key, row.covered ? row.value.toFixed(4) : 'no value');
     */
    get rows() { return this._table.rows; }

    /**
     * The row of the integral named `key`, as `rows` gives it.
     *
     * @param key The row's key: Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR, RNIR, or the key of a row of your own.
     * @returns The row.
     * @throws a key no row has
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * const { value, min, minAt } = design.integrals().get('Rvis');
     * console.log('Rvis', value.toFixed(4), 'lowest', min.toFixed(4), 'at', minAt, 'nm');
     */
    get(key) {
        const row = this._table.rows.find(r => r.key === key);
        if (!row) throw new Error(`integrals: no row has the key ${inspect(key)}; the keys are ${this._table.rows.map(r => r.key).join(', ')}`);
        return row;
    }

    /**
     * The materials of the sides computed whose data stop inside the range,
     * an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their
     * n and k are held at the last value (`heldFlat` true) or extrapolated.
     * Empty when every material covers it.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.integrals().outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._table.outOfRange; }

    /**
     * Writes the rows to a CSV file as the window's English export writes
     * its table: Integral, Value, %, Min, Min λ (nm), Max, Max λ (nm) and
     * Band, with each row named by its key, which for the built-in rows is
     * the window's own name, and an empty cell where a row has no value. A
     * file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `integrals-${Date.now()}.csv`);
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * design.integrals().saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const columns = exportColumns(en);
        const lines = [columns.map(c => c.label), ...tableRows(this._table.rows).map(row => columns.map(c => row[c.key]))];
        fs.writeFileSync(path, lines.map(line => line.map(cell).join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the rows.
    [inspect.custom]() {
        const { mode, start, end, rows } = this._table;
        return `<Integrals ${mode} from ${start} to ${end} nm: ${rows.length} rows>`;
    }
}
