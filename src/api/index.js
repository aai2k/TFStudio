/**
 * TFStudio's headless API: open, edit, evaluate, optimize and tolerance a
 * design without the app's window, in Node. Every call computes with the code
 * the windows compute with, so its numbers are the app's numbers. A design is the plain object a .tfs file
 * holds; calls that change one return a new one.
 *
 *   await init({ dataDir })        WASM kernel, and the user's catalogs from a data folder
 *   openDesign(path), saveDesign(design, path, { overwrite }), newDesign(setup), setDesignSetup(design, setup)
 *   insertLayer, deleteLayer, setLayer, stackFromFormula, cleanDesign(design, options)
 *   findMaterials(query), materialNK(id, wavelengths, design)
 *   spectrum(design, { from, to, step, angles }), summarize(spectrum, { bands })
 *   indexProfile(design, { wavelength, side }), layerThicknesses(design, { wavelength, side }), designFacts(design, { side })
 *   admittance(design, { wavelength, angle, side, plane })
 *   electricField(design, { wavelength, angle, side, pointsPerLayer, depthUnit, reference })
 *   color(design, { quantity, angle, pol, observer, illuminant, step, side })
 *   integrals(design, { start, end, step, angle, pol, custom, side })
 *   setMerit(design, rows), merit(design)
 *   setSpecification(design, checks), checkSpecification(design)
 *   refine(design, settings, hooks), synthesize(design, { method, pool, settings }, hooks), runHooks(method)
 *   monteCarlo(design, options, hooks), estimateYield(design, options, hooks), layerSensitivity(design, options)
 *
 * Wavelengths and layer thicknesses are in nm, angles in degrees in the
 * incident medium, substrate thickness in mm, reflectance and transmittance as
 * fractions of 1. A name, setting or value the API cannot use is refused with
 * an error that says what it takes; nothing is silently replaced.
 */
export { init } from './environment.js';
export { openDesign, saveDesign, newDesign, setDesignSetup } from './designs.js';
export { insertLayer, deleteLayer, setLayer, stackFromFormula } from './stack.js';
export { cleanDesign } from './cleaner.js';
export { findMaterials, materialNK } from './materials.js';
export { spectrum, summarize } from './evaluate.js';
export { indexProfile, layerThicknesses } from './stackViews.js';
export { designFacts } from './designFacts.js';
export { admittance } from './admittance.js';
export { electricField } from './electricField.js';
export { color } from './color.js';
export { integrals } from './integrals.js';
export { setMerit, merit } from './merit.js';
export { setSpecification, checkSpecification } from './specification.js';
export { refine, synthesize, runHooks } from './runs.js';
export { monteCarlo, estimateYield, layerSensitivity } from './tolerance.js';
