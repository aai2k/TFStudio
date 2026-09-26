import { applyLayers } from './layerActions.js';
import { createStepBursts, stepLayerThicknesses, thicknessStep } from './thicknessStep.js';

const { useCallback, useRef } = React;

// A second without a step ends a burst. Ticks within one wheel spin arrive tens
// of milliseconds apart and clicks in a run a few hundred, so a longer pause is
// a new gesture with its own undo step.
const BURST_GAP_MS = 1000;

/**
 * Step handler for the thickness cells, as `(rowId, unit, ticks, modifiers)`
 * with `ticks` a signed count of steps. A row inside the selection steps every
 * selected layer with it; a row outside it steps alone. Each step reaches the
 * design at once, so every open window follows it, and one Ctrl+Z takes back a
 * burst.
 *
 * Each write is rendered before the handler returns (flushSync), so the next
 * tick reads the stack it produced. A tick that arrived before React had
 * rendered would read the stack from before the burst, which is also what an
 * undo shows, and would be taken for one.
 */
export function useThicknessStep({ layers, side, design, updateDesign, selectedIds, refLambda }) {
    const latestRef = useRef(null);
    latestRef.current = { layers, side, design, updateDesign, selectedIds, refLambda };
    const burstsRef = useRef(null);
    if (!burstsRef.current) burstsRef.current = createStepBursts(BURST_GAP_MS);

    return useCallback((rowId, unit, ticks, modifiers) => {
        const current = latestRef.current;
        const ids = current.selectedIds.has(rowId) ? [...current.selectedIds].sort() : [rowId];
        const step = {
            amount: ticks * thicknessStep(unit, modifiers), unit,
            refLambda: current.refLambda, designMaterials: current.design.materials,
        };
        const key = `${current.side}|${unit}|${ids.join(',')}`;
        const result = burstsRef.current.step(key, current.layers, performance.now(),
            base => stepLayerThicknesses(base, ids, step));
        if (!result) return;
        ReactDOM.flushSync(() => applyLayers(current.design, current.updateDesign, current.side,
            result.next, result.commit ? undefined : { transient: true, compareDirty: true }));
    }, []);
}
