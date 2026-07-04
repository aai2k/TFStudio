/**
 * usePersistentNumber — useState for a numeric setting, backed by localStorage.
 *
 * Synthesis windows (Needle / Gradual Evolution) unmount when the user switches
 * tools, which would reset plain useState settings to their defaults. Backing
 * them with localStorage makes a user's edits survive window switches (and app
 * restarts).
 *
 * Returns [value, setValue, fromStorage]:
 *   • setValue(n) writes through to localStorage.
 *   • fromStorage is true when the initial value came from a stored entry
 *     (lets callers know a user-set value exists, e.g. to skip a smart default).
 */
const { useState, useCallback, useRef } = React;

export function usePersistentNumber(key, def) {
    const fromStorageRef = useRef(false);
    const [value, setValue] = useState(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw != null) {
                const n = parseFloat(raw);
                if (!isNaN(n) && isFinite(n)) { fromStorageRef.current = true; return n; }
            }
        } catch (_) { /* no localStorage → default */ }
        return def;
    });
    const set = useCallback((n) => {
        setValue(n);
        try { localStorage.setItem(key, String(n)); } catch (_) {}
    }, [key]);
    return [value, set, fromStorageRef.current];
}

/**
 * usePersistentBool — useState for a boolean setting, backed by localStorage.
 * Same rationale as usePersistentNumber (survives window switches / restarts).
 * Stored as '1' / '0'. Returns [value, setValue].
 */
export function usePersistentBool(key, def) {
    const [value, setValue] = useState(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw != null) return raw === '1' || raw === 'true';
        } catch (_) { /* no localStorage → default */ }
        return def;
    });
    const set = useCallback((b) => {
        setValue(b);
        try { localStorage.setItem(key, b ? '1' : '0'); } catch (_) {}
    }, [key]);
    return [value, set];
}
