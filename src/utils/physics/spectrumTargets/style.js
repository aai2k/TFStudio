/**
 * Operand-type classification, colour/dash lookup, and marker style shared by
 * the target trace/shape builders. See ../spectrumTargets.js for the overlay
 * conventions this implements.
 */

import { LOG_MINMAX_OPERAND_TYPES, LOG_OPERAND_TYPES, logOperand } from '../optimizer/logReadings.js';

// Legacy per-curve palette (kept for any external importers). The overlay now
// colours targets by R/T/A *family* and encodes polarization via dash instead,
// so avg / s / p of the same quantity stay clearly distinguishable (they were
// near-identical hues before).
export const CURVE_COLOR = {
    T:  '#4fc3f7',
    R:  '#ef5350',
    A:  '#66bb6a',
    Ts: '#81d4fa',
    Rs: '#ef9a9a',
    Tp: '#0277bd',
    Rp: '#c62828',
};

// Strong, fully-saturated family colours used for ALL polarizations.
export const FAMILY_COLOR = { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' };

export const RANGE_AVG_TYPES    = new Set(['TAV', 'RAV', 'AAV']);
// Continuous per-λ target operands (flat or linear ramp). Drawn as a dotted
// target line (start→end) spanning the band — plus a shaded band zone.
export const RANGE_TARGET_TYPES = new Set(['TGT', 'RGT', 'AGT']);
// The worst-case rows read in dB or density, drawn as one level over their
// band at the percentage it stands for (levels.js).
const LOG_BAND_TYPES = new Set(LOG_MINMAX_OPERAND_TYPES);
export const OPTICAL_TYPES   = new Set([
    'T','TS','TP','TAV','TGT', 'R','RS','RP','RAV','RGT', 'A','AS','AP','AAV','AGT',
    ...LOG_OPERAND_TYPES,
]);

// A band operand spans [λStart, λEnd] (an average, a per-λ target, or a
// worst-case level in dB or density).
export function isBandType(type) {
    return RANGE_AVG_TYPES.has(type) || RANGE_TARGET_TYPES.has(type) || LOG_BAND_TYPES.has(type);
}

// The R/T/A family of an operand type — used to pick the operand type for a
// newly drawn target and to colour-code markers. ODMN is a T row.
export function operandFamily(type) {
    const channel = logOperand(type)?.channel ?? type[0];
    return channel === 'T' || channel === 'R' ? channel : 'A';
}

export function operandCurveKey(op) {
    // Range-target / argwave / etc. don't carry an S/P suffix — fall back to op.pol.
    const polSuffix = (op.type.endsWith('S') && !RANGE_TARGET_TYPES.has(op.type)) ? 's'
                    : (op.type.endsWith('P') && !RANGE_TARGET_TYPES.has(op.type)) ? 'p'
                    : (op.pol ?? 'avg');
    const family = operandFamily(op.type);
    if (family === 'A') return 'A';
    return polSuffix === 's' ? family + 's' : polSuffix === 'p' ? family + 'p' : family;
}

// Polarization of an operand: explicit S/P point types carry it in the suffix,
// everything else uses op.pol.
function operandPol(op) {
    if (op.type.endsWith('S') && !RANGE_TARGET_TYPES.has(op.type)) return 's';
    if (op.type.endsWith('P') && !RANGE_TARGET_TYPES.has(op.type)) return 'p';
    return op.pol ?? 'avg';
}

// Colour = R/T/A family (full saturation). Dash = polarization, mirroring the
// Optical-Evaluation curve convention (avg solid, s dot, p dash).
export function targetColor(op) {
    // A measured block names its channel in a field rather than in its type
    // code, so the type says nothing about which family to colour it.
    const quantity = op.quantity || 'R';
    const family = op.type === 'MCURVE' ? (logOperand(quantity)?.channel ?? quantity) : operandFamily(op.type);
    return FAMILY_COLOR[family] || '#aaaaaa';
}
export function targetDash(op) {
    const p = operandPol(op);
    return p === 's' ? 'dotted' : p === 'p' ? 'dashed' : 'solid';
}

// Above this many single-λ ("point") target markers, the per-marker hover
// tooltips overlap the actual R/T/A curve readout and become unusable
// (e.g. a discrete continuous-target expanded at 1 nm → hundreds of markers).
// Past the threshold we MERGE all same-color point markers into one trace and
// turn OFF hover on them, so the spectrum's own hover stays readable.
export const POINT_TARGET_HOVER_LIMIT = 30;

// Clamp a target value (fraction). R/T/A are physical 0..1.
export function clampFrac(v) { return Math.min(1, Math.max(0, v)); }
