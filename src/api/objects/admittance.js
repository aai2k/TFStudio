// A coated side's admittance locus at one wavelength, as design.admittance()
// answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import en from '../../constants/locales/en.js';

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, a name with each comma made a semicolon.
const cell = value => (typeof value === 'number' ? String(value) : String(value).replace(/,/g, ';'));

// The rows of the window's table for both polarizations, as its Copy CSV
// writes them: for each, the substrate, each layer from the substrate out, and
// the incident medium, whose reflection coefficient against itself is 0.
function tableRows(loci) {
    const rows = [[en.admittance.colLayer, en.admittance.colMaterial, 'Re(Y)', 'Im(Y)', 'Re(Γ)', 'Im(Γ)']];
    for (const pol of ['s', 'p']) {
        const locus = loci[pol];
        for (const b of locus.boundaries) {
            rows.push([b.layer === 0 ? `η_s (${pol})` : `L${b.layer} (${pol})`, b.name, b.Y.re, b.Y.im, b.gamma.re, b.gamma.im]);
        }
        rows.push([`η₀ (${pol})`, loci.incident.name, locus.eta0.re, locus.eta0.im, 0, 0]);
    }
    return rows;
}

/**
 * The admittance locus of one coated side at one wavelength, for s and p, as
 * design.admittance() computes it and the Admittance Diagram window draws it.
 * Complex values are `{ re, im }` in Macleod's sign, the window's: an
 * absorbing material's admittance has a negative imaginary part.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^3 H');
 * const locus = design.admittance(550).s;
 * for (const b of locus.boundaries) console.log(b.layer, b.name, b.Y.re.toFixed(4), b.Y.im.toFixed(4));
 */
export class Admittance {
    constructor(loci) {
        this._loci = loci;
    }

    /**
     * The side computed: `'front'` or `'back'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance(550).mode);
     */
    get mode() { return this._loci.mode; }

    /**
     * The wavelength, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance().wavelength, 'nm');
     */
    get wavelength() { return this._loci.wavelength; }

    /**
     * The angle of incidence, degrees in the medium light comes from.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance(550, { angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._loci.angle; }

    /**
     * The plane the arcs are in: `'admittance'`, the Y plane, or
     * `'reflection'`, the plane of the reflection coefficient Γ.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance(550, { plane: 'reflection' }).plane);
     */
    get plane() { return this._loci.plane; }

    /**
     * The medium light comes from, `{ material, name }`: the incident
     * medium on the front, the exit medium on the back.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance(550).incident);
     */
    get incident() { return this._loci.incident; }

    /**
     * The substrate, `{ material, name }`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance(550).substrate.name);
     */
    get substrate() { return this._loci.substrate; }

    /**
     * The s locus, `{ eta0, etaSubstrate, boundaries, arcs }`: eta0 and
     * etaSubstrate the admittances of the medium and the substrate;
     * boundaries the window's table, one `{ layer, material, name, Y, gamma }`
     * per boundary from the substrate out, layer 0 the bare substrate and
     * then each layer with a thickness by its number as design.layers
     * numbers it, Y the admittance at its outer surface and gamma the
     * reflection coefficient there, the last at the outer surface of the
     * coating; arcs one `{ layer, material, re, im }` per layer with a
     * thickness, from the substrate out, re and im the points the window
     * draws it through, in the plane chosen.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { gamma } = design.admittance(550, { angle: 45 }).s.boundaries.at(-1);
     * console.log('Rs', gamma.re ** 2 + gamma.im ** 2);
     */
    get s() { return this._loci.s; }

    /**
     * The p locus, as for `s`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { Y } = design.admittance(550, { angle: 45 }).p.boundaries.at(-1);
     * console.log('Y at the front surface, p:', Y.re, Y.im);
     */
    get p() { return this._loci.p; }

    /**
     * The materials of the side computed whose data do not reach the
     * wavelength, an array of `{ id, name, rangeNm, heldFlat }`: their n and
     * k there are held at the last value (`heldFlat` true) or extrapolated.
     * Empty when every material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.admittance(5000).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._loci.outOfRange; }

    /**
     * Writes the loci to a CSV file as the window's Copy CSV writes its table
     * with both polarizations shown: for s and then p, a row for the
     * substrate, one for each layer from the substrate out and one for the
     * medium light comes from, with Re(Y), Im(Y), Re(Γ) and Im(Γ). A file
     * that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `admittance-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * design.admittance(550, { angle: 45 }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        fs.writeFileSync(path, tableRows(this._loci).map(row => row.map(cell).join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the loci.
    [inspect.custom]() {
        return `<Admittance ${this.mode} at ${this.wavelength} nm, ${this.angle} degrees: ${this.s.arcs.length} layers, ${this.plane} plane>`;
    }
}
