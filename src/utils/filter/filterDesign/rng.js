/**
 * Small deterministic PRNG for the integer search's multistart.
 *
 * The search is stochastic, so without a seed the same design gives a different
 * answer every run, which is no use in a design tool. Seeding it from the
 * specification and the run number makes a whole session reproducible while
 * still letting a second Start explore somewhere new.
 *
 * mulberry32: 32-bit state, uniform on [0, 1).
 */
export function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/** 32-bit hash of a string, for turning a design signature into a seed. */
export function hashSeed(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h | 0;
}
