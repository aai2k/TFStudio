/**
 * The first-run welcome screen, the guided tour, and the interactive tutorials.
 *
 * What the user has already seen is kept in localStorage rather than
 * settings.json: it is renderer-local and reads synchronously, so the welcome
 * screen cannot race the settings load and open on someone who has dismissed it.
 */

import { buildSampleDesigns } from '../utils/samples/sampleDesigns.js';
import { buildTutorials } from '../utils/samples/tutorials.js';

const { useState, useEffect, useRef, useCallback } = React;

// Set once the user dismisses the welcome screen; thereafter the screen only
// opens from Help ▸ Welcome / Tour.
const WELCOME_SEEN_KEY = 'tfstudio-welcome-seen';
// Completed tutorial keys — JSON array in localStorage.
const TUTORIALS_DONE_KEY = 'tfstudio-tutorials-done';

function loadTutorialsDone() {
    try { return new Set(JSON.parse(localStorage.getItem(TUTORIALS_DONE_KEY) || '[]')); }
    catch (_) { return new Set(); }
}

// Merge a lesson's structure with its localized text (by step index) and start
// the player. A starter design is named in the user's language. Closes the
// browser; the active lesson renders on top.
function startLessonIn(w, key) {
    const lesson = w.tutorials.find(l => l.key === key);
    const loc = w.t.tutorials?.lessons?.[key];
    if (!lesson || !loc) return;
    const steps = lesson.steps.map((s, i) => ({
        ...s,
        ...(s.loadDesign ? { loadDesign: () => s.loadDesign(loc.designName) } : {}),
        ...(loc.steps?.[i] || {}),
    }));
    // Every lesson runs in the Filter-Design layout: Design Editor on the left,
    // Optical Evaluation on the right. Lesson-opened tools dock LEFT.
    w.applyPreset('filter-design');
    w.setActiveTutorial({ key, title: loc.title, steps });
    w.setShowTutorials(false);
}

// The lesson after `key` in the curriculum, as { key, title } in the user's
// language, or null after the last one.
function nextLessonAfter(tutorials, t, key) {
    const index = tutorials.findIndex(l => l.key === key);
    const next = index >= 0 ? tutorials[index + 1] : null;
    const title = next && t.tutorials?.lessons?.[next.key]?.title;
    return title ? { key: next.key, title } : null;
}

// A lesson's starter design goes into a top-level folder of the lessons' own,
// made on first use, so lessons leave nothing among the user's projects. With
// no such folder to be had it goes where a new design would.
async function addLessonDesign(w, design) {
    const name = w.t.tutorials.folderName;
    const folder = w.folders.find(f => f.id.toLowerCase() === name.toLowerCase())
        || await w.createTopFolder?.(name);
    return w.addItemFromDesign(design, folder || undefined);
}

// A lesson step may open a tool, drop a starter design, or apply a docking
// layout.
function runTutorialStep(w, action) {
    if (!action) return;
    // Per-step setup (e.g. preset the needle pool/engine/iterations) runs before
    // the tool opens so the freshly-mounted window reads it.
    if (action.prep) { try { action.prep(); } catch (_) {} }
    if (action.loadDesign) {
        // Drop the starter design in and make it active. The Filter-Design
        // layout (already applied at lesson start) shows it in the left-hand
        // Design Editor + right-hand Optical Evaluation — no extra window.
        try { addLessonDesign(w, action.loadDesign()).catch(() => {}); } catch (_) {}
        return;
    }
    if (action.layout) { w.applyPreset(action.layout); return; }
    // Lesson-opened tools dock into the LEFT group (beside the Design Editor),
    // and focus an existing instance instead of duplicating it.
    if (action.tool) w.openTool(action.tool, { region: 'left', focusExisting: true });
}

export function useWelcomeAndTutorials({
    addItem, addItemFromDesign, folders = [], createTopFolder, openTool, applyPreset, locale, t,
}) {
    const [showWelcome,    setShowWelcome]    = useState(false);
    const [showTour,       setShowTour]       = useState(false);
    const [showTutorials,  setShowTutorials]  = useState(false);
    const [activeTutorial, setActiveTutorial] = useState(null);
    const [tutorialsDone,  setTutorialsDone]  = useState(loadTutorialsDone);

    // Built-in starter designs offered on the welcome screen.
    const sampleDesigns = React.useMemo(() => buildSampleDesigns(), []);
    const tutorials     = React.useMemo(() => buildTutorials(), []);
    const activeKey     = activeTutorial?.key;
    const nextLesson    = React.useMemo(
        () => (activeKey ? nextLessonAfter(tutorials, t, activeKey) : null), [tutorials, t, activeKey]);

    const w = useRef({});
    w.current = {
        tutorials, t, applyPreset, openTool, addItemFromDesign, folders, createTopFolder,
        setActiveTutorial, setShowTutorials,
    };

    // ── First-run welcome ─────────────────────────────────────────────────────
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

    // Welcome-screen actions. Each marks the screen seen and closes it.
    const closeWelcome = useCallback(() => { markWelcomeSeen(); setShowWelcome(false); }, [markWelcomeSeen]);
    const welcomeNewDesign = () => { closeWelcome(); addItem(); };
    const welcomeOpenSample = (sample) => {
        closeWelcome();
        try {
            addItemFromDesign(sample.build(t.welcome?.samples?.[sample.key]?.name));
            openTool('design-editor');
        } catch (_) {}
    };
    const welcomeDocs = useCallback(() => {
        closeWelcome();
        window.electronAPI?.openHelp?.({ anchor: 'index', locale });
    }, [closeWelcome, locale]);
    const startTour = useCallback(() => { markWelcomeSeen(); setShowWelcome(false); setShowTour(true); }, [markWelcomeSeen]);

    // ── Interactive tutorials ─────────────────────────────────────────────────
    const openTutorials = useCallback(() => { setShowWelcome(false); setShowTutorials(true); }, []);

    const markTutorialDone = useCallback((key) => {
        setTutorialsDone(prev => {
            if (prev.has(key)) return prev;
            const nx = new Set(prev); nx.add(key);
            try { localStorage.setItem(TUTORIALS_DONE_KEY, JSON.stringify([...nx])); } catch (_) {}
            return nx;
        });
    }, []);

    return {
        showWelcome, setShowWelcome, showTour, setShowTour,
        showTutorials, setShowTutorials, activeTutorial, setActiveTutorial, nextLesson,
        tutorialsDone, sampleDesigns, tutorials,
        closeWelcome, welcomeNewDesign, welcomeOpenSample, welcomeDocs,
        startTour, openTutorials, markTutorialDone,
        startLesson:      useCallback((key) => startLessonIn(w.current, key), []),
        onTutorialAction: useCallback((action) => runTutorialStep(w.current, action), []),
    };
}
