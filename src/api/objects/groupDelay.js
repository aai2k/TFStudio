// A design's phase, group delay, GDD, TOD and CDC against wavelength, as
// design.groupDelay() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { buildGdGddView } from '../../components/windows/analysis/gdGddEvaluation/viewModel.js';
import en from '../../constants/locales/en.js';
import { curveOf } from './spectrum.js';

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, an empty cell for none, a name with each comma made a
// semicolon.
function cell(value) {
    if (value == null) return '';
    return typeof value === 'number' ? String(value) : String(value).replace(/,/g, ';');
}

// The curves as the window's table reads them (gdGddEvaluation/spectrum.js),
// each knot by its place on the grid.
function windowSpectrum(result) {
    const index = new Map(result.wavelength.map((wavelength, i) => [wavelength, i]));
    return {
        lambda: result.wavelength, phaseDeg: result.phase, gd: result.gd, gdd: result.gdd, tod: result.tod, cdc: result.cdc,
        outsideRange: result.outside,
        knotSamples: result.knots.map(knot => ({ ...knot, index: index.get(knot.wavelength), wavelengthNm: knot.wavelength })),
    };
}

/**
 * Phase, group delay, GDD, TOD and CDC of a design's reflected or transmitted
 * light against wavelength, as design.groupDelay() computes them and the
 * Group Delay / GDD window shows them. `g.phase`, `g.gd`, `g.gdd`, `g.tod` and
 * `g.cdc` are Curves.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^8 H');
 * const g = design.groupDelay(500, 600, { step: 1 });
 * console.log(g.mode, 'mean GD from 540 to 560 nm', g.gd.mean(540, 560).toFixed(3), 'fs');
 */
export class GroupDelay {
    constructor(result) {
        this._result = result;
        this._curves = Object.fromEntries(['phase', 'gd', 'gdd', 'tod', 'cdc'].map(key => [key, curveOf(result[key], result.wavelength)]));
    }

    /**
     * The sides computed: `'front'` or `'back'`, one coated side, or
     * `'total'`, the whole part in transmission.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay().mode, design.groupDelay(400, 800, { response: 'T', side: 'total' }).mode);
     */
    get mode() { return this._result.mode; }

    /**
     * The light whose phase is taken: `'R'`, reflected, or `'T'`,
     * transmitted.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(400, 800, { response: 'T' }).response);
     */
    get response() { return this._result.response; }

    /**
     * The angle of incidence, degrees in the medium light comes from.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(400, 800, { angle: 45 }).angle, 'degrees');
     */
    get angle() { return this._result.angle; }

    /**
     * The polarization: `'avg'`, `'s'` or `'p'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(400, 800, { angle: 45, pol: 'p' }).pol);
     */
    get pol() { return this._result.pol; }

    /**
     * The wavelength step, nm, or `'auto'`, the window's own grid.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(400, 800, { step: 'auto' }).step);
     */
    get step() { return this._result.step; }

    /**
     * The wavelength the phase is shifted to 0 at, nm, or `null` for the
     * absolute phase: without a reference, or when the sample nearest it has
     * no value.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(400, 800, { reference: 550 }).reference, 'nm');
     */
    get reference() { return this._result.reference; }

    /**
     * The wavelengths, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(400, 800, { step: 100 }).wavelength.join(', '));
     */
    get wavelength() { return this._result.wavelength; }

    /**
     * The phase φ, degrees, a Curve: unwrapped along the grid, absolute, or
     * 0 at the sample nearest the reference when one was given.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const g = design.groupDelay(500, 600, { reference: 550 });
     * console.log('phase from 500 to 600 nm:', g.phase.min().toFixed(1), 'to', g.phase.max().toFixed(1), 'degrees');
     */
    get phase() { return this._curves.phase; }

    /**
     * The group delay, fs, a Curve.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log('mean GD from 520 to 580 nm:', design.groupDelay().gd.mean(520, 580).toFixed(3), 'fs');
     */
    get gd() { return this._curves.gd; }

    /**
     * The GDD, fs², a Curve.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const g = design.groupDelay();
     * console.log('GDD from 520 to 580 nm:', g.gdd.min(520, 580).toFixed(3), 'to', g.gdd.max(520, 580).toFixed(3), 'fs²');
     */
    get gdd() { return this._curves.gdd; }

    /**
     * The TOD, fs³, a Curve.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log('mean TOD from 520 to 580 nm:', design.groupDelay().tod.mean(520, 580).toFixed(3), 'fs³');
     */
    get tod() { return this._curves.tod; }

    /**
     * The CDC, GDD · 2πc/λ², fs/nm, a Curve: the chromatic dispersion as
     * Essential Macleod reports it, with the sign of GDD. The slope of group
     * delay against wavelength, dGD/dλ, is its negative.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log('mean CDC from 520 to 580 nm:', design.groupDelay().cdc.mean(520, 580).toFixed(5), 'fs/nm');
     */
    get cdc() { return this._curves.cdc; }

    /**
     * For each wavelength, the name of the material whose data its value was
     * taken outside of, or `null`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const g = design.groupDelay(200, 2500, { step: 10 });
     * console.log(g.wavelength.filter((_, i) => g.outside[i]).length, 'wavelengths outside a material\'s data');
     */
    get outside() { return this._result.outside; }

    /**
     * The table knots that are exactly wavelengths of the grid, an array of
     * `{ wavelength, gd, gdd, tod, cdc }`, each quantity a pair `[left, right]`
     * of its values on the two sides of the knot; the value the curves hold
     * at that wavelength reads the material averaged across the knot. On the
     * uniform grid none is read when the knots in range are dense against the
     * grid, more than one per 8 points, and on `side: 'total'` none is read.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * for (const knot of design.groupDelay().knots.slice(0, 3)) console.log(knot.wavelength, 'nm: GDD', knot.gdd[0].toFixed(3), 'and', knot.gdd[1].toFixed(3), 'fs²');
     */
    get knots() { return this._result.knots; }

    /**
     * The wavelengths with no value, an array of `{ wavelength, reason }`;
     * the curves are NaN there. Empty when every wavelength has one.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay().invalid.length, 'wavelengths with no value');
     */
    get invalid() { return this._result.invalid; }

    /**
     * The material models the values come from, each `'name: model'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay().models.join('\n'));
     */
    get models() { return this._result.models; }

    /**
     * The materials of the sides computed whose data stop inside the range,
     * an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n
     * and k are held at the last value (`heldFlat` true) or extrapolated.
     * Empty when every material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.groupDelay(200, 2500, { step: 10 }).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._result.outOfRange; }

    /**
     * Writes the curves to a CSV file as the window's Copy CSV writes its
     * table: λ (nm), then Knot where a table knot is sampled, a row for each
     * side of it, λ− and λ+, then Outside data where a value was taken outside
     * a material's data, then Group Delay (fs), GDD (fs²), CDC (fs/nm),
     * Phase φ (°) and TOD (fs³). The phase is the one `phase` holds. A file
     * that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `group-delay-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * design.groupDelay(400, 800, { step: 1 }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const view = buildGdGddView(windowSpectrum(this._result), { quantity: 'gd', outsideLabel: en.materialRange.outsideColumn, units: en.units },
            en.gdgdd, undefined, en.spectralAxis.lambdaShort);
        const lines = [view.tableColumns.map(column => column.label), ...view.tableRows.map(row => view.tableColumns.map(column => cell(row[column.key])))];
        fs.writeFileSync(path, lines.map(line => line.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the curves.
    [inspect.custom]() {
        const { mode, response, pol, angle, wavelength } = this._result;
        return `<GroupDelay ${mode} ${response} ${pol} at ${angle} degrees from ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points>`;
    }
}
