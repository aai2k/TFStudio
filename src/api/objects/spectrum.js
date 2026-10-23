// A spectrum and its curves, as design.spectrum() answers, and a curve over
// angle of incidence, as design.ellipsometryVsAngle() answers its Ψ and Δ.

import fs from 'node:fs';
import { inspect } from 'node:util';

// The quantities of a spectrum: R, T and A for unpolarized light, then for s
// and p, as the API's spectrum gives them.
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];

function meanOf(values) {
    let total = 0;
    for (const value of values) total += value;
    return total / values.length;
}

// The lowest and highest of `values`, NaN left out: Infinity and -Infinity
// when every one is NaN.
function lowestOf(values) {
    let lowest = Infinity;
    for (const value of values) if (value < lowest) lowest = value;
    return lowest;
}

function highestOf(values) {
    let highest = -Infinity;
    for (const value of values) if (value > highest) highest = value;
    return highest;
}

// One value per x, an array whose new arrays are plain ones, with what the
// mean(), min() and max() of a curve share. A curve holds its x in `_x`, and
// in `_axis` the name of that x and its unit.
class CurveOverX extends Array {
    static get [Symbol.species]() { return Array; }

    // `reduce` of the values whose x is from `start` to `end`, both included,
    // for the method `what`; a band no x is in is refused.
    _over(reduce, what, start, end) {
        const xs = this._x;
        const values = this.filter((_, i) => (start == null || xs[i] >= start) && (end == null || xs[i] <= end));
        if (!values.length) {
            const [name, unit] = this._axis;
            throw new Error(`${what}: no ${name} of this curve is from ${start ?? xs[0]} to ${end ?? xs[xs.length - 1]} ${unit}`);
        }
        return reduce(values);
    }
}

/**
 * One value per wavelength: an array of numbers, so `Math.max(...curve)`, a
 * for loop and the array methods take it as they take any array; map(),
 * filter() and the other methods that make a new array make a plain one.
 *
 * mean(), min() and max() summarize it over a band of wavelengths, and
 * `wavelength` holds the wavelength of each value, nm.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * const s = design.spectrum(400, 700);
 * console.log(Math.max(...s.R), s.R.mean(450, 650));
 */
export class Curve extends CurveOverX {
    /**
     * The wavelength of each value, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700, { step: 50 });
     * console.log(s.R.wavelength.join(', '));
     */
    get wavelength() { return this._x; }

    /**
     * The mean of the values whose wavelength is from `start` to `end`, both
     * included.
     *
     * @param [start] The first wavelength of the band, nm. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm. Without it, the curve's last.
     * @returns The mean; NaN when a value in the band is NaN.
     * @throws a band no wavelength of the curve is in
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700);
     * console.log('Mean R from 450 to 650 nm:', s.R.mean(450, 650));
     */
    mean(start, end) { return this._over(meanOf, 'mean', start, end); }

    /**
     * The lowest value whose wavelength is from `start` to `end`, both
     * included, NaN values left out.
     *
     * @param [start] The first wavelength of the band, nm. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm. Without it, the curve's last.
     * @returns The lowest value; `Infinity` when every value in the band is NaN.
     * @throws a band no wavelength of the curve is in
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700);
     * console.log('Lowest T from 450 to 650 nm:', s.T.min(450, 650));
     */
    min(start, end) { return this._over(lowestOf, 'min', start, end); }

    /**
     * The highest value whose wavelength is from `start` to `end`, both
     * included, NaN values left out.
     *
     * @param [start] The first wavelength of the band, nm. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm. Without it, the curve's last.
     * @returns The highest value; `-Infinity` when every value in the band is NaN.
     * @throws a band no wavelength of the curve is in
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700);
     * console.log('Highest R from 450 to 650 nm:', s.R.max(450, 650));
     */
    max(start, end) { return this._over(highestOf, 'max', start, end); }
}

/**
 * One value per angle of incidence: an array of numbers, so
 * `Math.max(...curve)`, a for loop and the array methods take it as they take
 * any array; map(), filter() and the other methods that make a new array make
 * a plain one.
 *
 * mean(), min() and max() summarize it over a range of angles, and `angle`
 * holds the angle of each value, degrees in the medium light comes from.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^3 H');
 * const e = design.ellipsometryVsAngle(633, 45, 80);
 * console.log(Math.min(...e.psi), e.psi.mean(60, 70));
 */
export class AngleCurve extends CurveOverX {
    /**
     * The mean of the values whose angle is from `start` to `end`, both
     * included.
     *
     * @param [start] The first angle of the range, degrees. Without it, the curve's first.
     * @param [end] The last angle of the range, degrees. Without it, the curve's last.
     * @returns The mean; NaN when a value in the range is NaN.
     * @throws a range no angle of the curve is in
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometryVsAngle(633, 45, 80);
     * console.log('Mean Psi from 60 to 70 degrees:', e.psi.mean(60, 70));
     */
    mean(start, end) { return this._over(meanOf, 'mean', start, end); }

    /**
     * The lowest value whose angle is from `start` to `end`, both included,
     * NaN values left out.
     *
     * @param [start] The first angle of the range, degrees. Without it, the curve's first.
     * @param [end] The last angle of the range, degrees. Without it, the curve's last.
     * @returns The lowest value; `Infinity` when every value in the range is NaN.
     * @throws a range no angle of the curve is in
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometryVsAngle(633, 45, 80);
     * console.log('Lowest Psi from 60 to 70 degrees:', e.psi.min(60, 70));
     */
    min(start, end) { return this._over(lowestOf, 'min', start, end); }

    /**
     * The highest value whose angle is from `start` to `end`, both included,
     * NaN values left out.
     *
     * @param [start] The first angle of the range, degrees. Without it, the curve's first.
     * @param [end] The last angle of the range, degrees. Without it, the curve's last.
     * @returns The highest value; `-Infinity` when every value in the range is NaN.
     * @throws a range no angle of the curve is in
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometryVsAngle(633, 45, 80);
     * console.log('Highest Delta from 60 to 70 degrees:', e.delta.max(60, 70));
     */
    max(start, end) { return this._over(highestOf, 'max', start, end); }

    /**
     * The angle of incidence of each value, degrees.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometryVsAngle(633, 45, 80, { step: 5 });
     * console.log(e.psi.angle.join(', '));
     */
    get angle() { return this._x; }
}

// `values` as a curve of the class `Kind` over `xs`, its x named and in the
// unit `axis`, which the curve keeps out of its own entries.
function curveOver(Kind, values, xs, axis) {
    const curve = Kind.from(values);
    Object.defineProperties(curve, { _x: { value: xs }, _axis: { value: axis } });
    return curve;
}

/** `values` as a Curve over `wavelength`, nm. */
export const curveOf = (values, wavelength) => curveOver(Curve, values, wavelength, ['wavelength', 'nm']);

/** `values` as an AngleCurve over `angle`, degrees. */
export const angleCurveOf = (values, angle) => curveOver(AngleCurve, values, angle, ['angle', 'degrees']);

/**
 * R, T and A of a design over a range of wavelengths, at one angle of
 * incidence or several, as design.spectrum() computes them. `s.R` and the
 * other quantities are at the first angle asked; `s.angle(45)` is the
 * spectrum at another.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * const s = design.spectrum(400, 800, { step: 1, angles: [0, 45] });
 * console.log(s.mode, Math.max(...s.R), Math.min(...s.angle(45).Tp));
 */
export class Spectrum {
    constructor(mode, wavelength, angles, series, outOfRange) {
        this._values = { mode, wavelength, angles, outOfRange };
        this._series = series;
        this._curves = series.map(values => Object.fromEntries(QUANTITIES.map(name => [name, curveOf(values[name], wavelength)])));
    }

    /**
     * What the spectrum was computed on, as the design's `sides` and
     * `scoreOn` say: `'front'` or `'back'`, the coated side alone, or
     * `'total'`, the whole part.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.spectrum(400, 700).mode);
     */
    get mode() { return this._values.mode; }

    /**
     * The wavelengths, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700, { step: 50 });
     * console.log(s.wavelength.join(', '));
     */
    get wavelength() { return this._values.wavelength; }

    /**
     * The angles of incidence, degrees in the incident medium, in the order
     * they were asked.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700, { angles: [0, 45] });
     * for (const a of s.angles) console.log(a, Math.max(...s.angle(a).R));
     */
    get angles() { return this._values.angles; }

    /**
     * The materials whose data stop inside the range, an array of
     * `{ id, name, rangeNm, heldFlat }`: outside `rangeNm`, `[first, last]` in
     * nm, their n and k are held at the last value (`heldFlat` true) or
     * extrapolated. Empty when every material covers the range.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(200, 2500, { step: 10 });
     * for (const m of s.outOfRange) console.log(m.id, 'has data from', m.rangeNm);
     * console.log(s.outOfRange.length, 'materials stop inside the range');
     */
    get outOfRange() { return this._values.outOfRange; }

    /**
     * Reflectance for unpolarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.max(...design.spectrum(400, 700).R));
     */
    get R() { return this._curves[0].R; }

    /**
     * Transmittance for unpolarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.min(...design.spectrum(400, 700).T));
     */
    get T() { return this._curves[0].T; }

    /**
     * Absorptance for unpolarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.max(...design.spectrum(400, 700).A));
     */
    get A() { return this._curves[0].A; }

    /**
     * Reflectance for s-polarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).Rs));
     */
    get Rs() { return this._curves[0].Rs; }

    /**
     * Reflectance for p-polarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).Rp));
     */
    get Rp() { return this._curves[0].Rp; }

    /**
     * Transmittance for s-polarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.min(...design.spectrum(400, 700, { angles: [45] }).Ts));
     */
    get Ts() { return this._curves[0].Ts; }

    /**
     * Transmittance for p-polarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.min(...design.spectrum(400, 700, { angles: [45] }).Tp));
     */
    get Tp() { return this._curves[0].Tp; }

    /**
     * Absorptance for s-polarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).As));
     */
    get As() { return this._curves[0].As; }

    /**
     * Absorptance for p-polarized light at the first angle, a Curve of
     * fractions of 1, one per wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).Ap));
     */
    get Ap() { return this._curves[0].Ap; }

    /**
     * The spectrum at one of the angles it was computed at.
     *
     * @param angle The angle of incidence, degrees in the incident medium.
     * @returns A Spectrum of that angle alone.
     * @throws an angle the spectrum was not computed at
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700, { angles: [0, 45] });
     * console.log(Math.min(...s.angle(45).Tp));
     */
    angle(angle) {
        const i = this.angles.indexOf(angle);
        if (i < 0) throw new Error(`angle: the spectrum was computed at [${this.angles.join(', ')}], not at ${angle}`);
        return new Spectrum(this.mode, this.wavelength, [angle], [this._series[i]], this.outOfRange);
    }

    /**
     * Writes the spectrum to a CSV file: a column of wavelengths, then R, T,
     * A, Rs, Rp, Ts, Tp, As and Ap at each angle, as fractions of 1, each
     * headed with its quantity and angle. A file that is there is written
     * over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `spectrum-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.spectrum(400, 700, { step: 10, angles: [0, 45] }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const header = ['Wavelength (nm)', ...this.angles.flatMap(angle => QUANTITIES.map(name => `${name} at ${angle} deg`))];
        const rows = this.wavelength.map((wavelength, i) => [wavelength, ...this._curves.flatMap(curves => QUANTITIES.map(name => curves[name][i]))]);
        fs.writeFileSync(path, [header, ...rows].map(row => `${row.join(',')}\r\n`).join(''), 'utf8');
    }

    // What console.log prints for a spectrum.
    [inspect.custom]() {
        const { wavelength } = this;
        return `<Spectrum ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points, angles [${this.angles.join(', ')}], ${this.mode}>`;
    }
}
