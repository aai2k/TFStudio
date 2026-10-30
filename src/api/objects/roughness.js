// A design's specular R and T with rough interfaces against the smooth
// design, as design.roughness() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { SCATTER_CURVES } from '../../components/windows/analysis/roughnessScattering/figure.js';
import { scatterColumns, scatterRows } from '../../components/windows/analysis/roughnessScattering/tableModel.js';
import en from '../../constants/locales/en.js';
import { curveOf } from './spectrum.js';

// Every curve switch on, so the table has every column.
const EVERY_CURVE = Object.fromEntries(SCATTER_CURVES.map(key => [key, true]));

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, an empty cell for none.
const cell = value => (value == null ? '' : String(value));

// The curves of one spectrum, each a Curve.
const curvesOf = (spectrum, wavelength) => Object.fromEntries(Object.entries(spectrum).map(([key, values]) => [key, curveOf(values, wavelength, key)]));

/**
 * The specular R and T of a design with rough interfaces, against the smooth
 * design, as design.roughness() computes them and the Roughness / Scattering
 * window shows them. `r.smooth` and `r.rough` hold the curves and `r.loss` the
 * light lost from the specular beams, each a Curve.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * const r = design.roughness({ sigma: 2 });
 * console.log(r.mode, 'mean R from 500 to 600 nm', r.smooth.R.mean(500, 600).toFixed(5), 'becomes', r.rough.R.mean(500, 600).toFixed(5));
 */
export class Roughness {
    constructor(result) {
        this._result = result;
        this._smooth = curvesOf(result.smooth, result.wavelength);
        this._rough = curvesOf(result.rough, result.wavelength);
        this._loss = curveOf(result.loss, result.wavelength, 'loss');
    }

    /**
     * The sides computed: `'front'`, `'back'` or `'total'`, the whole part.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.roughness().mode, design.roughness({ side: 'total' }).mode);
     */
    get mode() { return this._result.mode; }

    /**
     * The angle of incidence, degrees in the incident medium.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.roughness({ angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._result.angle; }

    /**
     * The wavelengths, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.roughness({ step: 100 }).wavelength.join(', '));
     */
    get wavelength() { return this._result.wavelength; }

    /**
     * The design as it stands: `R` and `T` for unpolarized light and `Rs`,
     * `Rp`, `Ts` and `Tp` for s and p, each a Curve of fractions of 1.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log('peak R', design.roughness().smooth.R.max().toFixed(5));
     */
    get smooth() { return this._smooth; }

    /**
     * The design with its rough interfaces, the same curves as `smooth`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const r = design.roughness({ sigma: 3, range: 'short' });
     * console.log('peak R', r.rough.R.max().toFixed(5), 'against', r.smooth.R.max().toFixed(5));
     */
    get rough() { return this._rough; }

    /**
     * The light lost from the specular beams, smooth R + T minus rough R + T
     * for unpolarized light, a Curve of fractions of 1. In an absorbing design
     * it holds the change in absorption too, and where a transition layer
     * replaces part of an absorbing layer it can fall below 0.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const loss = design.roughness({ sigma: 2 }).loss;
     * console.log('largest loss', (loss.max() * 1e6).toFixed(1), 'ppm');
     */
    get loss() { return this._loss; }

    /**
     * The layers set to 0 nm because their transition layer took more than
     * they had, an array of `{ side, number }`, numbered as the Design Editor
     * numbers them. Empty when every layer is thicker than 2σ.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.layers[1].thickness = 3;
     * console.log(design.roughness({ sigma: 2 }).thinned);
     */
    get thinned() { return this._result.thinned; }

    /**
     * `true` when a long-range interface with a σ above 0 is in. The
     * long-range layer is derived for one surface at normal incidence, so at
     * an angle, under a cone or in a multilayer it is an estimate.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.roughness().longRange, design.roughness({ range: 'short' }).longRange);
     */
    get longRange() { return this._result.longRange; }

    /**
     * The materials of the sides computed whose data stop inside the range,
     * an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n
     * and k are held at the last value (`heldFlat` true) or extrapolated.
     * Empty when every material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.roughness({ start: 200, end: 2500, step: 10 }).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._result.outOfRange; }

    /**
     * Writes the curves to a CSV file as the window's Copy CSV writes its
     * table with every curve switched on: λ (nm), then for T, Ts, Tp, R, Rs
     * and Rp in turn the smooth and the rough value, then the loss. The
     * window's headings name % and ppm, and its Copy CSV writes the values as
     * fractions of 1, as this does. A file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `roughness-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.roughness({ sigma: 2 }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const { wavelength, smooth, rough, loss } = this._result;
        const calc = { lambda: wavelength, ideal: smooth, specular: rough, loss };
        const columns = scatterColumns(en, 'ppm', EVERY_CURVE, calc);
        const rows = scatterRows(calc, EVERY_CURVE);
        const lines = [columns.map(column => column.label), ...rows.map(row => columns.map(column => cell(row[column.key])))];
        fs.writeFileSync(path, lines.map(line => line.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the spectra.
    [inspect.custom]() {
        const { mode, angle, wavelength, thinned } = this._result;
        return `<Roughness ${mode} at ${angle} degrees from ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points, ${thinned.length} layer${thinned.length === 1 ? '' : 's'} thinned to 0 nm>`;
    }
}
