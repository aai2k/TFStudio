// The electric field through a coated side at one wavelength, as the
// Electric Field window computes it (eFieldEvaluation/profileModel.js) and
// reads its depth (xScale.js) and its amplitude (yScale.js).

import { computeProfile } from '../components/windows/analysis/eFieldEvaluation/profileModel.js';
import { EFIELD_LAMBDA_NM } from '../components/windows/analysis/eFieldEvaluation/sessionState.js';
import { depthScale, X_UNIT_IDS } from '../components/windows/analysis/eFieldEvaluation/xScale.js';
import { incidentAmplitudeVpm, plotValue } from '../components/windows/analysis/eFieldEvaluation/yScale.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { FIELD_SAMPLES_PER_LAYER } from '../utils/physics/unpolarizedField.js';
import { requireResolved } from './materials.js';
import { emptySide, profiledNumbers, requireLayers, scoredSide, storedLayers, viewWavelength } from './stackViews.js';
import { checkOptions, requireValue, isAngle, isPositive, MAX_POINTS } from './check.js';

const DEFAULTS = sessionDefaults('eFieldEvaluation');
// computeEFieldProfile takes at least two samples across a layer, one at each
// of its surfaces.
const MIN_POINTS_PER_LAYER = 2;
const isPointCount = v => Number.isInteger(v) && v >= MIN_POINTS_PER_LAYER;
const isDepthUnit = v => X_UNIT_IDS.includes(v);

// One polarization's field, its |E|² curves as fractions of the incident |E|²
// and its amplitude in V/m for 1 W/m², as the window's amplitude reading takes it.
function fieldOf(profile, toAmplitude) {
    return {
        e2: profile.e2, e2Tangential: profile.e2Tangential, e2Normal: profile.e2Normal,
        amplitude: profile.e2.map(toAmplitude),
    };
}

/**
 * The electric field through one coated side at one wavelength, for s, p and
 * unpolarized light, as the [Electric Field](/analysis/efield/) window
 * computes it: from the medium light comes from, through the layers, to the
 * substrate. It is computed on the front, or on the back of a design coated on
 * the back alone, the side the PR, GD, PSI and EFMX merit rows score, unless
 * `side` is given. The design's cone of incidence is not used, as the window
 * does not use it. A layer with no thickness is left out, as the window leaves
 * it out.
 *
 * |E|² is given as a fraction of the incident |E|², for the whole field and
 * for its components along and normal to the layers; |E|² of the whole field
 * is the squared semi-major axis of the ellipse the field traces, the largest
 * field the material sees over a cycle. `avg`, the unpolarized field, is the
 * mean of the s and p fields, as the EFMX merit row reads it. The amplitude is
 * in V/m for an incident beam of 1 W/m², the reading a damage threshold is
 * quoted against (Macleod, Thin-Film Optical Filters, 5th ed., ch. 3, Electric
 * Field and Losses in the Admittance Diagram).
 *
 * @param design The design.
 * @param [options]
 * @param [options.wavelength] The wavelength the field is computed at, nm. Without it, the design's reference wavelength, as the window opens at it.
 * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
 * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.pointsPerLayer=60] The samples taken across each layer, a whole number of 2 or more, as many as the window takes when left out.
 * @param [options.depthUnit='nm'] What `depth` is in: `'nm'`, physical depth; `'OT'`, optical distance, the running sum of n times thickness, nm; `'QWOT'` or `'FWOT'`, optical distance in quarter or full waves of `reference`.
 * @param [options.reference] The wavelength λ0, nm, the optical depth units read n at and count waves of. Without it, the design's reference wavelength, as the window's depth axis takes it, or `wavelength` for a design that holds none.
 * @returns The field.
 * @property mode The side computed: `'front'` or `'back'`.
 * @property wavelength The wavelength, nm.
 * @property angle The angle of incidence, degrees.
 * @property reference The λ0 the depth was read at, nm.
 * @property depthUnit The unit `depth` is in. It is `'nm'` where an optical unit was asked for and a material has no index at `reference`, as the window then falls back to physical depth.
 * @property pointsPerLayer The samples taken across each layer.
 * @property z The depth of each sample from the outer surface, nm: the first at the surface, then `pointsPerLayer` across each layer, the last at the substrate.
 * @property depth The depth of each sample in `depthUnit`.
 * @property layers One per layer with a thickness, in the order light meets them, `{ number, material, start, end, depthStart, depthEnd }`: number as the Design Editor numbers it, 1 next to the substrate; material by id; start and end its depth from the outer surface in nm, depthStart and depthEnd in `depthUnit`.
 * @property s The s field: `e2`, `e2Tangential` and `e2Normal`, |E|² of the whole field and of its components along and normal to the layers as fractions of the incident |E|², and `amplitude`, the whole field's amplitude in V/m for 1 W/m² incident, one value per sample.
 * @property p The p field, as `s`.
 * @property avg The unpolarized field, the mean of the s and p fields sample by sample, as `s`.
 * @property incidentAmplitude The incident beam's amplitude in V/m for 1 W/m², from the medium's index: |E|² of 1 reads this amplitude.
 * @property outOfRange The materials of the side computed whose data do not reach the wavelength, each `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a wavelength or reference of 0 or less, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a depth unit other than `'nm'`, `'OT'`, `'QWOT'` or `'FWOT'`, or a pointsPerLayer that is not a whole number of 2 or more
 * @throws more samples, layers times pointsPerLayer, than one call computes; the refusal names the limit
 * @throws a side with no layer thicker than 0 nm
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H', referenceWavelength: 1064 });
 * const field = tf.electricField(design, { wavelength: 1064, depthUnit: 'QWOT' });
 * const peak = field.s.e2.indexOf(Math.max(...field.s.e2));
 * const layer = field.layers.find(l => field.z[peak] >= l.start && field.z[peak] <= l.end);
 * console.log('peak |E|² s', field.s.e2[peak].toFixed(4), 'at', field.depth[peak].toFixed(3), 'QWOT, in layer', layer.number);
 * console.log(field.s.amplitude[peak].toFixed(2), 'V/m for 1 W/m², the incident beam', field.incidentAmplitude.toFixed(2), 'V/m');
 */
export function electricField(design, options) {
    const {
        wavelength, angle = DEFAULTS.theta, side, pointsPerLayer = FIELD_SAMPLES_PER_LAYER, depthUnit = DEFAULTS.xUnit, reference,
    } = checkOptions('electricField', options, ['wavelength', 'angle', 'side', 'pointsPerLayer', 'depthUnit', 'reference']);
    const mode = scoredSide('electricField', design, side);
    const lambda = viewWavelength('electricField', design, wavelength, EFIELD_LAMBDA_NM);
    requireValue('electricField', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue('electricField', 'pointsPerLayer', pointsPerLayer, isPointCount, `a whole number of samples across a layer, ${MIN_POINTS_PER_LAYER} or more`);
    requireValue('electricField', 'depthUnit', depthUnit, isDepthUnit, "'nm', 'OT', 'QWOT' or 'FWOT'");
    if (reference !== undefined) requireValue('electricField', 'reference', reference, isPositive, 'a wavelength in nm above 0');
    requireLayers('electricField', design, mode);
    const numbers = profiledNumbers(storedLayers(design, mode), mode, true);
    if (!numbers.length) throw emptySide('electricField', mode);
    const samples = numbers.length * pointsPerLayer + 1;
    if (samples > MAX_POINTS) {
        throw new Error(`electricField: ${samples} samples (layers times points per layer) is more than ${MAX_POINTS}; take fewer points per layer`);
    }
    requireResolved(design);
    const profile = computeProfile(withHerpinRecords(design), { lambda, theta: angle, pol: 'avg', side: mode, refLambda: reference ?? null, pointsPerLayer });
    const depth = depthScale(profile, depthUnit);
    const bounds = profile.s.layerBounds;
    const incidentAmplitude = incidentAmplitudeVpm(profile.incidentIndex);
    const toAmplitude = plotValue('amplitude', incidentAmplitude);
    return {
        mode, wavelength: lambda, angle, reference: profile.refLambda, depthUnit: depth.id, pointsPerLayer,
        z: profile.s.z, depth: depth.map(profile.s.z),
        layers: profile.validLayers.map((layer, i) => ({
            number: numbers[i], material: layer.materialId, start: bounds[i], end: bounds[i + 1], depthStart: depth.bounds[i], depthEnd: depth.bounds[i + 1],
        })),
        s: fieldOf(profile.s, toAmplitude), p: fieldOf(profile.p, toAmplitude), avg: fieldOf(profile.avg, toAmplitude),
        incidentAmplitude,
        outOfRange: designRangeCoverage(design, [lambda, lambda], mode).offenders,
    };
}
