/**
 * The modal dialogs and wizards the shell owns: Settings, About, and the four
 * wizards that build a design rather than edit one.
 */

const { useState, useEffect } = React;

export function useAppDialogs() {
    const [showSettings,     setShowSettings]     = useState(false);
    const [showAbout,        setShowAbout]        = useState(false);
    const [showFilterDesign, setShowFilterDesign] = useState(false);
    const [showBBM,          setShowBBM]          = useState(false);
    const [showMono,         setShowMono]         = useState(false);
    // true opens Stack Formula on the active design's own formula; an object
    // opens it on a formula another window hands over (see useStackFormula).
    const [showStackFormula, setShowStackFormula] = useState(false);

    // The Design Editor's toolbar button opens the Stack Formula dialog through
    // this decoupled event: a tool window has no direct path to shell state.
    useEffect(() => {
        const open = () => setShowStackFormula(true);
        window.addEventListener('tfstudio:stack-formula', open);
        return () => window.removeEventListener('tfstudio:stack-formula', open);
    }, []);

    return {
        showSettings, setShowSettings, showAbout, setShowAbout,
        showFilterDesign, setShowFilterDesign, showBBM, setShowBBM,
        showMono, setShowMono, showStackFormula, setShowStackFormula,
    };
}
