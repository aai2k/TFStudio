/**
 * Tells the user about catalog files the program could not write, delete or
 * read.
 *
 * A catalog edit takes effect in memory at once and is written to its file in
 * the background (see persistCatalog). When that write fails, the edit looks
 * saved but is gone after a restart, and a failed delete brings the catalog
 * back. A catalog file that cannot be read at startup is left out of every
 * list. Each of these is shown as one error notification.
 *
 * Mount once, in the app shell: `useCatalogSaveFailures(t, setMessageNotification)`.
 */

import { CATALOG_SAVE_FAILED } from './catalogManager/persistence.js';

const { useEffect, useRef } = React;

/** The message for one CATALOG_SAVE_FAILED detail. */
export function catalogFailureMessage({ name, action, error }, me) {
    return action === 'delete' ? me.catalogDeleteFailed(name, error) : me.catalogSaveFailed(name, error);
}

/**
 * @param {Object} t  the locale
 * @param {(note: {type: 'error', message: string}) => void} notify  shows one notification
 */
export function useCatalogSaveFailures(t, notify) {
    // The listeners stay mounted for the app's life; a language change or a new
    // notify function reaches them through the ref.
    const latest = useRef({ t, notify });
    latest.current = { t, notify };

    useEffect(() => {
        const show = message => latest.current.notify({ type: 'error', message });
        const onFailed = event => show(catalogFailureMessage(event.detail || {}, latest.current.t.materialEditor));
        const onLoaded = event => {
            const unreadable = event.detail?.unreadable;
            if (unreadable?.length) show(latest.current.t.materialEditor.catalogFilesUnreadable(unreadable.join(', ')));
        };
        window.addEventListener(CATALOG_SAVE_FAILED, onFailed);
        window.addEventListener('catalogs-loaded', onLoaded);
        return () => {
            window.removeEventListener(CATALOG_SAVE_FAILED, onFailed);
            window.removeEventListener('catalogs-loaded', onLoaded);
        };
    }, []);
}
