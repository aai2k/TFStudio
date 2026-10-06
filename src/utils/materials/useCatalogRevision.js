import { CATALOGS_CHANGED } from './catalogManager.js';

// Both ways the catalogs can change under a window that has already read them:
// the asynchronous startup scan finishing, and any later edit.
const CATALOG_EVENTS = ['catalogs-loaded', CATALOGS_CHANGED];

/**
 * A counter that changes whenever the material catalogs do.
 *
 * A window computes from material data but is mounted against a design, so
 * nothing about editing a material reaches it: the design is untouched and its
 * memo never reruns, leaving the old numbers on screen until the window is
 * closed and opened again. Taking this as a dependency is what closes that.
 *
 * The hooks are read from React when this runs rather than when the module
 * loads: the hook is shared by many modules, and one of them may load it while
 * a different React stands in (the tests' hook harness).
 */
export function useCatalogRevision() {
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => {
        const bump = () => setRevision(value => value + 1);
        for (const event of CATALOG_EVENTS) window.addEventListener(event, bump);
        return () => {
            for (const event of CATALOG_EVENTS) window.removeEventListener(event, bump);
        };
    }, []);
    return revision;
}
