import { createInterpolator } from '../pchip.js';

/** Interpolate one column of a [[x, ...], ...] table under the named rule, PCHIP when none is given. */
export function interp(table, x, yi, rule) {
    const interpolate = createInterpolator((table || []).map(row => [row[0], row[yi]]), rule);
    return interpolate ? interpolate(x) : null;
}
