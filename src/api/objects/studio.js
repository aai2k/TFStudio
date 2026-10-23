// tf: TFStudio's designs and materials, and in the Script Console the open design.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { checkOptions } from '../check.js';
import { Design } from './design.js';
import { trailingOptions } from './options.js';
import { worded } from './refusals.js';

// A built-in material's id as a design may also hold it, after this prefix:
// the form stack() writes, which findMaterials does not list.
const BUILTIN = 'builtin:';

/**
 * A material of TFStudio's catalogs, as tf.materials gives it.
 *
 * @example
 * const tio2 = tf.materials.get('TiO2');
 * console.log(tio2.id, tio2.name, tio2.catalog, tio2.nk(550));
 */
export class Material {
    constructor(found) {
        this._found = found;
    }

    /**
     * The id designs name the material by: a built-in material's short id,
     * such as `TiO2`, which can differ from its name, such as
     * `TiO2 (anatase)`; or `catalog:key` for a material of another catalog. A
     * design may also hold a built-in material as `builtin:TiO2`, the form
     * the Design Editor and stack() write, which tf.materials takes too.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.layers.append(tf.materials.get('MgF2').id, 95);
     * console.log(design.layers[1].material);
     */
    get id() { return this._found.id; }

    /**
     * The name the app shows.
     *
     * @example
     * console.log(tf.materials.get('TiO2').name);
     */
    get name() { return this._found.name; }

    /**
     * The catalog the material is in, `'builtin'` for a built-in one.
     *
     * @example
     * console.log(tf.materials.get('TiO2').catalog);
     */
    get catalog() { return this._found.catalog; }

    /**
     * n and k of the material, as the Material Dispersion window shows them;
     * outside the range its data cover they are held at the edge value or
     * extrapolated.
     *
     * @param wavelengths One wavelength, nm, or several.
     * @returns `[n, k]` for one wavelength; for several, `[ns, ks]`, an array of n and an array of k, one of each per wavelength.
     * @throws a wavelength of 0 or less
     * @example
     * const [n, k] = tf.materials.get('TiO2').nk(550);
     * const [ns, ks] = tf.materials.get('TiO2').nk([400, 550, 700]);
     * console.log(n, k, ns, ks);
     */
    nk(wavelengths) {
        const one = typeof wavelengths === 'number';
        const { nk } = worded({ method: 'nk', call: 'materialNK' }, () => api.materialNK(this.id, one ? [wavelengths] : wavelengths));
        const n = nk.map(point => point.n), k = nk.map(point => point.k);
        return one ? [n[0], k[0]] : [n, k];
    }

    // What console.log prints for a material.
    [inspect.custom]() { return `<Material ${this.id} (${this.name}, ${this.catalog})>`; }
}

/**
 * The materials of TFStudio's catalogs: the built-in ones and those of the
 * catalogs in the data folder.
 *
 * @example
 * const [n, k] = tf.materials.get('TiO2').nk(550);
 * console.log(n, k, tf.materials.find('SiO2').length);
 */
export class Materials {
    /**
     * The material with this id, or else with this name. A built-in
     * material's id may be given as `builtin:TiO2`, as a layer's material can
     * hold it.
     *
     * @param idOrName The material's id, or its name.
     * @returns A Material.
     * @throws no material with this id or name, or several with this name and none with this id
     * @example
     * console.log(tf.materials.get('TiO2'));
     */
    get(idOrName) {
        const id = typeof idOrName === 'string' && idOrName.startsWith(BUILTIN) ? idOrName.slice(BUILTIN.length) : idOrName;
        const found = api.findMaterials(id);
        const byId = found.filter(m => m.id === id);
        const exact = byId.length ? byId : found.filter(m => m.name === idOrName);
        if (exact.length === 1) return new Material(exact[0]);
        if (exact.length) {
            throw new Error(`materials: ${exact.length} materials are named '${idOrName}': take one by its id, ${exact.map(m => m.id).join(', ')}`);
        }
        throw new Error(`materials: no material has the id or name '${idOrName}'; tf.materials.find('${idOrName}') lists those whose id or name holds it`);
    }

    /**
     * The materials whose id or name holds `text`, in upper or lower case.
     *
     * @param [text=''] The text to look for; empty finds every material.
     * @returns The materials found, each a Material.
     * @example
     * for (const m of tf.materials.find('TiO2')) console.log(m.id, m.catalog);
     */
    find(text = '') {
        return api.findMaterials(text).map(found => new Material(found));
    }

    // What console.log prints for the materials.
    [inspect.custom]() { return '<Materials: tf.materials.get(id or name), tf.materials.find(text)>'; }
}

/**
 * TFStudio, computing as the app does. In the Script Console, `tf` is one,
 * with the open design in `tf.design`.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * console.log(Math.max(...design.spectrum(400, 700).R));
 */
export class TFStudio {
    /**
     * In the Script Console, the design open in the app when the script
     * started, a Design, or null when none was open; null in a program. When
     * the script ends, the design left here, whether `tf.design` was changed
     * in place or set to another Design, is applied to the open design as one
     * step Undo takes back, if that design has not changed meanwhile. The open design keeps
     * its name, which is its file's, so nothing is applied when the design
     * holds what it started with but for its name.
     *
     * @example
     * if (tf.design) console.log('The open design is', tf.design.name, 'with', tf.design.layers.length, 'front layers');
     * else console.log('No design is open');
     */
    design = null;

    constructor(info) {
        this._info = info;
        this._materials = new Materials();
    }

    /**
     * What starting TFStudio found, an object: `wasm`, `true` when the fast
     * kernel loaded, `dataDir`, the data folder whose catalogs it read, or
     * null, and `unreadable`, the catalog files it could not read.
     *
     * @example
     * console.log(tf.info.wasm, tf.info.dataDir);
     */
    get info() { return this._info; }

    /**
     * The materials of TFStudio's catalogs, a Materials.
     *
     * @example
     * const [n, k] = tf.materials.get('TiO2').nk(550);
     * console.log(n, k);
     */
    get materials() { return this._materials; }

    /**
     * A new design as the app makes one: a bare substrate in air, with no
     * layers, coated on the front and scored on its coated side.
     *
     * @param [name='New Design'] The design's name.
     * @param [options]
     * @param [options.substrate='BK7'] The substrate material, by id.
     * @param [options.reference=550] The reference wavelength, nm, at which stack formulas count quarter waves.
     * @returns A Design.
     * @throws a material id that resolves to nothing, or a reference wavelength of 0 or less
     * @example
     * const design = tf.newDesign('Mirror 550', { substrate: 'BK7', reference: 550 });
     * console.log(design);
     */
    newDesign(...args) {
        const [[name = 'New Design'], options] = trailingOptions('newDesign', args, ['name']);
        const { substrate = 'BK7', reference = 550 } = checkOptions('newDesign', options, ['substrate', 'reference']);
        const words = { method: 'newDesign', call: 'newDesign', names: { referenceWavelength: 'reference' } };
        return new Design(worded(words, () => api.newDesign({ name, substrate, referenceWavelength: reference })));
    }

    /**
     * A design read from a .tfs file, as File > Open reads it, with the same
     * checks and repairs.
     *
     * @param path The file, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @returns A Design.
     * @throws a file that cannot be read or does not hold a usable design
     * @example
     * const file = require('path').join(require('os').homedir(), `mirror-${Date.now()}.tfs`);
     * const mirror = tf.newDesign('Mirror');
     * mirror.stack('(HL)^4 H');
     * mirror.save(file);
     * const design = tf.openDesign(file);
     * console.log(design.name, design.layers.length, 'layers, from', file);
     */
    openDesign(path) {
        return new Design(api.openDesign(path));
    }

    // What console.log prints for tf.
    [inspect.custom]() { return '<TFStudio: tf.design, tf.materials, tf.newDesign(), tf.openDesign()>'; }
}
