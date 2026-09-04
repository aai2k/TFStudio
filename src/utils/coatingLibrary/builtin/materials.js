/**
 * The materials built-in coatings carry with them.
 *
 * A built-in entry may use a material outside the built-in library, for
 * example a zirconia film or a soda lime glass. Its definition then travels
 * inside the entry (the `materials` block of entryModel.js) so the coating
 * resolves on any installation. Every such definition lives here exactly once:
 * an entry names the ids it needs through embedded(), and two entries that
 * share an id share the same record. That is what lets a coating applied to a
 * design after another one that uses the same material compute with the data
 * its preview was made with; applyCoating.js keeps the design's first meaning
 * of an id.
 *
 * The records are generated from the refractiveindex.info database by
 * tools/gen_coating_materials.mjs into ./materialData.js.
 */
import { EMBEDDED_MATERIAL_DATA } from './materialData.js';

/** Material id to its one definition. */
export const EMBEDDED_MATERIALS = Object.freeze(Object.fromEntries(
    Object.entries(EMBEDDED_MATERIAL_DATA).map(([id, record]) => [id, Object.freeze(record)])));

/**
 * The definitions for `ids`, in the shape of an entry's `materials` block.
 * Throws on an id the table does not hold, so a misspelt id in a family file
 * fails when the module loads rather than when the coating is applied.
 */
export function embedded(...ids) {
    const block = {};
    for (const id of ids) {
        const record = EMBEDDED_MATERIALS[id];
        if (!record) throw new Error(`No embedded material "${id}" in the coating library`);
        block[id] = record;
    }
    return block;
}
