import { createPchipInterpolator } from '../pchip.js';

/** PCHIP-interpolate one column of a [[x, ...], ...] table. */
export function interp(table, x, yi) {
    const interpolate = createPchipInterpolator((table || []).map(row => [row[0], row[yi]]));
    return interpolate ? interpolate(x) : null;
}
