import { makeConeSpec, coneIsActive } from '../../../utils/physics/optimizer.js';
import { useAnalysisEvaluation } from './useAnalysisEvaluation.js';

const { useMemo } = React;

/**
 * `compute(payload)` for `design`, the way Optical Evaluation evaluates its
 * spectrum: on the calling thread in collimated light, and in the analysis
 * worker as `operation` under a cone of incidence, where every point costs one
 * evaluation per ray. Returns { data, error, busy } either way; `compute`
 * reports its own failures, so the calling thread never sets `error`.
 */
export function useEvaluationUnderCone(design, operation, payload, compute) {
    const coneActive = coneIsActive(makeConeSpec(design?.cone || {}));
    const evaluation = useAnalysisEvaluation(coneActive, operation, payload);
    const direct = useMemo(
        () => (coneActive ? null : compute(payload)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [coneActive, payload],
    );
    return coneActive ? evaluation : { data: direct, error: null, busy: false };
}
