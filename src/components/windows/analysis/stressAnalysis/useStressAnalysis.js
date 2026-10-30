import { useCatalogRevision } from '../../../../utils/materials/useCatalogRevision.js';
import { useDesign } from '../../../../state/DesignContext.js';
import { computeStress, stressBlockWith } from './model.js';
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
    // Every number here comes off the materials rather than off the design, so
    // an edited constant has to reach the table without the design moving.
    const catalogRevision = useCatalogRevision();
    const result = useMemo(
        () => computeStress(design, evalMode),
        [design, evalMode, catalogRevision],
    );

    const setTemperature = (key, value) => updateDesign({
        stress: stressBlockWith(design?.stress, { [key]: value }),
    });
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
