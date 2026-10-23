// The electric field through a coated side at one wavelength, as
// design.electricField() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import en from '../../constants/locales/en.js';

// The window's curves in the order its table lists them with avg chosen, and
// the name each carries in a column heading.
const CURVES = [['avg', en.eField.polSuffixAvg], ['s', en.eField.polSuffixS], ['p', en.eField.polSuffixP]];

// The rows of the window's table as its Copy CSV writes them, with its factory
// display: the amplitude of the whole field, avg with s and p, against depth
// in the field's depth unit.
function tableRows(field) {
    const header = [en.eField.xColumns[field.depthUnit], ...CURVES.map(([, suffix]) => `E (${suffix}) [V/m]`)];
    return [header, ...field.depth.map((depth, i) => [depth, ...CURVES.map(([pol]) => field[pol].amplitude[i])])];
}

/**
 * The electric field through one coated side at one wavelength, for s, p and
 * unpolarized light, as design.electricField() computes it and the Electric
 * Field window draws it.
 *
 * @example
 * const design = tf.newDesign('Mirror', { reference: 1064 });
 * design.stack('(HL)^4 H');
 * const field = design.electricField(1064);
 * console.log('peak |E|², s:', Math.max(...field.s.e2), 'over', field.z.length, 'samples');
 */
export class ElectricField {
    constructor(field) {
        this._field = field;
    }

    /**
     * The side computed: `'front'` or `'back'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(550).mode);
     */
    get mode() { return this._field.mode; }

    /**
     * The wavelength the field was computed at, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField().wavelength, 'nm');
     */
    get wavelength() { return this._field.wavelength; }

    /**
     * The angle of incidence, degrees in the medium light comes from.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(550, { angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._field.angle; }

    /**
     * The wavelength λ0 the depth was read at, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(633, { depthUnit: 'QWOT' }).reference, 'nm');
     */
    get reference() { return this._field.reference; }

    /**
     * The unit `depth` is in: `'nm'`, `'OT'`, `'QWOT'` or `'FWOT'`; `'nm'`
     * where an optical unit was asked for and a material has no index at the
     * reference wavelength.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(550, { depthUnit: 'FWOT' }).depthUnit);
     */
    get depthUnit() { return this._field.depthUnit; }

    /**
     * The samples taken across each layer.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(550, { pointsPerLayer: 200 }).pointsPerLayer);
     */
    get pointsPerLayer() { return this._field.pointsPerLayer; }

    /**
     * The depth of each sample from the outer surface, nm, an array: the
     * first at the surface, the last at the substrate.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { z } = design.electricField(550);
     * console.log(z.length, 'samples down to', z.at(-1), 'nm');
     */
    get z() { return this._field.z; }

    /**
     * The depth of each sample in `depthUnit`, an array.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(550, { depthUnit: 'QWOT' }).depth.at(-1), 'quarter waves');
     */
    get depth() { return this._field.depth; }

    /**
     * One object per layer with a thickness, in the order light meets them,
     * `{ number, material, start, end, depthStart, depthEnd }`: number as
     * design.layers and design.backLayers number it; material by id; start
     * and end its depth from the outer surface in nm, depthStart and depthEnd
     * in `depthUnit`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * for (const l of design.electricField(550).layers) console.log(l.number, l.material, l.start.toFixed(1), 'to', l.end.toFixed(1), 'nm');
     */
    get layers() { return this._field.layers; }

    /**
     * The s field, `{ e2, e2Tangential, e2Normal, amplitude }`, one value per
     * sample: |E|² of the whole field and of its components along and normal
     * to the layers, as fractions of the incident |E|², and the whole field's
     * amplitude in V/m for 1 W/m² incident.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log('peak |E|², s:', Math.max(...design.electricField(550).s.e2));
     */
    get s() { return this._field.s; }

    /**
     * The p field, as for `s`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { p } = design.electricField(550, { angle: 45 });
     * console.log('peak normal component, p:', Math.max(...p.e2Normal));
     */
    get p() { return this._field.p; }

    /**
     * The unpolarized field, the mean of the s and p fields sample by
     * sample, as for `s`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log('peak amplitude, avg:', Math.max(...design.electricField(550, { angle: 45 }).avg.amplitude), 'V/m');
     */
    get avg() { return this._field.avg; }

    /**
     * The incident beam's amplitude in V/m for 1 W/m², from the index of the
     * medium light comes from: |E|² of 1 reads this amplitude.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(550).incidentAmplitude, 'V/m');
     */
    get incidentAmplitude() { return this._field.incidentAmplitude; }

    /**
     * The materials of the side computed whose data do not reach the
     * wavelength, an array of `{ id, name, rangeNm, heldFlat }`, as for an
     * Admittance.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.electricField(5000).outOfRange.length, 'materials stop short of 5000 nm');
     */
    get outOfRange() { return this._field.outOfRange; }

    /**
     * Writes the field to a CSV file as the window's Copy CSV writes its
     * table with its factory display: a row per sample with the depth in
     * `depthUnit` and the amplitude of the whole field in V/m for 1 W/m², for
     * avg, s and p. A file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `field-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * design.electricField(550).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        fs.writeFileSync(path, tableRows(this._field).map(row => row.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the field.
    [inspect.custom]() {
        return `<ElectricField ${this.mode} at ${this.wavelength} nm, ${this.angle} degrees: ${this.layers.length} layers, ${this.z.length} samples>`;
    }
}
