// A design's spectrum with graded interlayers against the design as it
// stands, as design.inhomogeneities() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { OVERLAY_CURVES } from '../../components/windows/analysis/inhomogeneities/figure.js';
import { overlayColumns, overlayRows } from '../../components/windows/analysis/inhomogeneities/tableModel.js';
import en from '../../constants/locales/en.js';
import { SpecReport } from './results.js';
import { curveOf } from './spectrum.js';

// Every curve switch on, so the table has every column.
const EVERY_CURVE = Object.fromEntries(OVERLAY_CURVES.map(key => [key, true]));

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number times its column's scale, in the unit its heading names, an empty
// cell for none.
const cell = (value, scale = 1) => (value == null ? '' : String(value * scale));

// The curves of one spectrum, each a Curve.
const curvesOf = (spectrum, wavelength) => Object.fromEntries(Object.entries(spectrum).map(([key, values]) => [key, curveOf(values, wavelength, key)]));

/**
 * The spectrum of a design with graded interlayers at its interfaces, against
 * the design as it stands, as design.inhomogeneities() computes it and the
 * Inhomogeneities window shows it. `r.homogeneous` and `r.graded` hold the
 * curves, each a Curve.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * const r = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 3 }] });
 * console.log(r.mode, 'mean R from 500 to 600 nm', r.homogeneous.R.mean(500, 600).toFixed(5), 'becomes', r.graded.R.mean(500, 600).toFixed(5));
 */
export class Inhomogeneities {
    constructor(result) {
        this._result = result;
        this._homogeneous = curvesOf(result.homogeneous, result.wavelength);
        this._graded = curvesOf(result.graded, result.wavelength);
        this._specification = result.specification ? new SpecReport(result.specification) : null;
    }

    /**
     * The sides computed: `'front'`, `'back'` or `'total'`, the whole part.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.inhomogeneities().mode, design.inhomogeneities({ side: 'total' }).mode);
     */
    get mode() { return this._result.mode; }

    /**
     * The angle of incidence, degrees in the incident medium.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.inhomogeneities({ angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._result.angle; }

    /**
     * The wavelengths, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.inhomogeneities({ step: 100 }).wavelength.join(', '));
     */
    get wavelength() { return this._result.wavelength; }

    /**
     * The design as it stands: `R`, `T` and `A` for unpolarized light and
     * `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap` for s and p, each a Curve of
     * fractions of 1.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log('peak R', design.inhomogeneities().homogeneous.R.max().toFixed(5));
     */
    get homogeneous() { return this._homogeneous; }

    /**
     * The design with the interlayers in, the same curves as `homogeneous`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * const r = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 3 }, { interface: 5, thickness: 3 }] });
     * console.log('peak R', r.graded.R.max().toFixed(5), 'against', r.homogeneous.R.max().toFixed(5));
     */
    get graded() { return this._graded; }

    /**
     * The interlayers, in the order given, with their defaults filled in, an
     * array of `{ side, interface, thickness, profile, slices, materials }`:
     * `materials` the two that meet there, by id, in the order the interlayer
     * grades from one to the other.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * for (const row of design.inhomogeneities({ interlayers: [{ interface: 0 }, { interface: 9 }] }).interlayers) {
     *     console.log(row.side, row.interface, row.thickness, 'nm', row.profile, row.slices, 'slices:', row.materials.join(' to '));
     * }
     */
    get interlayers() { return this._result.interlayers; }

    /**
     * What the interlayers add to the coating, nm: the window's Σ.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.inhomogeneities({ interlayers: [{ interface: 1, thickness: 2 }, { interface: 2 }] }).addedThickness, 'nm');
     */
    get addedThickness() { return this._result.addedThickness; }

    /**
     * The verdict for the design with its interlayers in, a SpecReport as
     * specification.check() gives one, each check read at its own Step, as
     * the badge under the window's chart reads it; `null` when the design has
     * no specification.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.98 });
     * const report = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 10 }] }).specification;
     * console.log(report.passed, report.rows[0].value.toFixed(5));
     */
    get specification() { return this._specification; }

    /**
     * The materials of the sides computed whose data stop inside the range,
     * an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n
     * and k are held at the last value (`heldFlat` true) or extrapolated.
     * Empty when every material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.inhomogeneities({ start: 200, end: 2500, step: 10 }).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._result.outOfRange; }

    /**
     * Writes the curves to a CSV file as the window's Copy CSV writes its
     * table with every curve switched on: λ (nm), then for T, Ts, Tp, R, Rs,
     * Rp, A, As and Ap in turn the homogeneous and the graded value in %, as
     * the headings name them. A file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `interlayers-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.inhomogeneities({ interlayers: [{ interface: 4 }] }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const { wavelength, homogeneous, graded } = this._result;
        const columns = overlayColumns(en, EVERY_CURVE);
        const rows = overlayRows({ lambda: wavelength, ...homogeneous }, { lambda: wavelength, ...graded }, EVERY_CURVE);
        const lines = [columns.map(column => column.label), ...rows.map(row => columns.map(column => cell(row[column.key], column.scale)))];
        fs.writeFileSync(path, lines.map(line => line.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the spectra.
    [inspect.custom]() {
        const { mode, angle, wavelength, interlayers } = this._result;
        return `<Inhomogeneities ${mode} at ${angle} degrees from ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points, ${interlayers.length} interlayer${interlayers.length === 1 ? '' : 's'}>`;
    }
}
