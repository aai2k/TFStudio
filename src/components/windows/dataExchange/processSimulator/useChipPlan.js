import { assignChips } from '../../../../utils/monitoring/monoSim.js';
import { monitorWorksheetSession } from '../../simulation/monitorWorksheet/sessionState.js';
import { planForSteps } from '../../simulation/monitorWorksheet/useMonitorWorksheet.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useMemo } = React;

/**
 * The witness chip plan of the run, shared with the Monitor Worksheet: the
 * same store, so a chip number, a chip glass or a witness ratio entered in
 * either window is what the other one shows.
 *
 * `stepCount` is the active side's layer count, zero-thickness layers
 * included, which is how the worksheet indexes its plan. A plan of another
 * length belongs to another stack and gives way to the plain division by chip
 * size. `plan` is null while `enabled` is off, so the part is modelled instead.
 */
export function useChipPlan(design, stepCount, enabled) {
    const [session, setField, patch] = useWindowSession(monitorWorksheetSession, design);

    const chipByStep = useMemo(
        () => planForSteps(session.chipByStep, stepCount) || assignChips(stepCount, session.layersPerChip),
        [session.chipByStep, session.layersPerChip, stepCount]);

    // `step` is the layer's deposition index over the whole side, 0-based.
    const setChipForStep = useCallback((step, chip) => {
        const next = chipByStep.slice();
        next[step] = Math.max(1, Math.round(chip) || 1);
        setField('chipByStep', next);
    }, [chipByStep, setField]);

    // Changing the chip size re-plans the whole run, as it does in the worksheet.
    const setLayersPerChip = useCallback(value => {
        patch({ layersPerChip: value, chipByStep: null });
    }, [patch]);
    const setChipMaterial = useCallback(value => setField('chipMaterial', value), [setField]);
    const setWitnessRatio = useCallback(value => setField('witnessRatio', value), [setField]);

    const plan = useMemo(() => (enabled ? {
        chipByStep,
        chipMaterial: session.chipMaterial,
        witnessRatio: session.witnessRatio,
    } : null), [enabled, chipByStep, session.chipMaterial, session.witnessRatio]);

    return {
        plan,
        layersPerChip: session.layersPerChip,
        chipMaterial: session.chipMaterial,
        witnessRatio: session.witnessRatio,
        setChipForStep, setLayersPerChip, setChipMaterial, setWitnessRatio,
    };
}
