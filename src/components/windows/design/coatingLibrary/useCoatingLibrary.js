import { useDesign } from '../../../../state/DesignContext.js';
import { BUILTIN_COATINGS } from '../../../../utils/coatingLibrary/builtin/index.js';
import { filterEntries, substratesOf, tagCounts } from '../../../../utils/coatingLibrary/filter.js';
import { applyCoatingPatch } from '../../../../utils/coatingLibrary/applyCoating.js';
import {
    USER_COATINGS_CHANGED, deleteUserCoating, listUserCoatings,
} from '../../../../utils/coatingLibrary/userCoatings.js';
import { useWindowSession } from '../../windowSession.js';
import { coatingLibrarySession } from './sessionState.js';

const { useCallback, useEffect, useMemo, useState } = React;

const numberOrNull = text => (text === '' || text == null ? null : Number(text));

/** State and actions of the Coating Library window. */
export function useCoatingLibrary(ts) {
    const { design, updateDesign, checkpoint } = useDesign();
    const [session, setField] = useWindowSession(coatingLibrarySession, null);
    const [userEntries, setUserEntries] = useState([]);
    const [message, setMessage] = useState('');

    const refreshUser = useCallback(async () => setUserEntries(await listUserCoatings()), []);
    useEffect(() => {
        refreshUser();
        window.addEventListener(USER_COATINGS_CHANGED, refreshUser);
        return () => window.removeEventListener(USER_COATINGS_CHANGED, refreshUser);
    }, [refreshUser]);

    const entries = session.source === 'user' ? userEntries : BUILTIN_COATINGS;

    // Everything but the tag filter, so each tag chip can say how many entries
    // choosing it would leave.
    const narrowed = useMemo(() => filterEntries(entries, {
        query: session.query, type: session.type, substrate: session.substrate,
        lambda: numberOrNull(session.lambda), maxLayers: numberOrNull(session.maxLayers),
    }), [entries, session.query, session.type, session.substrate, session.lambda, session.maxLayers]);
    const visible = useMemo(() => filterEntries(narrowed, { tags: session.tags }), [narrowed, session.tags]);
    const tags = useMemo(() => tagCounts(narrowed), [narrowed]);
    const substrates = useMemo(() => substratesOf(entries), [entries]);

    const selected = visible.find(entry => entry.id === session.selectedId) || null;

    const toggleTag = useCallback(tag => setField('tags', current =>
        (current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])), [setField]);
    const toggleType = useCallback(type => setField('collapsedTypes', current =>
        (current.includes(type) ? current.filter(item => item !== type) : [...current, type])), [setField]);

    const apply = useCallback(() => {
        if (!selected) return;
        const side = session.applySide;
        checkpoint();
        const { patch, clashes } = applyCoatingPatch(design, selected, { side, mode: session.applyMode });
        updateDesign(patch);
        const sideLabel = side === 'back' ? ts.sideBack : ts.sideFront;
        const lines = [ts.applied(selected.layers.length, sideLabel.toLowerCase())];
        if (clashes.length > 0) lines.push(ts.clashes(clashes.join(', ')));
        setMessage(lines.join(' '));
    }, [selected, session.applySide, session.applyMode, design, checkpoint, updateDesign, ts]);

    const remove = useCallback(async () => {
        if (!selected || session.source !== 'user') return;
        if (!window.confirm(ts.confirmDelete(selected.name))) return;
        const result = await deleteUserCoating(selected.name);
        if (result?.success) {
            setField('selectedId', null);
            setMessage(ts.deleted(selected.name));
        }
    }, [selected, session.source, setField, ts]);

    return {
        design, session, setField, entries, visible, tags, substrates, toggleTag, toggleType,
        selected, message, setMessage, apply, remove,
    };
}
