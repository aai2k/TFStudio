/**
 * Deviation spec — the plain-object shape that describes a systematic
 * perturbation (thickness scale/offset + Δn/Δk, global and per-material) plus
 * the helpers to construct, clone, and inspect one.
 */

/**
 * Empty (no-op) deviation. Applying this to a design returns the unperturbed
 * spectrum bit-identically.
 *
 *   globalDeltaN          : added to n(λ) of every layer material
 *   globalDeltaK          : added to k(λ) of every layer material (clamped ≥ 0 in wrapMaterial)
 *   globalThicknessScale  : multiplies every layer's physical thickness
 *   globalThicknessOffset : a FLAT thickness offset ADDED to every layer after
 *                           the scale, expressed in `globalThicknessOffsetUnit`.
 *   globalThicknessOffsetUnit : 'nm' (physical) | 'ot' (optical thickness, nm) |
 *                           'qw' (quarter-waves @ λ₀) | 'fw' (full-waves @ λ₀).
 *                           For ot/qw/fw the optical offset is converted to a
 *                           physical Δd per layer via the layer material's
 *                           n(λ₀) (λ₀ = design.referenceWavelength). This means
 *                           a fixed optical offset maps to a DIFFERENT physical
 *                           nm in each material — exactly what "the run is 1 QW
 *                           long everywhere" physically means.
 *   perMaterial[matId]    : { dn, dk, dScale, dOffset, dOffsetUnit } — combined
 *                           ADDITIVELY for n/k, MULTIPLICATIVELY for the scale,
 *                           and ADDITIVELY (in physical nm, after unit
 *                           conversion) for the offset with the global values,
 *                           so users can express "everything ran 2 % thick, but
 *                           TiO2 also overshot by +3 nm".
 *
 * Final thickness per layer:  d' = max(0, d·scale + offset_phys)
 *   scale      = globalThicknessScale · perMaterial.dScale
 *   offset_phys = toPhysNm(globalOffset) + toPhysNm(perMaterial.dOffset)
 */
export function emptyDeviation() {
    return {
        globalDeltaN: 0,
        globalDeltaK: 0,
        globalThicknessScale: 1.0,
        globalThicknessOffset: 0,
        globalThicknessOffsetUnit: 'nm',
        perMaterial: {},
    };
}

// Thickness-offset units. 'nm' is a direct physical offset; the rest are
// OPTICAL and convert to physical nm using the layer material's n at λ₀:
//   ot : value is an optical-thickness offset Δ(n·d) in nm   → Δd = value / n
//   qw : value is in quarter-waves   (1 QW optical = λ₀/4)   → Δd = value·λ₀/(4n)
//   fw : value is in full-waves      (1 FW optical = λ₀)     → Δd = value·λ₀/n
// (QWOT convention matches the rest of the codebase: QWOT = 4·n·d / λ₀.)
export const THICKNESS_OFFSET_UNITS = ['nm', 'ot', 'qw', 'fw'];

export function offsetToPhysicalNm(value, unit, nAtRef, lamRef) {
    if (!value) return 0;
    switch (unit) {
        case 'ot': return nAtRef > 0 ? value / nAtRef : 0;
        case 'qw': return nAtRef > 0 ? (value * lamRef) / (4 * nAtRef) : 0;
        case 'fw': return nAtRef > 0 ? (value * lamRef) / nAtRef : 0;
        case 'nm':
        default:   return value;
    }
}

// True when the deviation has any optical-unit (ot/qw/fw) thickness offset, so
// callers know they must look up n(λ₀) per layer (a plain 'nm' offset doesn't).
export function needsRefIndex(dev) {
    const opt = (u) => u === 'ot' || u === 'qw' || u === 'fw';
    if ((dev?.globalThicknessOffset || 0) && opt(dev?.globalThicknessOffsetUnit)) return true;
    if (dev?.perMaterial) {
        for (const k of Object.keys(dev.perMaterial)) {
            const v = dev.perMaterial[k] || {};
            if ((v.dOffset || 0) && opt(v.dOffsetUnit)) return true;
        }
    }
    return false;
}

/**
 * Deep-clone a deviation spec — used by the sweep so we don't mutate the
 * caller's baseline while stepping a parameter.
 */
export function cloneDeviation(dev) {
    const out = emptyDeviation();
    if (!dev) return out;
    out.globalDeltaN = dev.globalDeltaN || 0;
    out.globalDeltaK = dev.globalDeltaK || 0;
    out.globalThicknessScale = (dev.globalThicknessScale ?? 1);
    out.globalThicknessOffset = dev.globalThicknessOffset || 0;
    out.globalThicknessOffsetUnit = dev.globalThicknessOffsetUnit || 'nm';
    if (dev.perMaterial) {
        for (const k of Object.keys(dev.perMaterial)) {
            const v = dev.perMaterial[k] || {};
            out.perMaterial[k] = {
                dn: v.dn || 0, dk: v.dk || 0, dScale: (v.dScale ?? 1),
                dOffset: v.dOffset || 0, dOffsetUnit: v.dOffsetUnit || 'nm',
            };
        }
    }
    return out;
}

/**
 * Has-any-perturbation check. Useful for the UI to know whether to draw the
 * baseline overlay (skip when dev is identity → both curves coincide anyway).
 */
export function isIdentityDeviation(dev) {
    if (!dev) return true;
    const nonZero  = (x) => Math.abs(x || 0) > 1e-12;         // additive term ≠ 0
    const notUnity = (x) => Math.abs((x ?? 1) - 1) > 1e-12;   // scale factor ≠ 1
    if (nonZero(dev.globalDeltaN) || nonZero(dev.globalDeltaK) ||
        notUnity(dev.globalThicknessScale) || nonZero(dev.globalThicknessOffset)) return false;
    if (dev.perMaterial) {
        for (const k of Object.keys(dev.perMaterial)) {
            const v = dev.perMaterial[k] || {};
            if (nonZero(v.dn) || nonZero(v.dk) || notUnity(v.dScale) || nonZero(v.dOffset)) return false;
        }
    }
    return true;
}
