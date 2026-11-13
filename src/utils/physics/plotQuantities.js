/**
 * Plot Engine: any quantity against any other, read along one sweep.
 *
 * Pure compute helpers used by `PlotEngine.js`. No React, no global state.
 *
 * Curve spec:
 *   {
 *     id, label,
 *     sweep: 'wavelength' | 'aoi' | 'thk:<i>',
 *     // Range of the sweep, in its unit (nm, °, nm):
 *     rangeFrom: number,
 *     rangeTo:   number,
 *     rangeStep: number,
 *     // Held while the sweep runs, each unless it is the swept one:
 *     lambdaFixed_nm: number,
 *     aoiFixed_deg:   number,
 *     // What each axis reads (quantities.js):
 *     x: { quantity, polarization: 'avg' | 's' | 'p', side: 'front' | 'back' | 'total' },
 *     y: { quantity, polarization, side },
 *     // On a design with environments, as computed: the environment the
 *     // curve's quantities are read in (environment 1 when absent), and on a
 *     // curve that reads MF, the environment whose own merit it reads, or
 *     // 'all' for the total over the environments that are on:
 *     env, meritEnv,
 *     // Visual:
 *     color, dash, width, visible
 *   }
 *
 * The quantity 'sweep' is the swept value itself, so x = 'sweep' draws the
 * ordinary curve against λ, AOI or the layer thickness.
 *
 * 3D surface plotting (see plotQuantities/computeSurface.js) plots a scalar Z
 * over TWO swept variables. An axis variable, and a curve's sweep, is one of:
 *   'wavelength'      λ in nm           (any Z but MF)
 *   'aoi'             angle of incidence in °  (any Z but MF)
 *   'thk:<i>'         thickness of front layer i (nm)
 */

export {
    POLARIZATIONS, SURFACE_MODES, DASHES, LAMBDA_STEP_NM,
    makeDefaultCurve, curveNumber, normalizeCurve, xSamples, curveSweep, computeCurve,
    yAxisLabel, yFormatter,
} from './plotQuantities/curves.js';

export {
    SWEEP, QUANTITIES, phaseMember, quantityFamily, quantitySides, takesPolarization, isFraction,
} from './plotQuantities/quantities.js';

export {
    parseAxisVar, isLayerVar, axisVarUnit,
    buildAxisVarOptions, layerNumber, layerTag, buildAxisTargetOptions, defaultAxisRange,
} from './plotQuantities/axisVars.js';

export {
    Z_QUANTITIES, COLORSCALES, axisSampleCount,
    makeDefaultSurfaceSpec, requiredSurfaceLambdas, surfaceAxisLabel,
} from './plotQuantities/surfaceSpec.js';

export { computeSurface } from './plotQuantities/computeSurface.js';
