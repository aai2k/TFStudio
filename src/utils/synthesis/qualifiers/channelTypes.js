/**
 * Channel (T/R/A) and MF-operand-type helpers shared by qualifier evaluation
 * and MF generation.
 */

// Map qualifier `channel` (T/R/A) + λ-mode (single/avg) → MF operand type.
// Polarization rides on the operand's `pol` field (avg/s/p), not the type code,
// so these return the base type only (no S/P suffix). The caller always passes
// `pol` to makeOperand.
export function singleType(ch /*, pol */) { return ch; }
export function avgType(ch /*, pol */) { return ch + 'AV'; }

// Worst-case soft-min / soft-max operand type for a channel.
//   direction 'min' → T/R/A MN (worst-case minimum, e.g. "min T over band")
//   direction 'max' → T/R/A MX (worst-case maximum, e.g. "max R over band")
export function minmaxType(ch, direction) {
    return ch + (direction === 'min' ? 'MN' : 'MX');
}

export function argwaveType(direction, ch, pol) {
    // Polarization is carried by the operand's `pol` field (not the type code),
    // so argwave types are just MXW{T|R|A} / MNW{T|R|A}. (The S/P-suffixed
    // variants were removed — see ARGWAVE_OPERAND_TYPES in optimizer.js.)
    return (direction === 'min' ? 'MNW' : 'MXW') + ch;
}

// Resolve channel from a qualifier kind that hard-encodes it.
export function channelFromKind(kind) {
    if (kind === 'T_AT' || kind === 'T_AVG') return 'T';
    if (kind === 'R_AT' || kind === 'R_AVG') return 'R';
    if (kind === 'A_AT' || kind === 'A_AVG') return 'A';
    return null;
}
