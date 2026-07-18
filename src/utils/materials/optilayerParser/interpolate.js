/** Linear-interpolate a [[x, y], …] table (x ascending). */
export function interp(table, x, yi) {
    if (!table.length) return null;
    if (x <= table[0][0]) return table[0][yi];
    if (x >= table[table.length - 1][0]) return table[table.length - 1][yi];
    let lo = 0, hi = table.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid][0] <= x) lo = mid; else hi = mid;
    }
    const t = (x - table[lo][0]) / (table[hi][0] - table[lo][0]);
    return table[lo][yi] + t * (table[hi][yi] - table[lo][yi]);
}
