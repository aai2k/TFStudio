/**
 * The branding profile: logo, company line, accent color, footer text and the
 * default designer name. Set once, kept in the Branding folder, used by every
 * report. One module-level copy is shared by every mount of the window.
 */

import { DEFAULT_ACCENT } from '../../../../utils/report/template.js';

export const DEFAULT_BRANDING = Object.freeze({
    company: '', line2: '', accent: DEFAULT_ACCENT, footer: '', designer: '', logoDataUrl: null,
});

let current = { ...DEFAULT_BRANDING };
let loaded = false;
let loading = null;
const listeners = new Set();

function notify() { for (const fn of listeners) fn(current); }

function sanitize(raw) {
    const out = { ...DEFAULT_BRANDING };
    if (!raw || typeof raw !== 'object') return out;
    for (const key of ['company', 'line2', 'footer', 'designer']) {
        if (typeof raw[key] === 'string') out[key] = raw[key];
    }
    if (/^#[0-9a-fA-F]{6}$/.test(raw.accent || '')) out.accent = raw.accent;
    if (typeof raw.logoDataUrl === 'string' && raw.logoDataUrl.startsWith('data:image/')) out.logoDataUrl = raw.logoDataUrl;
    return out;
}

/** Read the profile from disk once; later calls return the same promise. */
export function loadBranding() {
    if (loaded) return Promise.resolve(current);
    if (!loading) {
        loading = Promise.resolve(window.electronAPI?.loadReportBranding?.())
            .then(r => { if (r?.success && r.branding) current = sanitize(r.branding); })
            .catch(() => {})
            .then(() => { loaded = true; notify(); return current; });
    }
    return loading;
}

/** Change the profile in memory; every open window sees it at once. */
export function updateBranding(patch) {
    current = sanitize({ ...current, ...patch });
    notify();
    return current;
}

/** Write the profile to the Branding folder. */
export async function saveBranding() {
    const r = await window.electronAPI?.saveReportBranding?.(current);
    if (!r?.success) throw new Error(r?.error || 'save failed');
}

/** The profile as React state, loaded on first use. */
export function useBranding() {
    const { useEffect, useState } = React;
    const [branding, setBranding] = useState(current);
    useEffect(() => {
        listeners.add(setBranding);
        loadBranding();
        return () => listeners.delete(setBranding);
    }, []);
    return branding;
}
