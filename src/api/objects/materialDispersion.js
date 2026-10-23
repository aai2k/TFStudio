// A material's phase, group delay, GDD, CDC and TOD through a slab of it,
// and its group index, as material.dispersion() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import en from '../../constants/locales/en.js';
import { materialDispersionColumns } from '../../utils/materials/materialDispersionSpectrum.js';
import { curveOf } from './spectrum.js';

const CURVES = ['phase', 'gd', 'gdd', 'cdc', 'tod', 'groupIndex'];

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, an empty cell for none, a name with each comma made a
// semicolon.
function cell(value) {
    if (value == null) return '';
    return typeof value === 'number' ? String(value) : String(value).replace(/,/g, ';');
}

/**
 * Phase, group delay, GDD, CDC and TOD of light through a slab of one
 * material, and its group index, against wavelength, as
 * material.dispersion() computes them and the Material Dispersion window
 * shows them. `d.phase`, `d.gd`, `d.gdd`, `d.cdc`, `d.tod` and
 * `d.groupIndex` are Curves.
 *
 * @example
 * const d = tf.materials.get('BK7').dispersion(700, 900, { thickness: 2 });
 * console.log('mean GDD of 2 mm of BK7 from 780 to 820 nm:', d.gdd.mean(780, 820).toFixed(1), 'fs²');
 */
export class MaterialDispersion {
    constructor(result) {
        this._result = result;
        this._curves = Object.fromEntries(CURVES.map(key => [key, curveOf(result[key], result.wavelength)]));
    }

    /**
     * The slab's thickness, mm.
     *
     * @example
     * console.log(tf.materials.get('BK7').dispersion().thickness, 'mm');
     */
    get thickness() { return this._result.thickness; }

    /**
     * The wavelengths, nm: the window's grid, with a sample on each table
     * knot in range.
     *
     * @example
     * console.log(tf.materials.get('BK7').dispersion(700, 900).wavelength.length, 'wavelengths');
     */
    get wavelength() { return this._result.wavelength; }

    /**
     * The phase φ = −(d/c)·ω·n, degrees, a Curve.
     *
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900);
     * console.log('phase from', d.phase.min().toFixed(0), 'to', d.phase.max().toFixed(0), 'degrees');
     */
    get phase() { return this._curves.phase; }

    /**
     * The group delay, fs, a Curve.
     *
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900);
     * console.log('GD of 1 mm of BK7 at 800 nm:', d.gd[d.wavelength.indexOf(800)].toFixed(1), 'fs');
     */
    get gd() { return this._curves.gd; }

    /**
     * The GDD, fs², a Curve.
     *
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900);
     * console.log('GDD of 1 mm of BK7 at 800 nm:', d.gdd[d.wavelength.indexOf(800)].toFixed(2), 'fs²');
     */
    get gdd() { return this._curves.gdd; }

    /**
     * The CDC, GDD · 2πc/λ², fs/nm, a Curve, with the sign of GDD; the
     * slope of group delay against wavelength, dGD/dλ, is its negative.
     *
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900);
     * console.log('CDC of 1 mm of BK7 at 800 nm:', d.cdc[d.wavelength.indexOf(800)].toFixed(4), 'fs/nm');
     */
    get cdc() { return this._curves.cdc; }

    /**
     * The TOD, fs³, a Curve.
     *
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900);
     * console.log('TOD of 1 mm of BK7 at 800 nm:', d.tod[d.wavelength.indexOf(800)].toFixed(2), 'fs³');
     */
    get tod() { return this._curves.tod; }

    /**
     * The group index n − λ·dn/dλ, a Curve.
     *
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900);
     * console.log('group index of BK7 at 800 nm:', d.groupIndex[d.wavelength.indexOf(800)].toFixed(5));
     */
    get groupIndex() { return this._curves.groupIndex; }

    /**
     * For each wavelength, the material's name where its value was taken
     * outside the material's data, held at the edge or extrapolated, or
     * `null`.
     *
     * @example
     * const d = tf.materials.get('TiO2').dispersion(300, 1100);
     * console.log(d.outside.filter(Boolean).length, 'wavelengths outside the data');
     */
    get outside() { return this._result.outside; }

    /**
     * The wavelengths with no value, an array of
     * `{ wavelength, reason, maximumThickness }`. `reason` says why: most
     * often the slab absorbs the light there to an optical depth above 50,
     * and `maximumThickness`, mm, is then the thickness up to which it would
     * have one; it is `null` when no thickness gives one, as where the
     * material's model has no third derivative. The curves are NaN there.
     * Empty when every wavelength has one.
     *
     * @example
     * const d = tf.materials.get('Si').dispersion(400, 1100, { thickness: 1 });
     * console.log(d.masked.length, 'wavelengths with no value; the first', d.masked[0]);
     */
    get masked() { return this._result.masked; }

    /**
     * The table knots that are wavelengths of the grid, an array of
     * `{ wavelength, gd, gdd, tod, cdc }`, each quantity a pair
     * `[left, right]` of its values on the two sides of the knot; the value
     * the curves hold at that wavelength reads the material averaged across
     * the knot. None is read when the knots are dense against the grid, more
     * than one per 8 points.
     *
     * @example
     * for (const knot of tf.materials.get('TiO2').dispersion().knots.slice(0, 3)) console.log(knot.wavelength, 'nm: GDD', knot.gdd[0].toFixed(3), 'and', knot.gdd[1].toFixed(3), 'fs²');
     */
    get knots() { return this._result.knots; }

    /**
     * The models the material's n and k come from, as the window names
     * them.
     *
     * @example
     * console.log(tf.materials.get('BK7').dispersion().model);
     */
    get model() { return this._result.model; }

    /**
     * Writes the curves to a CSV file as the window's Copy CSV writes its
     * table: λ (nm), then Outside data where a value was taken outside the
     * material's data, then Phase φ (°), Group Delay (fs), GDD (fs²),
     * CDC (fs/nm), TOD (fs³) and nᵧ, the group index. A file that is there is
     * written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `bk7-dispersion-${Date.now()}.csv`);
     * tf.materials.get('BK7').dispersion(700, 900).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const result = this._result;
        const columns = materialDispersionColumns(en.gdgdd, en.spectralAxis.lambdaShort, en.materialRange.outsideColumn, result.outside.some(Boolean));
        const rows = result.wavelength.map((lambda, i) => ({
            lambda, outside: result.outside[i] ?? '', ...Object.fromEntries(CURVES.map(key => [key, result[key][i]])),
        }));
        const lines = [columns.map(column => column.label), ...rows.map(row => columns.map(column => cell(row[column.key])))];
        fs.writeFileSync(path, lines.map(line => line.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the curves.
    [inspect.custom]() {
        const { id, thickness, wavelength } = this._result;
        return `<MaterialDispersion ${id}, ${thickness} mm, from ${wavelength[0]} to ${wavelength[wavelength.length - 1]} nm, ${wavelength.length} points>`;
    }
}
