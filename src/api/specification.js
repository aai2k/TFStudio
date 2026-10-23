// A design's specification: setting its checks, and judging the design against
// them with each check's margin, as the Specification window does
// (utils/synthesis/qualifiers).

import {
    QUALIFIER_KINDS, QUALIFIER_CMPS, SIDE_KINDS, makeQualifier, startingSide, checkStepKind, stepFlags,
    evaluateQualifiers, aggregateVerdict, thresholdMargin,
} from '../utils/synthesis/qualifiers.js';
import { channelFromKind } from '../utils/synthesis/qualifiers/channelTypes.js';
import { buildMfePresetList } from '../utils/physics/integralValues.js';
import { BUILTIN_SOURCES, BUILTIN_DETECTORS } from '../utils/physics/spectralWeightings.js';
import { OPERAND_POLS, resolveEvalMode } from '../utils/physics/optimizer.js';
import { designMaterialLookup, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { isAngle, isBoolean, isPositive, shown, refusal } from './check.js';

// The fields a check holds, over every kind: those makeQualifier gives a new
// one (qualifiers/construction.js) and those the evaluators read beside them.
const CHECK_FIELDS = [
    'id', 'enabled', 'kind', 'label', 'cmp', 'target', 'tol', 'lo', 'hi', 'lambda', 'lambdaStart', 'lambdaEnd',
    'aoi', 'pol', 'channel', 'direction', 'level', 'edgeSide', 'flag', 'side', 'presetKey', 'presetLabel',
    'source', 'detector', 'bandPoints', 'curveId',
];

// The integral presets the window offers that a script can name: the built-in
// ones, since the presets a user saves are a setting of that user's machine.
const INTEGRAL_PRESETS = buildMfePresetList([]);
const SOURCE_IDS = BUILTIN_SOURCES.map(source => source.id);
const DETECTOR_IDS = BUILTIN_DETECTORS.map(detector => detector.id);

// Kinds by what their evaluators read (qualifiers/evaluate.js, bandScan.js): a
// wavelength, angle and polarization of their own, and one wavelength or a band.
const NOT_OPTICAL = [...SIDE_KINDS, 'PPEF'];
const AT_KINDS = ['T_AT', 'R_AT', 'A_AT'];
const optical = q => !NOT_OPTICAL.includes(q.kind);
const banded = q => optical(q) && !AT_KINDS.includes(q.kind);
const kindIn = (...kinds) => q => kinds.includes(q.kind);
const always = () => true;

const isNumber = v => Number.isFinite(v);
const isText = v => typeof v === 'string';
const isName = v => isText(v) && v !== '';
const oneOf = list => v => list.includes(v);
const orNone = ok => v => v == null || ok(v);
const orList = words => `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;

// What a source or detector needs beside its id to resolve as itself
// (spectralWeightings.js), which reads one without it as E or flat: a custom
// one its table, a blackbody its temperature.
const NEEDS = { custom: spec => Array.isArray(spec.table) && spec.table.length > 0, blackbody: spec => isPositive(spec.T) };
const resolvesAmong = ids => spec => !!spec && ids.includes(spec.id) && (NEEDS[spec.id] ?? always)(spec);

const curveIds = design => (design?.measuredCurves || []).map(curve => curve.id);
function curvesTaken(design) {
    const ids = curveIds(design);
    return ids.length ? `the id of one of the design's measured curves: ${ids.join(', ')}` : "the id of one of the design's measured curves, and it has none";
}

// A check with no Step (checkStepKind) by its kind, and for a MIN_MAX or
// CENTRAL_LAMBDA check by the value it looks for: the lowest T or A, or the
// highest R.
const stepless = q => (kindIn('MIN_MAX', 'CENTRAL_LAMBDA')(q) ? `${q.kind} of the ${q.direction === 'min' ? 'lowest' : 'highest'} ${q.channel}` : q.kind);

const IN_UNIT = "a number in the check's unit";
const NAME = 'a name, as text';
const WAVELENGTH = 'a wavelength in nm above 0';

// What each field of a check can take: [field, whether the check's kind reads
// it, whether a value is one it takes, what it takes], then, where they
// differ, the same two for a check whose kind does not read the field. A field
// the kind does not read is checked when the check gives it. presetOf, below,
// checks an INTEGRAL check's preset key against the window's presets.
const RULES = [
    ['id', always, isName, NAME],
    ['enabled', always, isBoolean, 'true or false'],
    ['label', always, isText, 'text'],
    ['cmp', always, oneOf(QUALIFIER_CMPS), "'ge', 'le', 'eq' or 'between'"],
    ['target', q => q.cmp !== 'between', isNumber, IN_UNIT],
    ['tol', q => q.cmp === 'eq', isNumber, IN_UNIT],
    ['lo', q => q.cmp === 'between', isNumber, IN_UNIT],
    ['hi', q => q.cmp === 'between', (v, q) => isNumber(v) && v >= q.lo, q => `${IN_UNIT} no lower than lo, ${q.lo}`, isNumber, IN_UNIT],
    ['lambda', kindIn(...AT_KINDS), isPositive, WAVELENGTH],
    ['lambdaStart', banded, isPositive, WAVELENGTH],
    ['lambdaEnd', banded, isPositive, WAVELENGTH],
    ['aoi', optical, isAngle, 'an angle of incidence in degrees, 0 <= aoi < 90'],
    ['pol', optical, oneOf(OPERAND_POLS), "'avg', 's' or 'p'"],
    ['channel', q => optical(q) && !channelFromKind(q.kind), oneOf(['T', 'R', 'A']), "'T', 'R' or 'A'"],
    ['direction', kindIn('MIN_MAX', 'CENTRAL_LAMBDA', 'FWHM', 'EDGE_LAMBDA'), oneOf(['max', 'min']), "'max' or 'min'"],
    ['level', kindIn('FWHM', 'EDGE_LAMBDA'), v => isNumber(v) && v >= 0 && v <= 1, 'a fraction, 0 to 1'],
    ['edgeSide', kindIn('EDGE_LAMBDA'), orNone(oneOf(['left', 'right'])), "'left' or 'right'"],
    ['bandPoints', kindIn('INTEGRAL', 'FWHM', 'EDGE_LAMBDA'), orNone(v => Number.isInteger(v) && v >= 2), 'a whole number of 2 or more, or null for the default'],
    ['source', kindIn('INTEGRAL'), resolvesAmong(SOURCE_IDS), `one with an id of ${orList(SOURCE_IDS)}; a blackbody with T, its temperature in K, and a custom one with its table of [nm, value] rows`],
    ['detector', kindIn('INTEGRAL'), resolvesAmong(DETECTOR_IDS), `one with an id of ${orList(DETECTOR_IDS)}; a custom one with its table of [nm, value] rows`],
    ['presetKey', always, orNone(isText), 'text'],
    ['presetLabel', always, isText, 'text'],
    ['side', kindIn(...SIDE_KINDS), oneOf(['front', 'back', 'both']), "'front', 'back' or 'both'"],
    ['curveId', kindIn('PPEF'), (v, q, design) => curveIds(design).includes(v), (q, design) => curvesTaken(design), orNone(isText), 'text or null'],
    ['flag', q => !!checkStepKind(q), (v, q) => v == null || stepFlags(q).includes(v), q => `null for the default, or one of ${stepFlags(q).join(', ')}`,
        v => v == null, q => `null, as ${stepless(q)} has no Step`],
];

// The first field of check `q` that holds a value it cannot take, as
// [field, what it takes], or none.
function brokenRule(q, design) {
    for (const [field, reads, ok, takes, okUnread = ok, takesUnread = takes] of RULES) {
        const read = reads(q);
        if (!read && q[field] === undefined) continue;
        const [holds, said] = read ? [ok, takes] : [okUnread, takesUnread];
        if (!holds(q[field], q, design)) return [field, typeof said === 'function' ? said(q, design) : said];
    }
    return [];
}

const at = i => `setSpecification: check ${i}: `;

// Refuses `value`, given in field `option` of check `i`, saying what the field takes.
function refuseValue(i, option, takes, value) {
    throw refusal('badValue', { call: 'setSpecification', row: i, option, takes, value }, `${at(i)}${option} is ${takes}, not ${shown(value)}`);
}

// The fields the integral preset `preset` sets on a check, as picking it in
// the window sets them (QRow.js).
const presetFields = preset => ({
    channel: preset.char, presetLabel: preset.label, source: { ...preset.sourceSpec }, detector: { ...preset.detectorSpec },
    lambdaStart: preset.band[0], lambdaEnd: preset.band[1],
});

// The fields an INTEGRAL check's preset sets, none without one, after refusing
// a preset the window does not offer and a field the check gives otherwise.
function presetOf(check, i) {
    if (check.kind !== 'INTEGRAL' || check.presetKey == null || check.presetKey === '') return {};
    const preset = INTEGRAL_PRESETS.find(p => p.key === check.presetKey);
    if (!preset) refuseValue(i, 'presetKey', `'' for none, or one of ${INTEGRAL_PRESETS.map(p => p.key).join(', ')}`, check.presetKey);
    const fields = presetFields(preset);
    const differs = Object.keys(fields).find(f => f in check && JSON.stringify(check[f]) !== JSON.stringify(fields[f]));
    if (differs) refuseValue(i, differs, `${shown(fields[differs])}, as preset ${preset.key} sets it, or left out`, check[differs]);
    return fields;
}

// Check `check`, number `i` of those given. One given with an id is one a
// design holds, and is kept as it is given: the window holds and evaluates
// values a new check is refused for, such as an integral preset its user
// saved, and reads a thickness budget or layer count saved without a side as
// adding up both sides. One given without is completed as the window completes
// a new row:
// makeQualifier's defaults, the side the design coats for a thickness budget
// or layer count that names none (startingSide), and an integral preset's
// fields. Refuses either unless each field it gives is a field of a check and
// its kind is one this version evaluates, and a new one unless each of its
// fields holds a value that field can take (RULES).
function completedCheck(check, i, design) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
        throw new Error(`${at(i)}a check is an object of fields, such as { kind: 'T_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'ge', target: 0.95 }`);
    }
    const unknown = Object.keys(check).find(key => !CHECK_FIELDS.includes(key) && check[key] !== undefined);
    if (unknown) {
        throw refusal('unknownOption', { call: 'setSpecification', row: i, option: unknown, options: CHECK_FIELDS },
            `${at(i)}'${unknown}' is not a field of a check; a check takes ${CHECK_FIELDS.join(', ')}`);
    }
    if (!QUALIFIER_KINDS.includes(check.kind)) refuseValue(i, 'kind', `one of ${QUALIFIER_KINDS.join(', ')}`, check.kind);
    if (check.id !== undefined) {
        if (!isName(check.id)) refuseValue(i, 'id', NAME, check.id);
        return check;
    }
    const q = makeQualifier({ ...startingSide(check.kind, design, check.side), ...check, ...presetOf(check, i) });
    const [field, takes] = brokenRule(q, design);
    if (field) refuseValue(i, field, takes, q[field]);
    if (banded(q) && q.lambdaStart > q.lambdaEnd) {
        throw refusal('bandOrder', { call: 'setSpecification', row: i, start: q.lambdaStart, end: q.lambdaEnd },
            `${at(i)}lambdaEnd ${q.lambdaEnd} is below lambdaStart ${q.lambdaStart}`);
    }
    return q;
}

/**
 * A design with its specification replaced by the checks given, as the
 * [Specification](/design/specification/) window holds them: each check is a
 * pass or fail requirement on the design, which checkSpecification judges. A
 * check given without an id is a new one, made as one added in the window: a
 * field it leaves out takes the value such a check starts with, a thickness
 * budget or layer count given no side adds up the side the design coats, and
 * each field it gives must hold a value that field can take. A check given
 * with an id is one a design holds, such as one of `design.qualifiers`: it is
 * kept as it is given, so the checks a design holds go back through unchanged,
 * a thickness budget or layer count saved without a side still adding up both
 * sides, as the window reads it. An empty list clears the specification.
 *
 * @param design The design.
 * @param checks The checks, in order, each an object with at least a `kind`.
 * @param checks[].kind What is checked: `'T_AT'`, `'R_AT'` or `'A_AT'` at one wavelength; `'T_AVG'`, `'R_AVG'` or `'A_AVG'`, the average over a band; `'MIN_MAX'`, the lowest or highest value over a band; `'INTEGRAL'`, a weighted average such as Tvis; `'CENTRAL_LAMBDA'`, the wavelength of the band's peak or dip; `'FWHM'`, the width of the peak at `level`; `'EDGE_LAMBDA'`, where the curve crosses `level` of the peak; `'THICKNESS_BUDGET'`, the total thickness; `'LAYER_COUNT'`, the number of layers; `'PPEF'`, the peak-to-peak error against a measured curve.
 * @param [checks[].cmp='ge'] The comparison: `'ge'` or `'le'` with `target`, `'eq'` within `target` plus or minus `tol`, or `'between'` from `lo` to `hi`.
 * @param [checks[].target=0.99] The bound, in the check's unit: T, R and A as fractions of 1, where the window shows percent; wavelengths, widths and thicknesses in nm; a layer count as a count; PPEF in dB.
 * @param [checks[].tol] The tolerance of `'eq'`, in the check's unit; 0 or less holds the value to the target itself. Default: 0.01 for T, R and A, 1 nm for a centre or edge, 2 nm for a width, 10 nm for a thickness, 0 for a layer count, 0.05 dB for PPEF.
 * @param [checks[].lo=0.95] The lowest value of `'between'`, in the check's unit.
 * @param [checks[].hi=1] The highest value of `'between'`, no lower than `lo`.
 * @param [checks[].lambda=550] The wavelength of a check at one wavelength, nm.
 * @param [checks[].lambdaStart=400] The first wavelength of the band, nm.
 * @param [checks[].lambdaEnd=700] The last wavelength of the band, nm, no lower than `lambdaStart`.
 * @param [checks[].aoi=0] The angle of incidence, degrees in the incident medium.
 * @param [checks[].pol='avg'] `'avg'`, `'s'` or `'p'`.
 * @param [checks[].channel='T'] What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA read: `'T'`, `'R'` or `'A'`.
 * @param [checks[].direction='max'] For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA: `'max'`, the highest value or a peak, or `'min'`, the lowest value or a dip.
 * @param [checks[].level=0.5] For FWHM and EDGE_LAMBDA, the level the curve crosses, 0 to 1: with direction `'max'` that fraction of the band's highest value, with `'min'` that fraction of the way from its lowest value up to 1. A level below 0.001 or above 0.999 is taken as 0.001 or 0.999.
 * @param [checks[].edgeSide] For EDGE_LAMBDA, `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.
 * @param [checks[].flag] The window's Step, null for its default: on T_AVG, R_AVG, A_AVG and INTEGRAL 1 to 4, a grid no coarser than 1, 0.1, 0.01 or 0.001 nm, the default being the design's fringe grid; on FWHM and EDGE_LAMBDA, and on MIN_MAX and CENTRAL_LAMBDA of the highest T or A or the lowest R, 2 to 4, a search at 0.1, 0.01 or 0.001 nm, the default being 1 nm. A check at one wavelength, MIN_MAX and CENTRAL_LAMBDA of the lowest T or A or the highest R, a thickness budget, a layer count and PPEF have no Step, and take null.
 * @param [checks[].side] For THICKNESS_BUDGET and LAYER_COUNT, the layers added up: `'front'`, `'back'` or `'both'`. Default: the side the design coats.
 * @param [checks[].presetKey=''] For INTEGRAL, one of the integral presets Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR, RNIR, which sets the channel, band, source, detector and `presetLabel` as picking it in the window does, or `''` for none.
 * @param [checks[].presetLabel=''] For INTEGRAL, the preset's name as the window shows it.
 * @param [checks[].source={ id: 'D65' }] For INTEGRAL without a preset, the source: `{ id }`, the id one of D65, D50, A, AM1.5G, E, blackbody (with `T` in K) or custom (with `table`, rows of [nm, value]).
 * @param [checks[].detector={ id: 'photopic' }] For INTEGRAL without a preset, the detector: `{ id }`, the id photopic, flat or custom (with `table`).
 * @param [checks[].bandPoints] For INTEGRAL, FWHM and EDGE_LAMBDA, how many points the band is sampled at in place of the default, a whole number of 2 or more; a width or edge scan takes 11 at the least.
 * @param [checks[].curveId] For PPEF, the id of one of the design's measured curves.
 * @param [checks[].label=''] The check's label.
 * @param [checks[].enabled=true] `false` leaves the check out of the verdict.
 * @param [checks[].id] The check's name in the design: a check given one is one the design holds, kept as it is given; a check given none is a new one, and takes a fresh one.
 * @returns The design with the specification, which it holds in `qualifiers`.
 * @throws a kind this version does not evaluate, or a field no check has, such as a misspelling
 * @throws on a new check, a value its field cannot take, a band whose end is below its start, or a `hi` below `lo`
 * @throws on a new check, a preset the window does not offer, or a field the check gives otherwise than its preset sets it
 * @throws on a new check, a PPEF check whose curve is not one of the design's measured curves, or a flag on a check with no Step
 * @throws two checks with one id
 * @example
 * const mirror = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const specified = tf.setSpecification(mirror, [
 *     { kind: 'R_AVG', lambdaStart: 520, lambdaEnd: 580, cmp: 'ge', target: 0.9 },
 *     { kind: 'LAYER_COUNT', cmp: 'le', target: 15 },
 * ]);
 * console.log(specified.qualifiers.length, 'checks, the layer count on the', specified.qualifiers[1].side);
 */
export function setSpecification(design, checks) {
    if (!Array.isArray(checks)) throw new Error('setSpecification: checks is a list of specification checks');
    const ids = new Set();
    const qualifiers = checks.map((check, i) => {
        const q = completedCheck(check, i, design);
        if (ids.has(q.id)) refuseValue(i, 'id', 'a name no other check has', q.id);
        ids.add(q.id);
        return q;
    });
    return { ...design, qualifiers };
}

// A result's unit as the API names it: the evaluators' '%' is the unit the
// window shows a T, R or A in, and the value itself is a fraction of 1.
const UNITS = { '%': 'fraction', nm: 'nm', dB: 'dB', '': '' };

// Check `check`, number `index`, as checkSpecification gives it, from its
// result as the evaluator gives one (qualifiers/evaluate.js).
function rowOf(check, result, index) {
    const value = Number.isFinite(result.value) ? result.value : null;
    return {
        index, label: check.label ?? '', kind: check.kind, enabled: !!check.enabled,
        value, unit: UNITS[result.unit], passed: result.pass,
        margin: value === null ? null : thresholdMargin(check, value),
        threshold: { cmp: check.cmp, target: check.target, tol: check.tol, lo: check.lo, hi: check.hi },
        reason: result.summaryKey ?? null,
    };
}

/**
 * A design judged against its specification as the
 * [Specification](/design/specification/) window judges it: each check read
 * at its own Step, as the window's final value is, and averaged over the
 * design's cone of incidence when it has one.
 *
 * @param design The design; it needs a specification.
 * @returns The verdict.
 * @property passed `true` when every enabled check passes and there is one at least.
 * @property passing How many enabled checks pass.
 * @property total How many checks are enabled.
 * @property mode How the design was scored: `'front'`, `'back'` or `'total'`.
 * @property rows One per check, in order.
 * @property rows[].index The check's place in the specification, from 0.
 * @property rows[].label The check's label, `''` when it has none.
 * @property rows[].kind The check's kind.
 * @property rows[].enabled `false` for a check left out of the verdict.
 * @property rows[].value The check's value: T, R and A as fractions of 1, wavelengths, widths and thicknesses in nm, PPEF in dB, a layer count as a count; null when there is none.
 * @property rows[].unit `'fraction'`, `'nm'`, `'dB'`, or `''` for a layer count and for a disabled check, which is not evaluated.
 * @property rows[].passed Whether the value meets the threshold, as the window marks it; `false` when there is no value, null for a disabled check.
 * @property rows[].margin How far the value is from the nearest bound, in its unit: positive by the room left, negative by how far it is out, 0 on a bound, so `passed` is `true` exactly when it is 0 or more. Null when there is no value.
 * @property rows[].threshold The comparison as the check holds it: `{ cmp, target, tol, lo, hi }`.
 * @property rows[].reason Why there is no value, or null: `'disabled'`; `'notComputable'`; `'noCurve'`, a PPEF check whose curve the design does not hold; `'fwhmNotBracketed'` and `'edgeNotCrossed'`, a width or edge whose crossing is not inside the band; `'unknownKind'`.
 * @throws a design with no specification
 * @throws a design that names a material that resolves to nothing
 * @example
 * const mirror = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const specified = tf.setSpecification(mirror, [{ kind: 'R_AVG', lambdaStart: 520, lambdaEnd: 580, cmp: 'ge', target: 0.9 }]);
 * const verdict = tf.checkSpecification(specified);
 * for (const row of verdict.rows) console.log(row.kind, row.value, row.unit, row.passed, 'margin', row.margin);
 * console.log('Passes:', verdict.passed);
 */
export function checkSpecification(design) {
    // The analysis worker's 'specification' pass (analysisEvaluationWorker.js),
    // whose answer replaces the window's first, coarse one.
    const checks = design.qualifiers || [];
    if (!checks.length) {
        throw refusal('noSpecification', { call: 'checkSpecification' }, 'checkSpecification: the design has no specification; set one with setSpecification');
    }
    requireResolved(design);
    warnWithoutKernel();
    const shownDesign = withHerpinRecords(design);
    const results = evaluateQualifiers(checks, shownDesign, designMaterialLookup(shownDesign), {});
    const { passing, total, allPass } = aggregateVerdict(results);
    return { passed: allPass, passing, total, mode: resolveEvalMode(shownDesign), rows: checks.map((check, i) => rowOf(check, results[i], i)) };
}
