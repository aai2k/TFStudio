/**
 * Classify a material pool into index roles at λ0.
 *
 * @param {Array}  pool        [{ id, name, mat }] — mat has getNK(λ_nm)→[n,k]
 * @param {number} lambda0     reference wavelength (nm)
 * @returns {{ low, med, high, byN }}  role → { id, name, n } (med null if <3 mats);
 *                                     byN = all pool entries sorted ascending n.
 */
export function classifyPoolByIndex(pool, lambda0) {
    const withN = (pool || [])
        .map(p => {
            const nk = p.mat?.getNK?.(lambda0);
            const n = Array.isArray(nk) ? nk[0] : (typeof nk === 'number' ? nk : NaN);
            return { id: p.id, name: p.name || p.id, n };
        })
        .filter(p => Number.isFinite(p.n) && p.n > 0)
        .sort((a, b) => a.n - b.n);
    if (withN.length === 0) return { low: null, med: null, high: null, byN: [] };
    const low = withN[0];
    const high = withN[withN.length - 1];
    // Middle role = the entry closest to the geometric mean of low/high (the
    // classic intermediate-index choice for a QHQ middle/quarter layer).
    let med = null;
    if (withN.length >= 3) {
        const target = Math.sqrt(low.n * high.n);
        med = withN.reduce((best, p) =>
            (best === null || Math.abs(p.n - target) < Math.abs(best.n - target)) ? p : best, null);
    }
    return { low, med, high, byN: withN };
}
