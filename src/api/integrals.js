// A design's weighted averages of T, R and A, as the Integral Values window
// computes them (integralValues/integralModel.js, physics in
// utils/physics/integralValues.js and spectralWeightings.js).

import { INITIAL_BUILDER, integralTable } from '../components/windows/analysis/integralValues/integralModel.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { embedDesignMaterials, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { DEFAULT_INTEGRALS } from '../utils/physics/integralValues.js';
import { makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';
import { BUILTIN_DETECTORS, BUILTIN_SOURCES } from '../utils/physics/spectralWeightings.js';
import { dispatchAnalysisEvaluation } from '../utils/workers/analysisEvaluationWorker.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { viewSide } from './stackViews.js';
import { checkRange, checkOptions, requireValue, isAngle, isPositive, refusal } from './check.js';

const DEFAULTS = sessionDefaults('integralValues');
const BUILTIN_KEYS = DEFAULT_INTEGRALS.map(definition => definition.key);
const ROW_FIELDS = ['key', 'quantity', 'source', 'detector', 'band'];
const SOURCE_IDS = BUILTIN_SOURCES.map(source => source.id);
const DETECTOR_IDS = BUILTIN_DETECTORS.map(detector => detector.id);
const orList = words => `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
const quoted = words => words.map(w => `'${w}'`);

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
// A custom table's lowest and highest wavelengths bound its weighting's band,
// so a table needs two different wavelengths for the band to have a width.
const isRow = row => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite);
const isTable = v => Array.isArray(v) && v.every(isRow) && new Set(v.map(([nm]) => nm)).size >= 2;
const isBand = v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && v[0] < v[1];

// The fields a source or detector given as `{ id, ... }` holds beside its id,
// by id, and whether a value is one it takes: spectralWeightings.js reads a
// blackbody with no temperature or a custom one with no table as E or flat
// without a word. A blackbody given no temperature takes the window's, 5778 K.
const SPEC_FIELDS = {
    blackbody: { T: v => v === undefined || isPositive(v) },
    custom: { table: isTable },
};
const fieldsHold = (spec, reads) => Object.keys(spec).every(key => key === 'id' || (Object.hasOwn(reads, key) && reads[key](spec[key])))
    && Object.entries(reads).every(([key, ok]) => ok(spec[key]));

// The source or detector `spec` of custom row `i`, field `field`, after
// refusing an id `ids` does not hold, a field its id does not read, and a
// temperature or table it cannot use. A refusal names the whole of it, as a
// specification check's source is named, so it reads alike in each language.
function weightingSpec(i, field, spec, ids) {
    const takes = `{ id } with an id of ${orList(quoted(ids))}${field === 'source' ? ', a blackbody with T, its temperature in K above 0,' : ''} and a custom one with its table of [nm, value] rows, at least two at different wavelengths`;
    requireValue('integrals', `custom[${i}].${field}`, spec, v => isRecord(v) && ids.includes(v.id) && fieldsHold(v, SPEC_FIELDS[v.id] ?? {}), takes);
    return spec.id === 'blackbody' ? { ...spec, T: spec.T ?? INITIAL_BUILDER.source.T } : spec;
}

// Custom row `row`, number `i`, as the window's makeCustomDefinition holds a
// custom integral, after refusing a field it does not have or cannot use. A
// field left out takes the window's form's first value: T, D65, the photopic
// detector, 380-780 nm.
function customDefinition(row, i, keys) {
    requireValue('integrals', `custom[${i}]`, row, isRecord, `a row { ${ROW_FIELDS.join(', ')} }`);
    const unknown = Object.keys(row).find(key => !ROW_FIELDS.includes(key));
    if (unknown) {
        throw refusal('unknownOption', { call: 'integrals', option: `custom[${i}].${unknown}`, options: ROW_FIELDS },
            `integrals: unknown option 'custom[${i}].${unknown}'; the options are ${ROW_FIELDS.join(', ')}`);
    }
    const {
        key, quantity = INITIAL_BUILDER.char, source = { id: INITIAL_BUILDER.source.id }, detector = { id: INITIAL_BUILDER.detector.id },
        band = [INITIAL_BUILDER.bandMin, INITIAL_BUILDER.bandMax],
    } = row;
    requireValue('integrals', `custom[${i}].key`, key, v => typeof v === 'string' && v !== '' && !keys.has(v),
        `a name, as text, other than ${[...keys].join(', ')}`);
    keys.add(key);
    requireValue('integrals', `custom[${i}].quantity`, quantity, v => ['T', 'R', 'A'].includes(v), "'T', 'R' or 'A'");
    requireValue('integrals', `custom[${i}].band`, band, isBand, '[start, end] in nm, start < end');
    return {
        key, label: key, char: quantity, band,
        sourceSpec: weightingSpec(i, 'source', source, SOURCE_IDS),
        detectorSpec: weightingSpec(i, 'detector', detector, DETECTOR_IDS),
    };
}

/**
 * Weighted averages of a design's T, R and A, as the
 * [Integral Values](/analysis/integral-values/) window computes them: each
 * integral is ∫ C(λ) w(λ) dλ / ∫ w(λ) dλ over its weighting's band, by the
 * trapezoidal rule on the spectrum's grid, C being T, R or A and w the
 * weighting. The built-in rows are the window's: Tvis, Rvis and Avis
 * (photopic, D65 times the CIE 1924 V(λ), 380-780 nm), Tsol, Rsol and Asol
 * (ASTM G173-03 AM1.5G, 300-2500 nm), TUV and RUV (flat, 300-380 nm) and TNIR
 * and RNIR (flat, 780-2500 nm). Rows of your own come in `custom`. The sides
 * follow the design's [evaluation mode](/design/evaluation-modes/), as
 * `spectrum` does, unless `side` is given, and a design under a cone of
 * incidence is averaged over its cone, as the window averages it. A side with
 * no layers gives its bare surface.
 *
 * A row whose band the spectrum does not span from end to end has no value:
 * its numbers are NaN and `covered` is false, as the window shows a dash. A
 * row whose weighting is 0 over the whole band has no value either, though
 * `covered` is true. Tvis is the luminous transmittance: the Color Evaluation
 * window's Y / 100 for T under D65 with the 2 degree observer when this grid
 * has the colour's wavelengths on 380-780 nm, as the two default grids do.
 *
 * @param design The design.
 * @param [options]
 * @param [options.start=300] The first wavelength of the spectrum, nm.
 * @param [options.end=2500] The last wavelength, nm, above `start`.
 * @param [options.step=0.5] The wavelength step, nm.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90; the cone's axis on a design under a cone.
 * @param [options.pol='avg'] The polarization: `'avg'`, unpolarized, `'s'` or `'p'`.
 * @param [options.custom=[]] Rows of your own, after the built-in ones, each `{ key, quantity, source, detector, band }`: `key` its name, which no other row has; `quantity` `'T'`, `'R'` or `'A'`; `source` `{ id }` with an id of `'D65'`, `'D50'`, `'A'`, `'AM1.5G'`, `'E'`, `'blackbody'` with `T`, its temperature in K, or `'custom'` with `table`, its `[nm, value]` rows, at least two at different wavelengths; `detector` `{ id }` with an id of `'photopic'`, `'flat'` or `'custom'` with its `table`; `band` `[start, end]` in nm, which the weighting's own range narrows. Left out: `'T'`, D65, photopic and 380-780 nm, the window's form as it opens; a blackbody's T 5778 K.
 * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
 * @returns The integrals.
 * @property mode The sides computed: `'front'`, `'back'` or `'total'`.
 * @property start The first wavelength, nm.
 * @property end The last wavelength, nm.
 * @property step The wavelength step, nm.
 * @property angle The angle of incidence, degrees.
 * @property pol The polarization.
 * @property rows One per integral, the built-in ones first, as the window lists them, each `{ key, quantity, value, min, minAt, max, maxAt, band, covered, spectrumSpan }`: `value` the weighted average and `min` and `max` the lowest and highest C over the band, fractions of 1; `minAt` and `maxAt` their wavelengths, nm; `band` the band integrated, `[start, end]` in nm; `covered` whether the spectrum spans it; `spectrumSpan` the spectrum's first and last wavelength, nm.
 * @property outOfRange The materials of the sides computed whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a range that is not one, an angle outside 0 to 90, a polarization or side it does not have, or more than a million wavelengths
 * @throws a custom row with a field it does not have or cannot use, a key another row has, or a source or detector it does not have
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: 'HL' });
 * const iv = tf.integrals(design, { custom: [{ key: 'T3000K', source: { id: 'blackbody', T: 3000 }, band: [400, 700] }] });
 * for (const row of iv.rows) console.log(row.key, row.covered ? row.value.toFixed(4) : 'no value');
 */
export function integrals(design, options) {
    const {
        start = DEFAULTS.lambdaStart, end = DEFAULTS.lambdaEnd, step = DEFAULTS.lambdaStep, angle = DEFAULTS.theta,
        pol = DEFAULTS.polarization, custom = [], side,
    } = checkOptions('integrals', options, ['start', 'end', 'step', 'angle', 'pol', 'custom', 'side']);
    checkRange('integrals', { from: start, to: end, step }, 1, ['start', 'end']);
    requireValue('integrals', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue('integrals', 'pol', pol, v => ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'");
    requireValue('integrals', 'custom', custom, Array.isArray, `a list of rows, each { ${ROW_FIELDS.join(', ')} }`);
    const keys = new Set(BUILTIN_KEYS);
    const customDefinitions = custom.map((row, i) => customDefinition(row, i, keys));
    const shown = withHerpinRecords(design);
    const mode = viewSide('integrals', shown, side);
    requireResolved(design);
    warnWithoutKernel();
    // The window's 'integralSpectrum', in the analysis worker under a cone on
    // the design with its materials embedded, as the worker receives it.
    const coned = coneIsActive(makeConeSpec(shown.cone || {}));
    const spectrum = dispatchAnalysisEvaluation('integralSpectrum', {
        design: coned ? embedDesignMaterials(shown) : shown,
        params: { lambdaStart: start, lambdaEnd: end, lambdaStep: step, theta: angle, polarization: pol },
        evalMode: mode,
    });
    const { definitions, results } = integralTable(spectrum, customDefinitions);
    const rows = definitions.map(({ key, char }) => {
        const r = results[key];
        return {
            key, quantity: char, value: r.value, min: r.min, minAt: r.lamAtMin, max: r.max, maxAt: r.lamAtMax,
            band: [r.lamMin, r.lamMax], covered: r.covered, spectrumSpan: r.spectrumSpan,
        };
    });
    return { mode, start, end, step, angle, pol, rows, outOfRange: designRangeCoverage(shown, [start, end], mode).offenders };
}
