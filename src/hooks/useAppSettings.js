/**
 * Everything the app keeps in settings.json and the preferences file: the
 * palette and the themes imported into it, the language, the ribbon style, the
 * two opt-out toggles, the quick-access list and the analysis-window defaults.
 *
 * The saved values are read once on mount, and settings.json is written back
 * whenever one of them changes, but only after the read has finished, or the
 * defaults of the first frame would be saved over what the user had.
 */

import { getPalette, registerCustomThemes } from '../constants/colorPalettes.js';
import { getLocale, getCurrentLocale, saveLocale } from '../constants/locales/index.js';
import { parseVscodeTheme } from '../utils/theme/vscodeTheme.js';
import {
    cachedAppearance, initialTheme, applyPaletteVariables, uniqueThemeName,
} from '../utils/theme/appearance.js';
import { readAppSettings, writeAppSettings, readPreferences } from '../utils/io/settingsFile.js';
import { bootstrapTmmWasm } from '../utils/physics/tmmWasmBootstrap.js';
import { initTmmWasmMainThread } from '../tmmcore.js';

const { useState, useEffect, useCallback } = React;

// Apply what the settings file named, leaving anything it did not name on the
// value the app started with.
function applyLoadedSettings(loaded, set) {
    if (!loaded) return;
    // Imported themes are registered BEFORE the theme name is applied, so a
    // custom theme resolves on the very first paint (no default-theme flash).
    if (loaded.customThemes) {
        registerCustomThemes(loaded.customThemes);
        set.customThemes(loaded.customThemes);
    }
    if (loaded.theme)       set.theme(loaded.theme);
    if (loaded.locale)      set.locale(loaded.locale);
    if (loaded.ribbonStyle) set.ribbonStyle(loaded.ribbonStyle);
    set.wasmTmm(loaded.wasmTmm);
    set.updateCheckEnabled(loaded.updateCheckEnabled);
    if (loaded.skippedVersion !== null) set.skippedVersion(loaded.skippedVersion);
}

export function useAppSettings(setMessageNotification) {
    const [theme,          setTheme]          = useState(initialTheme);
    // Imported VS Code themes: { [name]: paletteObject }. Registered into the
    // palette module so getPalette()/getPaletteNames() see them like built-ins,
    // and persisted in settings.json alongside the selected theme name.
    const [customThemes,   setCustomThemes]   = useState(() => cachedAppearance().customThemes || {});
    const [locale,         setLocaleState]    = useState(getCurrentLocale());
    // Ribbon appearance: 'minimalist' (default) keeps ribbon + docking-tab icons
    // monochrome; 'colorful' tints them by group hue.
    const [ribbonStyle,    setRibbonStyle]    = useState(
        () => cachedAppearance().ribbonStyle || 'minimalist');
    // WASM TMM acceleration. ON by default (opt-out): a missing persisted
    // setting is treated as enabled; only an explicit `false` disables it.
    // Toggled in Settings; flips the runtime flag (main thread + worker
    // broadcasts) and persists via the settings effect below. If the .wasm
    // artifact is missing it silently falls back to JS regardless.
    const [wasmTmm,        setWasmTmmState]   = useState(true);
    // Update check. On by default (opt-out): the request is an unauthenticated
    // GET to a public API that sends no identifiers and stores nothing, and the
    // toggle exists for restricted networks.
    const [updateCheckEnabled, setUpdateCheckEnabled] = useState(true);
    const [skippedVersion, setSkippedVersion] = useState(null);
    const [appVersion,     setAppVersion]     = useState('');
    const [devAllowed,     setDevAllowed]     = useState(true);  // dev-only View items (Reload/DevTools)
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    // Analysis-window display overrides as stored in the preferences file;
    // resolved against the factory registry by AnalysisSettingsProvider.
    const [analysisSettings, setAnalysisSettings] = useState(null);
    // null until the preferences file is read, and again if the user has never
    // chosen: the title bar falls back to its own default list.
    const [quickAccess,    setQuickAccessState] = useState(null);

    const t = getLocale(locale);
    // Register imported themes into the palette module before resolving `c` so a
    // custom theme name resolves this same render (useMemo runs in render order).
    React.useMemo(() => registerCustomThemes(customThemes), [customThemes]);
    const c = getPalette(theme);

    useEffect(() => {
        // Readiness is released whatever the read does: the update check and the
        // settings write both wait on it.
        readAppSettings().catch(() => null).then(loaded => {
            applyLoadedSettings(loaded, {
                customThemes: setCustomThemes, theme: setTheme, locale: setLocaleState,
                ribbonStyle: setRibbonStyle, wasmTmm: setWasmTmmState,
                updateCheckEnabled: setUpdateCheckEnabled, skippedVersion: setSkippedVersion,
            });
            setSettingsLoaded(true);
        });
        readPreferences().then(prefs => {
            setAnalysisSettings(prefs.analysis);
            setQuickAccessState(prefs.quickAccess);
        });
        bootstrapTmmWasm();
        window.electronAPI?.getDevAllowed?.().then(v => setDevAllowed(v !== false)).catch(() => {});
        window.electronAPI?.getAppVersion?.().then(v => setAppVersion(v || '')).catch(() => {});
    }, []);

    const saveSettingsToDisk = () => writeAppSettings({
        theme, locale, wasmTmm, ribbonStyle, customThemes,
        updateCheckEnabled, skippedVersion,
        // The colour the window frame paints with. Electron fills a newly
        // exposed area during a resize, and the whole window before the first
        // frame, with the window's own background, so it has to be the theme's
        // or both flash the wrong colour.
        windowBackground: c.bg,
    });

    useEffect(() => {
        if (settingsLoaded) saveSettingsToDisk();
    }, [settingsLoaded, theme, locale, wasmTmm, ribbonStyle, customThemes, updateCheckEnabled, skippedVersion]);

    useEffect(() => { applyPaletteVariables(c); }, [c]);

    const setLocale = (newLocale) => { setLocaleState(newLocale); saveLocale(newLocale); };

    // Toggle WASM acceleration: update UI state + apply at runtime (instantiate
    // on first enable, reuse the loaded bytes thereafter). Persists via effect.
    const setWasmTmm = (on) => { setWasmTmmState(on); initTmmWasmMainThread(null, on); };

    // Written straight through rather than on a debounce: the list changes one
    // button at a time, and it has to survive the app being closed right after.
    const setQuickAccess = useCallback((toolIds) => {
        setQuickAccessState(toolIds);
        window.electronAPI?.saveQuickAccess?.(toolIds);
    }, []);

    // ── Import a VS Code colour theme ──────────────────────────────────────────
    // Picks a .json/.jsonc theme file, maps it onto a TFStudio palette, registers
    // + persists it, and switches to it. Name collisions get a numeric suffix so
    // re-importing never clobbers a built-in or a prior import.
    const importThemeFromVscode = useCallback(async () => {
        try {
            const res = await window.electronAPI?.importVscodeTheme?.();
            if (!res || res.canceled) return;
            if (!res.success) { setMessageNotification({ type: 'error', message: res.error || t.settings.themeImportError }); return; }
            const { name, palette } = parseVscodeTheme(res.text, res.fileName);
            const finalName = uniqueThemeName(name, customThemes);
            const next = { ...customThemes, [finalName]: palette };
            registerCustomThemes(next);
            setCustomThemes(next);
            setTheme(finalName);
            setMessageNotification({ type: 'success', message: t.settings.themeImportOk(finalName) });
        } catch (err) {
            setMessageNotification({ type: 'error', message: (t.settings.themeImportError || 'Import failed') + ': ' + err.message });
        }
    }, [customThemes, t, setMessageNotification]);

    // Remove an imported theme; if it was active, fall back to the default Light.
    const deleteCustomTheme = useCallback((name) => {
        setCustomThemes((prev) => {
            if (!prev[name]) return prev;
            const next = { ...prev };
            delete next[name];
            registerCustomThemes(next);
            return next;
        });
        if (theme === name) setTheme('Light');
    }, [theme]);

    return {
        c, t,
        theme, setTheme, locale, setLocale, ribbonStyle, setRibbonStyle,
        customThemes, importThemeFromVscode, deleteCustomTheme,
        wasmTmm, setWasmTmm,
        updateCheckEnabled, setUpdateCheckEnabled, skippedVersion, setSkippedVersion,
        appVersion, devAllowed, settingsLoaded,
        analysisSettings, quickAccess, setQuickAccess,
    };
}
