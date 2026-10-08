/**
 * Refresh all, as the windows see it: the event sent once the project folders
 * and the material catalogs have been read again, a counter that changes with
 * it, and a hook for a window whose result a Run or Generate button produced.
 *
 * DesignContext hands every window a new design object on the event, so a
 * window that computes from the design computes again by itself. A result a
 * button produced does not follow the design, and its window runs the button's
 * work again through useAfterRefreshAll.
 *
 * The hooks are read from React when they run rather than when the module
 * loads, as in useCatalogRevision, so the tests' hook harness can stand in.
 */

export const REFRESH_ALL = 'tfstudio:refresh-all';

/**
 * Tell every window that the files on disk have just been read again.
 * `changedIds` are the designs in memory the refresh changed; DesignContext
 * counts them as edited, so a synthesis window that cached one from before
 * starts again from what was read rather than carrying on from its cache.
 */
export function announceRefreshAll(changedIds = []) {
    window.dispatchEvent(new CustomEvent(REFRESH_ALL, { detail: { changedIds } }));
}

/** A counter that changes on every Refresh all. */
export function useRefreshRevision() {
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => {
        const bump = () => setRevision(value => value + 1);
        window.addEventListener(REFRESH_ALL, bump);
        return () => window.removeEventListener(REFRESH_ALL, bump);
    }, []);
    return revision;
}

/**
 * Runs `action` once after each Refresh all while the window is open, in the
 * render that follows it. The event's updates are batched, so that render
 * already has the refreshed design. The action decides whether its window has
 * a result on screen to produce again.
 */
export function useAfterRefreshAll(action) {
    const revision = useRefreshRevision();
    const seen = React.useRef(revision);
    const actionRef = React.useRef(action);
    actionRef.current = action;
    React.useEffect(() => {
        if (revision === seen.current) return;
        seen.current = revision;
        actionRef.current();
    }, [revision]);
}
