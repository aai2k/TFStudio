/**
 * TFStudio's object API: a design as an object whose attributes and methods
 * read and change it, made on the plain calls of the headless API (src/api),
 * in the shape of the Python package's objects (python/tfstudio), with
 * camelCase names and an options object where Python takes keyword arguments.
 * The Script Console's `tf` is a TFStudio, with `tf.design` the open design.
 *
 *   const tf = await start({ dataDir })       a Node program; the console has its tf
 *   tf.newDesign(name, { substrate, reference }), tf.openDesign(path), tf.materials.get(id)
 *   design.layers[n], design.merit, design.spectrum(start, end, { step, angles })
 *   await design.refine({ method, ... }), await design.synthesize(method, pool, { ... })
 *   await design.monteCarlo(start, end, { ... }), design.layerSensitivity({ ... })
 *
 * Units are the app's: wavelengths and layer thicknesses in nm, angles in
 * degrees in the incident medium, the substrate's thickness in mm, R, T and A
 * as fractions of 1. A refusal throws an Error with the API's own message.
 */
import { init } from '../environment.js';
import { TFStudio } from './studio.js';

export { TFStudio, Materials, Material } from './studio.js';
export { Design, Substrate } from './design.js';
export { Layers, Layer } from './layers.js';
export { Merit, MeritRow } from './merit.js';
export { Spectrum, Curve } from './spectrum.js';
export { Progress, RunResult, MonteCarlo, LayerSensitivity, SensitivityRow } from './results.js';

/**
 * Starts TFStudio in a Node program, as the API's init() starts it: loads the
 * WASM kernel the app computes with and, given a data folder, reads the
 * material catalogs in it. The Script Console starts it before a script runs,
 * so a script has its `tf` already.
 *
 * @param [options]
 * @param [options.dataDir=null] A TFStudio data folder, the one that holds the Materials and Projects folders. Without it, the built-in materials and those a design carries resolve.
 * @param [options.wasmPath=null] The kernel file, when it is not the one the API ships with.
 * @returns A promise of a TFStudio, with `tf.design` null.
 * @throws a data folder that holds no Materials folder, or a second start with another data folder
 */
export async function start(options) {
    return new TFStudio(await init(options));
}
