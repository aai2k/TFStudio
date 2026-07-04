/**
 * Variator helpers — pure functions (no React, no global state) so they can
 * be unit-tested. Used by `src/components/windows/Variator.js`.
 *
 * For dispersive materials, n,k variations are applied as constant offsets
 * added to the spectral n(λ), k(λ) — that's what wrapMaterial implements. k is
 * clamped to ≥ 0 (Macleod §2.2; absorption can't go negative).
 */

/**
 * Returns a material wrapper that exposes getNK(λ) → [n + dn, max(0, k + dk)].
 * If both offsets are ~0, returns the base material unchanged so consumers
 * can rely on object-identity for hot-path caching.
 *
 * @param {{id?:string, name?:string, color?:string, getNK:(lam:number)=>[number,number]}} base
 * @param {number} dn   refractive-index offset (added to n)
 * @param {number} dk   extinction offset (added to k, then clamped to ≥ 0)
 * @returns {object|null}
 */
export function wrapMaterial(base, dn, dk) {
    if (!base || typeof base.getNK !== 'function') return base;
    if (Math.abs(dn) < 1e-12 && Math.abs(dk) < 1e-12) return base;
    return {
        id:    (base.id || 'mat') + "'",
        name:  (base.name || base.id || 'mat') +
               " (Δn=" + dn.toFixed(3) + ", Δk=" + dk.toFixed(4) + ")",
        color: base.color,
        getNK: (lam) => {
            const nk = base.getNK(lam);
            return [nk[0] + dn, Math.max(0, nk[1] + dk)];
        }
    };
}

/**
 * Slider half-range for a layer thickness, in nm. Picks ≥ ±20 nm to keep the
 * range usable on very thin layers, otherwise scales with the layer so thick
 * layers have proportionally more room.
 */
export function thicknessRangeNm(baseNm) {
    const half = Math.max(20, baseNm * 0.2);
    return { min: -half, max: half };
}
