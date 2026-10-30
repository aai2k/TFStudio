/**
 * TFStudio's headless API: open, edit, evaluate, optimize and tolerance a
 * design without the app's window, in Node. Every call computes with the code
 * the windows compute with, so its numbers are the app's numbers. A design is the plain object a .tfs file
 * holds; calls that change one return a new one.
 *
 *   await init({ dataDir })        WASM kernel, and the user's catalogs from a data folder
 *   openDesign(path), saveDesign(design, path, { overwrite }), newDesign(setup), setDesignSetup(design, setup)
 *   insertLayer, deleteLayer, setLayer, stackFromFormula, cleanDesign(design, options)
 *   scaleThicknesses(design, { factor, side }), quantize(design, { mode, value, side }), perturb(design, { percent, side, seed })
 *   flipLayers(design, { side }), copySide(design, { from }), designDifferences(design, other)
 *   edgeFilter(design, { pass, edge, angle, a, b, incident, periods }), applyEdgeFilter(design, { solution, periods, side, mode })
 *   needleProfile(design, { pool, side, step, intraSamples }), insertNeedle(design, candidate, { thickness, side })
 *   findMaterials(query), materialNK(id, wavelengths, design), materialDispersion(id, { from, to, thickness }, design)
 *   spectrum(design, { from, to, step, angles }), summarize(spectrum, { bands })
 *   bandFeature(design, { feature, from, to, quantity, angle, level }), edgeShift(design, { from, to, angles, level })
 *   readSpectrumFile(path, { angle, pol, quantity, scale, xUnit }), measuredDifference(design, measured, { grid, from, to, db, levelFree })
 *   readEllipsometryFile(path, { angle, side, deltaConvention, xUnit }), addMeasuredCurves(design, curves)
 *   fitMeasured(design, curve, { grid, from, to, weight, output, constraints }), exportMeasuredCurves(design, path, { curves, format, xUnit, scale })
 *   indexProfile(design, { wavelength, side }), layerThicknesses(design, { wavelength, side }), designFacts(design, { side })
 *   admittance(design, { wavelength, angle, side, plane })
 *   electricField(design, { wavelength, angle, side, pointsPerLayer, depthUnit, reference })
 *   color(design, { quantity, angle, pol, observer, illuminant, step, side })
 *   integrals(design, { start, end, step, angle, pol, custom, side })
 *   ellipsometry(design, { from, to, step, angles, side, deltaConvention })
 *   ellipsometryVsAngle(design, { wavelength, angleStart, angleEnd, angleStep, side, deltaConvention })
 *   groupDelay(design, { from, to, step, angle, pol, response, side, reference })
 *   pulseAnalysis(design, { source, shape, centre, duration, bandwidth, order, gdd, tod, side, response, pol, angle, passes }), setPulseSpectrum(design, fileOrRows)
 *   processSteps(design, { side, otherSide, quantity, angle, pol, from, to, step, chips }), exportProcess(design, folder, options)
 *   monitorWorksheet(design, { side, quantity, angle, pol, chips, wavelengths, signalErrorPct, noiseFloorPct, maxTerminationErrPct })
 *   saveZemaxCoating(design, path, { name, thickness, wavelength, from, to, step, scope, side, overwrite }), readZemaxCoating(path, { wavelength })
 *   importZemaxCoating(design, path, { coating, wavelength, side })
 *   saveCodevCoating(design, path, { title, saveName, from, to, step, angles, wavelength, side, overwrite }), readCodevCoating(path)
 *   importCodevCoating(design, path, { side })
 *   inhomogeneities(design, { interlayers, start, end, step, angle, side })
 *   roughness(design, { sigma, range, interfaces, start, end, step, angle, side })
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
export { scaleThicknesses, quantize, perturb, flipLayers, copySide, designDifferences } from './designEdits.js';
export { edgeFilter, applyEdgeFilter } from './edgeFilter.js';
export { needleProfile, insertNeedle } from './needle.js';
export { findMaterials, materialNK } from './materials.js';
export { materialDispersion } from './materialDispersion.js';
export { spectrum, summarize } from './evaluate.js';
export { bandFeature, edgeShift } from './bandFeature.js';
export { readSpectrumFile, measuredDifference } from './measured.js';
export { readEllipsometryFile } from './ellipsometryFile.js';
export { addMeasuredCurves, fitMeasured, exportMeasuredCurves } from './measuredCurves.js';
export { indexProfile, layerThicknesses } from './stackViews.js';
export { designFacts } from './designFacts.js';
export { admittance } from './admittance.js';
export { electricField } from './electricField.js';
export { color } from './color.js';
export { integrals } from './integrals.js';
export { ellipsometry, ellipsometryVsAngle } from './ellipsometry.js';
export { groupDelay } from './groupDelay.js';
export { pulseAnalysis, setPulseSpectrum } from './pulse.js';
export { processSteps, exportProcess } from './process.js';
export { monitorWorksheet } from './monitorWorksheet.js';
export { saveZemaxCoating, readZemaxCoating, importZemaxCoating } from './zemaxCoating.js';
export { saveCodevCoating, readCodevCoating, importCodevCoating } from './codevCoating.js';
export { inhomogeneities } from './inhomogeneities.js';
export { roughness } from './roughness.js';
export { setMerit, merit } from './merit.js';
export { setSpecification, checkSpecification } from './specification.js';
export { refine, synthesize, runHooks } from './runs.js';
export { monteCarlo, estimateYield, layerSensitivity } from './tolerance.js';
