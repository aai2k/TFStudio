/**
 * Tells the user about catalog files the program could not write, delete or
 * read, and asks before a catalog save replaces a material another copy of
 * TFStudio changed.
 *
 * A catalog edit takes effect in memory at once and is written to its file in
 * the background (see persistCatalog). When that write fails, the edit looks
 * saved but is gone after a restart, and a failed delete brings the catalog
 * back. A catalog file that cannot be read at startup is left out of every
 * list. Each of these is shown as one error notification.
 *
 * Mount once, in the app shell: `useCatalogSaveFailures(t, setMessageNotification, setInputDialog)`.
 */

import { CATALOG_SAVE_FAILED, CATALOG_EDIT_CLASH } from './catalogManager/persistence.js';

const { useEffect, useRef } = React;

/** The message for one CATALOG_SAVE_FAILED detail. */
export function catalogFailureMessage({ name, action, error }, me) {
    return action === 'delete' ? me.catalogDeleteFailed(name, error) : me.catalogSaveFailed(name, error);
}

/**
 * @param {Object} t  the locale
 * @param {(note: {type: 'error', message: string}) => void} notify  shows one notification
 * @param {(dialog: Object|null) => void} ask  shows a confirm dialog, or closes it given null
 */
export function useCatalogSaveFailures(t, notify, ask) {
    // The listeners stay mounted for the app's life; a language change or a new
    // notify function reaches them through the ref.
    const latest = useRef({ t, notify, ask });
    latest.current = { t, notify, ask };

    useEffect(() => {
        const show = message => latest.current.notify({ type: 'error', message });
        const onFailed = event => show(catalogFailureMessage(event.detail || {}, latest.current.t.materialEditor));
        const onLoaded = event => {
            const unreadable = event.detail?.unreadable;
            if (unreadable?.length) show(latest.current.t.materialEditor.catalogFilesUnreadable(unreadable.join(', ')));
        };
        const onClash = event => {
            const { name, answer } = event.detail;
            const { t: locale, ask: open } = latest.current;
            const reply = replace => { open(null); answer(replace); };
            open({
                confirm: true, danger: true,
                title: locale.dialogs.changedOnDisk.title,
                message: locale.materialEditor.materialChangedElsewhere(name),
                confirmLabel: locale.materialEditor.replaceChangedMaterial,
                onConfirm: () => reply(true),
                onCancel: () => reply(false),
            });
        };
        window.addEventListener(CATALOG_SAVE_FAILED, onFailed);
        window.addEventListener('catalogs-loaded', onLoaded);
        window.addEventListener(CATALOG_EDIT_CLASH, onClash);
        return () => {
            window.removeEventListener(CATALOG_SAVE_FAILED, onFailed);
            window.removeEventListener('catalogs-loaded', onLoaded);
            window.removeEventListener(CATALOG_EDIT_CLASH, onClash);
        };
    }, []);
}
