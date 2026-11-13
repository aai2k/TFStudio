/**
 * The colour Color Evaluation shows, computed in each environment its
 * Environment droplist names (chrome/environmentChoice.js), each from the
 * design that environment computes, in that environment's evaluation mode;
 * environment 1's is the design itself. When any of them computes under a
 * cone of incidence the colour is computed on the analysis worker, otherwise
 * on the window's thread.
 */
import { rangeMaterials } from '../../../../utils/materials/materialRange.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';
import { computeEnvironmentReports, shownReports } from './colorModel.js';

const { useState, useEffect, useMemo } = React;

/**
 * `options` are computeColorReports' own, without the design. Returns
 * `{ environment, reports, materials, coneActive, busy, error }`: the
 * droplist's choice (useEnvironmentChoice), the reports the window shows
 * (shownReports), the materials its range notice reads, those of the sides
 * computed in every environment shown, whether the cone puts the colour on the
 * worker and the worker is still at it, and what failed: the worker's error
 * under a cone, the message of the failure otherwise, or null.
 */
export function useColorReports(design, options) {
    const [error, setError] = useState(null);
    useEffect(() => { setError(null); }, [options.evalMode]);
    const environment = useEnvironmentChoice(design, { overlay: true });
    const { views, every } = environment;
    const coneActive = views.some(view => view.coned);
    const designs = useMemo(() => views.map(view => view.design), [views]);
    const evalModes = useMemo(() => views.map(view => view.mode), [views]);
    const materials = useMemo(
        () => views.flatMap(view => rangeMaterials(view.design, view.mode)), [views]);
    const payload = useMemo(() => ({ designs, options, evalModes }), [designs, options, evalModes]);
    const worker = useAnalysisEvaluation(coneActive, 'colorReports', payload);
    const direct = useMemo(
        () => (coneActive ? null : computeEnvironmentReports(designs, { ...options, setError }, evalModes)),
        [coneActive, designs, options, evalModes]);
    const sets = coneActive ? worker.data : direct;
    const reports = useMemo(() => shownReports(sets, every, views), [sets, every, views]);
    return {
        environment, reports, materials, coneActive,
        busy: coneActive && worker.busy,
        error: coneActive ? worker.error : error,
    };
}
