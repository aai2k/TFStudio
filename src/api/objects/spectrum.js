// A spectrum and its curves, as design.spectrum() answers, and a curve over
// angle of incidence, as design.ellipsometryVsAngle() answers its Ψ and Δ.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { spectrumConditionLines } from '../../utils/io/spectrumTable.js';
import { logValue } from '../../utils/physics/optimizer/logReadings.js';
import * as api from '../index.js';
import { checkOptions, requireValue, shown } from '../check.js';
import { trailingOptions } from './options.js';
import { worded } from './refusals.js';

// The quantities of a spectrum: R, T and A for unpolarized light, then for s
// and p, as the API's spectrum gives them.
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
// The quantities an optical density is read from.
const TRANSMITTANCES = ['T', 'Ts', 'Tp'];

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

    /**
     * The ripple over a band: the highest value whose wavelength is from
     * `start` to `end`, both included, less the lowest, NaN values left out,
     * so `max(start, end) - min(start, end)`; with `unit: 'dB'`, the ratio of
     * the two in decibels, 10·log10(max/min), for a curve of values above 0.
     *
     * @param [start] The first wavelength of the band, nm. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm. Without it, the curve's last.
     * @param [options]
     * @param [options.unit='fraction'] `'fraction'`, the difference in the curve's own unit, a fraction of 1 for R, T and A; or `'dB'`.
     * @returns The ripple; NaN when every value in the band is NaN.
     * @throws a band no wavelength of the curve is in, or a unit it does not have
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 800);
     * console.log('T ripple from 650 to 750 nm:', s.T.ripple(650, 750), 'or', s.T.ripple(650, 750, { unit: 'dB' }), 'dB');
     */
    ripple(...args) {
        const [[start, end], options] = trailingOptions('ripple', args, ['start', 'end']);
        const { unit = 'fraction' } = checkOptions('ripple', options, ['unit']);
        requireValue('ripple', 'unit', unit, v => v === 'fraction' || v === 'dB', "'fraction' or 'dB'");
        const [lowest, highest] = this._over(values => [lowestOf(values), highestOf(values)], 'ripple', start, end);
        if (lowest > highest) return NaN;
        return unit === 'dB' ? 10 * Math.log10(highest / lowest) : highest - lowest;
    }

    /**
     * The value at a wavelength, read off the straight line between the two
     * samples either side of it, as the plot draws the curve; at a sample,
     * that sample's value.
     *
     * @param wavelength The wavelength, nm, from the curve's first to its last.
     * @returns The value; NaN when a sample it is read from is NaN.
     * @throws a wavelength outside the curve, or one that is not a number
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const s = design.spectrum(400, 700, { step: 5 });
     * console.log('R at 532.1 nm:', s.R.at(532.1));
     */
    at(wavelength) {
        const xs = this._x;
        const [first, last] = [xs[0], xs[xs.length - 1]];
        if (typeof wavelength !== 'number' || !(wavelength >= first && wavelength <= last)) {
            throw new Error(`at: the curve is from ${first} to ${last} nm, not at ${shown(wavelength)}`);
        }
        let low = 0, high = xs.length - 1;
        while (high - low > 1) {
            const middle = (low + high) >> 1;
            if (xs[middle] <= wavelength) low = middle; else high = middle;
        }
        if (xs[low] === wavelength) return this[low];
        if (xs[high] === wavelength) return this[high];
        return this[low] + (this[high] - this[low]) * (wavelength - xs[low]) / (xs[high] - xs[low]);
    }

    /**
     * The optical density at each wavelength, −log10 T, a Curve, as the
     * ODMN merit row reads it: a T below 1e-15 reads as a density of 15. A
     * spectrum's T, Ts and Tp have one; other curves do not.
     *
     * @returns A Curve of densities over the same wavelengths.
     * @throws a curve that is not a spectrum's T, Ts or Tp
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const s = design.spectrum(400, 700);
     * console.log('Highest optical density from 500 to 600 nm:', s.T.density().max(500, 600));
     */
    density() {
        if (!TRANSMITTANCES.includes(this._quantity)) {
            throw new Error(`density: optical density is read from a spectrum's T, Ts or Tp, not from ${this._quantity ?? 'this curve'}`);
        }
        return curveOf(Array.from(this, value => logValue('OD', value)), this._x);
    }

    /**
     * Where the curve crosses a level beside the peak of a band, as an
     * EDGE_LAMBDA check of the Specification window finds it: computed on
     * the design the spectrum was computed on, at the curve's angle, so the
     * crossing is exact and not read off the samples. The level is a
     * fraction of the band's peak, so on a band peaking at T = 0.90, `level:
     * 0.5` is crossed where T = 0.45. A spectrum's curves have it; other
     * curves do not.
     *
     * @param [start] The first wavelength of the band, nm, inside the curve. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm, inside the curve. Without it, the curve's last.
     * @param [options]
     * @param [options.level=0.5] The level crossed, a fraction from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999.
     * @param [options.edgeSide] `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.
     * @param [options.direction='max'] `'max'`, the level a fraction of the band's highest value, or `'min'`, a fraction of the way from its lowest value up to 1.
     * @param [options.step=1] The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The crossing is bracketed on a scan of the band no coarser than it, of 301 samples at the least.
     * @returns An object: `edge`, the crossing, nm, null when the curve does not cross the level inside the band, and `reason`, then `'edgeNotCrossed'` and otherwise null; `peak`, the wavelength of the band's peak, nm, and `peakValue`, the curve's value there; `level`, the level used, 0.001 to 0.999, and `levelValue`, the curve's value at the crossing; and `feature`, `mode`, `quantity`, `angle`, `direction` and `step`.
     * @throws a curve that is not a spectrum's, a band not inside the curve, or an option it does not take or a value an option cannot take
     * @example
     * const design = tf.newDesign('Long-wave pass');
     * design.stack('(0.5H L 0.5H)^8');
     * const s = design.spectrum(600, 760);
     * const e = s.T.edge(600, 760, { level: 0.5 });
     * console.log('T crosses', e.levelValue.toFixed(3), 'at', e.edge.toFixed(2), 'nm');
     */
    edge(...args) { return this._feature('edge', args, ['level', 'edgeSide', 'direction', 'step']); }

    /**
     * The full width of the peak of a band where the curve crosses a level,
     * by default half the peak, as a FWHM check of the Specification window
     * finds it, with the two crossings, their midpoint and the peak: computed
     * on the design the spectrum was computed on, at the curve's angle, so the
     * crossings are exact and not read off the samples. A spectrum's curves
     * have it; other curves do not.
     *
     * @param [start] The first wavelength of the band, nm, inside the curve. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm, inside the curve. Without it, the curve's last.
     * @param [options]
     * @param [options.level=0.5] The level crossed, a fraction of the peak from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999.
     * @param [options.direction='max'] `'max'`, the width of a peak, or `'min'`, of a dip, crossed a fraction of the way from its lowest value up to 1.
     * @param [options.step=1] The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The crossings are bracketed on a scan of the band no coarser than it, of 301 samples at the least.
     * @returns An object: `width`, `right` − `left`, nm, the value of a FWHM check; `left` and `right`, the crossings below and above the peak, nm; `centre`, their midpoint, nm; each null when a crossing is not inside the band, and `reason`, then `'fwhmNotBracketed'` and otherwise null; `peak`, `peakValue`, `level` and `levelValue`, as edge() gives them; and `feature`, `mode`, `quantity`, `angle`, `direction` and `step`.
     * @throws a curve that is not a spectrum's, a band not inside the curve, or an option it does not take or a value an option cannot take
     * @example
     * const design = tf.newDesign('Bandpass');
     * design.stack('(HL)^4 HH (LH)^4');
     * const s = design.spectrum(500, 600);
     * const band = s.T.fwhm(500, 600);
     * console.log('FWHM', band.width.toFixed(2), 'nm, centred at', band.centre.toFixed(2), 'nm, peak T', band.peakValue.toFixed(4));
     */
    fwhm(...args) { return this._feature('fwhm', args, ['level', 'direction', 'step']); }

    /**
     * The wavelength of the peak of a band, or of its dip, as a Central λ
     * check of the Specification window finds it: searched on the design the
     * spectrum was computed on, at the curve's angle, not read off the
     * samples. A spectrum's curves have it; other curves do not.
     *
     * @param [start] The first wavelength of the band, nm, inside the curve. Without it, the curve's first.
     * @param [end] The last wavelength of the band, nm, inside the curve. Without it, the curve's last.
     * @param [options]
     * @param [options.direction='max'] `'max'`, the highest value, or `'min'`, the lowest.
     * @param [options.step=1] The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The peak of R, and the dip of T or A, is found without a step, so it stays 1.
     * @returns An object: `peak`, the wavelength, nm, and `peakValue`, the curve's value there; and `feature`, `mode`, `quantity`, `angle`, `direction` and `step`.
     * @throws a curve that is not a spectrum's, a band not inside the curve, or an option it does not take or a value an option cannot take
     * @example
     * const design = tf.newDesign('Bandpass');
     * design.stack('(HL)^4 HH (LH)^4');
     * const s = design.spectrum(500, 600);
     * const top = s.T.peak(500, 600, { step: 0.01 });
     * console.log('Peak T', top.peakValue.toFixed(4), 'at', top.peak.toFixed(3), 'nm');
     */
    peak(...args) { return this._feature('peak', args, ['direction', 'step']); }

    // What bandFeature finds of `feature` over a band of the curve, on the
    // design and at the angle its spectrum was computed on, for the method of
    // that name, which takes the options `known`.
    _feature(feature, args, known) {
        const [[start, end], options] = trailingOptions(feature, args, ['start', 'end']);
        const given = checkOptions(feature, options, known);
        if (!this._source) {
            throw new Error(`${feature}: only a spectrum's curves have ${feature}(), since it is found on the design the spectrum was computed on`);
        }
        const xs = this._x;
        const [first, last] = [xs[0], xs[xs.length - 1]];
        const [from, to] = [start ?? first, end ?? last];
        if (!(from >= first && to <= last)) {
            throw new Error(`${feature}: the curve is from ${first} to ${last} nm, and the band ${shown(from)} to ${shown(to)} nm is not inside it`);
        }
        const words = { method: feature, call: 'bandFeature', hidden: ['feature', 'from', 'to', 'quantity', 'angle'] };
        return worded(words, () => api.bandFeature(this._source.design, { ...given, feature, from, to, quantity: this._quantity, angle: this._source.angle }));
    }
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
// unit `axis`, and the quantity it holds, which the curve keeps out of its own
// entries.
function curveOver(Kind, values, xs, axis, quantity) {
    const curve = Kind.from(values);
    Object.defineProperties(curve, { _x: { value: xs }, _axis: { value: axis }, _quantity: { value: quantity } });
    return curve;
}

/** `values` as a Curve over `wavelength`, nm; `quantity` names a spectrum's quantity, such as 'T'. */
export const curveOf = (values, wavelength, quantity) => curveOver(Curve, values, wavelength, ['wavelength', 'nm'], quantity);

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
        this._values = { mode, wavelength, angles, outOfRange, name: null, design: null };
        this._series = series;
        this._curves = series.map(values => Object.fromEntries(QUANTITIES.map(quantity => [quantity, curveOf(values[quantity], wavelength, quantity)])));
    }

    // The spectrum with the name of the design it was computed on, which its
    // CSV file gives.
    _named(name) {
        this._values.name = name;
        return this;
    }

    // The spectrum with a copy of the design it was computed on, on which its
    // curves find their edges, widths and peaks, each at its own angle; with
    // none, its curves have none.
    _computedOn(design) {
        if (!design) return this;
        this._values.design = design;
        this._curves.forEach((curves, i) => {
            for (const curve of Object.values(curves)) Object.defineProperty(curve, '_source', { value: { design, angle: this.angles[i] } });
        });
        return this;
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
        return new Spectrum(this.mode, this.wavelength, [angle], [this._series[i]], this.outOfRange)._named(this._values.name)._computedOn(this._values.design);
    }

    /**
     * Writes the spectrum to a CSV file: the conditions on # lines as
     * Measured Spectra's export writes them, which its import reads back
     * (the design's name; the angle of incidence when the spectrum has one
     * angle, and the side light comes in on, the back for a design scored on
     * its back alone and the front otherwise; and "Polarization: per
     * column"), then a column of wavelengths and R, T, A, Rs, Rp, Ts, Tp, As
     * and Ap at each angle, as fractions of 1, each headed with its quantity
     * and angle. A file that is there is written over.
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
        const conditions = spectrumConditionLines({
            name: this._values.name, aoi: this.angles.length === 1 ? this.angles[0] : null, side: this.mode === 'back' ? 'back' : 'front',
        });
        const header = ['Wavelength (nm)', ...this.angles.flatMap(angle => QUANTITIES.map(name => `${name} at ${angle} deg`))];
        const rows = this.wavelength.map((wavelength, i) => [wavelength, ...this._curves.flatMap(curves => QUANTITIES.map(name => curves[name][i]))]);
        fs.writeFileSync(path, [...conditions, ...[header, ...rows].map(row => row.join(','))].map(line => `${line}\r\n`).join(''), 'utf8');
    }

    // What console.log prints for a spectrum.
    [inspect.custom]() {
        const { wavelength } = this;
        return `<Spectrum ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points, angles [${this.angles.join(', ')}], ${this.mode}>`;
    }
}
