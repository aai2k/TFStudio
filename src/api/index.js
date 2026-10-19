/**
 * TFStudio's headless API: open, edit, evaluate, optimize and tolerance a
 * design without the app's window, in Node. Every call computes with the code
 * the windows compute with, so its numbers are the app's numbers. A design is the plain object a .tfs file
 * holds; calls that change one return a new one.
 *
 *   await init({ dataDir })        WASM kernel, and the user's catalogs from a data folder
 *   openDesign(path), saveDesign(design, path, { overwrite }), newDesign(setup), setDesignSetup(design, setup)
 *   insertLayer, deleteLayer, setLayer, stackFromFormula
 *   findMaterials(query), materialNK(id, wavelengths, design)
 *   spectrum(design, { from, to, step, angles }), summarize(spectrum, { bands })
 *   setMerit(design, rows), merit(design)
 *   refine(design, settings, hooks), synthesize(design, { method, pool, settings }, hooks), runHooks(method)
 *   monteCarlo(design, options), layerSensitivity(design, options)
 *
 * Wavelengths and layer thicknesses are in nm, angles in degrees in the
 * incident medium, substrate thickness in mm, reflectance and transmittance as
 * fractions of 1. A name, setting or value the API cannot use is refused with
 * an error that says what it takes; nothing is silently replaced.
 */
export { init } from './environment.js';
export { openDesign, saveDesign, newDesign, setDesignSetup } from './designs.js';
export { insertLayer, deleteLayer, setLayer, stackFromFormula } from './stack.js';
export { findMaterials, materialNK } from './materials.js';
export { spectrum, summarize } from './evaluate.js';
export { setMerit, merit } from './merit.js';
export { refine, synthesize, runHooks } from './runs.js';
export { monteCarlo, layerSensitivity } from './tolerance.js';
