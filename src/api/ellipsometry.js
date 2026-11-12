// A coated side's ellipsometric angles Ψ and Δ, against wavelength or against
// angle of incidence, as the Ellipsometry window computes them
// (ellipsometryEvaluation/spectrum.js).

import { computeEllipsometrySweep } from '../components/windows/analysis/ellipsometryEvaluation/spectrum.js';
import { ELLIPSOMETRY_LAMBDA_NM } from '../components/windows/analysis/ellipsometryEvaluation/sessionState.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { inEnvironments } from './designEnvironments.js';
import { scoredSide, viewWavelength } from './stackViews.js';
import { checkOptions, checkRange, requireValue, isAngle, refusal } from './check.js';

const DEFAULTS = sessionDefaults('ellipsometryEvaluation');
// The window's angular sweep runs to 89.5 degrees and takes a step of 0.05
// degrees or more, the limits of its fields, which its sweep clamps to.
const MAX_SWEEP_ANGLE = 89.5;
const MIN_ANGLE_STEP = 0.05;
const isConvention = v => v === 'azzam' || v === 'reversed';
const isSweepAngle = v => Number.isFinite(v) && v >= 0 && v <= MAX_SWEEP_ANGLE;

// The one side Ψ and Δ are computed on, as scoredSide takes it. The whole part
// is refused: an ellipsometer measures the light one surface reflects.
function oneSurface(call, design, side) {
    if (side === 'total') {
        throw refusal('badValue', { call, option: 'side', takes: "'front' or 'back'", value: side },
            `${call}: Psi and Delta are measured on one surface, so side is 'front' or 'back', not 'total'`);
    }
    return scoredSide(call, design, side);
}

// The side both calls compute on, after the checks they make on it and the
// convention. Every environment has the design's sides, so the side is the
// same in each.
function checkedSide(call, design, { side, deltaConvention }) {
    requireValue(call, 'deltaConvention', deltaConvention, isConvention, "'azzam' or 'reversed'");
    return oneSurface(call, design, side);
}

// One design with its materials checked, as both calls compute on it.
function computable(design) {
    requireResolved(design);
    requireKernel();
    return withHerpinRecords(design);
}

// The sweep against wavelength of one design, as ellipsometry() gives it.
function ellipsometryOf(design, { from, to, step, angles, mode, deltaConvention }) {
    const shown = computable(design);
    const sweeps = angles.map(angle => computeEllipsometrySweep(shown, {
        mode: 'spectral', side: mode, lambdaStart: from, lambdaEnd: to, lambdaStep: step, thetaDeg: angle, deltaConvention,
    }));
    return {
        mode, wavelength: Array.from(sweeps[0].x), deltaConvention,
        angles: sweeps.map(({ psi, delta }, i) => ({ angle: angles[i], psi: Array.from(psi), delta: Array.from(delta) })),
        outOfRange: designRangeCoverage(shown, [from, to], mode).offenders,
    };
}

// The sweep against angle of one design, as ellipsometryVsAngle() gives it.
function ellipsometryVsAngleOf(design, { lambda, angleStart, angleEnd, angleStep, mode, deltaConvention }) {
    const shown = computable(design);
    const sweep = computeEllipsometrySweep(shown, {
        mode: 'angular', side: mode, lambdaNm: lambda, angleStart, angleEnd, angleStep, deltaConvention,
    });
    return {
        mode, wavelength: lambda, deltaConvention, angle: Array.from(sweep.x), psi: Array.from(sweep.psi), delta: Array.from(sweep.delta),
        outOfRange: designRangeCoverage(shown, [lambda, lambda], mode).offenders,
    };
}

/**
 * Ψ and Δ of one coated side against wavelength, at one angle of incidence or
 * several, as the [Ellipsometry](/analysis/ellipsometry/) window's spectral
 * sweep computes them, from ρ = r_p / r_s = tan Ψ · exp(i Δ) (Macleod,
 * Thin-Film Optical Filters, 5th ed., Eq. 16.2). The window computes one
 * angle; each angle here is computed as the window computes it. Ψ and Δ are
 * computed on the front, or on the back of a design coated on the back alone,
 * the side the PSI and DEL merit rows score, unless `side` is given; a side
 * with no layers gives its bare surface. The design's cone of incidence is not
 * used, as the window does not use it. A design with more than one
 * [environment](/design/environments/) is computed in environment 1, its own
 * media and substrate, unless `env` names another.
 *
 * @param design The design.
 * @param [options]
 * @param [options.from=400] The first wavelength, nm.
 * @param [options.to=800] The last wavelength, nm, above `from`.
 * @param [options.step=0.5] The wavelength step, nm.
 * @param [options.angles=[65]] The angles of incidence, degrees in the medium light comes from, each 0 up to but not including 90.
 * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.deltaConvention='azzam'] The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that, for data written in the other time convention. Ψ is the same in both.
 * @param [options.env] The environment computed, by its number from 1 or its id, whether it is on or off; or `'all'` for one sweep per environment that is on, environment 1 when none is. Without it, environment 1.
 * @returns The sweep; with `env: 'all'`, `{ environments }`, one entry per environment, each this sweep with the environment's `number`, `id` and `name`.
 * @property mode The side computed: `'front'` or `'back'`.
 * @property wavelength The wavelengths, nm.
 * @property deltaConvention The sign of Δ: `'azzam'` or `'reversed'`.
 * @property angles One per angle asked, in the order asked, each `{ angle, psi, delta }`: the angle in degrees, and Ψ and Δ at each wavelength, degrees, Ψ from 0 to 90 and Δ from 0 to 360, both NaN where the computed r_s or r_p is exactly zero.
 * @property outOfRange The materials of the side computed whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a convention other than `'azzam'` or `'reversed'`, or more than a million points (wavelengths times angles)
 * @throws a design that names a material that resolves to nothing
 * @throws an environment the design does not have, naming the numbers and ids it has
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const e = tf.ellipsometry(design, { from: 400, to: 800, step: 1, angles: [55, 70] });
 * for (const { angle, psi, delta } of e.angles) console.log(angle, 'degrees: at', e.wavelength[100], 'nm Psi', psi[100].toFixed(3), 'Delta', delta[100].toFixed(3));
 * const wet = tf.addEnvironment(design, { name: 'Under water', incidentMedium: 'H2O' });
 * for (const env of tf.ellipsometry(wet, { from: 400, to: 800, step: 1, env: 'all' }).environments) console.log(env.number, env.name, 'Psi at', env.wavelength[100], 'nm', env.angles[0].psi[100].toFixed(3));
 */
export function ellipsometry(design, options) {
    const {
        from = DEFAULTS.lambdaStart, to = DEFAULTS.lambdaEnd, step = DEFAULTS.lambdaStep, angles = [DEFAULTS.thetaDeg], side,
        deltaConvention = DEFAULTS.deltaConvention, env,
    } = checkOptions('ellipsometry', options, ['from', 'to', 'step', 'angles', 'side', 'deltaConvention', 'env']);
    requireValue('ellipsometry', 'angles', angles, v => Array.isArray(v) && v.length > 0 && v.every(isAngle),
        'a list of angles of incidence in degrees, each 0 <= angle < 90');
    checkRange('ellipsometry', { from, to, step }, angles.length);
    const mode = checkedSide('ellipsometry', design, { side, deltaConvention });
    return inEnvironments('ellipsometry', design, env, one => ellipsometryOf(one, { from, to, step, angles, mode, deltaConvention }));
}

/**
 * Ψ and Δ of one coated side against angle of incidence at one wavelength,
 * as the [Ellipsometry](/analysis/ellipsometry/) window's angular sweep
 * computes them, from ρ = r_p / r_s = tan Ψ · exp(i Δ) (Macleod, Thin-Film
 * Optical Filters, 5th ed., Eq. 16.2). The angles run from `angleStart` by
 * `angleStep`, each rounded to 0.001 degree, to `angleEnd`. Ψ and Δ are
 * computed on the front, or on the back of a design coated on the back alone,
 * the side the PSI and DEL merit rows score, unless `side` is given; a side
 * with no layers gives its bare surface. The design's cone of incidence is not
 * used, as the window does not use it. A design with more than one
 * [environment](/design/environments/) is computed in environment 1, its own
 * media and substrate, unless `env` names another.
 *
 * Where the window takes a setting it cannot sweep and sweeps another in its
 * place, this call refuses it: an end above 89.5 degrees, a start above the
 * end, and a step below 0.05 degrees or above the span.
 *
 * @param design The design.
 * @param [options]
 * @param [options.wavelength] The wavelength, nm. Without it, the design's reference wavelength, as the window follows it.
 * @param [options.angleStart=45] The first angle of incidence, degrees in the medium light comes from, 0 or more.
 * @param [options.angleEnd=80] The last angle, degrees, above `angleStart` and at most 89.5.
 * @param [options.angleStep=0.5] The angle step, degrees, from 0.05 up to the span, `angleEnd` minus `angleStart`.
 * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.deltaConvention='azzam'] The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that, for data written in the other time convention. Ψ is the same in both.
 * @param [options.env] The environment computed, by its number from 1 or its id, whether it is on or off; or `'all'` for one sweep per environment that is on, environment 1 when none is. Without it, environment 1.
 * @returns The sweep; with `env: 'all'`, `{ environments }`, one entry per environment, each this sweep with the environment's `number`, `id` and `name`.
 * @property mode The side computed: `'front'` or `'back'`.
 * @property wavelength The wavelength, nm.
 * @property deltaConvention The sign of Δ: `'azzam'` or `'reversed'`.
 * @property angle The angles of incidence, degrees.
 * @property psi Ψ at each angle, degrees, 0 to 90; NaN where the computed r_s or r_p is exactly zero.
 * @property delta Δ at each angle, degrees, 0 to 360; NaN where Ψ is.
 * @property outOfRange The materials of the side computed whose data do not reach the wavelength, each `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a wavelength of 0 or less, angles that are not a range from 0 to 89.5, a step below 0.05 degrees or above the span, a side other than `'front'` or `'back'`, or a convention other than `'azzam'` or `'reversed'`
 * @throws a design that names a material that resolves to nothing
 * @throws an environment the design does not have, naming the numbers and ids it has
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const e = tf.ellipsometryVsAngle(design, { wavelength: 633, angleStart: 45, angleEnd: 80, angleStep: 0.5 });
 * const lowest = e.psi.indexOf(Math.min(...e.psi));
 * console.log('lowest Psi', e.psi[lowest].toFixed(3), 'at', e.angle[lowest], 'degrees');
 * const wet = tf.addEnvironment(design, { name: 'Under water', incidentMedium: 'H2O' });
 * for (const env of tf.ellipsometryVsAngle(wet, { wavelength: 633, env: 'all' }).environments) console.log(env.number, env.name, 'lowest Psi', Math.min(...env.psi).toFixed(3));
 */
export function ellipsometryVsAngle(design, options) {
    const {
        wavelength, angleStart = DEFAULTS.angleStart, angleEnd = DEFAULTS.angleEnd, angleStep = DEFAULTS.angleStep, side,
        deltaConvention = DEFAULTS.deltaConvention, env,
    } = checkOptions('ellipsometryVsAngle', options, ['wavelength', 'angleStart', 'angleEnd', 'angleStep', 'side', 'deltaConvention', 'env']);
    const lambda = viewWavelength('ellipsometryVsAngle', design, wavelength, ELLIPSOMETRY_LAMBDA_NM);
    if (!(isSweepAngle(angleStart) && isSweepAngle(angleEnd) && angleStart < angleEnd)) {
        throw refusal('angleRange', { call: 'ellipsometryVsAngle', start: angleStart, end: angleEnd, max: MAX_SWEEP_ANGLE },
            `ellipsometryVsAngle: angleStart and angleEnd are angles of incidence in degrees, 0 <= angleStart < angleEnd <= ${MAX_SWEEP_ANGLE}`);
    }
    const span = angleEnd - angleStart;
    requireValue('ellipsometryVsAngle', 'angleStep', angleStep, v => Number.isFinite(v) && v >= MIN_ANGLE_STEP && v <= span,
        `an angle step in degrees from ${MIN_ANGLE_STEP} up to the span, ${span}`);
    const mode = checkedSide('ellipsometryVsAngle', design, { side, deltaConvention });
    return inEnvironments('ellipsometryVsAngle', design, env,
        one => ellipsometryVsAngleOf(one, { lambda, angleStart, angleEnd, angleStep, mode, deltaConvention }));
}
