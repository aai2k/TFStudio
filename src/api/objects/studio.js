// tf: TFStudio's designs and materials, and in the Script Console the open design.

import { inspect } from 'node:util';
import * as api from '../index.js';
import { checkOptions } from '../check.js';
import { Design } from './design.js';
import { MaterialDispersion } from './materialDispersion.js';
import { defined, trailingOptions } from './options.js';
import { worded } from './refusals.js';

// A built-in material's id as a design may also hold it, after this prefix:
// the form stack() writes, which findMaterials does not list.
const BUILTIN = 'builtin:';

// What the coating writers call the plain calls' from and to.
const RANGE_NAMES = { from: 'start', to: 'end' };

// `options` after refusing a name not in `known`, start or end, with start
// and end under the plain call's names.
function rangeOptions(method, options, known) {
    const { start, end, ...given } = checkOptions(method, options, [...known, 'start', 'end']);
    return { ...given, ...defined({ from: start, to: end }) };
}

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

    /**
     * The range of wavelengths the material's data cover, `[first, last]` in
     * nm, or null when it states none, as a formula with no stated range.
     *
     * @example
     * console.log('TiO2 has data from', tf.materials.get('TiO2').range);
     */
    get range() {
        // materialNK reports the range beside n and k; the wavelength asked is any one.
        return api.materialNK(this.id, [550]).rangeNm;
    }

    /**
     * Phase, group delay, GDD, CDC and TOD of light through a slab of the
     * material, and its group index, against wavelength, as the Material
     * Dispersion window computes them: φ = −(d/c)·ω·n of the slab of
     * thickness d and its derivatives against ω, from the material's formula
     * or its table read as the app reads it, so the values are analytic at
     * each wavelength and the phase is absolute. The wavelengths are the
     * window's, 2000 steps over the range and never finer than 0.2 nm, with
     * a sample on each table knot in range. Light the slab absorbs to an
     * optical depth above 50 leaves no value.
     *
     * @param [start=400] The first wavelength, nm.
     * @param [end=1100] The last wavelength, nm, above `start`.
     * @param [options]
     * @param [options.thickness=1] The slab's thickness, mm, from 1e-9 (1 pm) to 100000 (100 m).
     * @returns A MaterialDispersion.
     * @throws an option it does not take, a range that is not one, or a thickness outside 1e-9 to 100000 mm
     * @example
     * const d = tf.materials.get('BK7').dispersion(700, 900, { thickness: 2 });
     * console.log('2 mm of BK7: GDD from', d.gdd.min().toFixed(1), 'to', d.gdd.max().toFixed(1), 'fs²');
     */
    dispersion(...args) {
        const [[start, end], options] = trailingOptions('dispersion', args, ['start', 'end']);
        const words = { method: 'dispersion', call: 'materialDispersion', hidden: ['from', 'to'] };
        const given = checkOptions('dispersion', options, ['thickness']);
        return new MaterialDispersion(worded(words, () => api.materialDispersion(this.id, defined({ ...given, from: start, to: end }))));
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

    /**
     * Reads a spectrum file as the Measured Spectra window's import reads it:
     * a CSV or text table, one curve per column after the wavelength column,
     * or a JCAMP-DX file, one curve per spectrum, each what the window would
     * add to a design. The options take the place of the import panel's
     * settings, which ask only what the file leaves unsaid: an angle or a
     * polarization the file states, in its header lines or in a column's
     * heading, is kept, as in the window.
     *
     * @param path The file, by its full path. A relative path is taken as `openDesign` takes it.
     * @param [options]
     * @param [options.angle] The angle of incidence, degrees, for the curves whose file states none; 0 where neither does.
     * @param [options.pol] `'avg'`, `'s'` or `'p'`, for the curves whose file states none; `'avg'` where neither does. A column headed with its polarization, such as Rs, keeps it, and an A column headed with none is `'avg'`.
     * @param [options.quantity] For a table, `'T'`, `'R'` or `'A'` for every column; without it, what each column's heading says, and T where it says none.
     * @param [options.scale] For a table, how every column's values are written: `'fraction'`, `'percent'` or `'absorbance'`; without it, what the import makes of each column.
     * @param [options.xUnit] For a table, the unit of its wavelength column: `'nm'`, `'um'`, `'cm-1'` or `'eV'`; without it, what the import makes of it.
     * @returns An object: `format`, `'table'` or `'jcamp'`; `fileName`; `xUnit`, the unit a table's wavelengths were read in, or null; `skippedRows`, lines of a table that held no row; and `curves`, each `{ name, quantity, angle, pol, wavelength, values }`, the wavelengths in nm rising and R, T and A as fractions of 1, which `design.compareMeasured()` takes.
     * @throws a file that cannot be read or holds no spectrum the import reads, an option it does not take or a value an option cannot take, or for a JCAMP-DX file an option other than angle and pol
     * @example
     * const file = require('path').join(require('os').homedir(), `scan-${Date.now()}.csv`);
     * require('fs').writeFileSync(file, 'Wavelength (nm),%R\n450,2.1\n550,0.9\n650,1.8\n');
     * const [scan] = tf.readSpectrumFile(file).curves;
     * console.log(scan.name, scan.quantity, scan.wavelength, scan.values);
     */
    readSpectrumFile(path, options) {
        return worded({ method: 'readSpectrumFile', call: 'readSpectrumFile' }, () => api.readSpectrumFile(path, options));
    }

    /**
     * Reads an ellipsometer file as the Measured Ellipsometry window's import
     * reads it: a table of a wavelength column and columns of Ψ and Δ in
     * degrees, each column typed as the window types it, the curves the
     * window's Add all adds. The options take the place of the import panel's
     * settings: an angle the file states, in its header lines or in a
     * column's heading, is kept, as in the window, and the side its header
     * states fills the panel, which `side` replaces.
     *
     * @param path The file, by its full path. A relative path is taken as `openDesign` takes it.
     * @param [options]
     * @param [options.angle] The angle of incidence, degrees, for the columns whose file states none; 70 where neither does.
     * @param [options.side] `'front'` or `'back'`, the side measured; without it, the side the file's header states, or `'front'`.
     * @param [options.deltaConvention='azzam'] The sign the file writes Δ in: `'azzam'` or `'reversed'`, 360 degrees less it.
     * @param [options.xUnit] The unit of the wavelength column: `'nm'`, `'um'`, `'cm-1'` or `'eV'`; without it, what the import makes of it.
     * @param [options.quantities] Each column's type, in the file's order: `'PSI'`, `'DEL'`, or null for the type the import gives it; a column with no type is left out.
     * @returns An object: `fileName`; `xUnit`, the unit the wavelengths were read in; `skippedRows`, lines that held no row; and `curves`, each `{ name, quantity, angle, side, deltaConvention, cosDelta, wavelength, values }`: quantity `'PSI'` or `'DEL'`, deltaConvention null for Ψ, cosDelta true for a Δ that looks like cos Δ, the wavelengths in nm rising and the values in degrees, which `design.addMeasuredCurves()` and `design.compareMeasured()` take.
     * @throws a file that cannot be read or holds no table of numbers, an option it does not take or a value an option cannot take
     * @example
     * const file = require('path').join(require('os').homedir(), `witness-${Date.now()}.csv`);
     * require('fs').writeFileSync(file, '# AOI 65 deg, front side\nWavelength (nm),Psi (deg),Delta (deg)\n500,24.9,242.6\n600,20.7,218.4\n');
     * const [psi, delta] = tf.readEllipsometryFile(file).curves;
     * console.log(psi.angle, psi.values, delta.values);
     */
    readEllipsometryFile(path, options) {
        return worded({ method: 'readEllipsometryFile', call: 'readEllipsometryFile' }, () => api.readEllipsometryFile(path, options));
    }

    /**
     * Writes measured curves a design holds to a file as the Export tab
     * writes them: Measured Spectra's for R, T and A, as CSV, its condition
     * lines above the columns, or as JCAMP-DX; Measured Ellipsometry's for Ψ
     * and Δ, as CSV in degrees. Without options, the window's factory format:
     * CSV, nm, R, T and A in percent.
     *
     * @param design The design, a Design.
     * @param path The file to write, by its full path. A relative path is taken as `openDesign` takes it.
     * @param [options]
     * @param [options.curves] The names of the curves written, all R, T and A or all Ψ and Δ. Without it, every R, T and A curve the design holds, or its Ψ and Δ when it holds none.
     * @param [options.format='csv'] `'csv'`, or `'jcamp'` for JCAMP-DX, which R, T and A take.
     * @param [options.xUnit='nm'] The unit of the wavelength column: `'nm'`, `'um'` or `'cm-1'` for R, T and A, `'nm'`, `'um'` or `'eV'` for Ψ and Δ.
     * @param [options.scale='percent'] For R, T and A, `'percent'` or `'fraction'`.
     * @param [options.overwrite=false] Write over a file that is already there.
     * @throws a design that is not a Design or holds no measured curve, a name of a curve it does not hold, curves of both kinds, an option it does not take or a value an option cannot take, or a file that is already there, without `overwrite`
     * @example
     * const file = require('path').join(require('os').homedir(), `bench-${Date.now()}.csv`);
     * const design = tf.newDesign('AR');
     * design.addMeasuredCurves({ name: 'Bench R', quantity: 'R', angle: 8, wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] });
     * tf.exportMeasuredCurves(design, file, { scale: 'fraction' });
     * console.log(require('fs').readFileSync(file, 'utf8'));
     */
    exportMeasuredCurves(design, path, options) {
        if (!(design instanceof Design)) throw new Error('exportMeasuredCurves: design is a Design, as tf.newDesign() or tf.openDesign() gives one');
        worded({ method: 'exportMeasuredCurves', call: 'exportMeasuredCurves' }, () => api.exportMeasuredCurves(design._data, path, options));
    }

    /**
     * Writes one side of a design to a Zemax OpticStudio COATING.DAT file as
     * the Zemax Coatings window's Export tab writes it: a MATE record for
     * each material, n and k sampled every `step` nm from `start` to `end`
     * and written in µm with the imaginary index as -k, then one COAT record
     * of the side's layers, from the incident medium side. The back is
     * written from the exit medium to the substrate, so on either face the
     * file means air to glass.
     *
     * @param design The design, a Design.
     * @param path The file to write, by its full path. A relative path is taken as `openDesign` takes it.
     * @param [options]
     * @param [options.name='TFSTUDIO_DESIGN'] The name of the COAT record, written in capitals, every character but letters, digits, `_` and `.` as `_`, and cut to 32 characters.
     * @param [options.thickness='absolute'] `'absolute'`, each layer's physical thickness in µm; or `'relative'`, its optical thickness in waves of `wavelength`.
     * @param [options.wavelength=550] λ₀, nm, for relative thicknesses.
     * @param [options.start=400] The first wavelength of the MATE records, nm.
     * @param [options.end=800] The last wavelength of the MATE records, nm, above `start`.
     * @param [options.step=25] The step of the MATE records, nm.
     * @param [options.scope='used'] `'used'`, the materials the design uses, its media and substrate included; or `'all'`, every material of the catalogs here as well.
     * @param [options.side] `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.
     * @param [options.overwrite=false] Write over a file that is already there.
     * @throws a design that is not a Design, a side with no layers, an option it does not take or a value an option cannot take, a start and end that are not a range, a file that is already there, without `overwrite`, or a design that names a material that resolves to nothing
     * @example
     * const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
     * const design = tf.newDesign('AR');
     * design.stack('0.5H L');
     * tf.saveZemaxCoating(design, file, { name: 'AR', thickness: 'relative' });
     * const text = require('fs').readFileSync(file, 'utf8');
     * console.log(text.slice(text.indexOf('COAT')));
     */
    saveZemaxCoating(design, path, options) {
        if (!(design instanceof Design)) throw new Error('saveZemaxCoating: design is a Design, as tf.newDesign() or tf.openDesign() gives one');
        const given = rangeOptions('saveZemaxCoating', options, ['name', 'thickness', 'wavelength', 'step', 'scope', 'side', 'overwrite']);
        worded({ method: 'saveZemaxCoating', call: 'saveZemaxCoating', names: RANGE_NAMES }, () => api.saveZemaxCoating(design._data, path, given));
    }

    /**
     * Reads a Zemax OpticStudio COATING.DAT file as the Zemax Coatings
     * window lists it: its MATE records, as the Materials tab lists them,
     * and its coatings, as the Coatings tab lists them, a relative thickness
     * given in nm at `wavelength`. Nothing is written to a catalog.
     *
     * @param path The file, by its full path. A relative path is taken as `openDesign` takes it.
     * @param [options]
     * @param [options.wavelength=550] λ₀, nm, at which a thickness the file gives in waves is converted to nm.
     * @returns An object: `fileName`; `materials`, each MATE record `{ name, repeat, importedAs, wavelength, n, k }`, repeat `{ index, count }` for a name the file defines more than once and null otherwise, importedAs the name an import gives it, wavelengths in nm rising and k 0 or more; and `coatings`, each COAT `{ name, type, layers }`, type `'stack'` for a stack of layers, the only kind that imports, or `'ideal'`, `'table'` or `'encrypted'`, and layers null but for a stack, each `{ material, thickness, fileThickness, mode }`, thickness in nm (null for a relative thickness whose material the file gives no index for), fileThickness as the file writes it, mode `'absolute'` or `'relative'`.
     * @throws a file that cannot be read or holds neither a MATE record nor a coating, an option it does not take or a value an option cannot take
     * @example
     * const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
     * require('fs').writeFileSync(file, 'MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n');
     * const read = tf.readZemaxCoating(file);
     * for (const layer of read.coatings[0].layers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
     */
    readZemaxCoating(path, options) {
        return worded({ method: 'readZemaxCoating', call: 'readZemaxCoating' }, () => api.readZemaxCoating(path, options));
    }

    /**
     * Writes one side of a design to a CODE V .seq command file as the CODE V
     * Coatings window's Export tab writes it: the commands that enter the
     * stack in the MULTILAYER option, thicknesses in nm from the incident
     * medium side, layers of zero thickness left out, a MIC table of each
     * material's n and k at up to 21 of the analysis wavelengths, and SAV,
     * which has CODE V save it as a .mul. The back is written from the exit
     * medium to the substrate.
     *
     * @param design The design, a Design.
     * @param path The file to write, by its full path. A relative path is taken as `openDesign` takes it.
     * @param [options]
     * @param [options.title] TIT, the stack's title, cut to 80 characters, single quotes left out; without it, the design's name.
     * @param [options.saveName] The name SAV saves the .mul under, each run of characters but letters, digits, `_` and `-` written as one `_`; without it, the design's name.
     * @param [options.start=400] The first analysis wavelength, nm.
     * @param [options.end=800] The last analysis wavelength, nm, above `start`.
     * @param [options.step=10] The step of the analysis wavelengths, nm; CODE V takes 100 of them at most.
     * @param [options.angles=[0]] ANG, the angles of incidence in degrees, 0 or more and below 90; CODE V takes 5 at most.
     * @param [options.wavelength] REF, the reference wavelength, nm; without it, the design's reference wavelength.
     * @param [options.side] `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.
     * @param [options.overwrite=false] Write over a file that is already there.
     * @returns What the writer noted, as the window lists it under the text: a material sampled on fewer wavelengths than it has, or an absorbing medium written without its k.
     * @throws a design that is not a Design, a side with no layers, a stack past a limit of the MUL option (1000 layers, 100 wavelengths, 5 angles), an option it does not take or a value an option cannot take, a start and end that are not a range, a file that is already there, without `overwrite`, or a design that names a material that resolves to nothing
     * @example
     * const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
     * const design = tf.newDesign('AR');
     * design.stack('0.5H L');
     * console.log(tf.saveCodevCoating(design, file, { angles: [0, 45] }));
     * console.log(require('fs').readFileSync(file, 'utf8').split('\n').filter(line => /^(COA|SUB|SAV)/.test(line.trim())).join('\n'));
     */
    saveCodevCoating(design, path, options) {
        if (!(design instanceof Design)) throw new Error('saveCodevCoating: design is a Design, as tf.newDesign() or tf.openDesign() gives one');
        const given = rangeOptions('saveCodevCoating', options, ['title', 'saveName', 'step', 'angles', 'wavelength', 'side', 'overwrite']);
        return worded({ method: 'saveCodevCoating', call: 'saveCodevCoating', names: RANGE_NAMES }, () => api.saveCodevCoating(design._data, path, given));
    }

    /**
     * Reads a CODE V coating file, a .seq command file or a .mul CODE V
     * saved, as the CODE V Coatings window's Import tab shows it: what the
     * stack sets around its layers, and its layers from the incident medium
     * side, a thickness the file gives in waves of REF given in nm. Nothing
     * is written to a catalog.
     *
     * @param path The file, by its full path; a name ending in .mul is read as a saved .mul, any other as commands. A relative path is taken as `openDesign` takes it.
     * @returns An object: `fileName`; `title`; `reference`, REF in nm; `wavelengths`, the analysis wavelengths in nm; `angles`, in degrees; `incident` and `substrate`, each `{ label, n, k }`, a MIC material by its label with n and k null, or a constant index with label null; `layers`, each `{ index, thickness, code, locked }`, index as for `incident`, thickness in nm, code its COA code (100 frozen, 0 free, 1 to 99 coupled) and locked whether it is 100; and `warnings`, what the reader noted.
     * @throws a file that cannot be read, or that does not enter a stack the reader can read, with what stopped it
     * @example
     * const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
     * require('fs').writeFileSync(file, "MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n");
     * const read = tf.readCodevCoating(file);
     * for (const layer of read.layers) console.log('n', layer.index.n, layer.thickness, 'nm', layer.locked ? 'locked' : '');
     */
    readCodevCoating(path) {
        return worded({ method: 'readCodevCoating', call: 'readCodevCoating' }, () => api.readCodevCoating(path));
    }

    // What console.log prints for tf.
    [inspect.custom]() { return '<TFStudio: tf.design, tf.materials, tf.newDesign(), tf.openDesign(), tf.readSpectrumFile(), tf.readEllipsometryFile()>'; }
}
