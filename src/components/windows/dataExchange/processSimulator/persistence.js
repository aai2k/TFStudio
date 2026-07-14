const PERSIST_KEY = 'tfstudio-process-sim-v1';

export function loadPersist() {
    let persisted = {};
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (raw) {
            const value = JSON.parse(raw);
            persisted = value && typeof value === 'object' ? value : {};
        }
    } catch (_) {}
    return persisted;
}

export function savePersist(patch) {
    try {
        const previous = loadPersist();
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...previous, ...patch }));
    } catch (_) {}
}
