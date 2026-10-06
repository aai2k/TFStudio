import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { useCatalogRevision } from '../../../../utils/materials/useCatalogRevision.js';

const { useMemo } = React;

/**
 * The material Material Dispersion plots, or `missing` when it resolves
 * nowhere.
 *
 * The picker offers the open design's own materials, including definitions that
 * travelled inside a .tfs and exist in no local catalog, so the id is resolved
 * through the design. It is resolved again on every catalog change: the picked
 * material is usually not in the design, so editing or deleting it in the
 * Material Editor changes nothing the design would pass on.
 *
 * @returns {{ material: object|null, missing: boolean }}
 */
export function useDispersionMaterial(design, materialId) {
    const catalogRevision = useCatalogRevision();
    return useMemo(() => {
        const resolved = resolveDesignMaterial(design, materialId);
        return resolved.status === 'missing'
            ? { material: null, missing: true }
            : { material: resolved.material, missing: false };
    }, [design, materialId, catalogRevision]);
}
