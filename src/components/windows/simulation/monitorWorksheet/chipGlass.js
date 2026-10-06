import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';

/**
 * The witness chip glass a run is computed on.
 *
 * The glass is a session value naming a material outside the design, so the
 * design's missing-material check never sees it: deleting its catalog leaves
 * the value pointing at nothing. A glass that resolves nowhere gives way to the
 * design substrate, which is what an unset glass means, and is returned as
 * `missing` so the window can say which glass it no longer has.
 *
 * Shared by the Monitor Worksheet, the Process Exporter and the Report, which
 * read one chip plan and must agree on the table it gives.
 *
 * @returns {{ chipMaterial: string|null, missing: string|null }}
 */
export function usableChipGlass(design, chipMaterial) {
    if (!chipMaterial) return { chipMaterial: null, missing: null };
    return resolveDesignMaterial(design, chipMaterial).status === 'missing'
        ? { chipMaterial: null, missing: chipMaterial }
        : { chipMaterial, missing: null };
}
