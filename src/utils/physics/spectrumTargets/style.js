/**
 * Operand-type classification, colour/dash lookup, and marker style shared by
 * the target trace/shape builders. See ../spectrumTargets.js for the overlay
 * conventions this implements.
 */

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
export const OPTICAL_TYPES   = new Set([
    'T','TS','TP','TAV','TGT', 'R','RS','RP','RAV','RGT', 'A','AS','AP','AAV','AGT',
]);

// A band operand spans [λStart, λEnd] (either an average or a per-λ target).
export function isBandType(type) {
    return RANGE_AVG_TYPES.has(type) || RANGE_TARGET_TYPES.has(type);
}

export function operandCurveKey(op) {
    // Range-target / argwave / etc. don't carry an S/P suffix — fall back to op.pol.
    const polSuffix = (op.type.endsWith('S') && !RANGE_TARGET_TYPES.has(op.type)) ? 's'
                    : (op.type.endsWith('P') && !RANGE_TARGET_TYPES.has(op.type)) ? 'p'
                    : (op.pol ?? 'avg');
    if (op.type.startsWith('T')) return polSuffix === 's' ? 'Ts' : polSuffix === 'p' ? 'Tp' : 'T';
    if (op.type.startsWith('R')) return polSuffix === 's' ? 'Rs' : polSuffix === 'p' ? 'Rp' : 'R';
    return 'A';
}

// The R/T/A family of an operand type — used to pick the operand type for a
// newly drawn target and to colour-code markers.
export function operandFamily(type) {
    if (type.startsWith('T')) return 'T';
    if (type.startsWith('R')) return 'R';
    return 'A';
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
export function targetColor(op) { return FAMILY_COLOR[operandFamily(op.type)] || '#aaaaaa'; }
export function targetDash(op) {
    const p = operandPol(op);
    return p === 's' ? 'dot' : p === 'p' ? 'dash' : 'solid';
}

// Above this many single-λ ("point") target markers, the per-marker hover
// tooltips overlap the actual R/T/A curve readout and become unusable
// (e.g. a discrete continuous-target expanded at 1 nm → hundreds of markers).
// Past the threshold we MERGE all same-color point markers into one trace and
// turn OFF hover on them, so the spectrum's own hover stays readable.
export const POINT_TARGET_HOVER_LIMIT = 30;

// Thin X-marker style shared by point + band target markers. Targets are
// marked with X's, using the slim 'x-thin' symbol so
// they don't read as heavy blobs over the R/T/A curves.
export function xMarker(color, size = 8) {
    return { symbol: 'x-thin', size, color, line: { color, width: 1.3 } };
}

// Clamp a target value (fraction). R/T/A are physical 0..1.
export function clampFrac(v) { return Math.min(1, Math.max(0, v)); }
