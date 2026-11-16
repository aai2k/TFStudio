/**
 * usePersistentNumber — useState for a numeric setting, backed by localStorage.
 *
 * Synthesis windows (Needle / Gradual Evolution) unmount when the user switches
 * tools, which would reset plain useState settings to their defaults. Backing
 * them with localStorage makes a user's edits survive window switches (and app
 * restarts).
 *
 * Returns [value, setValue]; setValue(n) writes through to localStorage.
 */
const { useState, useCallback } = React;

export function usePersistentNumber(key, def) {
    const [value, setValue] = useState(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw != null) {
                const n = parseFloat(raw);
                if (!isNaN(n) && isFinite(n)) return n;
            }
        } catch (_) { /* no localStorage → default */ }
        return def;
    });
    const set = useCallback((n) => {
        setValue(n);
        try { localStorage.setItem(key, String(n)); } catch (_) {}
    }, [key]);
    return [value, set];
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
