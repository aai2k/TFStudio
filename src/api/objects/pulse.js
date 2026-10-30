// A pulse's passage through a design, as design.pulse() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { resultsTable } from '../../components/windows/analysis/pulseAnalysis/viewModel.js';
import en from '../../constants/locales/en.js';
import { windowMetrics } from '../pulse.js';

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, an empty cell for none, a name with each comma made a
// semicolon.
function cell(value) {
    if (value == null) return '';
    return typeof value === 'number' ? String(value) : String(value).replace(/,/g, ';');
}

/**
 * A pulse's passage through a design, in time and in its spectrum, as
 * design.pulse() computes it and the Pulse Analysis window shows it: its
 * metrics, the window's Results table, and its curves.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^8 H');
 * const p = design.pulse({ centre: 550, duration: 20 });
 * console.log(p.mode, 'output FWHM', p.metrics.outputFwhm.toFixed(2), 'fs, delay', p.metrics.delay.toFixed(2), 'fs');
 */
export class Pulse {
    constructor(result) {
        this._result = result;
    }

    /**
     * The sides computed: `'front'` or `'back'`, one coated side, or
     * `'total'`, the whole part in transmission.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550 }).mode, design.pulse({ centre: 550, response: 'T', side: 'total' }).mode);
     */
    get mode() { return this._result.mode; }

    /**
     * The pulse taken: `'R'`, the reflected one, or `'T'`, the transmitted one.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550, response: 'T' }).response);
     */
    get response() { return this._result.response; }

    /**
     * The polarization: `'avg'`, `'s'` or `'p'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550, angle: 45, pol: 'p' }).pol);
     */
    get pol() { return this._result.pol; }

    /**
     * The angle of incidence, degrees in the medium light comes from.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550, angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._result.angle; }

    /**
     * The bounces off the coating, or passes through it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550, passes: 4 }).passes, 'bounces');
     */
    get passes() { return this._result.passes; }

    /**
     * Where the spectrum comes from: `'model'`, the shape, or `'design'`,
     * the spectrum the design holds.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550 }).source);
     */
    get source() { return this._result.source; }

    /**
     * The centre wavelength, nm: the one given, 800 nm, or with the design's
     * spectrum its centroid.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse().centre, 'nm');
     */
    get centre() { return this._result.centre; }

    /**
     * `false` when the time window reached its largest size before the
     * output fitted inside it, so part of the output may wrap round from one
     * end to the other and the curves and metrics are not reliable; `true`
     * otherwise.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550 }).converged);
     */
    get converged() { return this._result.converged; }

    /**
     * Whether the input's own chirp changes its shape anywhere by more than
     * 1e-4 of the Fourier-limited peak; the window's table lists the input's
     * FWHM only then.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550 }).chirped, design.pulse({ centre: 550, gdd: 50 }).chirped);
     */
    get chirped() { return this._result.chirped; }

    /**
     * The window's Results table: `flpFwhm`, `inputFwhm` and `outputFwhm`,
     * the intensity FWHM of the Fourier-limited pulse, the input and the
     * output, fs; `outputRms`, the output's RMS width, fs; `peakVsFlp`, the
     * output's peak over the Fourier-limited pulse's, and
     * `transformLimitedRatio`, over the peak the output's own spectrum would
     * reach with a flat phase, fractions of 1; `energyRatio`, the energy out
     * over the energy in; `delay`, the output's delay after the input, fs;
     * `residualGdd` and `residualTod`, the output's GDD, fs², and TOD, fs³,
     * averaged over its spectrum; `inputBandwidth` and `outputBandwidth`, the
     * spectral intensity FWHM, nm; `timeBandwidth`, the output's
     * time-bandwidth product.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const m = design.pulse({ centre: 550, duration: 20 }).metrics;
     * console.log('FLP', m.flpFwhm.toFixed(2), 'fs, out', m.outputFwhm.toFixed(2), 'fs, residual GDD', m.residualGdd.toFixed(2), 'fs²');
     */
    get metrics() { return this._result.metrics; }

    /**
     * The time curves, `flp`, `input` and `output`, each `{ t, intensity }`:
     * t in fs, the intensity on the scale where the Fourier-limited pulse
     * peaks at 1. They hold the transform's samples from the first to the
     * last above 1e-4 of that peak, and past 4000 samples the lowest and
     * highest of each run in turn, so each curve has its own t. The output is
     * at its absolute delay; the window's Delay removed view moves it back by
     * `metrics.delay`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const { output } = design.pulse({ centre: 550 }).time;
     * console.log(output.t.length, 'samples, peak', Math.max(...output.intensity).toFixed(4));
     */
    get time() { return this._result.time; }

    /**
     * The spectrum curves, each `{ wavelength, values }`, wavelengths in nm
     * rising: `input` and `output`, the spectral intensity on the scale where
     * the input peaks at 1; `coatingGdd`, the response's GDD times the
     * passes, fs², the mean of s and p with `pol: 'avg'`; `compensatingGdd`,
     * the GDD that undoes the input's own chirp, fs². They hold the
     * transform's samples where the input is above 1e-3 of its peak, or a
     * fresh evaluation at least 600 points across that band when the
     * transform has fewer. Past 4000 samples each keeps the lowest and highest
     * of each run of its own values in turn, so each curve then has its own
     * wavelengths. `band` is `[low, high]`, nm, the band they cover.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * const s = design.pulse({ centre: 550 }).spectrum;
     * console.log('from', s.band[0].toFixed(1), 'to', s.band[1].toFixed(1), 'nm,', s.coatingGdd.wavelength.length, 'points');
     */
    get spectrum() { return this._result.spectrum; }

    /**
     * On the whole part, the time from this pulse to the first echo
     * reflected inside the substrate, fs, the substrate's group delay there
     * and back at the centre wavelength; `null` on one side.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550, response: 'T', side: 'total' }).echoDelay.toFixed(0), 'fs');
     */
    get echoDelay() { return this._result.echoDelay; }

    /**
     * The materials of the sides computed whose data stop inside the
     * spectrum's band, an array of `{ id, name, rangeNm, heldFlat }`: outside
     * `rangeNm` their n and k are held at the last value (`heldFlat` true) or
     * extrapolated. Empty when every material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * console.log(design.pulse({ centre: 550 }).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._result.outOfRange; }

    /**
     * Writes the metrics to a CSV file as the window's Copy CSV writes its
     * Results table: Quantity, Value and Unit, a row for each metric in the
     * window's words, the peaks and the energy in percent, and the input's
     * FWHM only when the input is chirped. A file that is there is written
     * over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `pulse-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^8 H');
     * design.pulse({ centre: 550 }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const table = resultsTable(windowMetrics(this._result), en.pulseAnalysis, en.units);
        const lines = [table.columns.map(column => column.label), ...table.rows.map(row => table.columns.map(column => cell(row[column.key])))];
        fs.writeFileSync(path, lines.map(line => line.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the pulse.
    [inspect.custom]() {
        const { mode, response, pol, angle, centre, passes } = this._result;
        return `<Pulse ${mode} ${response} ${pol} at ${angle} degrees, centre ${centre} nm, ${passes} pass${passes === 1 ? '' : 'es'}>`;
    }
}
