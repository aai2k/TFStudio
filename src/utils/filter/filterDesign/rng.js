/**
 * Seeding for the integer search's multistart.
 *
 * The search is stochastic, so without a seed the same design gives a different
 * answer every run, which is no use in a design tool. Seeding it from the
 * specification and the run number makes a whole session reproducible while
 * still letting a second Start explore somewhere new.
 *
 * The generator itself is the one the monitoring simulators already use, so a
 * seed means the same stream everywhere in the app; `deriveSeed` turns a base
 * seed plus a run index into the per-run seed.
 */
export { mulberry32, deriveSeed } from '../../monitoring/monitoringSim/rng.js';

/** 32-bit hash of a string, for turning a design signature into a seed. */
export function hashSeed(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h | 0;
}
