// A design's phase and its derivatives against wavelength, group delay, GDD,
// TOD and CDC, as the GD/GDD window computes them (gdGddEvaluation/spectrum.js).

import { computeGdGddSpectrum } from '../components/windows/analysis/gdGddEvaluation/spectrum.js';
import { phaseFromReference } from '../components/windows/analysis/gdGddEvaluation/viewModel.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { phaseSide } from './stackViews.js';
import { checkOptions, checkRange, requireValue, isAngle, isPositive } from './check.js';

const DEFAULTS = sessionDefaults('gdGddEvaluation');
// The uniform step without `step`, nm, the step the other analysis calls take.
const STEP_NM = 0.5;

/**
 * Phase, group delay, GDD, TOD and CDC of a design's reflected or transmitted
 * light against wavelength, as the [Group Delay / GDD](/analysis/gd-gdd/)
 * window computes them: GD = −dφ/dω and GDD = −d²φ/dω² (Macleod, Thin-Film
 * Optical Filters, 5th ed., Eq. 11.17), TOD = −d³φ/dω³ with the same sign, and
 * CDC = GDD · 2πc/λ² in fs/nm, the chromatic dispersion as Essential Macleod
 * reports it, with the sign of GDD; the slope of group delay against
 * wavelength, dGD/dλ, is its negative. They are computed on the front, or on
 * the back of a design coated on the back alone, the side the PR, GD, GDD and
 * TOD merit rows score, unless `side` is given; a side with no layers gives its
 * bare surface.
 * `side: 'total'`, with `response: 'T'` alone, is the whole part as the
 * [Pulse Analysis](/analysis/pulse-analysis/) window computes it: the front
 * coating, one pass through the substrate at the design's thickness and the
 * back coating, the first pulse to come out of the part. The design's cone of
 * incidence is not used, as the window does not use it.
 *
 * GD, GDD and TOD are analytic values at each wavelength (Birge and Kärtner,
 * Applied Optics 45, 1478 (2006)), so they do not depend on the grid. The phase
 * is unwrapped along the grid, so on a uniform grid it can land 2π off across a
 * resonance narrower than the step. On the whole part the substrate's own
 * phase, −2π n d cosθ / λ, n, d and θ its index, thickness and the angle in it,
 * is added as it is, so only the coatings' phase is unwrapped. `step: 'auto'`
 * gives the window's own grid, which adds points at reflection minima and at
 * table knots, so a mean over it leans toward the spikes there.
 *
 * @param design The design.
 * @param [options]
 * @param [options.from=400] The first wavelength, nm.
 * @param [options.to=800] The last wavelength, nm, above `from`.
 * @param [options.step=0.5] The wavelength step, nm, from `from`, the last point at `to` when the step does not land on it; or `'auto'`, the window's own grid.
 * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
 * @param [options.pol='avg'] The polarization: `'avg'`, the mean of s and p as the merit rows take it, `'s'` or `'p'`.
 * @param [options.response='R'] The light whose phase is taken: `'R'`, reflected, or `'T'`, transmitted.
 * @param [options.side] `'front'`, `'back'`, or with `response: 'T'` `'total'`, the whole part. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.reference] A wavelength, nm: the phase is then shifted to 0 at the sample nearest it, as the window plots it; when that sample has no value, the phase stays absolute and `reference` is `null`. Without it, the phase is absolute, as the window's table gives it. GD, GDD, TOD and CDC are the same either way.
 * @returns The curves.
 * @property mode The sides computed: `'front'`, `'back'` or `'total'`.
 * @property response `'R'` or `'T'`.
 * @property angle The angle of incidence, degrees.
 * @property pol The polarization.
 * @property step The wavelength step, nm, or `'auto'`.
 * @property reference The wavelength the phase is shifted to 0 at, nm, or `null` when it is not shifted: without `reference`, or when the sample nearest it has no value.
 * @property wavelength The wavelengths, nm.
 * @property phase The phase φ at each wavelength, degrees, unwrapped along the grid.
 * @property gd The group delay at each wavelength, fs.
 * @property gdd The GDD at each wavelength, fs².
 * @property tod The TOD at each wavelength, fs³.
 * @property cdc The CDC at each wavelength, fs/nm: GDD · 2πc/λ², with the sign of GDD, so −dGD/dλ.
 * @property outside For each wavelength, the name of the material whose data its value was taken outside of, or `null`.
 * @property knots The table knots that are exactly wavelengths of the grid, each `{ wavelength, gd, gdd, tod, cdc }`, each quantity a pair `[left, right]` of its values on the two sides of the knot; the value at that wavelength reads the material averaged across the knot. On the uniform grid none is read when the knots in range are dense against the grid, more than one per 8 points, and on `side: 'total'` none is read.
 * @property invalid The wavelengths with no value, each `{ wavelength, reason }`; phase, GD, GDD, TOD and CDC are NaN there.
 * @property models The material models the values come from, each `'name: model'`.
 * @property outOfRange The materials of the sides computed whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a range that is not one, a step that is not a positive number or `'auto'`, an angle outside 0 to 90, a polarization, response or side it does not have, `'total'` with `response: 'R'`, a reference that is not a wavelength above 0, or more than a million wavelengths
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^8 H' });
 * const g = tf.groupDelay(design, { from: 500, to: 600, step: 1 });
 * const at = g.wavelength.indexOf(550);
 * console.log(g.mode, 'at 550 nm: GD', g.gd[at].toFixed(3), 'fs, GDD', g.gdd[at].toFixed(3), 'fs²');
 */
export function groupDelay(design, options) {
    const {
        from = DEFAULTS.lamStart, to = DEFAULTS.lamEnd, step = STEP_NM, angle = DEFAULTS.theta, pol = DEFAULTS.pol,
        response = DEFAULTS.target, side, reference,
    } = checkOptions('groupDelay', options, ['from', 'to', 'step', 'angle', 'pol', 'response', 'side', 'reference']);
    requireValue('groupDelay', 'step', step, v => v === 'auto' || isPositive(v), "a wavelength step in nm above 0, or 'auto'");
    // The window's own grid holds at most 2001 points before it refines them,
    // so 'auto' is checked for its range alone.
    checkRange('groupDelay', { from, to, step: step === 'auto' ? to - from : step });
    requireValue('groupDelay', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue('groupDelay', 'pol', pol, v => ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'");
    requireValue('groupDelay', 'response', response, v => v === 'R' || v === 'T', "'R' or 'T'");
    requireValue('groupDelay', 'reference', reference, v => v === undefined || isPositive(v), 'a wavelength in nm above 0');
    // 'total' is the whole part, which the window's model names 'whole'.
    const mode = phaseSide('groupDelay', design, side, response);
    requireResolved(design);
    warnWithoutKernel();
    const shown = withHerpinRecords(design);
    const raw = computeGdGddSpectrum(shown, {
        side: mode === 'total' ? 'whole' : mode, target: response, polarization: pol, thetaDeg: angle,
        lambdaStart: from, lambdaEnd: to, preview: false, ...(step === 'auto' ? {} : { stepNm: step }),
    });
    // phaseFromReference gives the phase back as it is when the sample nearest
    // the reference has no value, so the reference is then not reported.
    const phase = reference === undefined ? raw.phaseDeg : phaseFromReference(raw.lambda, raw.phaseDeg, reference);
    return {
        mode, response, angle, pol, step, reference: phase === raw.phaseDeg ? null : reference,
        wavelength: raw.lambda,
        phase,
        gd: raw.gd, gdd: raw.gdd, tod: raw.tod, cdc: raw.cdc,
        outside: raw.outsideRange,
        knots: raw.knotSamples.map(({ wavelengthNm, gd, gdd, tod, cdc }) => ({ wavelength: wavelengthNm, gd, gdd, tod, cdc })),
        invalid: raw.invalid.map(({ wavelengthNm, reason }) => ({ wavelength: wavelengthNm, reason })),
        models: raw.models,
        outOfRange: designRangeCoverage(shown, [from, to], mode).offenders,
    };
}
