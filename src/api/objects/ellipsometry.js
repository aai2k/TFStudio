// A coated side's Ψ and Δ, as design.ellipsometry() and
// design.ellipsometryVsAngle() answer.

import fs from 'node:fs';
import { inspect } from 'node:util';
import en from '../../constants/locales/en.js';
import { angleCurveOf, curveOf } from './spectrum.js';

// The window's table headings for Ψ and Δ (EllipsometryResults.js).
const PSI = 'Ψ (°)';
const DELTA = 'Δ (°)';

/**
 * Ψ and Δ of one coated side, as design.ellipsometry() computes them against
 * wavelength, at one angle of incidence or several, or
 * design.ellipsometryVsAngle() against angle at one wavelength. Against
 * wavelength, `e.psi` and `e.delta` are Curves at the first angle asked and
 * `e.angle(70)` is the sweep at another; against angle, they are AngleCurves.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^3 H');
 * const e = design.ellipsometry(400, 800, { angles: [65, 70] });
 * console.log(e.mode, Math.min(...e.psi), Math.max(...e.angle(70).delta));
 */
export class Ellipsometry {
    constructor(result) {
        const { mode, wavelength, deltaConvention, outOfRange } = result;
        const angular = !Array.isArray(wavelength);
        const series = angular ? [{ psi: result.psi, delta: result.delta }] : result.angles;
        const angles = angular ? result.angle : series.map(one => one.angle);
        const over = angular ? values => angleCurveOf(values, angles) : values => curveOf(values, wavelength);
        this._values = { mode, wavelength, angles, deltaConvention, outOfRange, angular, name: null };
        this._series = series;
        this._curves = series.map(({ psi, delta }) => ({ psi: over(psi), delta: over(delta) }));
    }

    // The result with the name of the design it was computed on, which its CSV
    // file gives.
    _named(name) {
        this._values.name = name;
        return this;
    }

    /**
     * The side computed: `'front'` or `'back'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.ellipsometry().mode);
     */
    get mode() { return this._values.mode; }

    /**
     * Against wavelength, the wavelengths, nm; against angle, the one
     * wavelength, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.ellipsometry(400, 800, { step: 100 }).wavelength.join(', '), design.ellipsometryVsAngle(633).wavelength);
     */
    get wavelength() { return this._values.wavelength; }

    /**
     * The angles of incidence, degrees in the medium light comes from:
     * against wavelength, those asked, in the order asked; against angle,
     * the angles swept.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometry(400, 800, { angles: [55, 70] });
     * for (const a of e.angles) console.log(a, Math.min(...e.angle(a).psi));
     */
    get angles() { return this._values.angles; }

    /**
     * The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer
     * writes, or `'reversed'`, 360 degrees minus that.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.ellipsometry(400, 800, { deltaConvention: 'reversed' }).deltaConvention);
     */
    get deltaConvention() { return this._values.deltaConvention; }

    /**
     * Ψ, degrees from 0 to 90, where tan Ψ is |r_p| / |r_s|, and NaN where
     * the computed r_s or r_p is exactly zero: against wavelength a Curve at
     * the first angle, against angle an AngleCurve.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.ellipsometry().psi.mean(500, 600));
     */
    get psi() { return this._curves[0].psi; }

    /**
     * Δ, degrees from 0 up to 360, the phase of r_p / r_s in the convention
     * `deltaConvention` names, and NaN where Ψ is: against wavelength a Curve
     * at the first angle, against angle an AngleCurve.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(Math.max(...design.ellipsometryVsAngle(633).delta));
     */
    get delta() { return this._curves[0].delta; }

    /**
     * The materials of the side computed whose data stop inside the range,
     * or do not reach the one wavelength of a sweep against angle, an array
     * of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k
     * are held at the last value (`heldFlat` true) or extrapolated. Empty
     * when every material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.ellipsometry(200, 2500, { step: 10 }).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._values.outOfRange; }

    /**
     * The sweep against wavelength at one of the angles it was computed at.
     *
     * @param angle The angle of incidence, degrees.
     * @returns An Ellipsometry of that angle alone.
     * @throws an angle the sweep was not computed at, or a sweep against angle
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const e = design.ellipsometry(400, 800, { angles: [55, 70] });
     * console.log(Math.min(...e.angle(70).psi));
     */
    angle(angle) {
        const { mode, wavelength, angles, deltaConvention, outOfRange, angular } = this._values;
        if (angular) throw new Error(`angle: this sweep runs over angle at ${wavelength} nm; psi and delta hold it`);
        const i = angles.indexOf(angle);
        if (i < 0) throw new Error(`angle: the sweep was computed at [${angles.join(', ')}], not at ${angle}`);
        return new Ellipsometry({ mode, wavelength, deltaConvention, outOfRange, angles: [this._series[i]] })._named(this._values.name);
    }

    /**
     * Writes Ψ and Δ to a CSV file as the window's export writes its table:
     * a column of wavelengths, λ (nm), or of angles, AOI (°), then Ψ (°) and
     * Δ (°). Against wavelength at more than one angle, Ψ and Δ come for each
     * angle in turn, each headed with its angle. Against wavelength at one
     * angle, two # lines come first, as Measured Ellipsometry's export of the
     * design's Ψ/Δ writes them: the design's name, then the angle and the side,
     * which its import reads back. A file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `ellipsometry-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * design.ellipsometry(400, 800, { step: 5 }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const { mode, wavelength, angles, angular, name } = this._values;
        const xs = angular ? angles : wavelength;
        const conditions = !angular && angles.length === 1 ? [`# ${name || 'design'}`, `# AOI ${angles[0]} deg, ${mode} side`] : [];
        const headed = (label, angle) => (angles.length === 1 ? label : `${label} at ${angle} deg`);
        const header = angular ? [en.spectrumExchange.aoiLabel, PSI, DELTA]
            : [en.spectralAxis.lambdaShort, ...angles.flatMap(angle => [headed(PSI, angle), headed(DELTA, angle)])];
        const rows = xs.map((x, i) => [x, ...this._series.flatMap(({ psi, delta }) => [psi[i], delta[i]])]);
        fs.writeFileSync(path, [...conditions, ...[header, ...rows].map(row => row.join(','))].join('\n'), 'utf8');
    }

    // What console.log prints for a sweep.
    [inspect.custom]() {
        const { mode, wavelength, angles, deltaConvention, angular } = this._values;
        return angular
            ? `<Ellipsometry ${mode} at ${wavelength} nm, ${angles[0]} to ${angles[angles.length - 1]} degrees, ${angles.length} points, ${deltaConvention}>`
            : `<Ellipsometry ${mode} from ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points, angles [${angles.join(', ')}], ${deltaConvention}>`;
    }
}
