/**
 * What an operand's stored numbers mean.
 *
 * An operand row holds a λ Start, a λ End and a target, but what those numbers
 * are depends entirely on the operand type. λ Start is a wavelength for a
 * spectral operand, a layer index for a thickness constraint, a reference to
 * another row for a math operand, and a saved preset for an integral. A target
 * is a fraction, a thickness in nanometres, a wavelength, a phase quantity, or a
 * plain number.
 *
 * These classifiers let an editor tell whether a stored number survives a change
 * of type. Carried across a boundary it is not merely unhelpful but wrong: 400
 * and 700 are a sensible visible band, and nonsense as layer indices.
 */
import {
    isArgwave, isBlank, isConstraint, isDmfs, isIntegral, isMath, isPhase,
    isTotalThickness,
} from './operandModel.js';

const ROW_RANGE_DOMAINS = [
    [isConstraint, 'layer'],
    [isMath, 'operandRef'],
    [isIntegral, 'preset'],
    [isTotalThickness, 'comparison'],
    [type => isBlank(type) || isDmfs(type), 'comment'],
];

/** What the λ Start / λ End pair holds for an operand type. */
export function rowRangeDomain(type) {
    const hit = ROW_RANGE_DOMAINS.find(([test]) => test(type));
    return hit ? hit[1] : 'wavelength';
}

// All phase operands share one domain even though their units differ (fs, fs²,
// fs³, degrees), so a target survives a GDD to TOD change with its unit
// silently reinterpreted. Splitting them needs the per-type unit table, which
// lives in the merit table's view model.
const TARGET_DOMAINS = [
    [type => isConstraint(type) || isTotalThickness(type), 'nm'],
    [isArgwave, 'wavelength'],
    [isPhase, 'phase'],
    [isMath, 'raw'],
    [type => isBlank(type) || isDmfs(type), 'none'],
];

/** The unit an operand's target is expressed in. */
export function targetDomain(type) {
    const hit = TARGET_DOMAINS.find(([test]) => test(type));
    return hit ? hit[1] : 'fraction';
}
