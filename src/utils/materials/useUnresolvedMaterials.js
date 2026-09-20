import { unresolvedMaterials } from './designMaterials.js';
import { useCatalogRevision } from './useCatalogRevision.js';

const { useMemo } = React;

/**
 * Material ids that the design cannot resolve, refreshed when the catalogs
 * change: the asynchronous startup scan completing, or a material being saved
 * or deleted.
 */
export function useUnresolvedMaterials(design) {
    const catalogRevision = useCatalogRevision();
    return useMemo(() => unresolvedMaterials(design), [design, catalogRevision]);
}
