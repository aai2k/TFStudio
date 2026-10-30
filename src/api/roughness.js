// A design's specular R and T with rough interfaces, against the smooth
// design, as the Roughness / Scattering window computes it
// (roughnessScattering/model.js, physics in utils/physics/scattering.js).

import { getRoughnessContext } from '../components/windows/analysis/roughnessScattering/model.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { embedDesignMaterials, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { editorLayerNumber } from '../utils/misc/layerNumbers.js';
import { emptyRoughness, ROUGHNESS_RANGES } from '../utils/physics/scattering.js';
import { makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';
import { dispatchAnalysisEvaluation } from '../utils/workers/analysisEvaluationWorker.js';
import { requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { rowReader } from './inhomogeneities.js';
import { storedLayers, viewSide } from './stackViews.js';
import { checkOptions, checkRange, requireValue, isAngle, isNonNegative } from './check.js';

const DEFAULTS = sessionDefaults('roughnessScattering');
const UNIFORM = emptyRoughness();
const OPTIONS = ['sigma', 'range', 'interfaces', 'start', 'end', 'step', 'angle', 'side'];
const ROW_FIELDS = ['side', 'interface', 'sigma', 'range'];
// R and T for unpolarized light, then for s and p: the curves the window draws.
const QUANTITIES = ['R', 'T', 'Rs', 'Rp', 'Ts', 'Tp'];
const SIGMA_TAKEN = 'a roughness in nm, 0 or more';
const RANGE_TAKEN = ROUGHNESS_RANGES.map(range => `'${range}'`).join(' or ');
const isRange = v => ROUGHNESS_RANGES.includes(v);

// The window's roughness spec for the options given: every interface of each
// side at `sigma` and `range`, then each row's interface at its own, as the
// per-interface editor holds them. Interface k is the top of layer k counted
// from the substrate: on the front, whose editor lists interfaces from the
// medium, the editor's index N - k; on the back, from the substrate, index k.
function roughSpec(design, { sigma, range, interfaces }, mode) {
    requireValue('roughness', 'sigma', sigma, isNonNegative, SIGMA_TAKEN);
    requireValue('roughness', 'range', range, isRange, RANGE_TAKEN);
    requireValue('roughness', 'interfaces', interfaces, Array.isArray, `a list of rows, each { ${ROW_FIELDS.join(', ')} }`);
    const { frontN, backN } = getRoughnessContext(design, mode);
    const counts = { front: frontN, back: backN };
    const spec = {
        mode: 'perInterface', sigma, range,
        sigmas: new Array(frontN).fill(sigma), ranges: new Array(frontN).fill(range),
        backSigmas: new Array(backN).fill(sigma), backRanges: new Array(backN).fill(range),
    };
    const reader = rowReader('roughness', 'interfaces', counts, mode, ROW_FIELDS);
    interfaces.forEach((row, i) => {
        const side = reader.side(row, i);
        const k = reader.interface(row, i, side);
        const { sigma: own = sigma, range: kind = range } = row;
        requireValue('roughness', `interfaces[${i}].sigma`, own, isNonNegative, SIGMA_TAKEN);
        requireValue('roughness', `interfaces[${i}].range`, kind, isRange, RANGE_TAKEN);
        const back = side === 'back';
        const index = back ? k : storedLayers(design, 'front').length - k;
        (back ? spec.backSigmas : spec.sigmas)[index] = own;
        (back ? spec.backRanges : spec.ranges)[index] = kind;
    });
    return spec;
}

const curvesOf = spectrum => Object.fromEntries(QUANTITIES.map(q => [q, Array.from(spectrum[q])]));

// The layers the transition layers emptied, by side and Design Editor number,
// from the window's stored indices: air side first on the front, substrate
// first on the back.
function thinnedLayers(design, thinned) {
    return ['front', 'back'].flatMap(side => thinned[side]
        .map(index => ({ side, number: editorLayerNumber(side, storedLayers(design, side).length, index) }))
        .sort((a, b) => a.number - b.number));
}

/**
 * The specular R and T of a design with rough interfaces, against the smooth
 * design, as the [Roughness / Scattering](/analysis/roughness-scattering/)
 * window computes them (Macleod, Thin-Film Optical Filters, 5th ed., §16). Each
 * rough interface becomes a transition layer 2σ thick, σ the rms roughness.
 * Short range, roughness fine against the wavelength, is a graded layer whose
 * n and k run in a straight line from one material to the other, cut into 16
 * and into 32 slices and the two results combined as (4·S32 − S16)/3; it
 * changes R and T and loses no light. Long range, bumps wide against the
 * wavelength, is one layer with an index between the two materials and an
 * extinction coefficient that stands for the light scattered out of the
 * specular beams (C. K. Carniglia and D. G. Jensen, Appl. Opt. 41, 3167
 * (2002)). That layer is derived for one surface at normal incidence, so at an
 * angle, under a cone, or at the interfaces of a multilayer it is an estimate.
 * The sides follow the design's
 * [evaluation mode](/design/evaluation-modes/), as `spectrum` does, unless
 * `side` is given, and a design under a cone of incidence is averaged over its
 * cone, as the window averages it.
 *
 * Interface k of a side is the top of its layer k, numbered from the
 * substrate as the Design Editor numbers layers: 0 is the substrate's surface
 * and N, on a side of N layers, the surface that meets the medium. A side with
 * no layers, or none thicker than 0 nm, has no interface, and gives its bare
 * surface, on its own or on the whole part. A transition layer takes its
 * thickness out of the layer beneath its interface, the one deposited first,
 * so the rest of the design stays where it was; the substrate is not thinned.
 * A layer thinner than 2σ is set to 0 nm and listed in `thinned`. A layer of
 * 0 nm is not in the coating: the σ set on its top is not used, and the layer
 * beneath it meets the next layer there is, at the interface on top of the
 * layer beneath.
 *
 * @param design The design.
 * @param [options]
 * @param [options.sigma=1] The rms roughness of every interface, nm, 0 or more.
 * @param [options.range='long'] The kind of roughness of every interface: `'short'` or `'long'`.
 * @param [options.interfaces=[]] The interfaces that differ from `sigma` and `range`, one row each, `{ side, interface, sigma, range }`, as the per-interface editor sets them: `side` `'front'` or `'back'`, the side computed, or the coated side on a whole part coated on one side, and given on each row of a whole part coated on both sides; `interface` from 0, the substrate's surface, to the side's layer count; `sigma` and `range` as above, the call's own when left out. One row to an interface. One rough interface alone is `sigma: 0` with that interface listed.
 * @param [options.start=400] The first wavelength, nm.
 * @param [options.end=800] The last wavelength, nm, above `start`.
 * @param [options.step=0.5] The wavelength step, nm.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90; the cone's axis on a design under a cone.
 * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
 * @returns The two spectra and the loss.
 * @property mode The sides computed: `'front'`, `'back'` or `'total'`.
 * @property angle The angle of incidence, degrees.
 * @property wavelength The wavelengths, nm.
 * @property smooth The design as it stands: `R` and `T` for unpolarized light and `Rs`, `Rp`, `Ts` and `Tp` for s and p, one value per wavelength, fractions of 1.
 * @property rough The design with its rough interfaces, the same curves.
 * @property loss The light lost from the specular beams, smooth R + T minus rough R + T for unpolarized light, one value per wavelength, a fraction of 1. In an absorbing design it holds the change in absorption too, and where a transition layer replaces part of an absorbing layer it can fall below 0.
 * @property thinned The layers set to 0 nm because their transition layer took more than they had, each `{ side, number }`, numbered as the Design Editor numbers them.
 * @property longRange `true` when a long-range interface with a σ above 0 is in, so the long-range estimate applies.
 * @property outOfRange The materials of the sides computed whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a side other than `'front'`, `'back'` or `'total'`, or more than a million wavelengths
 * @throws a σ below 0 or a kind other than `'short'` or `'long'`, in the options or on a row
 * @throws a row with a field it does not have, a row for a side not computed or with no side on a whole part coated on both sides, or an interface the side does not have or one another row names
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
 * const r = tf.roughness(design, { sigma: 2, start: 400, end: 700, step: 1 });
 * const i = r.wavelength.indexOf(550);
 * console.log('R at 550 nm', r.smooth.R[i].toFixed(5), 'becomes', r.rough.R[i].toFixed(5), '; loss', (r.loss[i] * 1e6).toFixed(1), 'ppm');
 */
export function roughness(design, options) {
    const {
        sigma = UNIFORM.sigma, range = UNIFORM.range, interfaces = [],
        start = DEFAULTS.lambdaStart, end = DEFAULTS.lambdaEnd, step = DEFAULTS.lambdaStep, angle = DEFAULTS.aoi, side,
    } = checkOptions('roughness', options, OPTIONS);
    checkRange('roughness', { from: start, to: end, step }, 1, ['start', 'end']);
    requireValue('roughness', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    const shown = withHerpinRecords(design);
    const mode = viewSide('roughness', shown, side);
    const rough = roughSpec(shown, { sigma, range, interfaces }, mode);
    requireResolved(design);
    requireKernel();
    // The window's 'roughnessSpectra', in the analysis worker under a cone on
    // the design with its materials embedded, as the worker receives it.
    const coned = coneIsActive(makeConeSpec(shown.cone || {}));
    const { data, error } = dispatchAnalysisEvaluation('roughnessSpectra', {
        design: coned ? embedDesignMaterials(shown) : shown,
        params: { lambdaStart: start, lambdaEnd: end, lambdaStep: step, theta: angle, polarization: 'avg' },
        rough, evalMode: mode,
    });
    if (error) throw new Error(`roughness: ${error}`);
    return {
        mode, angle, wavelength: Array.from(data.lambda),
        smooth: curvesOf(data.ideal), rough: curvesOf(data.specular), loss: Array.from(data.loss),
        thinned: thinnedLayers(shown, data.thinned), longRange: data.hasLongRange,
        outOfRange: designRangeCoverage(shown, [start, end], mode).offenders,
    };
}
