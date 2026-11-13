/**
 * The quantities of a 2D curve read along its sweep, family by family, each by
 * the code of the window it belongs to:
 *
 *   T, R, A               the spectrum Optical Evaluation computes, under the
 *                         design's cone of incidence; over a layer parameter,
 *                         the points a surface over it reads (opticalSurface.js)
 *   phase, GD, GDD, TOD   the GD/GDD window's analytic values, the phase
 *                         unwrapped along the sweep as the window unwraps it
 *                         along wavelength
 *   Ψ, Δ                  the Ellipsometry window's sweeps, Δ in the
 *                         Azzam-Bashara sign an ellipsometer writes
 *   MF                    the merit function a surface over a layer parameter
 *                         reads (meritSurface.js)
 *
 * The context is curveContext's: the design, its material resolver and the
 * stack resolved for the spectrum, in the environment the curve is computed in
 * on a design with environments, with the whole design the merit function
 * scores. A sweep is { token, kind, values, range }, `range` the wavelength
 * range of a wavelength sweep (curves.js).
 */

import { computeAngular, computeSpectral } from '../../../components/windows/analysis/ellipsometryEvaluation/spectrum.js';
import { gdGddPointEvaluator, unwrappedPhaseDeg } from '../../../components/windows/analysis/gdGddEvaluation/spectrum.js';
import { toDeltaConvention } from '../thinFilmMath.js';
import { parseAxisVar } from './axisVars.js';
import { overridesFrom } from './layerOverrides.js';
import { computeMeritCurve } from './meritSurface.js';
import { buildOpticalBaseCtx, opticalPointSpectrum } from './opticalSurface.js';
import { phaseMember, quantityFamily } from './quantities.js';
import { pickChannel, runSpectrum } from './spectrumRunner.js';
import { sweptDesign } from './sweptDesign.js';

/** A curve that cannot be drawn, with the t.plotEngine key that says why. */
export class CurveError extends Error {
    constructor(errorKey) {
        super(errorKey);
        this.errorKey = errorKey;
    }
}

const CHANNELS = ['T', 'R', 'A'];

// T, R and A of a spectrum, or of one point of a sweep per spectrum.
const spectrumChannels = (out, polarization) =>
    Object.fromEntries(CHANNELS.map(channel => [channel, pickChannel(out, polarization, channel)]));
const pointChannels = (outs, polarization) => Object.fromEntries(CHANNELS.map(channel => [channel,
    outs.map(out => pickChannel(out, polarization, channel)?.[0] ?? NaN)]));

function opticalCurve(curve, ctx, sweep, { side, polarization }) {
    if (sweep.kind === 'lambda') {
        const params = { ...sweep.range, theta: curve.aoiFixed_deg, polarization };
        return spectrumChannels(runSpectrum(side, params, ctx), polarization);
    }
    const lambda = curve.lambdaFixed_nm;
    if (sweep.kind === 'aoi') {
        const at = theta => runSpectrum(side, { lambdaStart: lambda, lambdaEnd: lambda, lambdaStep: 1, theta, polarization }, ctx);
        return pointChannels(sweep.values.map(at), polarization);
    }
    const baseCtx = buildOpticalBaseCtx(ctx.design, ctx.resolveMat);
    const spec = { surfaceMode: side, polarization };
    const at = value => opticalPointSpectrum(baseCtx, spec, overridesFrom([[sweep.token, value]], lambda, curve.aoiFixed_deg));
    return pointChannels(sweep.values.map(at), polarization);
}

// The GD/GDD window's point values along the sweep.
function phasePoints(curve, ctx, sweep, options) {
    const evaluatorAt = (design, resolveMaterial, thetaDeg) =>
        gdGddPointEvaluator(design, { ...options, thetaDeg, resolveMaterial }).evaluateAt;
    const lambda = curve.lambdaFixed_nm;
    if (sweep.kind === 'lambda') {
        const evaluateAt = evaluatorAt(ctx.design, ctx.resolveMat, curve.aoiFixed_deg);
        return sweep.values.map(wavelength => evaluateAt(wavelength));
    }
    if (sweep.kind === 'aoi') {
        return sweep.values.map(theta => evaluatorAt(ctx.design, ctx.resolveMat, theta)(lambda));
    }
    return sweep.values.map((value) => {
        const swept = sweptDesign(ctx, sweep.token, value);
        return evaluatorAt(swept.design, swept.resolveMat, curve.aoiFixed_deg)(lambda);
    });
}

// Phase φ (degrees), GD (fs), GDD (fs²) and TOD (fs³) of the reflected or the
// transmitted light. The whole part is the window's 'whole' side, the light
// transmitted through the front coating, the substrate and the back coating.
function phaseCurve(curve, ctx, sweep, { side, polarization, quantity }) {
    const { response } = phaseMember(quantity);
    const options = { side: side === 'total' && response === 'T' ? 'whole' : side, target: response, polarization };
    const points = phasePoints(curve, ctx, sweep, options);
    const member = key => points.map(point => (point.valid ? point[key] : NaN));
    return {
        [`phase${response}`]: unwrappedPhaseDeg(points, options.side),
        [`gd${response}`]: member('gdFs'),
        [`gdd${response}`]: member('gddFs2'),
        [`tod${response}`]: member('todFs3'),
    };
}

function ellipsometricSweep(curve, ctx, sweep, side) {
    const { design, resolveMat: resolveMaterial } = ctx;
    if (sweep.kind === 'lambda') {
        return computeSpectral(design, { side, ...sweep.range, thetaDeg: curve.aoiFixed_deg, resolveMaterial });
    }
    const lambda = curve.lambdaFixed_nm;
    if (sweep.kind === 'aoi') {
        return computeAngular(design, { side, lambdaNm: lambda, angles: sweep.values, resolveMaterial });
    }
    const points = sweep.values.map((value) => {
        const swept = sweptDesign(ctx, sweep.token, value);
        return computeSpectral(swept.design, {
            side, lambdaStart: lambda, lambdaEnd: lambda, lambdaStep: 1,
            thetaDeg: curve.aoiFixed_deg, resolveMaterial: swept.resolveMat,
        });
    });
    return { psi: points.map(point => point.psi[0]), delta: points.map(point => point.delta[0]) };
}

function ellipsometricCurve(curve, ctx, sweep, { side }) {
    const { psi, delta } = ellipsometricSweep(curve, ctx, sweep, side);
    return { psi: Array.from(psi), delta: toDeltaConvention(Array.from(delta), 'azzam') };
}

// The merit function integrates over wavelength and angle, so it has a value
// only along a layer parameter. It is scored on the whole design, in the
// environments `curve.meritEnv` names (meritSurface.js), each deposited as
// that environment deposits the recipe.
function meritCurve(curve, ctx, sweep) {
    if (sweep.kind === 'lambda' || sweep.kind === 'aoi') throw new CurveError('errMfSweep');
    const result = computeMeritCurve(sweep.token, sweep.values, ctx.whole ?? ctx.design, ctx.resolveMat, curve.meritEnv);
    if (!result.ok) throw new CurveError(result.errorKey);
    return { MF: result.mf };
}

// Each family's computation and what sets it apart on one axis: two axes that
// agree on it share one computation.
const FAMILIES = {
    optical: { compute: opticalCurve, key: axis => `${axis.side}|${axis.polarization}` },
    phase: {
        compute: phaseCurve,
        key: axis => `${axis.side}|${axis.polarization}|${phaseMember(axis.quantity).response}`,
    },
    ellipsometric: { compute: ellipsometricCurve, key: axis => axis.side },
    merit: { compute: meritCurve, key: () => '' },
};

// `sweep` as the environment of `ctx` deposits it: a layer's recipe thickness
// times the factor that environment thickens the layer by (`ctx.layerFactors`,
// absent in environment 1), so a curve's axis keeps the recipe thickness and
// each environment computes its own layer.
function depositedSweep(ctx, sweep) {
    const factor = sweep.kind === 'thk' ? ctx.layerFactors?.[parseAxisVar(sweep.token).layer] : undefined;
    return factor === undefined || factor === 1 ? sweep : { ...sweep, values: sweep.values.map(value => value * factor) };
}

/**
 * A reader of a curve's axes: given an axis { quantity, polarization, side },
 * its values along `sweep`. Throws CurveError for a quantity that has no value
 * along this sweep. The merit function takes the recipe's thicknesses and
 * deposits them in each environment it scores; every other quantity is read
 * in the environment of `ctx`.
 */
export function curveReader(curve, ctx, sweep) {
    const computed = new Map();
    const deposited = depositedSweep(ctx, sweep);
    return (axis) => {
        const family = quantityFamily(axis.quantity);
        if (family === 'sweep') return sweep.values;
        const { compute, key } = FAMILIES[family];
        const id = `${family}|${key(axis)}`;
        if (!computed.has(id)) computed.set(id, compute(curve, ctx, family === 'merit' ? sweep : deposited, axis));
        return computed.get(id)[axis.quantity];
    };
}
