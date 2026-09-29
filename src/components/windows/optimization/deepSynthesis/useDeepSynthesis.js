import { useCatSelection, sideKeyFor } from '../synthesisShared/synthesisHelpers.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { DEEP_CATS_KEY, DEEP_MAX_LAYERS_KEY, DEEP_SYNTHESIS_WINDOW_DEFAULTS } from './deepSynthesisSettings.js';
import { useMinThickness } from './useMinThickness.js';
import {
    freshHistory, loadHistory, saveHistory, resetLastRun, clearHistory, restoreRow, restoreBest,
} from './historyActions.js';
import { createRunContext, stopDeepSynthesis, abandonDeepSynthesis } from './runners/lifecycle.js';
import { runDeepSynthesisWorker } from './runners/workerPool.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

const EMPTY_VIEW = {
    running: false, phase: null, step: 0, round: 0, rounds: 0, layerCount: 0, mf: null, mfBest: null,
    rows: [], top: [], trend: [], parts: null, startInfo: null, statusMsg: '', canReset: false,
};

// One run context per mount, holding the refs the runners read.
function useRunContext() {
    const [view, setView] = useState(EMPTY_VIEW);
    const publish = useCallback(patch => setView(current => ({ ...current, ...patch })), []);
    const holder = useRef(null);
    if (!holder.current) holder.current = { ...createRunContext(publish), hist: freshHistory() };
    return { ctx: holder.current, view };
}

// Keep the context on the props and settings of the latest render.
function useSyncedContext(ctx, props, settings) {
    useEffect(() => {
        const { design, updateDesign, checkpoint, getDesignRevision, t } = props;
        Object.assign(ctx, { updateDesign, checkpoint, getDesignRevision, td: t.deepSynthesis, ...settings.refs });
        ctx.designRef.current = design;
        ctx.operandsRef.current = design?.meritOperands || [];
        ctx.cfgRef.current = { dMin: settings.dMin, maxLayers: settings.maxLayers };
    });
    useEffect(() => {
        const design = props.design;
        if (!ctx.runningRef.current) ctx.publish({ layerCount: (design?.[sideKeyFor(design)] || []).length });
    }, [props.design]);
}

// A design switch leaves the old design's run and loads the new design's
// history; unmounting leaves the run and keeps the history.
function useDesignLifecycle(ctx, designId) {
    const lastId = useRef(undefined);
    useEffect(() => {
        if (lastId.current && lastId.current !== designId) abandonDeepSynthesis(ctx, '');
        lastId.current = designId ?? null;
        loadHistory(ctx, lastId.current);
    }, [designId]);
    useEffect(() => () => { abandonDeepSynthesis(ctx, ''); saveHistory(ctx); }, []);
}

function useOptimizingFlag(running, { beginOptimization, endOptimization }) {
    useEffect(() => {
        if (!running) return undefined;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);
}

// Every history action first leaves a run, since each changes the design.
function useActions(ctx) {
    return useMemo(() => {
        const leaving = action => (arg) => { abandonDeepSynthesis(ctx, ''); action(ctx, arg); };
        return {
            run: () => runDeepSynthesisWorker(ctx),
            stop: () => stopDeepSynthesis(ctx),
            reset: leaving(resetLastRun),
            clearHistory: leaving(clearHistory),
            restore: leaving(restoreRow),
            best: leaving(restoreBest),
        };
    }, [ctx]);
}

export function useDeepSynthesis(props) {
    const { ctx, view } = useRunContext();
    const { dMin, setDMin, maxMNT } = useMinThickness(props.design, ctx.runningRef);
    const [maxLayers, setMaxLayers] = usePersistentNumber(DEEP_MAX_LAYERS_KEY, DEEP_SYNTHESIS_WINDOW_DEFAULTS.maxLayers);
    const pool = useCatSelection(DEEP_CATS_KEY);
    const refs = { selectedCatsRef: pool.selectedCatsRef, excludedMatsRef: pool.excludedMatsRef };
    useSyncedContext(ctx, props, { dMin, maxLayers, refs });
    useDesignLifecycle(ctx, props.design?.id);
    useOptimizingFlag(view.running, props);
    const actions = useActions(ctx);
    return { view, dMin, setDMin, maxMNT, maxLayers, setMaxLayers, pool, actions };
}
