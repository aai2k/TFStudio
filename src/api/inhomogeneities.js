// A design's spectrum with graded interlayers at its interfaces, against the
// design as it stands, as the Inhomogeneities window computes it
// (inhomogeneities/model.js, physics in utils/physics/inhomogeneity.js).

import { NEW_INTERLAYER } from '../components/windows/analysis/inhomogeneities/model.js';
import { toleranceSpecInputs } from '../components/windows/analysis/toleranceSpecInputs.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { embedDesignMaterials, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { PROFILE_IDS, totalInterlayerThickness } from '../utils/physics/inhomogeneity.js';
import { makeConeSpec, coneIsActive, resolveEvalMode } from '../utils/physics/optimizer.js';
import { evaluateQualifiers } from '../utils/synthesis/qualifiers.js';
import { dispatchAnalysisEvaluation } from '../utils/workers/analysisEvaluationWorker.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { verdictOf } from './specification.js';
import { emptySide, storedLayers, viewSide } from './stackViews.js';
import { checkOptions, checkRange, requireValue, refusal, isAngle, isNonNegative } from './check.js';

const DEFAULTS = sessionDefaults('inhomogeneities');
const OPTIONS = ['interlayers', 'start', 'end', 'step', 'angle', 'side'];
const ROW_FIELDS = ['side', 'interface', 'thickness', 'profile', 'slices'];
// R, T and A for unpolarized light, then for s and p, as spectrum gives them.
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const quoted = PROFILE_IDS.map(id => `'${id}'`);
const PROFILES_TAKEN = `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`;

/**
 * The interfaces of `side` of `design`, as the window lists them: one more
 * than its layers, and none on a side with no layers.
 */
export function interfaceCount(design, side) {
    const count = storedLayers(design, side).length;
    return count ? count + 1 : 0;
}

/**
 * What reads the rows of the option `list` of the call `call`, each a record
 * of `fields`, on `design` computed in `mode`. `side(row, i)` gives the side
 * of row `i`, after refusing a row that is not a record or has a field not in
 * `fields`: the side given, which must be the side computed or, on the whole
 * part, either side; or else the side computed, or on the whole part the side
 * with layers. A row on the whole part of a design coated on both sides gives
 * its side. `interface(row, i, side, count)` gives its interface on a side of
 * `count` interfaces, refused unless it is a whole number from 0 to count - 1
 * that no earlier row of the side names.
 */
export function rowReader(call, list, design, mode, fields) {
    const seen = new Set();
    const sides = mode === 'total' ? ['front', 'back'] : [mode];
    const coated = sides.filter(side => storedLayers(design, side).length);
    const fallback = coated.length > 1 ? undefined : (coated[0] ?? sides[0]);
    const takes = sides.length === 1 ? `'${mode}', the side computed`
        : `'front' or 'back'${fallback ? '' : ', given on each row of a whole part coated on both sides'}`;
    return {
        side(row, i) {
            requireValue(call, `${list}[${i}]`, row, isRecord, `a row { ${fields.join(', ')} }`);
            const unknown = Object.keys(row).find(key => !fields.includes(key));
            if (unknown) {
                throw refusal('unknownOption', { call, option: `${list}[${i}].${unknown}`, options: fields },
                    `${call}: unknown option '${list}[${i}].${unknown}'; the options are ${fields.join(', ')}`);
            }
            const side = row.side ?? fallback;
            requireValue(call, `${list}[${i}].side`, side, v => sides.includes(v), takes);
            return side;
        },
        interface(row, i, side, count) {
            if (!count) throw emptySide(call, side);
            const k = row.interface;
            requireValue(call, `${list}[${i}].interface`, k, v => Number.isInteger(v) && v >= 0 && v < count,
                `a whole number from 0, the substrate's surface, to ${count - 1}, the ${side}'s layer count`);
            requireValue(call, `${list}[${i}].interface`, k, v => !seen.has(`${side}:${v}`), `an interface no other row of the ${side} names`);
            seen.add(`${side}:${k}`);
            return k;
        },
    };
}

// The rows given, with their defaults filled in, as the window's interlayer
// lists hold them and as the call gives them back. Interface k is the top of
// layer k counted from the substrate: on the front, stored air side first, the
// window's afterIndex N - 1 - k, between its stored layers N - 1 - k and N - k;
// on the back, stored substrate first, afterIndex k - 1.
function interlayersOf(design, given, mode) {
    requireValue('inhomogeneities', 'interlayers', given, Array.isArray, `a list of rows, each { ${ROW_FIELDS.join(', ')} }`);
    const call = 'inhomogeneities';
    const reader = rowReader(call, 'interlayers', design, mode, ROW_FIELDS);
    const inh = { interlayers: [], backInterlayers: [] };
    const rows = given.map((row, i) => {
        const side = reader.side(row, i);
        const k = reader.interface(row, i, side, interfaceCount(design, side));
        const { thickness = NEW_INTERLAYER.thickness, profile = NEW_INTERLAYER.profile, slices = NEW_INTERLAYER.slices } = row;
        requireValue(call, `interlayers[${i}].thickness`, thickness, isNonNegative, 'a thickness in nm, 0 or more');
        requireValue(call, `interlayers[${i}].profile`, profile, v => PROFILE_IDS.includes(v), PROFILES_TAKEN);
        requireValue(call, `interlayers[${i}].slices`, slices, v => Number.isInteger(v) && v >= 2, 'a whole number of slices, 2 or more');
        const layers = storedLayers(design, side);
        const n = layers.length;
        const back = side === 'back';
        const afterIndex = back ? k - 1 : n - 1 - k;
        (back ? inh.backInterlayers : inh.interlayers).push({ ...NEW_INTERLAYER, afterIndex, thickness, profile, slices });
        // The material the grading starts from and the one it ends at, as the
        // window's row label names them: the stored layer before the
        // interlayer and the one after it, or the medium or substrate there.
        const before = afterIndex < 0 ? (back ? design.substrate?.material : design.incidentMedium) : layers[afterIndex].material;
        const after = afterIndex + 1 < n ? layers[afterIndex + 1].material : (back ? design.exitMedium : design.substrate?.material);
        return { side, interface: k, thickness, profile, slices, materials: [before, after] };
    });
    return { rows, inh };
}

const curvesOf = spectrum => Object.fromEntries(QUANTITIES.map(q => [q, Array.from(spectrum[q])]));

/**
 * The spectrum of a design with graded interlayers at its interfaces,
 * against the design as it stands, as the
 * [Inhomogeneities](/analysis/inhomogeneities/) window computes it: each
 * interlayer is put in between the two materials that meet at its interface,
 * adding its thickness to the coating, and is cut into slices of one index
 * each, the share of the second material rising along its profile, n and k
 * mixed in proportion (Macleod, Thin-Film Optical Filters, 5th ed.,
 * "Inhomogeneous Layers"). The sides follow the design's
 * [evaluation mode](/design/evaluation-modes/), as `spectrum` does, unless
 * `side` is given, and a design under a cone of incidence is averaged over
 * its cone, as the window averages it. A side with no layers has no
 * interface, and gives its bare surface.
 *
 * Interface k of a side is the top of its layer k, numbered from the
 * substrate as the Design Editor numbers layers: 0 is the substrate's surface
 * and N, on a side of N layers, the surface that meets the medium. A layer of
 * 0 nm keeps its number and its interfaces, so an interlayer next to it grades
 * into its material, as the window's row names it. On the front the grading
 * runs from the material farther from the substrate to the nearer one, and on
 * the back from the nearer to the farther, as the window grades them; a
 * linear or sigmoid profile reads the same either way.
 *
 * When the design has a specification, the verdict is the Specification
 * window's for the design with its interlayers in, each check read at its own
 * Step, as the badge under the window's chart reads it. On a symmetric design
 * the two faces are judged as built: an interlayer on one face is not copied
 * to the other.
 *
 * @param design The design.
 * @param [options]
 * @param [options.interlayers=[]] One row per interlayer, each `{ side, interface, thickness, profile, slices }`: `side` `'front'` or `'back'`, the side computed, or the coated side on a whole part coated on one side, and given on each row of a whole part coated on both sides; `interface` from 0, the substrate's surface, to the side's layer count; `thickness` in nm, 0 or more, 5 when left out; `profile` `'linear'`, `'parabolic'`, `'invParabolic'`, `'exponential'` or `'sigmoid'`, `'linear'` when left out; `slices` a whole number, 2 or more, 10 when left out. One row to an interface.
 * @param [options.start=400] The first wavelength, nm.
 * @param [options.end=800] The last wavelength, nm, above `start`.
 * @param [options.step=0.5] The wavelength step, nm.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90; the cone's axis on a design under a cone.
 * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
 * @returns The two spectra.
 * @property mode The sides computed: `'front'`, `'back'` or `'total'`.
 * @property angle The angle of incidence, degrees.
 * @property wavelength The wavelengths, nm.
 * @property homogeneous The design as it stands: `R`, `T` and `A` for unpolarized light and `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap` for s and p, one value per wavelength, fractions of 1.
 * @property graded The design with the interlayers in, the same curves.
 * @property interlayers The rows, in the order given, with their defaults filled in, each `{ side, interface, thickness, profile, slices, materials }`: `materials` the two that meet there, by id, in the order the interlayer grades from one to the other.
 * @property addedThickness What the interlayers add to the coating, nm: the window's Σ.
 * @property specification The verdict for the design with its interlayers in, as checkSpecification gives one: `{ passed, passing, total, mode, rows }`; null when the design has no specification.
 * @property outOfRange The materials of the sides computed whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a side other than `'front'`, `'back'` or `'total'`, or more than a million wavelengths
 * @throws a row with a field it does not have, a row for a side not computed or with no side on a whole part coated on both sides, an interface the side does not have or one another row names, a thickness below 0, a profile it does not have, or slices that are not a whole number of 2 or more
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
 * const r = tf.inhomogeneities(design, { interlayers: [{ interface: 4, thickness: 3, profile: 'sigmoid' }], start: 450, end: 650, step: 1 });
 * const i = r.wavelength.indexOf(550);
 * console.log(r.interlayers[0].materials.join(' to '), 'adds', r.addedThickness, 'nm; R at 550 nm', r.homogeneous.R[i].toFixed(5), 'becomes', r.graded.R[i].toFixed(5));
 */
export function inhomogeneities(design, options) {
    const {
        interlayers = [], start = DEFAULTS.lambdaStart, end = DEFAULTS.lambdaEnd, step = DEFAULTS.lambdaStep, angle = DEFAULTS.aoi, side,
    } = checkOptions('inhomogeneities', options, OPTIONS);
    checkRange('inhomogeneities', { from: start, to: end, step }, 1, ['start', 'end']);
    requireValue('inhomogeneities', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    const shown = withHerpinRecords(design);
    const mode = viewSide('inhomogeneities', shown, side);
    const { rows, inh } = interlayersOf(shown, interlayers, mode);
    requireResolved(design);
    warnWithoutKernel();
    // The window's 'inhomogeneitySpectra', in the analysis worker under a cone
    // on the design with its materials embedded, as the worker receives it.
    const coned = coneIsActive(makeConeSpec(shown.cone || {}));
    const spectra = dispatchAnalysisEvaluation('inhomogeneitySpectra', {
        design: coned ? embedDesignMaterials(shown) : shown,
        params: { lambdaStart: start, lambdaEnd: end, lambdaStep: step, theta: angle, polarization: 'avg' },
        inh, evalMode: mode,
    });
    if (spectra.error) throw new Error(`inhomogeneities: ${spectra.error}`);
    // The worker's 'specification' pass with the window's recipe, whose answer
    // the badge shows.
    const checks = shown.qualifiers || [];
    let specification = null;
    if (checks.length) {
        const { design: judged, resolve } = toleranceSpecInputs(shown, { interlayers: inh });
        specification = verdictOf(checks, evaluateQualifiers(checks, judged, resolve, {}), resolveEvalMode(judged));
    }
    return {
        mode, angle, wavelength: Array.from(spectra.perturbed.lambda),
        homogeneous: curvesOf(spectra.baseline), graded: curvesOf(spectra.perturbed),
        interlayers: rows, addedThickness: totalInterlayerThickness(inh), specification,
        outOfRange: designRangeCoverage(shown, [start, end], mode).offenders,
    };
}
