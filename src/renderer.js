import { getPalette, getPaletteNames, registerCustomThemes, isBuiltInName } from './constants/colorPalettes.js';
import { parseVscodeTheme } from './utils/theme/vscodeTheme.js';
import { getLocale, getCurrentLocale, saveLocale } from './constants/locales.js';
import { MessageNotification } from './components/ui/MessageNotification.js';
import { TitleBar } from './components/TitleBar.js';
import { MenuBar } from './components/MenuBar.js';
import { Toolbar } from './components/Toolbar.js';
import { ProjectExplorer } from './components/panels/ProjectExplorer.js';
import { updateExplorerItemMtime } from './components/panels/projectExplorerModel.js';
import { DockingLayout } from './components/docking/DockingLayout.js';
import { SettingsModal } from './components/dialogs/settings/SettingsModal.js';
import { InputDialog } from './components/dialogs/InputDialog.js';
import { AboutDialog } from './components/dialogs/AboutDialog.js';
import { FilterDesignWizard } from './components/windows/optimization/filterDesignWizard/FilterDesignWizard.js';
import { BBMWizard } from './components/windows/simulation/bbmWizard/BBMWizard.js';
import { MonoWizard } from './components/windows/simulation/monoWizard/MonoWizard.js';
import { StackFormulaDialog } from './components/windows/design/stackFormula/StackFormulaDialog.js';
import { ReportGenerator } from './components/windows/information/reportGenerator/ReportGenerator.js';
import { WelcomeScreen } from './components/dialogs/WelcomeScreen.js';
import { GuidedTour } from './components/GuidedTour.js';
import { TutorialsBrowser } from './components/dialogs/TutorialsBrowser.js';
import { TutorialPlayer } from './components/TutorialPlayer.js';
import { buildSampleDesigns } from './utils/samples/sampleDesigns.js';
import { buildTutorials } from './utils/samples/tutorials.js';
import { DesignProvider, makeDefaultDesign } from './state/DesignContext.js';
import { AnalysisSettingsProvider } from './state/AnalysisSettingsContext.js';
import { UpdateProvider } from './components/ui/UpdateContext.js';
import { SpectralMonitor } from './components/SpectralMonitor.js';
import { MaterialResolutionModalGuard } from './components/materials/MaterialResolutionModalGuard.js';
import { initCatalogs, addCatalog } from './utils/materials/catalogManager.js';
import { embedDesignMaterials } from './utils/materials/designMaterials.js';
import { parseAGF } from './utils/materials/agfParser.js';
import { initTmmWasmMainThread, tmmWasmActive } from './tmmcore.js';
import { designFileKey, uniqueDesignName } from './utils/io/designNaming.js';
import {
    designsEqual,
    persistThenCommit,
    updateDirtyDesigns,
} from './utils/io/projectPersistence.js';
import { appendDistinctSnapshot } from './utils/history.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── Session persistence ────────────────────────────────────────────────────────
// Saves all in-memory designs to localStorage.
// This is the "working copy" that survives app restarts without an explicit save.
// The .tfs files on disk represent the last explicitly Ctrl+S saved snapshot.
// On startup: session wins over disk; dirty = session differs from disk.

const SESSION_KEY = 'tfstudio-session-v3';
const LEGACY_SESSION_KEY = 'tfstudio-session-v2';
const MAX_HISTORY = 50;
// First-run welcome flag. Set once the user dismisses the welcome
// screen; thereafter the screen only opens from Help ▸ Welcome / Tour.
const WELCOME_SEEN_KEY = 'tfstudio-welcome-seen';
// Completed tutorial keys — JSON array in localStorage.
const TUTORIALS_DONE_KEY = 'tfstudio-tutorials-done';

// ── Session persistence (v3: designs + per-design undo/redo history) ───────────
// History is persisted so undo/redo survives an app restart, per the working-
// copy model already used for unsaved designs.

function loadSession() {
    try {
        let raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.version === 3 && s.designs) {
                return { designs: s.designs, history: s.history || {} };
            }
        }
        // Migrate a v2 session (designs only) forward.
        raw = localStorage.getItem(LEGACY_SESSION_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.version === 2 && s.designs) return { designs: s.designs, history: {} };
        }
    } catch (_) {}
    return null;
}

function saveSession(designs, history) {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 3, designs, history: history || {} }));
    } catch (_) {}
}

// ── Startup folder/design load helpers ──────────────────────────────────────────

// Renderer-side guard against stale duplicate .tfs files sharing an id within a
// folder; main.js cleans these on load, but never trust the input. The design
// payload itself is dropped — the explorer tree only carries id/name/mtime/etc.
function dedupeFolderItems(folder) {
    const seen = new Set();
    const items = [];
    for (const it of (folder.items || [])) {
        if (!it || !it.id || seen.has(it.id)) continue;
        seen.add(it.id);
        const { design: _d, ...rest } = it;
        items.push(rest);
    }
    return { ...folder, items };
}

// Splits an IPC loadFolders() result into the design payloads (keyed by id,
// used as the disk baseline) and the folder tree the explorer renders (which
// never carries a design payload inline).
function parseFoldersResult(result) {
    const diskDesigns = {};
    result.folders.forEach(f => {
        (f.items || []).forEach(item => {
            if (item.design) diskDesigns[item.id] = item.design;
        });
    });
    return { diskDesigns, loadedFolders: result.folders.map(dedupeFolderItems) };
}

// Merges the last-explicit-save snapshot (`diskDesigns`) with any unsaved
// working copies persisted in the session (`sessDesigns`). Session wins — it
// carries the latest edits even across an unclean shutdown — but a design is
// only marked dirty if it actually differs from its disk snapshot.
function mergeSessionOverDisk(diskDesigns, sessDesigns) {
    const initialDesigns = {};
    const initialDirty   = {};

    Object.entries(diskDesigns).forEach(([id, diskDesign]) => {
        const sessionDesign = sessDesigns?.[id];
        if (sessionDesign) {
            initialDesigns[id] = sessionDesign;
            if (!designsEqual(sessionDesign, diskDesign)) initialDirty[id] = true;
        } else {
            initialDesigns[id] = diskDesign;
        }
    });

    // Session-only designs (e.g. created but the disk save failed) have no
    // disk snapshot at all — keep them, flagged dirty.
    if (sessDesigns) {
        Object.entries(sessDesigns).forEach(([id, design]) => {
            if (!initialDesigns[id]) {
                initialDesigns[id] = design;
                initialDirty[id]   = true;
            }
        });
    }

    return { initialDesigns, initialDirty };
}

// Restores per-design undo/redo stacks from the persisted session (best-
// effort; malformed entries are skipped rather than failing the whole load).
function restoreSessionHistory(sessionHistory) {
    const restored = {};
    for (const [id, h] of Object.entries(sessionHistory)) {
        if (!h) continue;
        restored[id] = {
            past:   Array.isArray(h.past)   ? h.past   : [],
            future: Array.isArray(h.future) ? h.future : [],
        };
    }
    return restored;
}

// ── Catalog load helpers ─────────────────────────────────────────────────────

// One-time migration: if no catalog files exist yet, promote any catalogs that
// were previously stored in localStorage (pre-Documents storage) to disk files.
async function migrateLegacyCatalogsFromLocalStorage(persistedCatalogs) {
    const OLD_KEY = 'tf_catalogs';
    try {
        const raw = localStorage.getItem(OLD_KEY);
        if (!raw) return;
        const legacy = JSON.parse(raw);
        for (const cat of Object.values(legacy)) {
            if (cat.id && cat.id !== 'builtin' && window.electronAPI?.saveCatalog) {
                await window.electronAPI.saveCatalog(cat);
                persistedCatalogs[cat.id] = cat;
            }
        }
        localStorage.removeItem(OLD_KEY);
    } catch (_) { /* corrupt legacy data — ignore */ }
}

// Auto-scan Documents\TFStudio\Materials\agf\ for .agf files and register any
// not already present in the persisted catalog set.
async function scanAndRegisterAgfCatalogs(persistedCatalogs) {
    if (!window.electronAPI?.scanAgfDir) return;
    try {
        const agfResult = await window.electronAPI.scanAgfDir();
        if (!agfResult.success) return;
        for (const { name, text } of agfResult.files) {
            const catId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            if (!persistedCatalogs[catId]) {
                addCatalog(parseAGF(text, catId));
            }
        }
    } catch (_) {}
}

// ── Settings load helpers ────────────────────────────────────────────────────

// Drops any imported theme whose name now collides with a shipped built-in
// (e.g. Monokai/One Dark Pro/Quiet Light imported before they became
// built-ins) — the built-in supersedes it.
function pruneBuiltInThemeNames(customThemes) {
    const cleaned = {};
    for (const [name, pal] of Object.entries(customThemes)) {
        if (!isBuiltInName(name)) cleaned[name] = pal;
    }
    return cleaned;
}

// Migrates the old 'Dark Gray (Default)' name (Light is now the default).
function migrateThemeName(name) {
    return name === 'Dark Gray (Default)' ? 'Dark Gray' : name;
}

// ── Design clone/import helpers ──────────────────────────────────────────────

// Assigns fresh, collision-free layer ids under a new design id/timestamp
// (`ts`) so a cloned or imported design can never share an id with its
// source. `side` distinguishes front/back layers in the generated id.
function rekeyLayers(layers, ts, side) {
    return (layers || []).map((l, i) => ({ ...l, id: `l-${ts}-${side}${i}` }));
}

// Single write path for .tfs files. Material definitions are attached here, at
// the boundary, because the catalogs they come from live in the renderer and the
// main process cannot see them.
function writeDesignFile(folderName, design) {
    return window.electronAPI.saveDesign(folderName, embedDesignMaterials(design));
}

function useProjectPersistence(setMessageNotification, t) {
    return useCallback(async (operation, commit, failureMessage) => {
        const result = await persistThenCommit(operation, commit);
        if (!result.success) {
            setMessageNotification({
                type: 'error',
                message: failureMessage || t.dialogs.persistenceFailed,
            });
        }
        return result.success;
    }, [setMessageNotification, t]);
}

// ── App ────────────────────────────────────────────────────────────────────────

const App = () => {
    const [folders,        setFolders]        = useState([]);
    const [selectedItem,   setSelectedItem]   = useState(null);
    const [selectedFolder, setSelectedFolder] = useState(null);
    const [selectedItems,  setSelectedItems]  = useState([]);
    const [lastClickedItem,setLastClickedItem]= useState(null);
    const [showSettings,   setShowSettings]   = useState(false);
    const [showAbout,      setShowAbout]      = useState(false);
    const [devAllowed,     setDevAllowed]     = useState(true);  // dev-only View items (Reload/DevTools)
    const [showFilterDesign,  setShowFilterDesign]  = useState(false);
    const [showBBM,           setShowBBM]           = useState(false);
    const [showMono,          setShowMono]          = useState(false);
    const [showStackFormula, setShowStackFormula] = useState(false);
    const [showReportGen,  setShowReportGen]  = useState(false);
    // First-run welcome screen + guided tour. "Seen" is tracked in
    // localStorage (renderer-local, synchronous — no settings.json load race).
    const [showWelcome,    setShowWelcome]    = useState(false);
    const [showTour,       setShowTour]       = useState(false);
    // Interactive tutorials: browser modal + the active lesson run.
    const [showTutorials,  setShowTutorials]  = useState(false);
    const [activeTutorial, setActiveTutorial] = useState(null);
    const [tutorialsDone,  setTutorialsDone]  = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem(TUTORIALS_DONE_KEY) || '[]')); }
        catch (_) { return new Set(); }
    });
    const [theme,          setTheme]          = useState('Light');
    // Imported VS Code themes: { [name]: paletteObject }. Registered into the
    // palette module so getPalette()/getPaletteNames() see them like built-ins,
    // and persisted in settings.json alongside the selected theme name.
    const [customThemes,   setCustomThemes]   = useState({});
    const [locale,         setLocaleState]    = useState(getCurrentLocale());
    // Ribbon appearance: 'minimalist' (default) keeps ribbon +
    // docking-tab icons monochrome; 'colorful' tints them by group hue.
    const [ribbonStyle,    setRibbonStyle]    = useState('minimalist');
    // WASM TMM acceleration. ON by default (opt-out): a
    // missing persisted setting is treated as enabled; only an explicit `false`
    // disables it. Toggled in Settings; flips the runtime flag (main thread +
    // worker broadcasts) and persists via the settings effect below. If the
    // .wasm artifact is missing it silently falls back to JS regardless.
    const [wasmTmm,        setWasmTmmState]   = useState(true);
    // Analysis-window display overrides as stored in the preferences file;
    // resolved against the factory registry by AnalysisSettingsProvider.
    const [analysisSettings, setAnalysisSettings] = useState(null);
    // Update check. On by default (opt-out): the request is an unauthenticated
    // GET to a public API that sends no identifiers and stores nothing, and the
    // toggle exists for restricted networks.
    const [updateCheckEnabled, setUpdateCheckEnabled] = useState(true);
    const [skippedVersion, setSkippedVersion] = useState(null);
    const [appVersion, setAppVersion] = useState('');
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [inputDialog,    setInputDialog]    = useState(null);
    const [messageNotification, setMessageNotification] = useState(null);
    const [toolRequests,   setToolRequests]   = useState([]);
    const [openWindowIds,  setOpenWindowIds]  = useState([]);
    const [layoutRequest,  setLayoutRequest]  = useState(null);

    // ── Multi-design store ──────────────────────────────────────────────────────
    const [designs,        setDesigns]        = useState({});
    const [activeDesignId, setActiveDesignId] = useState(null);
    const [dirtyDesigns,   setDirtyDesigns]   = useState({});
    // Bumped whenever the past/future stacks change (checkpoint / undo / redo /
    // jump). The History window re-renders off this; the "present" entry moves
    // with `designs` state, so transient previews need no bump.
    const [historyVersion, setHistoryVersion] = useState(0);
    const bumpHistory = useCallback(() => setHistoryVersion(v => (v + 1) % 1e9), []);

    // ── Refs (always-current values for use in callbacks / timers) ─────────────
    const foldersRef      = useRef([]);   // current folders
    const designsRef      = useRef({});   // current in-memory designs
    const historyRef      = useRef({});   // { [id]: { past: [...], future: [...] } }
    const diskDesignsRef  = useRef({});   // last-saved-to-disk snapshot per id (dirty baseline)
    const sessionTimerRef = useRef(null); // debounce for session save

    const t = getLocale(locale);
    // Register imported themes into the palette module before resolving `c` so a
    // custom theme name resolves this same render (useMemo runs in render order).
    React.useMemo(() => registerCustomThemes(customThemes), [customThemes]);
    const c = getPalette(theme);

    const setLocale = (newLocale) => { setLocaleState(newLocale); saveLocale(newLocale); };

    // Toggle WASM acceleration: update UI state + apply at runtime (instantiate
    // on first enable, reuse the loaded bytes thereafter). Persists via effect.
    const setWasmTmm = (on) => { setWasmTmmState(on); initTmmWasmMainThread(null, on); };

    useEffect(() => { foldersRef.current = folders; }, [folders]);
    useEffect(() => { designsRef.current = designs;  }, [designs]);

    useEffect(() => { loadFoldersFromDisk(); loadSettingsFromDisk(); loadPreferencesFromDisk();
        loadCatalogsFromDisk(); bootstrapWasm();
        window.electronAPI?.getDevAllowed?.().then(v => setDevAllowed(v !== false)).catch(() => {});
        window.electronAPI?.getAppVersion?.().then(v => setAppVersion(v || '')).catch(() => {}); }, []);

    // ── First-run welcome ───────────────────────────────────────
    // Show the welcome screen automatically the first time the app is opened.
    // A short delay lets the initial layout settle so it lands over a built UI.
    useEffect(() => {
        let seen = true;
        try { seen = localStorage.getItem(WELCOME_SEEN_KEY) === '1'; } catch (_) {}
        if (!seen) {
            const id = setTimeout(() => setShowWelcome(true), 400);
            return () => clearTimeout(id);
        }
    }, []);

    const markWelcomeSeen = useCallback(() => {
        try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch (_) {}
    }, []);

    // ── Open a default layout the first time a design is shown ─────────────────
    // Startup opens no design (empty workspace). When the user creates or picks
    // the first design and nothing is docked yet, drop in the Filter-Design
    // preset (Design Editor left, Optical Evaluation right) so they aren't left
    // staring at the empty state. Once any window is open we never auto-arrange.
    useEffect(() => {
        if (activeDesignId && openWindowIds.length === 0) {
            setLayoutRequest({ type: 'preset', id: 'filter-design', ts: Date.now() });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDesignId]);

    // Empty-workspace "Create project" — create + open a design and arrange the
    // default Filter-Design layout.
    const createProjectFromEmpty = () => {
        addItem();
        setLayoutRequest({ type: 'preset', id: 'filter-design', ts: Date.now() });
    };

    // Built-in starter designs offered on the welcome screen.
    const sampleDesigns = React.useMemo(() => buildSampleDesigns(), []);

    // Welcome-screen actions. Each marks the screen seen and closes it. The two
    // that create designs are plain (non-memoized) closures so they always see
    // the current `addItem`/`addItemFromDesign` (defined later in this component).
    const closeWelcome = useCallback(() => { markWelcomeSeen(); setShowWelcome(false); }, [markWelcomeSeen]);
    const welcomeNewDesign = () => { closeWelcome(); addItem(); };
    const welcomeOpenSample = (sample) => {
        closeWelcome();
        try {
            const design = sample.build();
            addItemFromDesign(design);
            setToolRequests(prev => [...prev, { toolId: 'design-editor', ts: Date.now() }]);
        } catch (_) {}
    };
    const welcomeDocs = useCallback(() => {
        closeWelcome();
        window.electronAPI?.openHelp?.({ anchor: 'index', locale });
    }, [closeWelcome, locale]);
    const startTour = useCallback(() => { markWelcomeSeen(); setShowWelcome(false); setShowTour(true); }, [markWelcomeSeen]);

    // ── Interactive tutorials ───────────────────────────────────
    const tutorials = React.useMemo(() => buildTutorials(), []);
    const openTutorials = useCallback(() => { setShowWelcome(false); setShowTutorials(true); }, []);

    // Merge a lesson's structure with its localized text (by step index) and
    // start the player. Closes the browser; the active lesson renders on top.
    const startLesson = (key) => {
        const lesson = tutorials.find(l => l.key === key);
        const loc = t.tutorials?.lessons?.[key];
        if (!lesson || !loc) return;
        const steps = lesson.steps.map((s, i) => ({ ...s, ...(loc.steps?.[i] || {}) }));
        // Every lesson runs in the Filter-Design layout: Design Editor on the
        // left, Optical Evaluation on the right. Lesson-opened tools dock LEFT.
        setLayoutRequest({ type: 'preset', id: 'filter-design', ts: Date.now() });
        setActiveTutorial({ key, title: loc.title, steps });
        setShowTutorials(false);
    };

    const markTutorialDone = useCallback((key) => {
        setTutorialsDone(prev => {
            if (prev.has(key)) return prev;
            const nx = new Set(prev); nx.add(key);
            try { localStorage.setItem(TUTORIALS_DONE_KEY, JSON.stringify([...nx])); } catch (_) {}
            return nx;
        });
    }, []);

    // Per-step action dispatcher (plain closure → always current handlers). A
    // step may open a tool, drop a starter design, or apply a docking layout.
    const onTutorialAction = (action) => {
        if (!action) return;
        // Per-step setup (e.g. preset the needle pool/engine/iterations) runs
        // before the tool opens so the freshly-mounted window reads it.
        if (action.prep) { try { action.prep(); } catch (_) {} }
        if (action.loadDesign) {
            // Drop the starter design in and make it active. The Filter-Design
            // layout (already applied at lesson start) shows it in the left-hand
            // Design Editor + right-hand Optical Evaluation — no extra window.
            try { addItemFromDesign(action.loadDesign()); } catch (_) {}
            return;
        }
        if (action.layout) { setLayoutRequest({ type: 'preset', id: action.layout, ts: Date.now() }); return; }
        if (action.tool) {
            // Lesson-opened tools dock into the LEFT group (beside the Design
            // Editor), and focus an existing instance instead of duplicating.
            setToolRequests(prev => [...prev, { toolId: action.tool, ts: Date.now(), region: 'left', focusExisting: true }]);
            return;
        }
    };

    useEffect(() => {
        if (settingsLoaded) saveSettingsToDisk();
    }, [settingsLoaded, theme, locale, wasmTmm, ribbonStyle, customThemes, updateCheckEnabled, skippedVersion]);

    // Mirror the active palette into CSS custom properties on :root so global
    // stylesheet rules (e.g. native <select>/<option> popups, which can't read
    // the inline `c` object) stay theme-aware. Without this the OS renders the
    // option list with default colours (white on dark themes → "looks default").
    useEffect(() => {
        const r = document.documentElement.style;
        r.setProperty('--tf-bg',           c.bg);
        r.setProperty('--tf-panel',        c.panel);
        r.setProperty('--tf-field',        c.field);
        r.setProperty('--tf-border',       c.border);
        r.setProperty('--tf-borderstrong', c.borderStrong);
        r.setProperty('--tf-text',         c.text);
        r.setProperty('--tf-textdim',      c.textDim);
        r.setProperty('--tf-accent',       c.accent);
        r.setProperty('--tf-accenttext',   c.accentText);
        r.setProperty('--tf-accenthover',  c.accentHover);
        r.setProperty('--tf-hover',        c.hover);
        r.setProperty('--tf-selected',     c.selected);
        r.setProperty('--tf-success',      c.success);
        r.setProperty('--tf-warning',      c.warning);
        r.setProperty('--tf-error',        c.error);
        r.setProperty('--tf-info',         c.info);
    }, [c]);

    // ── Session save (debounced 500 ms) ────────────────────────────────────────
    // Persists both the working designs and a serializable copy of the per-design
    // undo/redo history so Ctrl+Z / Ctrl+Y survive an app restart.
    const serializeHistory = () => {
        const out = {};
        for (const [id, h] of Object.entries(historyRef.current)) {
            if (!h) continue;
            out[id] = {
                past:   (h.past   || []).slice(-MAX_HISTORY),
                future: (h.future || []).slice(0, MAX_HISTORY),
            };
        }
        return out;
    };
    const scheduleSessionSave = useCallback(() => {
        clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = setTimeout(
            () => saveSession(designsRef.current, serializeHistory()), 500);
    }, []);

    // ── Activate design when selected item ID changes ──────────────────────────
    useEffect(() => {
        if (!selectedItem?.id) return;
        setActiveDesignId(selectedItem.id);
        setDesigns(prev => {
            if (prev[selectedItem.id]) return prev;
            return { ...prev, [selectedItem.id]: makeDefaultDesign(selectedItem.name, selectedItem.id) };
        });
    }, [selectedItem?.id]);

    // Dirty = working design differs (canonically) from the last disk save.
    // Re-evaluated on every change so that undoing back to the saved state
    // correctly clears the ● indicator.
    const recomputeDirty = useCallback((id, design) => {
        setDirtyDesigns(d => updateDirtyDesigns(d, id, design, diskDesignsRef.current[id]));
    }, []);

    const persistProjectChange = useProjectPersistence(setMessageNotification, t);

    // ── Explicit undo checkpoint ───────────────────────────────────────────────
    // Long-running tools (Refinement / Needle / Gradual Evolution) push ONE
    // checkpoint before they start, then stream their per-iteration previews
    // with { transient: true } so a single Ctrl+Z returns to the pre-run state
    // instead of stepping through thousands of sub-nm micro-iterations.
    const pushCheckpoint = useCallback((id) => {
        const tid = id ?? activeDesignId;
        if (!tid) return;
        if (!historyRef.current[tid]) historyRef.current[tid] = { past: [], future: [] };
        const hist = historyRef.current[tid];
        const cur  = designsRef.current[tid];
        if (!cur) return;
        hist.past   = appendDistinctSnapshot(hist.past, cur, MAX_HISTORY);
        hist.future = [];
        bumpHistory();
        scheduleSessionSave();
    }, [activeDesignId, scheduleSessionSave, bumpHistory]);

    // ── Design change (from DesignContext) ─────────────────────────────────────
    // Pushes to per-design undo history + saves session. No disk write.
    // opts.transient → update working state only, do NOT create a history entry
    // (used for live optimization previews; pair with pushCheckpoint()).
    const handleDesignChange = useCallback((id, newDesign, opts) => {
        if (!historyRef.current[id]) historyRef.current[id] = { past: [], future: [] };
        const hist = historyRef.current[id];
        const transient = !!(opts && opts.transient);
        // Use functional updater so we always read the most-recent state, even
        // when multiple changes arrive before a React render cycle completes.
        setDesigns(d => {
            const prev = d[id];
            if (!transient && prev && prev !== newDesign) {
                hist.past = appendDistinctSnapshot(hist.past, prev, MAX_HISTORY);
                hist.future = [];
            }
            return { ...d, [id]: newDesign };
        });
        // A committed edit always grows `past`; bump so the History window
        // re-renders. (Transient previews don't touch the stacks.)
        if (!transient) bumpHistory();
        // A live optimization preview is always dirty vs the last disk save —
        // skip the per-iteration canonical compare and just flag it. The exact
        // compare runs on committed edits, undo, and redo.
        if (transient) setDirtyDesigns(d => (d[id] ? d : { ...d, [id]: true }));
        else           recomputeDirty(id, newDesign);
        scheduleSessionSave();
    }, [scheduleSessionSave, recomputeDirty, bumpHistory]);

    // ── Undo ──────────────────────────────────────────────────────────────────
    const undo = useCallback(() => {
        if (!activeDesignId) return;
        const h = historyRef.current[activeDesignId];
        if (!h?.past?.length) return;
        const present  = designsRef.current[activeDesignId];
        const previous = h.past[h.past.length - 1];
        h.past   = h.past.slice(0, -1);
        h.future = [present, ...(h.future || [])].slice(0, MAX_HISTORY);
        setDesigns(d => ({ ...d, [activeDesignId]: previous }));
        recomputeDirty(activeDesignId, previous);
        bumpHistory();
        scheduleSessionSave();
    }, [activeDesignId, scheduleSessionSave, recomputeDirty, bumpHistory]);

    // ── Redo ──────────────────────────────────────────────────────────────────
    const redo = useCallback(() => {
        if (!activeDesignId) return;
        const h = historyRef.current[activeDesignId];
        if (!h?.future?.length) return;
        const present = designsRef.current[activeDesignId];
        const next    = h.future[0];
        h.future = h.future.slice(1);
        h.past   = [...(h.past || []), present].slice(-MAX_HISTORY);
        setDesigns(d => ({ ...d, [activeDesignId]: next }));
        recomputeDirty(activeDesignId, next);
        bumpHistory();
        scheduleSessionSave();
    }, [activeDesignId, scheduleSessionSave, recomputeDirty, bumpHistory]);

    // ── Jump to an arbitrary point in the timeline (History window) ────────────
    // timeline = [...past, present, ...future];  index 0 = oldest.
    const jumpToHistory = useCallback((targetIndex) => {
        if (!activeDesignId) return;
        const h = historyRef.current[activeDesignId];
        if (!h) return;
        const past    = h.past   || [];
        const future  = h.future || [];
        const present = designsRef.current[activeDesignId];
        const timeline = [...past, present, ...future];
        const curIdx   = past.length;
        const i = Math.max(0, Math.min(timeline.length - 1, targetIndex | 0));
        if (i === curIdx) return;
        const target = timeline[i];
        h.past   = timeline.slice(0, i);
        h.future = timeline.slice(i + 1);
        setDesigns(d => ({ ...d, [activeDesignId]: target }));
        recomputeDirty(activeDesignId, target);
        bumpHistory();
        scheduleSessionSave();
    }, [activeDesignId, scheduleSessionSave, recomputeDirty, bumpHistory]);

    // History view for the active design (consumed by the History window).
    const historyView = React.useMemo(() => {
        const h = activeDesignId ? historyRef.current[activeDesignId] : null;
        const past    = h?.past   || [];
        const future  = h?.future || [];
        const present = activeDesignId ? designs[activeDesignId] : null;
        if (!present && past.length === 0 && future.length === 0) {
            return { entries: [], currentIndex: -1 };
        }
        const timeline = [...past, present, ...future];
        return { entries: timeline, currentIndex: past.length };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDesignId, designs, historyVersion]);

    // ── Explicit save to disk (Ctrl+S / File > Save) ──────────────────────────
    const saveDesignToDisk = useCallback((id, design) => {
        const targetId     = id     ?? activeDesignId;
        const targetDesign = design ?? designsRef.current[targetId];
        if (!targetId || !targetDesign) return;
        const folder = foldersRef.current.find(f => f.items.some(i => i.id === targetId));
        if (folder && window.electronAPI?.saveDesign) {
            const savedSnapshot = JSON.parse(JSON.stringify(targetDesign));
            return persistProjectChange(
                () => writeDesignFile(folder.name, savedSnapshot),
                () => {
                    diskDesignsRef.current[targetId] = savedSnapshot;
                    setFolders(current => updateExplorerItemMtime(current, targetId, Date.now()));
                    setDirtyDesigns(d => updateDirtyDesigns(
                        d, targetId, designsRef.current[targetId], savedSnapshot));
                },
                t.dialogs.saveAs.saveFailed,
            );
        }
    }, [activeDesignId, persistProjectChange, t]);

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        const onKey = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key === 's') { e.preventDefault(); saveDesignToDisk(); }
            if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
            if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
            if (e.key === 'F1') {
                e.preventDefault();
                if (window.electronAPI && window.electronAPI.openHelp) {
                    window.electronAPI.openHelp({ anchor: 'index', locale });
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [saveDesignToDisk, undo, redo, locale]);

    // ── Disk I/O ──────────────────────────────────────────────────────────────

    const loadFoldersFromDisk = async ({ restoreSession = true, restoreLayout = true } = {}) => {
        let diskDesigns   = {};
        let loadedFolders = [];

        if (window.electronAPI?.loadFolders) {
            const result = await window.electronAPI.loadFolders();
            if (result.success) {
                ({ diskDesigns, loadedFolders } = parseFoldersResult(result));
            }
        }

        if (loadedFolders.length === 0) {
            loadedFolders = [{ id: 'My Designs', name: 'My Designs', expanded: true, items: [] }];
            if (window.electronAPI?.createFolder) {
                await window.electronAPI.createFolder('My Designs');
            }
        }

        // Disk is the dirty baseline. The .tfs on disk is the last explicit
        // save; an item is dirty iff the working copy differs from it
        // CANONICALLY (key order and the tfs_version wrapper are ignored —
        // that asymmetry was the cause of every file showing ● on startup).
        diskDesignsRef.current = { ...diskDesigns };

        // Merge session (unsaved working copies) over disk snapshots.
        // Session wins — it has the latest edits even if app was closed without
        // saving — and restores undo/redo history so it survives a restart.
        const session = restoreSession ? loadSession() : null;
        const { initialDesigns, initialDirty } = mergeSessionOverDisk(diskDesigns, session?.designs || null);
        historyRef.current = session?.history ? restoreSessionHistory(session.history) : {};

        setDesigns(initialDesigns);
        setDirtyDesigns(initialDirty);
        setFolders(loadedFolders);

        if (!restoreSession) {
            // A live Projects-root change is a workspace switch, not a startup
            // restore. Keeping selections from the previous root would leave
            // the explorer showing one directory while commands target another.
            setActiveDesignId(null);
            setSelectedItem(null);
            setSelectedItems([]);
            setLastClickedItem(null);
        }

        // Startup: select a project FOLDER as the default target for new designs,
        // but do NOT auto-open any design. The workspace shows the empty-state
        // ("Create a project…") until the user creates or picks a design.
        setSelectedFolder(loadedFolders[0] || null);

        // Restore a previously saved docking layout if one exists; otherwise
        // leave the workspace empty (no preset) so the empty-state is shown.
        const savedLayout = restoreLayout ? localStorage.getItem('tfstudio-saved-layout') : null;
        if (savedLayout) {
            setLayoutRequest({ type: 'restore', ts: Date.now() });
        }
    };

    const loadCatalogsFromDisk = async () => {
        let persistedCatalogs = {};

        if (window.electronAPI?.loadCatalogs) {
            const result = await window.electronAPI.loadCatalogs();
            if (result.success) persistedCatalogs = result.catalogs;
        }

        // One-time migration: if no files found yet, promote any catalogs that were
        // previously stored in localStorage (pre-Documents storage) to disk files.
        if (Object.keys(persistedCatalogs).length === 0) {
            await migrateLegacyCatalogsFromLocalStorage(persistedCatalogs);
        }

        initCatalogs(persistedCatalogs);

        // Auto-scan Documents\TFStudio\Materials\agf\ for .agf files.
        await scanAndRegisterAgfCatalogs(persistedCatalogs);

        // Notify any already-mounted catalog consumers to refresh.
        window.dispatchEvent(new CustomEvent('catalogs-loaded'));
    };

    const loadSettingsFromDisk = async () => {
        try {
            if (!window.electronAPI?.loadSettings) return;
            const result = await window.electronAPI.loadSettings();
            if (result.success && result.settings) {
                // Register imported themes BEFORE setTheme so a custom theme name
                // resolves on the very first paint (no default-theme flash).
                if (result.settings.customThemes && typeof result.settings.customThemes === 'object') {
                    const cleaned = pruneBuiltInThemeNames(result.settings.customThemes);
                    registerCustomThemes(cleaned);
                    setCustomThemes(cleaned);
                }
                // If the persisted theme was a now-pruned dupe, its built-in twin
                // resolves by the same name — nothing else to do.
                if (result.settings.theme) setTheme(migrateThemeName(result.settings.theme));
                if (result.settings.locale) setLocaleState(result.settings.locale);
                if (result.settings.ribbonStyle) setRibbonStyle(result.settings.ribbonStyle);
                setWasmTmmState(result.settings.wasmTmm !== false);   // default ON (opt-out)
                setUpdateCheckEnabled(result.settings.updateCheckEnabled !== false);  // default ON (opt-out)
                if (typeof result.settings.skippedVersion === 'string') {
                    setSkippedVersion(result.settings.skippedVersion);
                }
            }
        } catch (_) {
            // Defaults remain usable; readiness must still release startup work.
        } finally {
            setSettingsLoaded(true);
        }
    };

    // The analysis-window defaults live in the preferences file rather than in
    // settings.json, so they are in Documents and survive a reinstall. A missing
    // or unreadable file leaves every window on the values the release ships
    // with; the provider must still be told, or it waits for a block forever.
    const loadPreferencesFromDisk = async () => {
        let prefs = null;
        try { prefs = (await window.electronAPI?.loadPreferences?.())?.prefs || null; }
        catch (_) { /* shipped defaults */ }
        setAnalysisSettings(prefs?.analysis && typeof prefs.analysis === 'object'
            ? prefs.analysis
            : {});
    };

    // Main-process directory getters switch immediately after a successful
    // Settings change. Refresh the corresponding renderer registry in the same
    // interaction so its visible state and all following commands refer to the
    // same root.
    const handleUserPathChanged = async (key) => {
        if (key === 'projects') {
            await loadFoldersFromDisk({ restoreSession: false, restoreLayout: false });
        } else if (key === 'materials') {
            await loadCatalogsFromDisk();
        }
    };

    const saveSettingsToDisk = async () => {
        if (window.electronAPI?.saveSettings) {
            await window.electronAPI.saveSettings({
                theme, locale, wasmTmm, ribbonStyle, customThemes,
                updateCheckEnabled, skippedVersion,
            });
        }
    };

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
            // Unique display name (don't shadow a built-in or an existing import).
            const exists = (nm) => getPaletteNames().includes(nm) || !!customThemes[nm];
            let finalName = name;
            let n = 2;
            while (exists(finalName)) { finalName = `${name} (${n++})`; }
            const next = { ...customThemes, [finalName]: palette };
            registerCustomThemes(next);
            setCustomThemes(next);
            setTheme(finalName);
            setMessageNotification({ type: 'success', message: t.settings.themeImportOk(finalName) });
        } catch (err) {
            setMessageNotification({ type: 'error', message: (t.settings.themeImportError || 'Import failed') + ': ' + err.message });
        }
    }, [customThemes, t]);

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

    // Load the WASM TMM kernel bytes (via IPC) and, per the persisted setting,
    // instantiate the main-thread module + enable the flag. Reads the setting
    // directly so the runtime decision is race-free w.r.t. React state updates.
    // Missing artifact / disabled setting → silently stays on the JS path.
    const bootstrapWasm = async () => {
        let enabled = true;   // default ON; only an explicit `false` disables
        try {
            const s = await window.electronAPI?.loadSettings?.();
            if (s?.success && s.settings && s.settings.wasmTmm === false) enabled = false;
        } catch (_) { /* default on */ }
        try {
            const r = await window.electronAPI?.loadWasmKernel?.();
            const len = r?.bytes ? (r.bytes.byteLength ?? r.bytes.length ?? 0) : 0;
            let ok = false;
            if (r?.success && r.bytes) ok = await initTmmWasmMainThread(r.bytes, enabled);
            window.electronAPI?.diagLog?.(
                `WASM bootstrap: enabledPref=${enabled} kernelBytes=${len} mainInstantiated=${ok} active=${tmmWasmActive()}`);
        } catch (e) {
            window.electronAPI?.diagLog?.(`WASM bootstrap threw: ${e?.message || e}`);
        }
    };

    // ── Project explorer actions ──────────────────────────────────────────────

    // Names of every design in the tree. New, imported and duplicated designs are
    // made unique against this list: a name decides the .tfs filename, so a
    // collision would overwrite the other design's file (see designNaming.js).
    const existingDesignNames = useCallback(
        () => foldersRef.current.flatMap(f => f.items.map(i => i.name)), []);

    const addItem = useCallback(async (overrideFolder) => {
        const targetFolder = overrideFolder || selectedFolder;
        if (!targetFolder) return;
        // The running count is not unique on its own: deleting "Design 2" of
        // three makes the next default "Design 3", which already exists. Keep
        // counting up rather than falling back to a parenthesised suffix.
        const n       = foldersRef.current.flatMap(f => f.items).length + 1;
        const name    = uniqueDesignName(`Design ${n}`, existingDesignNames(), (_, k) => `Design ${n + k - 1}`);
        const design  = makeDefaultDesign(name);
        const newItem = { id: design.id, name: design.name, mtime: Date.now() };

        return persistProjectChange(
            window.electronAPI?.saveDesign
                ? () => writeDesignFile(targetFolder.name, design)
                : null,
            () => {
                diskDesignsRef.current[design.id] = JSON.parse(JSON.stringify(design));
                setDesigns(d => ({ ...d, [design.id]: design }));
                setFolders(prev => prev.map(f =>
                    f.id === targetFolder.id ? { ...f, items: [...f.items, newItem] } : f
                ));
                setSelectedFolder(targetFolder);
                setSelectedItem(newItem);
                setSelectedItems([newItem]);
                setActiveDesignId(design.id);
            },
        );
    }, [selectedFolder, existingDesignNames, persistProjectChange]);

    // Add a project-explorer item from a pre-built design (e.g. WDM wizard output).
    // Same persistence path as `addItem`; differs only in that the design is
    // supplied ready-made instead of constructed from `makeDefaultDesign`.
    const addItemFromDesign = useCallback(async (incoming, overrideFolder) => {
        const targetFolder = overrideFolder || selectedFolder;
        if (!targetFolder || !incoming) return;
        const name   = uniqueDesignName(incoming.name, existingDesignNames(), (b, k) => `${b} (${k})`);
        const design = name === incoming.name ? incoming : { ...incoming, name };
        const newItem = { id: design.id, name: design.name, mtime: Date.now() };

        return persistProjectChange(
            window.electronAPI?.saveDesign
                ? () => writeDesignFile(targetFolder.name, design)
                : null,
            () => {
                diskDesignsRef.current[design.id] = JSON.parse(JSON.stringify(design));
                setDesigns(d => ({ ...d, [design.id]: design }));
                setFolders(prev => prev.map(f =>
                    f.id === targetFolder.id ? { ...f, items: [...f.items, newItem] } : f
                ));
                setSelectedFolder(targetFolder);
                setSelectedItem(newItem);
                setSelectedItems([newItem]);
                setActiveDesignId(design.id);
            },
        );
    }, [selectedFolder, existingDesignNames, persistProjectChange]);

    // ── Open: import an external .tfs file into the project tree and open it ──
    // The main process shows a native picker and returns the parsed design; we
    // re-key it (fresh design + layer ids, collision-free name) so it can never
    // clobber an existing design via the load-folders id de-dupe, then persist
    // and open it through the normal addItemFromDesign path.
    const openDesignFromFile = useCallback(async () => {
        if (!window.electronAPI?.importTfs) return;
        const res = await window.electronAPI.importTfs();
        if (!res?.success || !res.design) return;
        const targetFolder = selectedFolder || foldersRef.current[0];
        if (!targetFolder) return;

        const ts       = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const base     = (res.design.name && String(res.design.name).trim()) || res.fileName || 'Imported design';
        const name     = uniqueDesignName(base, existingDesignNames(), (b, k) => `${b} (${k})`);

        const design = {
            ...res.design,
            id: `design-${ts}`,
            name,
            frontLayers: rekeyLayers(res.design.frontLayers, ts, 'f'),
            backLayers:  rekeyLayers(res.design.backLayers, ts, 'b'),
        };
        if (await addItemFromDesign(design, targetFolder)) {
            setToolRequests(prev => [...prev, { toolId: 'design-editor', ts: Date.now() }]);
        }
    }, [selectedFolder, addItemFromDesign, existingDesignNames]);

    // ── Save As: persist the active design under a new name as a separate file ──
    const saveDesignAs = useCallback(() => {
        const id  = activeDesignId;
        const src = id && designsRef.current[id];
        if (!src) return;
        const folder = foldersRef.current.find(f => f.items.some(i => i.id === id))
                     || selectedFolder || foldersRef.current[0];
        if (!folder) return;

        const sa        = t.dialogs.saveAs;
        const existing  = new Set(existingDesignNames().map(designFileKey));
        const base      = `${src.name} (copy)`;
        const suggested = uniqueDesignName(base, existingDesignNames(), (b, k) => `${b} ${k}`);

        setInputDialog({
            title: sa.title,
            defaultValue: suggested,
            validate: (nm) => {
                if (!nm?.trim()) return sa.empty;
                if (existing.has(designFileKey(nm.trim()))) return sa.exists;
                return '';
            },
            onConfirm: async (nm) => {
                const name = nm.trim();
                const ts    = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const newId = `design-${ts}`;
                const clone = {
                    ...JSON.parse(JSON.stringify(src)),
                    id: newId, name,
                    frontLayers: rekeyLayers(src.frontLayers, ts, 'f'),
                    backLayers:  rekeyLayers(src.backLayers, ts, 'b'),
                };
                const newItem = { id: newId, name, mtime: Date.now() };
                const saved = await persistProjectChange(
                    window.electronAPI?.saveDesign
                        ? () => writeDesignFile(folder.name, clone)
                        : null,
                    () => {
                        diskDesignsRef.current[newId] = JSON.parse(JSON.stringify(clone));
                        setDesigns(d => ({ ...d, [newId]: clone }));
                        setFolders(prev => prev.map(f =>
                            f.id === folder.id ? { ...f, items: [...f.items, newItem] } : f));
                        setSelectedFolder(folder);
                        setSelectedItem(newItem);
                        setSelectedItems([newItem]);
                        setActiveDesignId(newId);
                    },
                    sa.saveFailed,
                );
                if (saved) {
                    setInputDialog(null);
                }
            },
            onCancel: () => setInputDialog(null),
        });
    }, [activeDesignId, selectedFolder, t, existingDesignNames, persistProjectChange]);

    const duplicateItem = useCallback(async (item, folder) => {
        const src = designsRef.current[item.id];
        if (!src) return;
        const ts      = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newId   = `design-${ts}`;
        const newName = uniqueDesignName(
            `${item.name} (copy)`, existingDesignNames(), (b, k) => `${b} ${k}`);
        const clone   = {
            ...JSON.parse(JSON.stringify(src)),
            id: newId,
            name: newName,
            frontLayers: rekeyLayers(src.frontLayers, ts, 'f'),
            backLayers:  rekeyLayers(src.backLayers, ts, 'b'),
        };
        const newItem = { id: newId, name: newName, mtime: Date.now() };
        return persistProjectChange(
            window.electronAPI?.saveDesign
                ? () => writeDesignFile(folder.name, clone)
                : null,
            () => {
                diskDesignsRef.current[newId] = JSON.parse(JSON.stringify(clone));
                setDesigns(d => ({ ...d, [newId]: clone }));
                setFolders(prev => prev.map(f =>
                    f.id === folder.id ? { ...f, items: [...f.items, newItem] } : f
                ));
                setSelectedItem(newItem);
                setSelectedItems([newItem]);
                setActiveDesignId(newId);
            },
        );
    }, [existingDesignNames, persistProjectChange]);

    const removeSelectedItems = useCallback(async (explicitList) => {
        // `explicitList` lets the context menu delete a precise set without
        // racing the async selection state; falls back to the live selection.
        const toRemove = (Array.isArray(explicitList) && explicitList.length > 0)
            ? explicitList
            : (selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []));
        if (toRemove.length === 0) return;
        // Resolve every disk target before awaiting so concurrent selection or
        // tree updates cannot retarget a later delete in the batch.
        const deletions = toRemove.map(item => {
            const folder = foldersRef.current.find(f => f.items.some(s => s.id === item.id));
            return folder ? { item, folderName: folder.name, itemName: item.name } : null;
        }).filter(Boolean);

        const removedIds = new Set();
        for (const d of deletions) {
            await persistProjectChange(
                window.electronAPI?.deleteItem
                    ? () => window.electronAPI.deleteItem(d.folderName, d.itemName)
                    : null,
                () => removedIds.add(d.item.id),
            );
        }
        if (removedIds.size === 0) return;

        setFolders(prev => prev.map(f => ({
            ...f, items: f.items.filter(item => !removedIds.has(item.id)),
        })));
        setSelectedItem(prev => (removedIds.has(prev?.id) ? null : prev));
        setSelectedItems(prev => prev.filter(item => !removedIds.has(item.id)));
        setActiveDesignId(prev => (removedIds.has(prev) ? null : prev));
        setDirtyDesigns(prev => {
            const next = { ...prev };
            removedIds.forEach(id => delete next[id]);
            return next;
        });
        removedIds.forEach(id => { delete diskDesignsRef.current[id]; });
        for (const item of toRemove.filter(candidate => removedIds.has(candidate.id))) {
            window.dispatchEvent(new CustomEvent('tfstudio:design-evict', { detail: { id: item.id } }));
        }
    }, [selectedItems, selectedItem, persistProjectChange]);

    // Delete one SPECIFIC item by id — used by the explorer's per-row delete
    // button/key. Must NOT route through "select then removeSelectedItems":
    // selection state updates asynchronously, so that path deleted the
    // previously-active item (stale selection) and failed on the first click.
    const removeItem = useCallback(async (folderId, itemId) => {
        const folder = foldersRef.current.find(f => f.id === folderId);
        if (!folder) return;
        const item = folder.items.find(i => i.id === itemId);
        if (!item) return;
        return persistProjectChange(
            window.electronAPI?.deleteItem
                ? () => window.electronAPI.deleteItem(folder.name, item.name)
                : null,
            () => {
                setFolders(prev => prev.map(f => f.id === folderId
                    ? { ...f, items: f.items.filter(i => i.id !== itemId) }
                    : f));
                setSelectedItem(prev => (prev?.id === itemId ? null : prev));
                setSelectedItems(prev => prev.filter(s => s.id !== itemId));
                setActiveDesignId(prev => (prev === itemId ? null : prev));
                setDirtyDesigns(prev => {
                    const next = { ...prev };
                    delete next[itemId];
                    return next;
                });
                delete diskDesignsRef.current[itemId];
                window.dispatchEvent(new CustomEvent(
                    'tfstudio:design-evict', { detail: { id: itemId } }));
            },
        );
    }, [persistProjectChange]);

    const addFolder = useCallback(async () => {
        setInputDialog({
            title: 'New Project',
            defaultValue: 'New Project',
            validate: (name) => {
                if (!name?.trim()) return 'Project name cannot be empty';
                if (foldersRef.current.some(f => f.name.toLowerCase() === name.trim().toLowerCase()))
                    return 'A project with this name already exists';
                return '';
            },
            onConfirm: async (name) => {
                if (name?.trim()) {
                    const trimmedName = name.trim();
                    const newFolder = {
                        id: trimmedName, name: trimmedName, expanded: true, items: [],
                    };
                    const created = await persistProjectChange(
                        window.electronAPI?.createFolder
                            ? () => window.electronAPI.createFolder(trimmedName)
                            : null,
                        () => {
                            setFolders(prev => [...prev, newFolder]);
                            setSelectedFolder(newFolder);
                        },
                    );
                    if (!created) return;
                }
                setInputDialog(null);
            },
            onCancel: () => setInputDialog(null)
        });
    }, [persistProjectChange]);

    const renameItem = useCallback(async (folderId, itemId, newName) => {
        const folder = foldersRef.current.find(f => f.id === folderId);
        if (!folder) return;
        const item = folder.items.find(i => i.id === itemId);
        if (!item) return;
        const collides = folder.items.some(candidate =>
            candidate.id !== itemId && designFileKey(candidate.name) === designFileKey(newName));
        if (collides) {
            setMessageNotification({ type: 'error', message: t.dialogs.saveAs.exists });
            return false;
        }
        const oldName = item.name;
        const updated = { ...item, name: newName };
        return persistProjectChange(
            window.electronAPI?.renameItem
                ? () => window.electronAPI.renameItem(folder.name, oldName, newName)
                : null,
            () => {
                setFolders(prev => prev.map(f => f.id === folderId
                    ? { ...f, items: f.items.map(i => i.id === itemId ? updated : i) }
                    : f));
                setSelectedItem(prev => (prev?.id === itemId ? updated : prev));
                setDesigns(prev => {
                    if (!prev[itemId]) return prev;
                    return { ...prev, [itemId]: { ...prev[itemId], name: newName } };
                });
                if (diskDesignsRef.current[itemId]) {
                    diskDesignsRef.current[itemId] = {
                        ...diskDesignsRef.current[itemId], name: newName,
                    };
                }
            },
        );
    }, [persistProjectChange, t]);

    const renameFolder = useCallback(async (folderId, newName) => {
        const folder = foldersRef.current.find(f => f.id === folderId);
        if (!folder) return;
        const collides = foldersRef.current.some(candidate =>
            candidate.id !== folderId && candidate.name.toLowerCase() === newName.toLowerCase());
        if (collides) {
            setMessageNotification({ type: 'error', message: t.dialogs.folder.folderExists });
            return false;
        }
        const oldName = folder.name;
        return persistProjectChange(
            window.electronAPI?.renameFolder
                ? () => window.electronAPI.renameFolder(oldName, newName)
                : null,
            () => {
                setFolders(prev => prev.map(f =>
                    f.id === folderId ? { ...f, id: newName, name: newName } : f));
                setSelectedFolder(prev =>
                    prev?.id === folderId ? { ...prev, id: newName, name: newName } : prev);
            },
        );
    }, [persistProjectChange, t]);

    const removeFolder = useCallback(async (folderId) => {
        const folder = foldersRef.current.find(f => f.id === folderId);
        if (!folder) return;
        const removedIds = new Set(folder.items.map(item => item.id));
        return persistProjectChange(
            window.electronAPI?.deleteFolder
                ? () => window.electronAPI.deleteFolder(folder.name)
                : null,
            () => {
                setFolders(prev => prev.filter(f => f.id !== folderId));
                setSelectedFolder(prev => {
                    if (prev?.id !== folderId) return prev;
                    return foldersRef.current.find(f => f.id !== folderId) || null;
                });
                setSelectedItem(prev => (removedIds.has(prev?.id) ? null : prev));
                setSelectedItems(prev => prev.filter(item => !removedIds.has(item.id)));
                setActiveDesignId(prev => (removedIds.has(prev) ? null : prev));
                setDirtyDesigns(prev => {
                    const next = { ...prev };
                    removedIds.forEach(id => delete next[id]);
                    return next;
                });
                removedIds.forEach(id => {
                    delete diskDesignsRef.current[id];
                    window.dispatchEvent(new CustomEvent(
                        'tfstudio:design-evict', { detail: { id } }));
                });
            },
        );
    }, [persistProjectChange]);

    const toggleFolderExpanded = useCallback((folderId) =>
        setFolders(prev => prev.map(f => f.id === folderId ? { ...f, expanded: !f.expanded } : f)),
    []);

    // `orderedItems` is the flat list of rows in the exact order the user SEES
    // them — folder order, only expanded folders, each folder's items run through
    // the active sort. The explorer passes it in. Shift-range MUST slice this
    // list, not the raw `foldersRef` order: previously the range was computed
    // over the unsorted, collapsed-folder-inclusive data order, so a shift-click
    // selected a span the user never saw ("selection feels random").
    const handleItemClick = useCallback((item, folder, event, orderedItems) => {
        setSelectedFolder(folder);
        const ctrl = event?.ctrlKey || event?.metaKey;
        if (ctrl) {
            setSelectedItems(prev =>
                prev.find(s => s.id === item.id) ? prev.filter(s => s.id !== item.id) : [...prev, item]
            );
            setSelectedItem(item);
            // Move the anchor to the ctrl-clicked row so a following shift-click
            // ranges from here (matches file-explorer behaviour).
            setLastClickedItem(item);
        } else if (event?.shiftKey && lastClickedItem) {
            const list = (orderedItems && orderedItems.length)
                ? orderedItems
                : foldersRef.current.flatMap(f => f.items);
            const lastIdx = list.findIndex(s => s.id === lastClickedItem.id);
            const currIdx = list.findIndex(s => s.id === item.id);
            if (lastIdx === -1 || currIdx === -1) {
                // Anchor is no longer visible (folder collapsed / item gone) —
                // fall back to a fresh single selection and re-anchor.
                setSelectedItem(item);
                setSelectedItems([item]);
                setLastClickedItem(item);
                return;
            }
            const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
            setSelectedItems(list.slice(start, end + 1));
            setSelectedItem(item);
            // Anchor stays put across shift-clicks (range grows/shrinks from it).
        } else {
            setSelectedItem(item);
            setSelectedItems([item]);
            setLastClickedItem(item);
        }
    }, [lastClickedItem]);

    // ── Menu & toolbar actions ────────────────────────────────────────────────

    const handleMenuAction = useCallback((action) => {
        const actions = {
            'about':         () => setShowAbout(true),
            'welcome':       () => setShowWelcome(true),
            'tutorials':     () => setShowTutorials(true),
            'open-settings': () => setShowSettings(true),
            'new-design':    () => addItem(),
            'save':          () => saveDesignToDisk(),
            'export-report': () => setShowReportGen(true),
            'undo':          () => undo(),
            'redo':          () => redo(),
            'help-docs':     () => window.electronAPI?.openHelp?.({ anchor: 'index', locale }),

            'layout-filter-design': () => setLayoutRequest({ type: 'preset', id: 'filter-design', ts: Date.now() }),
            'layout-full-analysis': () => setLayoutRequest({ type: 'preset', id: 'full-analysis', ts: Date.now() }),
            'layout-synthesis':     () => setLayoutRequest({ type: 'preset', id: 'synthesis',     ts: Date.now() }),
            'layout-save':          () => setLayoutRequest({ type: 'save',   ts: Date.now() }),
            'layout-restore':       () => setLayoutRequest({ type: 'restore', ts: Date.now() }),
        };
        if (actions[action]) { actions[action](); return; }
        if (action.startsWith('tool:')) {
            setToolRequests(prev => [...prev, { toolId: action.slice(5), ts: Date.now() }]);
        }
    }, [addItem, saveDesignToDisk, undo, redo, locale]);

    const handleToolAction = useCallback((toolId) => {
        const actions = {
            'new-design':     () => addItem(),
            'save':           () => saveDesignToDisk(),
            'save-as':        () => saveDesignAs(),
            'open-project':   () => openDesignFromFile(),
            'undo':           () => undo(),
            'redo':           () => redo(),
            'filter-design':  () => setShowFilterDesign(true),
            'bbm-simulator':  () => setShowBBM(true),
            'mono-simulator': () => setShowMono(true),
            'stack-formula':  () => setShowStackFormula(true),
            'report-gen':     () => setShowReportGen(true),
            'help-docs':      () => window.electronAPI?.openHelp?.({ anchor: 'index', locale }),
        };
        if (actions[toolId]) { actions[toolId](); return; }
        setToolRequests(prev => [...prev, { toolId, ts: Date.now() }]);
    }, [addItem, saveDesignToDisk, saveDesignAs, openDesignFromFile, undo, redo, locale]);

    // Open the Stack Formula dialog from within a tool window (Design Editor
    // toolbar button dispatches this decoupled event since tool windows don't
    // have a direct path to renderer-level dialog state).
    useEffect(() => {
        const open = () => setShowStackFormula(true);
        window.addEventListener('tfstudio:stack-formula', open);
        return () => window.removeEventListener('tfstudio:stack-formula', open);
    }, []);

    // Load a TRANSIENT preview design (e.g. from the Optimizer Benchmark window):
    // make it the active design and optionally open a tool, but DO NOT add it to
    // the explorer or persist it to disk. A single reused id ('__bench_preview__')
    // means repeated previews replace one orphan design rather than accumulating;
    // it never appears in the project tree (the explorer renders from folder items,
    // not from the designs map).
    useEffect(() => {
        const onLoad = (e) => {
            const d = e.detail && e.detail.design;
            if (!d) return;
            const id = d.id || '__bench_preview__';
            const design = { ...d, id };
            setDesigns(prev => ({ ...prev, [id]: design }));
            setActiveDesignId(id);
            if (e.detail.openTool) {
                setToolRequests(prev => [...prev, { toolId: e.detail.openTool, ts: Date.now() }]);
            }
        };
        window.addEventListener('tfstudio:load-design', onLoad);
        return () => window.removeEventListener('tfstudio:load-design', onLoad);
    }, []);

    // ── Derived ───────────────────────────────────────────────────────────────
    const activeDesign  = activeDesignId ? designs[activeDesignId] : null;
    const isActiveDirty = activeDesignId ? !!dirtyDesigns[activeDesignId] : false;

    // Lightweight signature of the active design's front stack — drives tutorial
    // "run" gates (Next unlocks when the optimizer changes layer count/thickness).
    const _activeFrontLayers = activeDesign?.frontLayers || [];
    const activeDesignLayers = _activeFrontLayers.length;
    const activeDesignSig = activeDesign
        ? `${activeDesignLayers}|${Math.round(_activeFrontLayers.reduce((s, l) => s + (Number(l.thickness) || 0), 0))}`
        : '';

    // ── Render ────────────────────────────────────────────────────────────────

    return h(AnalysisSettingsProvider, { initial: analysisSettings },
        h(DesignProvider, {
            activeDesignId,
            designs,
            onDesignChange:   handleDesignChange,
            onCheckpoint:     pushCheckpoint,
            historyView,
            onJumpToHistory:  jumpToHistory
        },
        h(UpdateProvider, {
            c, t,
            enabled: updateCheckEnabled,
            ready: settingsLoaded && !!appVersion,
            skippedVersion,
            onSkipVersion: setSkippedVersion,
            appVersion,
        },
        h('div', {
            style: {
                display: 'flex', flexDirection: 'column', height: '100vh',
                backgroundColor: c.bg, color: c.text,
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        },
            h(TitleBar,  { c, t, activeDesign, isDirty: isActiveDirty }),
            h(MenuBar,   { c, onMenuAction: handleMenuAction, t, devAllowed }),
            h(Toolbar,   { c, t, onToolAction: handleToolAction, openWindows: openWindowIds, ribbonStyle }),
            h('div', { style: { display: 'flex', flex: 1, overflow: 'hidden' } },
                h(ProjectExplorer, {
                    folders, selectedFolder, selectedItem, selectedItems,
                    handleItemClick, setSelectedFolder, toggleFolderExpanded,
                    addItem, duplicateItem, removeSelectedItems, removeItem, setInputDialog, addFolder,
                    renameFolder, renameItem, removeFolder,
                    dirtyDesigns,
                    c, t,
                    onOpenDesign: (item) => {
                        setSelectedItem(item);
                        setToolRequests(prev => [...prev, { toolId: 'design-editor', ts: Date.now() }]);
                    }
                }),
                h(DockingLayout, {
                    c, theme, t, locale,
                    toolRequests,
                    layoutRequest,
                    onWindowListChange: setOpenWindowIds,
                    onCreateProject: createProjectFromEmpty,
                    setInputDialog,
                    ribbonStyle
                })
            ),
            h(SpectralMonitor, { c, t }),
            showSettings && h(SettingsModal, {
                theme, setTheme, locale, setLocale,
                wasmTmm, setWasmTmm,
                updateCheckEnabled, setUpdateCheckEnabled,
                onUserPathChanged: handleUserPathChanged,
                canChangeUserPath: (key) => key !== 'projects' || !Object.values(dirtyDesigns).some(Boolean),
                ribbonStyle, setRibbonStyle,
                customThemes,
                onImportTheme: importThemeFromVscode,
                onDeleteTheme: deleteCustomTheme,
                onClose: () => setShowSettings(false), c, t
            }),
            showAbout && h(AboutDialog, { c, t, onClose: () => setShowAbout(false) }),
            showFilterDesign && h(FilterDesignWizard, {
                c, t,
                folderName: selectedFolder?.name,
                onClose: () => setShowFilterDesign(false),
                onGenerate: (design) => { addItemFromDesign(design); }
            }),
            showBBM && h(MaterialResolutionModalGuard, {
                c, t, onClose: () => setShowBBM(false),
            }, h(BBMWizard, {
                c, t, onClose: () => setShowBBM(false),
            })),
            showMono && h(MaterialResolutionModalGuard, {
                c, t, onClose: () => setShowMono(false),
            }, h(MonoWizard, {
                c, t, onClose: () => setShowMono(false),
            })),
            showStackFormula && h(MaterialResolutionModalGuard, {
                c, t, onClose: () => setShowStackFormula(false),
            }, h(StackFormulaDialog, {
                c, t,
                folderName: selectedFolder?.name,
                hasActiveDesign: activeDesignId != null,
                onClose: () => setShowStackFormula(false),
                onCreateNew: (design) => { addItemFromDesign(design); }
            })),
            showReportGen && h(ReportGenerator, {
                c, t,
                designs, activeDesignId,
                folderName: selectedFolder?.name,
                onClose: () => setShowReportGen(false)
            }),
            // ── First-run welcome screen + guided tour ──
            showWelcome && h(WelcomeScreen, {
                c, t,
                samples: sampleDesigns,
                theme, setTheme, locale, setLocale,
                onNewDesign:  welcomeNewDesign,
                onOpenSample: welcomeOpenSample,
                onDocs:       welcomeDocs,
                onTour:       startTour,
                onTutorials:  openTutorials,
                onClose:      closeWelcome,
            }),
            showTour && h(GuidedTour, {
                c, t,
                onClose: () => setShowTour(false),
            }),
            showTutorials && h(TutorialsBrowser, {
                c, t,
                lessons: tutorials,
                doneKeys: tutorialsDone,
                onStart: startLesson,
                onClose: () => setShowTutorials(false),
            }),
            activeTutorial && h(TutorialPlayer, {
                c, t,
                lesson: activeTutorial,
                designSig: activeDesignSig,
                designLayers: activeDesignLayers,
                onAction: onTutorialAction,
                onComplete: markTutorialDone,
                onClose: () => setActiveTutorial(null),
            }),
            h(InputDialog, { inputDialog, c, t }),
            messageNotification && h(MessageNotification, {
                c,
                message: messageNotification.message,
                type: messageNotification.type,
                onClose: () => setMessageNotification(null)
            })
        )
        )
        )
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App, null));
