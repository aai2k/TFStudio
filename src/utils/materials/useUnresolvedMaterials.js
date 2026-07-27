import { unresolvedMaterials } from './designMaterials.js';

const { useEffect, useMemo, useState } = React;

/**
 * Material ids that the design cannot resolve, refreshed when the asynchronous
 * catalog startup scan completes.
 */
export function useUnresolvedMaterials(design) {
    const [catalogRevision, setCatalogRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setCatalogRevision(revision => revision + 1);
        window.addEventListener('catalogs-loaded', refresh);
        return () => window.removeEventListener('catalogs-loaded', refresh);
    }, []);
    return useMemo(() => unresolvedMaterials(design), [design, catalogRevision]);
}
