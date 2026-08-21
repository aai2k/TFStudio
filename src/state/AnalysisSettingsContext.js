/**
 * Display defaults for the analysis windows — curve colours and ranges the user
 * configured in Settings.
 *
 * The provider stays mounted at App level, so a window that closes and reopens
 * picks the current values up again at mount. Windows read through
 * `useAnalysisDefaults(windowId)`, which returns values already merged over the
 * factory registry, so a window never has to know whether an override exists.
 */
import {
  resolveAnalysisSettings, setAnalysisOverride, resetAnalysisWindow,
  isAnalysisWindowOverridden, sanitizeAnalysisOverrides,
} from '../utils/analysisSettings.js';
import { applyAnalysisDefaults } from '../utils/windowDefaults.js';

const { createElement: h, createContext, useContext, useState, useCallback, useMemo, useEffect } = React;

const AnalysisSettingsContext = createContext(null);

export const AnalysisSettingsProvider = ({ initial, children }) => {
  const [stored, setStored] = useState(() => sanitizeAnalysisOverrides(initial));
  const [ready, setReady] = useState(initial !== null && initial !== undefined);
  const [saveError, setSaveError] = useState(null);

  // The preferences file is read asynchronously after mount, so the stored
  // block arrives once, after the provider already exists. Adopt it when it
  // does; later edits come through setField and must not be overwritten by this.
  useEffect(() => {
    if (initial === null || initial === undefined) return;
    setStored(sanitizeAnalysisOverrides(initial));
    setReady(true);
  }, [initial]);

  // A change the user can see on screen but that never reached disk is the
  // worst outcome here, so a failed or unavailable write is surfaced rather
  // than swallowed. A missing channel means the preload did not expose it,
  // which happens when the app was reloaded without a full restart.
  const persist = useCallback(async (next) => {
    const save = window.electronAPI?.saveAnalysisSettings;
    if (typeof save !== 'function') {
      setSaveError('unavailable');
      return;
    }
    try {
      const result = await save(next);
      setSaveError(result?.success === false ? (result.error || 'failed') : null);
    } catch (err) {
      setSaveError(err?.message || 'failed');
    }
  }, []);

  // The window session stores read their starting values from the same block,
  // so they are pointed at it whenever it changes: once when the preferences
  // file arrives, and again after every edit here.
  useEffect(() => { applyAnalysisDefaults(stored); }, [stored]);

  const apply = useCallback((transform) => {
    setStored(current => {
      const next = transform(current);
      persist(next);
      return next;
    });
  }, [persist]);

  const setField = useCallback((windowId, section, key, value) => {
    apply(current => setAnalysisOverride(current, windowId, section, key, value));
  }, [apply]);

  const resetWindow = useCallback((windowId) => {
    apply(current => resetAnalysisWindow(current, windowId));
  }, [apply]);

  const resetAll = useCallback(() => apply(() => ({})), [apply]);

  const value = useMemo(() => ({
    stored,
    ready,
    saveError,
    setField,
    resetWindow,
    resetAll,
    isOverridden: (windowId) => isAnalysisWindowOverridden(stored, windowId),
    hasAnyOverride: Object.keys(stored).length > 0,
  }), [stored, ready, saveError, setField, resetWindow, resetAll]);

  return h(AnalysisSettingsContext.Provider, { value }, children);
};

export function useAnalysisSettings() {
  return useContext(AnalysisSettingsContext);
}

/**
 * Resolved defaults for one window: `{ colors, numbers, enums, booleans }`,
 * every field present, overrides already merged over the factory values.
 * Safe outside the provider (tests, isolated renders) — falls back to factory.
 */
export function useAnalysisDefaults(windowId) {
  const context = useContext(AnalysisSettingsContext);
  const stored = context?.stored;
  return useMemo(() => resolveAnalysisSettings(windowId, stored), [windowId, stored]);
}

/** Just the curve colours for one window. */
export function useAnalysisColors(windowId) {
  return useAnalysisDefaults(windowId).colors;
}
