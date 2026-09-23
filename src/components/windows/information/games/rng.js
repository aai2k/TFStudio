/**
 * Seeded random numbers for the games (mulberry32), so a run can be
 * reproduced: the window seeds from the clock, tests from a constant.
 */

export function makeRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A whole number in [lo, hi]. */
export function rngInt(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
}
