import { useDesign } from '../../../../state/DesignContext.js';
import { computeStress } from './model.js';
import { stressViewSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo } = React;

/**
 * The window's state: the computed stress, and the four design fields the
 * dialog behind it asks for.
 *
 * The temperatures, the substrate thickness and its diameter are written back
 * to the design rather than kept here, so the same file prints the same table
 * anywhere and the STR merit operand scores against the same numbers. The
 * substrate thickness is the one the Design Editor already carries; editing it
 * here edits that.
 */
export function useStressAnalysis() {
    const { design, evalMode, updateDesign } = useDesign();
    const [view, setViewField] = useWindowSession(stressViewSession, design);
    const result = useMemo(
        () => (design ? computeStress(design, evalMode) : null),
        [design, evalMode],
    );

    // Setting either temperature creates the block, and from then on the other
    // one reads as 20 °C rather than as absent. Clearing one drops it back out
    // again, and the last one out takes the block with it: a block holding
    // nothing is still a block, and would leave the design on a thermal run it
    // no longer describes, with no way back to stating no process at all.
    const setTemperature = (key, value) => {
        const next = { ...(design?.stress || {}), [key]: value };
        for (const field of Object.keys(next)) {
            if (next[field] == null) delete next[field];
        }
        updateDesign({ stress: Object.keys(next).length ? next : undefined });
    };
    const setSubstrate = (key, value) => updateDesign({
        substrate: { ...(design?.substrate || {}), [key]: value },
    });

    return {
        design, evalMode, result,
        showWhole: view.showWhole,
        setShowWhole: value => setViewField('showWhole', value),
        showTable: view.showTable,
        setShowTable: value => setViewField('showTable', value),
        temperatureC: design?.stress?.temperatureC ?? null,
        depositionTemperatureC: design?.stress?.depositionTemperatureC ?? null,
        thicknessMm: design?.substrate?.thickness ?? null,
        diameterMm: design?.substrate?.diameterMm ?? null,
        hasRun: !!design?.stress,
        setTemperatureC: value => setTemperature('temperatureC', value),
        setDepositionTemperatureC: value => setTemperature('depositionTemperatureC', value),
        setThicknessMm: value => setSubstrate('thickness', value),
        setDiameterMm: value => setSubstrate('diameterMm', value),
    };
}
