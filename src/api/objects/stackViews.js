// A design's stack read at one wavelength, as design.indexProfile() and
// design.layerThicknesses() answer.

import fs from 'node:fs';
import { inspect } from 'node:util';

// The Refractive Index Profile window's names for the parts of its Total view,
// which its CSV export writes in the region column.
const REGIONS = { front: 'Front', substrate: 'Substrate', back: 'Back' };

// The rows of the window's table of `profile`, as its CSV export writes them:
// each step of n and k with the depth it starts at, the last at the substrate,
// without the stretch of medium and substrate the window draws at each end.
// On the whole part each part has rows of its own, depths counted from its
// start: the front, the substrate in mm, the back.
function tableRows(profile) {
    if (profile.mode !== 'total') {
        const { substrate } = profile;
        return [['z (nm)', 'n', 'k'], ...profile.layers.map(layer => [layer.start, layer.n, layer.k]), [profile.thickness, substrate.n, substrate.k]];
    }
    const coat = side => {
        const layers = profile.layers.filter(layer => layer.side === side);
        const last = layers[layers.length - 1];
        return last ? [...layers.map(layer => [REGIONS[side], layer.start, layer.n, layer.k]), [REGIONS[side], last.end, last.n, last.k]] : [];
    };
    const { substrate } = profile;
    const bulk = substrate ? [[REGIONS.substrate, 0, substrate.n, substrate.k], [REGIONS.substrate, substrate.thickness, substrate.n, substrate.k]] : [];
    return [['region', 'z', 'n', 'k'], ...coat('front'), ...bulk, ...coat('back')];
}

/**
 * The refractive index of a design's layers at one wavelength, laid out by
 * depth, as design.indexProfile() reads it and the Refractive Index Profile
 * window shows it.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^3 H');
 * const profile = design.indexProfile({ wavelength: 633 });
 * for (const l of profile.layers) console.log(l.number, l.material, l.n, l.start, l.end);
 */
export class IndexProfile {
    constructor(profile) {
        this._profile = profile;
    }

    /**
     * What it was laid out on: `'front'` or `'back'`, that side alone, or
     * `'total'`, the whole part.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.indexProfile().mode);
     */
    get mode() { return this._profile.mode; }

    /**
     * The wavelength n and k were read at, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.indexProfile().wavelength, 'nm');
     */
    get wavelength() { return this._profile.wavelength; }

    /**
     * The medium light comes from, `{ material, n, k }`: the incident
     * medium on the front, the exit medium on the back; null on the whole
     * part, whose profile starts at the front's outer layer.
     *
     * @example
     * const design = tf.newDesign('Prism coating');
     * design.stack('(HL)^2');
     * design.incidentMedium = 'BK7';
     * const { incident } = design.indexProfile();
     * console.log(incident.material, incident.n);
     */
    get incident() { return this._profile.incident; }

    /**
     * The substrate, `{ material, n, k }`; on the whole part also
     * `thickness`, mm, and null when the design gives the substrate no
     * thickness.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { substrate } = design.indexProfile({ side: 'total' });
     * console.log(substrate.material, substrate.n, substrate.thickness, 'mm');
     */
    get substrate() { return this._profile.substrate; }

    /**
     * One object per layer with a thickness, `{ number, material, n, k,
     * thickness, start, end }`: number as design.layers and
     * design.backLayers number it, 1 next to the substrate; material by id;
     * thickness, start and end in nm, start and end the layer's depth from
     * its side's outer surface. On one side the layers run from the outer
     * surface in. On the whole part each also has `side`; the front's come
     * first, from its outer surface in, then the back's from the substrate
     * out, with start and end from the substrate.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * for (const l of design.indexProfile().layers) console.log(l.number, l.material, l.n, l.k, l.start, l.end);
     */
    get layers() { return this._profile.layers; }

    /**
     * The physical thickness of the layers, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.indexProfile().thickness, 'nm');
     */
    get thickness() { return this._profile.thickness; }

    /**
     * The optical thickness of the layers, the sum of n times thickness at
     * the wavelength, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.indexProfile({ wavelength: 550 }).opticalThickness, 'nm');
     */
    get opticalThickness() { return this._profile.opticalThickness; }

    /**
     * The materials whose data do not reach the wavelength, an array of
     * `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the
     * last value (`heldFlat` true) or extrapolated. Empty when every
     * material covers it.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.indexProfile({ wavelength: 5000 }).outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._profile.outOfRange; }

    /**
     * Writes the profile to a CSV file, the table the window exports less
     * the stretch of medium and substrate it draws at each end: a row for
     * each step of n and k with the depth it starts at,
     * `z (nm)`, from the outer surface to the substrate, which the last row
     * gives. On the whole part the columns are `region`, `z`, `n` and `k`,
     * each part's depths counted from its start, the substrate's in mm. A
     * file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `profile-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * design.indexProfile({ wavelength: 633 }).saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        fs.writeFileSync(path, tableRows(this._profile).map(row => `${row.join(',')}\r\n`).join(''), 'utf8');
    }

    // What console.log prints for a profile.
    [inspect.custom]() {
        return `<IndexProfile ${this.mode} at ${this.wavelength} nm: ${this.layers.length} layers, ${this.thickness} nm>`;
    }
}

/**
 * Each layer's physical and optical thickness, as design.layerThicknesses()
 * lists them and the Layer Thicknesses window shows them.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^3 H');
 * for (const row of design.layerThicknesses().rows) console.log(row.number, row.material, row.thickness, row.qwot);
 */
export class LayerThicknesses {
    constructor(listed) {
        this._listed = listed;
    }

    /**
     * What was listed: `'front'` or `'back'`, that side's layers, or
     * `'total'`, both sides.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.layerThicknesses().mode);
     */
    get mode() { return this._listed.mode; }

    /**
     * The wavelength λ0 the optical thicknesses were taken at, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.layerThicknesses().wavelength, 'nm');
     */
    get wavelength() { return this._listed.wavelength; }

    /**
     * One object per layer, from layer 1 next to the substrate outward,
     * `{ number, material, thickness, opticalThickness, qwot, fwot }`:
     * number as design.layers and design.backLayers number it; material by
     * id; thickness, nm; opticalThickness, n times thickness, nm; qwot,
     * 4 n d / λ0, and fwot, n d / λ0, with n the material's index at the
     * wavelength. The three optical values are null for a layer with no
     * material. On both sides each row also has `side`, the front's rows
     * first.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * for (const row of design.layerThicknesses({ wavelength: 600 }).rows) console.log(row.number, row.opticalThickness, row.qwot, row.fwot);
     */
    get rows() { return this._listed.rows; }

    /**
     * The materials whose data do not reach the wavelength, an array of
     * `{ id, name, rangeNm, heldFlat }`, as for an IndexProfile.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.layerThicknesses({ wavelength: 5000 }).outOfRange.length, 'materials stop short of 5000 nm');
     */
    get outOfRange() { return this._listed.outOfRange; }

    // What console.log prints for the rows.
    [inspect.custom]() { return `<LayerThicknesses ${this.mode} at ${this.wavelength} nm: ${this.rows.length} layers>`; }
}
