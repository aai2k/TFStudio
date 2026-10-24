// A band's peak, where the spectrum crosses a level either side of it and the
// width between the two crossings, as the Specification window's
// CENTRAL_LAMBDA, EDGE_LAMBDA and FWHM checks find them
// (utils/synthesis/qualifiers/bandScan.js), and how an edge moves with the
// angle of incidence.

import { bandCrossings, edgeCrossing } from '../utils/synthesis/qualifiers/bandScan.js';
import { checkStepKind } from '../utils/synthesis/qualifiers/constants.js';
import { makeQualifier } from '../utils/synthesis/qualifiers/construction.js';
import { buildEvalContext, resolveEvalMode } from '../utils/physics/optimizer.js';
import { designMaterialLookup, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { checkOptions, requireValue, refusal, isAngle } from './check.js';

// Each quantity of a spectrum as the channel and polarization a check reads.
const QUANTITIES = {
    R: ['R', 'avg'], T: ['T', 'avg'], A: ['A', 'avg'],
    Rs: ['R', 's'], Rp: ['R', 'p'], Ts: ['T', 's'], Tp: ['T', 'p'], As: ['A', 's'], Ap: ['A', 'p'],
};
// What a FWHM check the window adds starts with: T, a peak, half of it, at 0 degrees.
const NEW_CHECK = makeQualifier({ kind: 'FWHM' });
// The steps a check's Step offers, nm, by the flag it saves: 1 nm is its
// default, which saves none.
const STEP_FLAGS = new Map([[1, undefined], [0.1, 2], [0.01, 3], [0.001, 4]]);
// The options each feature reads beside the band, the quantity and the angle.
const FEATURE_OPTIONS = { peak: ['direction', 'step'], edge: ['direction', 'level', 'edgeSide', 'step'], fwhm: ['direction', 'level', 'step'] };

// Refuses a band that is not one.
function checkBand(call, from, to) {
    if (!(Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from)) {
        throw refusal('wavelengthRange', { call, from, to }, `${call}: from and to are wavelengths in nm, 0 < from < to`);
    }
}

// The check `feature` reads, as the Specification window holds one, from the
// options given, after refusing a value it cannot take.
function checkOf(call, feature, { from, to, quantity = NEW_CHECK.channel, direction = NEW_CHECK.direction, level = NEW_CHECK.level, edgeSide, step = 1 }) {
    checkBand(call, from, to);
    requireValue(call, 'quantity', quantity, v => Object.hasOwn(QUANTITIES, v), `one of ${Object.keys(QUANTITIES).join(', ')}`);
    requireValue(call, 'direction', direction, v => v === 'max' || v === 'min', "'max', a peak, or 'min', a dip");
    requireValue(call, 'level', level, v => Number.isFinite(v) && v >= 0 && v <= 1, 'a fraction, 0 to 1');
    requireValue(call, 'edgeSide', edgeSide, v => v === undefined || v === 'left' || v === 'right', "'left' or 'right'");
    requireValue(call, 'step', step, v => STEP_FLAGS.has(v), '1, 0.1, 0.01 or 0.001 nm');
    const [channel, pol] = QUANTITIES[quantity];
    const kind = feature === 'peak' ? 'CENTRAL_LAMBDA' : 'FWHM';
    const check = { kind, channel, pol, direction, level, edgeSide, lambdaStart: from, lambdaEnd: to, flag: STEP_FLAGS.get(step) };
    if (step !== 1 && !checkStepKind(check)) {
        throw refusal('badValue', { call, option: 'step', takes: `1, as the ${direction === 'max' ? 'peak' : 'dip'} of ${channel} is found without a step`, value: step },
            `${call}: step is 1, as the ${direction === 'max' ? 'peak' : 'dip'} of ${channel} is found without a step, not ${step}`);
    }
    return check;
}

// What `feature` reads of `crossings` (bandCrossings) for the check `check`.
function featureOf(feature, check, crossings) {
    const peak = { peak: crossings.peak, peakValue: crossings.peakValue };
    if (feature === 'peak') return peak;
    const levels = { level: crossings.level, levelValue: crossings.levelValue };
    if (feature === 'edge') {
        const edge = edgeCrossing(crossings, check.edgeSide);
        return { ...peak, ...levels, edge, reason: edge === null ? 'edgeNotCrossed' : null };
    }
    const left = crossings.left(), right = crossings.right();
    const both = left !== null && right !== null;
    return {
        ...peak, ...levels, left, right,
        width: both ? right - left : null, centre: both ? (left + right) / 2 : null, reason: both ? null : 'fwhmNotBracketed',
    };
}

// The design as the checks evaluate it, and the context they evaluate it in.
function evaluated(design) {
    requireResolved(design);
    warnWithoutKernel();
    const shown = withHerpinRecords(design);
    return { mode: resolveEvalMode(shown), ctx: buildEvalContext(shown, designMaterialLookup(shown)) };
}

/**
 * The peak of a band of a design's spectrum, where the spectrum crosses a
 * level either side of it, or the width between the two crossings, as the
 * [Specification](/design/specification/) window's CENTRAL_LAMBDA,
 * EDGE_LAMBDA and FWHM checks find them. The peak is searched at `step`. The
 * crossings are exact: each is bracketed on a scan of the band no coarser
 * than `step`, of 301 samples at the least, and then halved down to
 * neighbouring doubles, so the scan decides only which crossing is found. The level is a fraction of the peak: with
 * direction `'max'`, `level` times the band's highest value; with `'min'`,
 * that fraction of the way from its lowest value up to 1. What it is computed
 * on follows the design's [evaluation mode](/design/evaluation-modes/), as
 * `spectrum` does, and a design under a cone of incidence is averaged over
 * its cone.
 *
 * @param design The design.
 * @param options
 * @param options.feature `'peak'`, the wavelength of the band's highest value, or its lowest with direction `'min'`, as Central λ reads it; `'edge'`, where the spectrum crosses the level; or `'fwhm'`, the width between the crossings below and above the peak.
 * @param options.from The first wavelength of the band, nm.
 * @param options.to The last wavelength of the band, nm, above `from`.
 * @param [options.quantity='T'] `'R'`, `'T'` or `'A'` for unpolarized light, or `'Rs'`, `'Rp'`, `'Ts'`, `'Tp'`, `'As'` or `'Ap'`.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90.
 * @param [options.direction='max'] `'max'`, a peak, or `'min'`, a dip.
 * @param [options.level=0.5] For `'edge'` and `'fwhm'`, the level crossed, a fraction from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999, as the check takes it.
 * @param [options.edgeSide] For `'edge'`, `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.
 * @param [options.step=1] The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001, the check's Step; the crossings are bracketed on a scan of the band no coarser than it, of 301 samples at the least. The peak of R, and the dip of T or A, is found without a step, so for `'peak'` it stays 1.
 * @returns The feature.
 * @property feature The feature asked for.
 * @property mode How the design was scored: `'front'`, `'back'` or `'total'`.
 * @property quantity The quantity read.
 * @property angle The angle of incidence, degrees.
 * @property direction `'max'` or `'min'`.
 * @property step The step, nm.
 * @property peak The wavelength of the peak, or of the dip, nm.
 * @property peakValue The quantity at `peak`, a fraction of 1.
 * @property level For `'edge'` and `'fwhm'`, the level crossed, a fraction from 0.001 to 0.999.
 * @property levelValue For `'edge'` and `'fwhm'`, the quantity at the crossings, a fraction of 1: `peakValue` times `level`, or with direction `'min'` `peakValue` plus `level` times (1 − `peakValue`).
 * @property edge For `'edge'`, the crossing, nm; null when the spectrum does not cross the level inside the band.
 * @property left For `'fwhm'`, the crossing below the peak, nm; null when there is none inside the band.
 * @property right For `'fwhm'`, the crossing above the peak, nm; null when there is none inside the band.
 * @property width For `'fwhm'`, `right` − `left`, nm, the value of a FWHM check; null when either is.
 * @property centre For `'fwhm'`, the midpoint of `left` and `right`, nm; null when either is.
 * @property reason For `'edge'` and `'fwhm'`, why a crossing is missing, as checkSpecification words it, `'edgeNotCrossed'` or `'fwhmNotBracketed'`; null when none is.
 * @throws an option the feature does not take, a feature it does not have, a band that is not one, a quantity, direction, level, edge side or step it does not take, or an angle outside 0 to 90
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Bandpass' }), { formula: '(HL)^4 HH (LH)^4' });
 * const band = tf.bandFeature(design, { feature: 'fwhm', from: 500, to: 600 });
 * console.log(band.mode, 'peak T', band.peakValue.toFixed(4), 'at', band.peak.toFixed(2), 'nm');
 * console.log('FWHM', band.width.toFixed(2), 'nm, from', band.left.toFixed(2), 'to', band.right.toFixed(2), 'nm');
 */
export function bandFeature(design, options) {
    const { feature } = options ?? {};
    requireValue('bandFeature', 'feature', feature, v => Object.hasOwn(FEATURE_OPTIONS, v), "'peak', 'edge' or 'fwhm'");
    const given = checkOptions('bandFeature', options, ['feature', 'from', 'to', 'quantity', 'angle', ...FEATURE_OPTIONS[feature]]);
    const { quantity = NEW_CHECK.channel, angle = NEW_CHECK.aoi, direction = NEW_CHECK.direction, step = 1 } = given;
    requireValue('bandFeature', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    const check = { ...checkOf('bandFeature', feature, given), aoi: angle };
    const { mode, ctx } = evaluated(design);
    return { feature, mode, quantity, angle, direction, step, ...featureOf(feature, check, bandCrossings(check, ctx, {})) };
}

/**
 * Where a design's spectrum crosses a level beside a band's peak at each of
 * several angles of incidence, and how far that edge has moved from where it
 * is at the first angle, each found as an EDGE_LAMBDA check of the
 * [Specification](/design/specification/) window finds it, as `bandFeature`
 * with `feature: 'edge'` gives it. What it is computed on follows the design's
 * [evaluation mode](/design/evaluation-modes/), as `spectrum` does, and a
 * design under a cone of incidence is averaged over its cone.
 *
 * @param design The design.
 * @param options
 * @param options.from The first wavelength of the band, nm.
 * @param options.to The last wavelength of the band, nm, above `from`.
 * @param options.angles The angles of incidence, degrees in the incident medium, each 0 up to but not including 90.
 * @param [options.quantity='T'] `'R'`, `'T'` or `'A'` for unpolarized light, or `'Rs'`, `'Rp'`, `'Ts'`, `'Tp'`, `'As'` or `'Ap'`.
 * @param [options.direction='max'] `'max'`, the level a fraction of the band's highest value, or `'min'`, a fraction of the way from its lowest value up to 1.
 * @param [options.level=0.5] The level crossed, a fraction from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999.
 * @param [options.edgeSide] `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.
 * @param [options.step=1] The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The crossing is bracketed on a scan of the band no coarser than it, of 301 samples at the least.
 * @returns The edge at each angle, each list in the order of `angles`.
 * @property mode How the design was scored: `'front'`, `'back'` or `'total'`.
 * @property quantity The quantity read.
 * @property direction `'max'` or `'min'`.
 * @property step The step, nm.
 * @property level The level crossed, a fraction from 0.001 to 0.999.
 * @property angles The angles of incidence, degrees.
 * @property edge The crossing at each angle, nm; null where the spectrum does not cross the level inside the band.
 * @property shift The edge at each angle less the edge at the first angle, nm; null where either is null.
 * @property peak The wavelength of the band's peak, or dip, at each angle, nm.
 * @property peakValue The quantity at each peak, a fraction of 1.
 * @property levelValue The quantity at each crossing, a fraction of 1.
 * @property reason At each angle, `'edgeNotCrossed'` where there is no crossing, otherwise null.
 * @throws an option it does not take, a band that is not one, an empty list of angles or an angle outside 0 to 90, or a quantity, direction, level, edge side or step it does not take
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Edge' }), { formula: '(0.5H L 0.5H)^8' });
 * const moved = tf.edgeShift(design, { from: 600, to: 760, angles: [0, 15, 30, 45] });
 * moved.angles.forEach((angle, i) => console.log(angle, 'degrees:', moved.edge[i].toFixed(2), 'nm, moved', moved.shift[i].toFixed(2), 'nm'));
 */
export function edgeShift(design, options) {
    const given = checkOptions('edgeShift', options, ['from', 'to', 'angles', 'quantity', 'direction', 'level', 'edgeSide', 'step']);
    const { angles, quantity = NEW_CHECK.channel, direction = NEW_CHECK.direction, step = 1 } = given;
    const check = checkOf('edgeShift', 'edge', given);
    requireValue('edgeShift', 'angles', angles, v => Array.isArray(v) && v.length > 0 && v.every(isAngle), 'a list of angles of incidence in degrees, each 0 <= angle < 90');
    const { mode, ctx } = evaluated(design);
    const edges = angles.map(angle => featureOf('edge', check, bandCrossings({ ...check, aoi: angle }, ctx, {})));
    const first = edges[0].edge;
    return {
        mode, quantity, direction, step, level: edges[0].level, angles: [...angles],
        edge: edges.map(e => e.edge),
        shift: edges.map(e => (e.edge === null || first === null ? null : e.edge - first)),
        peak: edges.map(e => e.peak),
        peakValue: edges.map(e => e.peakValue),
        levelValue: edges.map(e => e.levelValue),
        reason: edges.map(e => e.reason),
    };
}
