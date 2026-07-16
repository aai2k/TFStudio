import { parseStackFormula, buildStackFromFormula } from '../../../../utils/synthesis/stackFormula.js';
import {
    computeSeed, buildSymbolMap, withRowMat, withRowSym, usedSymbolSet, missingSymbolRows,
    stackTotalThickness,
} from './model.js';
import { buildNewDesignFromFormula, buildReplaceAppendPatch } from './designBuild.js';

const { useState, useMemo, useEffect, useRef, useCallback } = React;

function applyNewDesign({ state, deps }) {
    const designObj = buildNewDesignFromFormula({
        newName: state.newName, refLambda: state.refLambda,
        incidentMat: state.incidentMat, substrateMat: state.substrateMat, exitMat: state.exitMat,
        effSide: state.effSide, text: state.text, symbolMap: state.symbolMap,
        startFromSubstrate: state.startFromSubstrate,
    });
    deps.onCreateNew && deps.onCreateNew(designObj);
    deps.onClose();
}

function applyReplaceOrAppend({ mode, state, deps }) {
    deps.checkpoint();
    const patch = buildReplaceAppendPatch({
        design: deps.design, mode, isSym: state.isSym, effSide: state.effSide,
        compiled: state.compiled, refLambda: state.refLambda,
        substrateMat: state.substrateMat, incidentMat: state.incidentMat, exitMat: state.exitMat,
        text: state.text, stamp: Date.now(),
    });
    deps.updateDesign(patch);
    deps.onClose();
}

export function useStackFormula({ design, updateDesign, checkpoint, onClose, onCreateNew, t }) {
    const sf = t.stackFormula;

    // Seed once from the active design: auto-detect its materials → H/L/M symbols
    // and a compact formula (or H/L/M defaults + sample for an empty design).
    const seedRef = useRef(null);
    if (!seedRef.current) seedRef.current = computeSeed(design);

    // Symbol → material assignments as an ordered, editable list. The user can
    // reassign, rename, add, or remove; any unknown symbol used in the formula
    // is auto-surfaced.
    const [symRows, setSymRows] = useState(() => seedRef.current.rows);
    const symbolMap = useMemo(() => buildSymbolMap(symRows), [symRows]);

    const setRowMat = useCallback((idx, matId) =>
        setSymRows(prev => withRowMat(prev, idx, matId)), []);
    const setRowSym = useCallback((idx, sym) =>
        setSymRows(prev => withRowSym(prev, idx, sym)), []);
    const addRow = useCallback(() =>
        setSymRows(prev => [...prev, { sym: '', matId: '', fixed: false }]), []);
    const removeRow = useCallback((idx) =>
        setSymRows(prev => prev.filter((_, i) => i !== idx)), []);

    const [refLambda, setRefLambda] = useState(() => design.referenceWavelength || 550);
    const [startFromSubstrate, setStartFromSubstrate] = useState(false);
    // Media as dropdowns (initialised from the design) — the formula carries
    // layers only. The front coating is bounded by the incident medium +
    // substrate; the back coating by the substrate + exit medium.
    const [incidentMat, setIncidentMat] = useState(() => design.incidentMedium || 'builtin:Air');
    const [substrateMat, setSubstrateMat] = useState(() => design.substrate?.material || 'builtin:BK7');
    const [exitMat, setExitMat] = useState(() => design.exitMedium || 'builtin:Air');

    // Which coating side(s) to write the formula into.
    const isSym = design.surfaceMode === 'symmetric';
    const [applySide, setApplySide] = useState('front'); // 'front' | 'back' | 'both'
    const effSide = isSym ? 'front' : applySide;          // symmetric edits front + auto-mirrors
    const showIncident = effSide !== 'back';
    const showExit     = effSide !== 'front' && !isSym;
    const [newName, setNewName] = useState(() => sf.defaultName);

    // Seed the textarea from the same auto-detected pass as the symbol rows.
    const [text, setText] = useState(() => seedRef.current.text);

    const parsed = useMemo(() => parseStackFormula(text), [text]);
    const compiled = useMemo(
        () => buildStackFromFormula({ text, symbolMap, refLambda, startFromSubstrate }),
        [text, symbolMap, refLambda, startFromSubstrate]);

    // Symbols actually referenced in the formula (for "used but unassigned"
    // highlighting in the assignment list).
    const usedSyms = useMemo(() => usedSymbolSet(parsed, symbolMap), [parsed, symbolMap]);

    // Auto-surface any unknown symbol used in the formula as a new assignment
    // row so the user immediately gets a picker for it.
    useEffect(() => {
        const missing = missingSymbolRows(parsed, symbolMap, symRows);
        if (missing) setSymRows(prev => [...prev, ...missing]);
    }, [parsed, symbolMap, symRows]);

    // ESC closes
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const applyToDesign = useCallback((mode) => {
        if (!compiled.ok) return;
        const state = {
            newName, refLambda, incidentMat, substrateMat, exitMat, effSide,
            text, symbolMap, startFromSubstrate, isSym, compiled,
        };
        const deps = { design, checkpoint, updateDesign, onClose, onCreateNew };
        if (mode === 'new') applyNewDesign({ state, deps });
        else applyReplaceOrAppend({ mode, state, deps });
    }, [compiled, design, isSym, effSide, refLambda, text, symbolMap, startFromSubstrate, newName,
        incidentMat, substrateMat, exitMat, checkpoint, updateDesign, onClose, onCreateNew]);

    const totalNm = stackTotalThickness(compiled);

    return {
        sf,
        symRows, symbolMap, setRowMat, setRowSym, addRow, removeRow, usedSyms,
        refLambda, setRefLambda, startFromSubstrate, setStartFromSubstrate,
        incidentMat, setIncidentMat, substrateMat, setSubstrateMat, exitMat, setExitMat,
        isSym, applySide, setApplySide, effSide, showIncident, showExit,
        newName, setNewName, text, setText, parsed, compiled,
        applyToDesign, totalNm,
    };
}
