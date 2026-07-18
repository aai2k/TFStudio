/**
 * Plot Engine — generic XY plot builder.
 *
 * A "curve" in the Plot Engine is a recipe that maps an x-axis quantity
 * (wavelength or angle of incidence) to a y-axis quantity (T, R, A — for
 * any polarization) at fixed values of the non-axis parameters.
 *
 * Pure compute helpers used by `PlotEngine.js`. No React, no global state.
 *
 * Curve spec:
 *   {
 *     id, label,
 *     xAxis: 'wavelength' | 'aoi',
 *     yChannel: 'T' | 'R' | 'A',
 *     polarization: 'avg' | 's' | 'p',
 *     surfaceMode: 'front' | 'back' | 'total',
 *     // Fixed (the non-x parameter):
 *     lambdaFixed_nm: number,   // used when xAxis = 'aoi'
 *     aoiFixed_deg:   number,   // used when xAxis = 'wavelength'
 *     // Range:
 *     rangeFrom: number,
 *     rangeTo:   number,
 *     rangeStep: number,
 *     // Visual:
 *     color, dash, width, visible
 *   }
 *
 * v1 scope: T/R/A vs (λ | AOI). v2 can add Ψ/Δ, φ, GD/GDD, |E|², admittance,
 * and per-layer quantities. The dispatch table here makes that extension easy:
 * just add new (xAxis, yChannel) handlers.
 *
 * 3D surface plotting (see plotQuantities/computeSurface.js) plots a scalar Z
 * over TWO swept variables — an axis variable is one of:
 *   'wavelength'      λ in nm           (optical Z only)
 *   'aoi'             angle of incidence in °  (optical Z only)
 *   'thk:<i>'         thickness of front layer i (nm)
 *   'n:<i>'           refractive index n of front layer i (constant-index what-if)
 *   'k:<i>'           extinction k of front layer i (constant-index what-if)
 */

export {
    X_AXES, Y_CHANNELS, POLARIZATIONS, SURFACE_MODES, DASHES,
    makeDefaultCurve, xSamples, computeCurve,
    xAxisLabel, yAxisLabel, yFormatter,
} from './plotQuantities/curves.js';

export {
    parseAxisVar, isLayerVar, axisVarUnit,
    buildAxisVarOptions, layerTag, AXIS_PROPS, buildAxisTargetOptions,
    axisTarget, axisProp, composeAxisVar, defaultAxisRange,
} from './plotQuantities/axisVars.js';

export {
    Z_QUANTITIES, SURFACE_RENDERS, COLORSCALES,
    makeDefaultSurfaceSpec, requiredSurfaceLambdas, surfaceAxisLabel,
} from './plotQuantities/surfaceSpec.js';

export { computeSurface } from './plotQuantities/computeSurface.js';
