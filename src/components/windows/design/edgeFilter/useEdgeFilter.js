import {
    initialInputs, searchSignature, edgeRequest, formulaSymbols, periodFormula,
    compileEdgeFilter, stackFormulaSeed,
} from './model.js';
import { buildNewEdgeFilterDesign, edgeFilterPatch } from './designBuild.js';
import { startEdgeSearch, stopEdgeSearch } from './searchRun.js';

const { useState, useMemo, useEffect, useRef, useCallback } = React;

const NO_FORMULA = { ok: false };

// The selected period as a formula and as the layers it builds.
function useSelection(design, inputs, prepared, solution) {
    return useMemo(() => {
        if (!solution || !prepared.request) return { formula: '', symbolMap: null, compiled: NO_FORMULA };
        const symbols = formulaSymbols(inputs, prepared.request);
        const formula = periodFormula(solution, symbols, inputs.periods);
        return {
            formula, symbolMap: symbols.symbolMap,
            compiled: compileEdgeFilter(design, formula, symbols.symbolMap, inputs.edgeLambda),
        };
    }, [design, inputs, prepared, solution]);
}

// Search runs: start, stop, progress, and the last answer with the inputs it
// answered. An answer to other inputs than the ones shown is not offered.
function useSearch(prepared, signature) {
    const workerRef = useRef(null);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [answer, setAnswer] = useState(null);
    const finish = useCallback((result, ranWith) => {
        setRunning(false);
        setAnswer({ result, ranWith, selected: 0 });
    }, []);
    const search = useCallback(() => {
        if (prepared.errorKey) { finish({ errorKey: prepared.errorKey }, signature); return; }
        setRunning(true);
        setProgress(null);
        startEdgeSearch({ workerRef, request: prepared.request, signature, setProgress, finish });
    }, [prepared, signature, finish]);
    const stop = useCallback(() => { stopEdgeSearch(workerRef); setRunning(false); }, []);
    useEffect(() => () => stopEdgeSearch(workerRef), []);
    const current = answer && answer.ranWith === signature ? answer : null;
    const select = useCallback(index => setAnswer(prev => ({ ...prev, selected: index })), []);
    return { running, progress, current, search, stop, select };
}

export function useEdgeFilter({ design, updateDesign, checkpoint, onClose, onCreateNew, onOpenStackFormula, t }) {
    const ef = t.edgeFilter;
    const [inputs, setInputs] = useState(() => initialInputs(design));
    const setInput = useCallback((key, value) => setInputs(prev => ({ ...prev, [key]: value })), []);
    const prepared = useMemo(() => edgeRequest(design, inputs), [design, inputs]);
    const signature = searchSignature(inputs);
    const run = useSearch(prepared, signature);

    // The design's own materials are searched as soon as the window opens.
    const searchRef = useRef(run.search);
    searchRef.current = run.search;
    useEffect(() => { searchRef.current(); }, []);

    const solutions = run.current?.result.solutions || [];
    const selected = solutions[run.current?.selected ?? 0] || null;
    const { formula, symbolMap, compiled } = useSelection(design, inputs, prepared, selected);

    const isSym = design.surfaceMode === 'symmetric';
    const [applySide, setApplySide] = useState('front');
    const effSide = isSym ? 'front' : applySide;
    const [newName, setNewName] = useState(() => ef.defaultName);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const applyToDesign = useCallback((mode) => {
        if (!compiled.ok) return;
        if (mode === 'new') {
            onCreateNew && onCreateNew(buildNewEdgeFilterDesign({
                newName, effSide, compiled, inputs, formula, sourceMaterials: design.materials,
            }));
        } else {
            checkpoint();
            updateDesign(edgeFilterPatch({ design, mode, isSym, effSide, compiled, inputs, formula, stamp: Date.now() }));
        }
        onClose();
    }, [compiled, design, inputs, formula, newName, effSide, isSym, checkpoint, updateDesign, onClose, onCreateNew]);

    const openInStackFormula = useCallback(() => {
        if (compiled.ok) onOpenStackFormula(stackFormulaSeed(formula, symbolMap, inputs));
    }, [compiled, formula, symbolMap, inputs, onOpenStackFormula]);

    return {
        ef, inputs, setInput, prepared, ...run, solutions, selected,
        formula, compiled, isSym, applySide, setApplySide, effSide, newName, setNewName,
        applyToDesign, openInStackFormula,
    };
}
