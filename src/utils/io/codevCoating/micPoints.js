import { micCurve } from './micIndex.js';

// A miss CODE V cannot be told apart from the written table: half a unit in
// the sixth decimal, the precision n and k are written with.
const WRITTEN_MISS = 5e-7;

// The row CODE V's interpolation of the kept rows misses most, in n or k,
// with that miss.
function worstRow(rows, kept) {
    const curve = micCurve(kept.map(i => rows[i]));
    let worst = { index: -1, miss: 0 };
    rows.forEach(([lam, n, k], index) => {
        const miss = Math.max(Math.abs(curve.n(lam) - n), Math.abs(curve.k(lam) - k));
        if (miss > worst.miss) worst = { index, miss };
    });
    return worst;
}

/**
 * Choose at most `max` of the [λ_nm, n, k] rows (ascending λ) for a MIC table.
 *
 * A table of `max` rows or fewer is kept whole. A longer one keeps both ends,
 * then adds, one at a time, the row that CODE V's interpolation of the rows
 * kept so far (micIndex.js) misses by the most in n or k, so the points
 * gather where the material bends and thin out where CODE V's curve already
 * follows it. It stops early once no row is missed by more than half a unit
 * in the sixth decimal.
 */
export function pickMicRows(rows, max) {
    if (rows.length <= max) return rows.slice();
    const kept = [0, rows.length - 1];
    while (kept.length < max) {
        const worst = worstRow(rows, kept);
        if (worst.miss <= WRITTEN_MISS) break;
        kept.push(worst.index);
        kept.sort((a, b) => a - b);
    }
    return kept.map(i => rows[i]);
}
