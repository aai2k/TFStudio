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

// The checks both calls make on the side, the convention and the design.
function checked(call, design, { side, deltaConvention }) {
    requireValue(call, 'deltaConvention', deltaConvention, isConvention, "'azzam' or 'reversed'");
    const mode = oneSurface(call, design, side);
    requireResolved(design);
    requireKernel();
    return mode;
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
 * used, as the window does not use it.
 *
 * @param design The design.
 * @param [options]
 * @param [options.from=400] The first wavelength, nm.
 * @param [options.to=800] The last wavelength, nm, above `from`.
 * @param [options.step=0.5] The wavelength step, nm.
 * @param [options.angles=[65]] The angles of incidence, degrees in the medium light comes from, each 0 up to but not including 90.
 * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.deltaConvention='azzam'] The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that, for data written in the other time convention. Ψ is the same in both.
 * @returns The sweep.
 * @property mode The side computed: `'front'` or `'back'`.
 * @property wavelength The wavelengths, nm.
 * @property deltaConvention The sign of Δ: `'azzam'` or `'reversed'`.
 * @property angles One per angle asked, in the order asked, each `{ angle, psi, delta }`: the angle in degrees, and Ψ and Δ at each wavelength, degrees, Ψ from 0 to 90 and Δ from 0 to 360, both NaN where the computed r_s or r_p is exactly zero.
 * @property outOfRange The materials of the side computed whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a convention other than `'azzam'` or `'reversed'`, or more than a million points (wavelengths times angles)
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const e = tf.ellipsometry(design, { from: 400, to: 800, step: 1, angles: [55, 70] });
 * for (const { angle, psi, delta } of e.angles) console.log(angle, 'degrees: at', e.wavelength[100], 'nm Psi', psi[100].toFixed(3), 'Delta', delta[100].toFixed(3));
 */
export function ellipsometry(design, options) {
    const {
        from = DEFAULTS.lambdaStart, to = DEFAULTS.lambdaEnd, step = DEFAULTS.lambdaStep, angles = [DEFAULTS.thetaDeg], side,
        deltaConvention = DEFAULTS.deltaConvention,
    } = checkOptions('ellipsometry', options, ['from', 'to', 'step', 'angles', 'side', 'deltaConvention']);
    requireValue('ellipsometry', 'angles', angles, v => Array.isArray(v) && v.length > 0 && v.every(isAngle),
        'a list of angles of incidence in degrees, each 0 <= angle < 90');
    checkRange('ellipsometry', { from, to, step }, angles.length);
    const mode = checked('ellipsometry', design, { side, deltaConvention });
    const shown = withHerpinRecords(design);
    const sweeps = angles.map(angle => computeEllipsometrySweep(shown, {
        mode: 'spectral', side: mode, lambdaStart: from, lambdaEnd: to, lambdaStep: step, thetaDeg: angle, deltaConvention,
    }));
    return {
        mode, wavelength: Array.from(sweeps[0].x), deltaConvention,
        angles: sweeps.map(({ psi, delta }, i) => ({ angle: angles[i], psi: Array.from(psi), delta: Array.from(delta) })),
        outOfRange: designRangeCoverage(shown, [from, to], mode).offenders,
    };
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
 * used, as the window does not use it.
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
 * @returns The sweep.
 * @property mode The side computed: `'front'` or `'back'`.
 * @property wavelength The wavelength, nm.
 * @property deltaConvention The sign of Δ: `'azzam'` or `'reversed'`.
 * @property angle The angles of incidence, degrees.
 * @property psi Ψ at each angle, degrees, 0 to 90; NaN where the computed r_s or r_p is exactly zero.
 * @property delta Δ at each angle, degrees, 0 to 360; NaN where Ψ is.
 * @property outOfRange The materials of the side computed whose data do not reach the wavelength, each `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a wavelength of 0 or less, angles that are not a range from 0 to 89.5, a step below 0.05 degrees or above the span, a side other than `'front'` or `'back'`, or a convention other than `'azzam'` or `'reversed'`
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const e = tf.ellipsometryVsAngle(design, { wavelength: 633, angleStart: 45, angleEnd: 80, angleStep: 0.5 });
 * const lowest = e.psi.indexOf(Math.min(...e.psi));
 * console.log('lowest Psi', e.psi[lowest].toFixed(3), 'at', e.angle[lowest], 'degrees');
 */
export function ellipsometryVsAngle(design, options) {
    const {
        wavelength, angleStart = DEFAULTS.angleStart, angleEnd = DEFAULTS.angleEnd, angleStep = DEFAULTS.angleStep, side,
        deltaConvention = DEFAULTS.deltaConvention,
    } = checkOptions('ellipsometryVsAngle', options, ['wavelength', 'angleStart', 'angleEnd', 'angleStep', 'side', 'deltaConvention']);
    const lambda = viewWavelength('ellipsometryVsAngle', design, wavelength, ELLIPSOMETRY_LAMBDA_NM);
    if (!(isSweepAngle(angleStart) && isSweepAngle(angleEnd) && angleStart < angleEnd)) {
        throw refusal('angleRange', { call: 'ellipsometryVsAngle', start: angleStart, end: angleEnd, max: MAX_SWEEP_ANGLE },
            `ellipsometryVsAngle: angleStart and angleEnd are angles of incidence in degrees, 0 <= angleStart < angleEnd <= ${MAX_SWEEP_ANGLE}`);
    }
    const span = angleEnd - angleStart;
    requireValue('ellipsometryVsAngle', 'angleStep', angleStep, v => Number.isFinite(v) && v >= MIN_ANGLE_STEP && v <= span,
        `an angle step in degrees from ${MIN_ANGLE_STEP} up to the span, ${span}`);
    const mode = checked('ellipsometryVsAngle', design, { side, deltaConvention });
    const shown = withHerpinRecords(design);
    const sweep = computeEllipsometrySweep(shown, {
        mode: 'angular', side: mode, lambdaNm: lambda, angleStart, angleEnd, angleStep, deltaConvention,
    });
    return {
        mode, wavelength: lambda, deltaConvention, angle: Array.from(sweep.x), psi: Array.from(sweep.psi), delta: Array.from(sweep.delta),
        outOfRange: designRangeCoverage(shown, [lambda, lambda], mode).offenders,
    };
}
