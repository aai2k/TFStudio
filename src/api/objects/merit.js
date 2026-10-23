// A design's merit function: its rows, and their values.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { defined, trailingOptions } from './options.js';
import { worded } from './refusals.js';

// How merit.add() words what setMerit refuses of the one row it is given:
// start and end are its arguments, as is the type.
const ADD_WORDS = { method: 'add', call: 'setMerit: row 0', names: { lambdaStart: 'start', lambdaEnd: 'end' }, hidden: ['type', 'lambdaStart', 'lambdaEnd'] };

// Refuses an option that names a field add() takes as an argument, which
// the argument would otherwise replace without a word.
function refuseArgumentOptions(options) {
    const argument = Object.keys(options ?? {}).find(name => ['type', 'lambdaStart', 'lambdaEnd'].includes(name));
    if (argument) throw new Error(`add: unknown option '${argument}'; a row's type, start and end are add()'s arguments`);
}

/**
 * One row of a design's merit function, with its value for the design as it
 * was when design.merit.rows was read. A field the row does not read is null.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.merit.add('RAV', 450, 650, { target: 0 });
 * for (const row of design.merit.rows) console.log(row.type, row.start, row.end, row.value, row.target);
 */
export class MeritRow {
    constructor(row) {
        this._row = row;
    }

    /**
     * The operand, such as `'RAV'` or `'MNT'`.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.merit.rows[0].type);
     */
    get type() { return this._row.type; }

    /**
     * The row's wavelength, or the first wavelength of its band, nm; the
     * first layer for MNT and MXT.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.merit.rows[0].start);
     */
    get start() { return this._row.lambdaStart ?? null; }

    /**
     * The last wavelength of the row's band, nm; the last layer for MNT and
     * MXT.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.merit.rows[0].end);
     */
    get end() { return this._row.lambdaEnd ?? null; }

    /**
     * The angle of incidence, degrees in the incident medium.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0, aoi: 45 });
     * console.log(design.merit.rows[0].aoi);
     */
    get aoi() { return this._row.aoi ?? null; }

    /**
     * The polarization the row is scored in, `'avg'`, `'s'` or `'p'`; null
     * on a row scored on both, such as PSI.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0, aoi: 45, pol: 's' });
     * console.log(design.merit.rows[0].pol);
     */
    get pol() { return this._row.pol ?? null; }

    /**
     * For TT and STR, the comparison: `'eq'`, `'le'` or `'ge'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.merit.add('TT', { target: 2000, cmp: 'le' });
     * console.log(design.merit.rows[0].cmp);
     */
    get cmp() { return this._row.cmp ?? null; }

    /**
     * The value the row drives toward, or its bound: R, T and A as fractions
     * of 1, a thickness in nm for MNT and MXT.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.merit.add('RAV', 520, 580, { target: 0.99 });
     * console.log(design.merit.rows[0].target);
     */
    get target() { return this._row.target ?? null; }

    /**
     * How much the row counts.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0, weight: 2 });
     * console.log(design.merit.rows[0].weight);
     */
    get weight() { return this._row.weight ?? null; }

    /**
     * `false` for a row left out of the merit.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0, enabled: false });
     * console.log(design.merit.rows[0].enabled);
     */
    get enabled() { return this._row.enabled ?? null; }

    /**
     * The row's value for the design; NaN for a row that cannot be evaluated.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * const row = design.merit.rows[0];
     * console.log(row.value - row.target);
     */
    get value() { return this._row.value ?? null; }

    /**
     * Why the row cannot be evaluated, or null.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * for (const row of design.merit.rows) console.log(row.type, row.error ?? 'evaluated');
     */
    get error() { return this._row.error ?? null; }

    // What console.log prints for a row.
    [inspect.custom]() { return `<MeritRow ${this.type} ${this.start}..${this.end}: ${this.value} for ${this.target}>`; }
}

/**
 * A design's merit function, as the Merit Function Editor holds it: rows in
 * order, each an operand of the Operand Reference, and the merit they add up
 * to. Reading `value`, `opticalValue` or `rows` evaluates the design as it is
 * then.
 *
 * @example
 * const design = tf.newDesign('AR');
 * design.stack('(HL)^2');
 * design.merit.add('RAV', 420, 680, { target: 0 });
 * design.merit.add('MNT', 1, design.layers.length, { target: 10 });
 * console.log(design.merit.value);
 */
export class Merit {
    constructor(design) {
        this._design = design;
    }

    /**
     * Adds a row at the end of the merit function, made as the Merit
     * Function Editor makes one: a field left out takes the value a row added
     * there starts with. `start` and `end` may be left out.
     *
     * @param type The operand, such as `'RAV'`, `'TAV'` or `'MNT'`; the Operand Reference says what each computes and which fields it reads.
     * @param [start] The wavelength, or the first wavelength of the band, nm; for MNT and MXT the first layer, numbered from the substrate.
     * @param [end] The last wavelength of the band, nm; for MNT and MXT the last layer. MNT and MXT cover layers 1 to 1000 when both are left out, so layers a synthesis adds are covered too.
     * @param [options]
     * @param [options.target] The value the row drives toward, or its bound: R, T and A as fractions of 1 (the editor shows percent), a thickness in nm for MNT and MXT. Without it, the editor's for the operand.
     * @param [options.weight=1] How much the row counts, 0 or more.
     * @param [options.aoi=0] The angle of incidence, degrees in the incident medium.
     * @param [options.pol='avg'] `'avg'`, `'s'` or `'p'`.
     * @param [options.targetEnd] The target at `end` of a target that slopes from `target` at `start`; null for a flat one.
     * @param [options.cmp] For TT and STR, the comparison: `'eq'`, `'le'` or `'ge'`.
     * @param [options.flag] The editor's Flag column, a whole number; the Operand Reference says what it does on each row.
     * @param [options.enabled=true] `false` leaves the row out of the merit.
     * @param [options.comment] The text of a BLNK row.
     * @param [options.id] A name for the row, which a math row names in `refId`, `refId1` or `refId2` to read it. Without it, a fresh id, as a row added in the editor gets.
     * @param [options.refId] For a math row that reads one row, that row's id.
     * @param [options.refId1] For a math row that reads two rows, the first one's id.
     * @param [options.refId2] For a math row that reads two rows, the second one's id.
     * @throws a type this version does not evaluate, a field no row has, a value a field cannot take, or `start` above `end` on a row that reads a band or a layer range
     * @throws more than `start` and `end` before the options, or the row's type, `start` or `end` among the options
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.merit.add('TAV', 800, 900, { target: 0.95, weight: 2, aoi: 45, pol: 'p' });
     * design.merit.add('MNT', { target: 10 });
     * console.log(design.merit.length, 'rows, merit', design.merit.value);
     */
    add(type, ...args) {
        const [[start, end], options] = trailingOptions('add', args, ['start', 'end']);
        refuseArgumentOptions(options);
        const row = defined({ ...options, lambdaStart: start, lambdaEnd: end, type });
        const design = this._design;
        const [made] = worded(ADD_WORDS, () => api.setMerit(design._data, [row])).meritOperands;
        design._data = { ...design._data, meritOperands: [...(design._data.meritOperands || []), made] };
    }

    /**
     * Takes every row out of the merit function.
     *
     * @example
     * const design = tf.newDesign('Bare BK7');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.merit.clear();
     * console.log(design.merit.length, 'rows');
     */
    clear() {
        const design = this._design;
        design._data = api.setMerit(design._data, []);
    }

    /**
     * The rows, each a MeritRow with its value for the design as it is now.
     *
     * @throws a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.merit.add('MNT', { target: 10 });
     * for (const row of design.merit.rows) console.log(row.type, row.value);
     */
    get rows() { return this._evaluated().rows.map(row => new MeritRow(row)); }

    /**
     * The merit of the design as it is now, as the Merit Function Editor
     * shows it; null while a row cannot be evaluated.
     *
     * @throws a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.merit.value);
     */
    get value() { return this._evaluated().total; }

    /**
     * The merit without the manufacturing rows MNT, MXT, TT and STR; null
     * while a row cannot be evaluated.
     *
     * @throws a design that names a material that resolves to nothing
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('(HL)^2');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * design.merit.add('MNT', { target: 100 });
     * console.log(design.merit.value, design.merit.opticalValue);
     */
    get opticalValue() { return this._evaluated().optical; }

    /**
     * How many rows the merit function has.
     *
     * @example
     * const design = tf.newDesign('Bare BK7');
     * design.merit.add('RAV', 450, 650, { target: 0 });
     * console.log(design.merit.length, 'row');
     */
    get length() { return (this._design._data.meritOperands || []).length; }

    _evaluated() { return api.merit(this._design._data); }

    // What console.log prints for a merit function.
    [inspect.custom]() { return `<Merit of ${this.length} rows>`; }
}
