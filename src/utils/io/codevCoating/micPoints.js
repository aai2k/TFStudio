// How far a straight line between rows a and b misses row m, in n or k,
// whichever is larger.
function lineMiss(a, b, m) {
    const f = (m[0] - a[0]) / (b[0] - a[0]);
    const n = a[1] + f * (b[1] - a[1]);
    const k = a[2] + f * (b[2] - a[2]);
    return Math.max(Math.abs(m[1] - n), Math.abs(m[2] - k));
}

// The row between two kept neighbours that a straight line misses most.
function worstRow(rows, kept) {
    let worst = { index: -1, miss: 0 };
    for (let s = 0; s + 1 < kept.length; s++) {
        const a = kept[s], b = kept[s + 1];
        for (let i = a + 1; i < b; i++) {
            const miss = lineMiss(rows[a], rows[b], rows[i]);
            if (miss > worst.miss) worst = { index: i, miss };
        }
    }
    return worst.index;
}

/**
 * Choose at most `max` of the [λ_nm, n, k] rows (ascending λ) for a MIC table.
 *
 * A table of `max` rows or fewer is kept whole. A longer one keeps both ends,
 * then adds, one at a time, the row that a straight line between its kept
 * neighbours misses by the most in n or k, so the points gather where the
 * material bends (an absorption edge) and thin out where it is flat. It stops
 * early once every dropped row lies on a line between kept ones.
 */
export function pickMicRows(rows, max) {
    if (rows.length <= max) return rows.slice();
    const kept = [0, rows.length - 1];
    while (kept.length < max) {
        const index = worstRow(rows, kept);
        if (index < 0) break;
        kept.push(index);
        kept.sort((a, b) => a - b);
    }
    return kept.map(i => rows[i]);
}
