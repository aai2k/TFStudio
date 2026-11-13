import { useCatalogRevision } from '../../../../utils/materials/useCatalogRevision.js';
import { useDesign } from '../../../../state/DesignContext.js';
import { BASE_ENVIRONMENT, environmentById, environmentDesign } from '../../../../utils/environments/environments.js';
import { temperatureChange } from '../../../../utils/environments/environmentTemperature.js';
import { toSignificantFigures } from '../../../../utils/math/significantFigures.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { computeStress, stressBlockWith } from './model.js';
import { stressViewSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo } = React;

const NONE_HELD = Object.freeze({ temperatureC: false, thicknessMm: false });

/**
 * The fields of the run and the part that environment `id` of `design`
 * computes with values of its own, which a number typed into the window could
 * not set: at another temperature its stress temperature, moved by the change,
 * once the design states a stress run (without one there is no temperature to
 * move); and its substrate thickness, when it sets one or its temperature
 * changes it. `shown` is the design that environment computes. Environment 1
 * holds none: its fields are the design's own.
 */
export function heldFields(design, id, shown) {
    if (id === BASE_ENVIRONMENT) return NONE_HELD;
    const env = environmentById(design, id);
    return {
        temperatureC: Boolean(design.stress) && temperatureChange(design, env) !== 0,
        thicknessMm: env.substrate?.thickness != null || shown.substrate?.thickness !== design.substrate?.thickness,
    };
}

// A field's value: the design's own as typed, or one the environment shown
// computes (heldFields) to five figures, as many as the field holds.
const fieldValue = (value, held) => (value == null || !held ? value ?? null : Number(toSignificantFigures(value, 5)));

/**
 * The window's state: the computed stress, and the four design fields the
 * dialog behind it asks for.
 *
 * The temperatures, the substrate thickness and its diameter are written back
 * to the design rather than kept here, so the same file prints the same table
 * anywhere and the STR merit operand scores against the same numbers. The
 * substrate thickness is the one the Design Editor already carries; editing it
 * here edits that.
 *
 * On a design with environments the stress is that of the environment the
 * droplist names, on what it is scored on, and the fields show the values it
 * computes with. A field it holds a value of its own for (heldFields) cannot
 * be edited while it is shown; the others are the design's own.
 */
export function useStressAnalysis() {
    const { design, updateDesign } = useDesign();
    const [view, setViewField] = useWindowSession(stressViewSession, design);
    const environment = useEnvironmentChoice(design);
    const { id, mode: evalMode, label } = environment.views[0];
    // Every number here comes off the materials rather than off the design, so
    // an edited constant has to reach the table without the design moving: an
    // environment at another temperature is built again from them too.
    const catalogRevision = useCatalogRevision();
    const shown = useMemo(() => environmentDesign(design, id), [design, id, catalogRevision]);
    const result = useMemo(
        () => computeStress(shown, evalMode),
        [shown, evalMode, catalogRevision],
    );

    const setTemperature = (key, value) => updateDesign({
        stress: stressBlockWith(design?.stress, { [key]: value }),
    });
    const setSubstrate = (key, value) => updateDesign({
        substrate: { ...(design?.substrate || {}), [key]: value },
    });

    const held = heldFields(design, id, shown);

    return {
        design, evalMode, result, environment,
        held, heldBy: label,
        showWhole: view.showWhole,
        setShowWhole: value => setViewField('showWhole', value),
        showTable: view.showTable,
        setShowTable: value => setViewField('showTable', value),
        temperatureC: fieldValue(shown?.stress?.temperatureC, held.temperatureC),
        depositionTemperatureC: shown?.stress?.depositionTemperatureC ?? null,
        thicknessMm: fieldValue(shown?.substrate?.thickness, held.thicknessMm),
        diameterMm: shown?.substrate?.diameterMm ?? null,
        hasRun: !!shown?.stress,
        setTemperatureC: value => setTemperature('temperatureC', value),
        setDepositionTemperatureC: value => setTemperature('depositionTemperatureC', value),
        setThicknessMm: value => setSubstrate('thickness', value),
        setDiameterMm: value => setSubstrate('diameterMm', value),
    };
}
