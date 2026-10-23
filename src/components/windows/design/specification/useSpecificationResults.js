import { evaluateQualifiers, hasOwnStep } from '../../../../utils/synthesis/qualifiers.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { coneIsActive, makeConeSpec } from '../../../../utils/physics/optimizer.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useAnalysisEvaluation } from '../../analysis/useAnalysisEvaluation.js';

const { useMemo, useRef } = React;

const pending = qualifiers => qualifiers.map(() => ({ value: null, pass: null }));

// The analysis worker's pass reads every check at its own Step. The first
// pass, on the window's own thread or while a run is followed, reads every
// check at its default step.
const OWN = Object.freeze({});
const COARSE = Object.freeze({ coarse: true });

function evaluateHere(qualifiers, design) {
    try { return evaluateQualifiers(qualifiers, design, designMaterialLookup(design), COARSE); }
    catch { return pending(qualifiers); }
}

// Results of the first pass, each marked provisional where its check has a
// Step of its own (hasOwnStep), which that pass does not read at: such a check
// can read otherwise than the row Generate MF writes for it until its own
// value arrives.
export function markProvisional(qualifiers, results) {
    return results.map((r, i) => (r && r.pass != null && hasOwnStep(qualifiers[i]) ? { ...r, provisional: true } : r));
}

// The last list of designs while `designs` holds the same ones in the same
// order, so a new array of the designs already evaluated asks for nothing new.
export function useSameDesigns(designs) {
    const kept = useRef(designs);
    const same = kept.current.length === designs.length && kept.current.every((d, i) => d === designs[i]);
    if (!same) kept.current = designs;
    return kept.current;
}

/**
 * Each design's Specification results as `options` asks (evaluate.js), by
 * default every check at its own Step, worked out on the analysis worker, since
 * a fine Step can take a tenth of a second or more per check. `options` may
 * also carry the recipe a tolerance window judges its designs with, a
 * deviation or interlayers (analysis/toleranceSpecInputs.js). An array in the
 * order of `designs`, with null for a design that could not be evaluated; null
 * itself while the work is under way, or when `active` is off and no results
 * for these designs are held.
 */
export function useFineSpecification(list, active, options = OWN) {
    const designs = useSameDesigns(list);
    const payload = useMemo(() => ({ designs, ...options }), [designs, options]);
    const wanted = active && designs.some(d => d.qualifiers?.length > 0);
    const fine = useAnalysisEvaluation(wanted, 'specification', payload);
    return fine.payload === payload ? fine.data : null;
}

/**
 * The checks' results on the design being shown.
 *
 * Each check is worked out at once at its default step, so the window answers
 * an edit straight away, and again on the analysis worker
 * (useFineSpecification) at its own Step, whose results replace the first ones
 * when they are for the design and checks still on screen.
 *
 * While a run is being followed (useLiveDesign) the window shows every check
 * at its default step, four times a second, and asks the worker for nothing: a
 * new design every quarter second would only cancel each evaluation before it
 * ends. The results at the checks' own Steps follow once the run stops. A
 * result read at a default step where its check has a Step of its own is
 * marked provisional (markProvisional). With the window closed nothing is
 * evaluated.
 *
 * Under a cone of incidence every check averages many rays, which on a thick
 * design takes seconds, so nothing is worked out here: the analysis worker
 * answers alone, as it does for the Merit Function Editor's table, at the
 * default step while a run is followed.
 */
export function useSpecificationResults(qualifiers) {
    const { design, preview } = useLiveDesign();
    const cone = coneIsActive(makeConeSpec(design?.cone || {}));
    const quick = useMemo(() => (cone ? pending(qualifiers) : markProvisional(qualifiers, evaluateHere(qualifiers, design))), [qualifiers, design, cone]);
    const designs = useMemo(() => [{ ...design, qualifiers }], [design, qualifiers]);
    const coarse = cone && preview;
    const fine = useFineSpecification(designs, !preview || cone, coarse ? COARSE : OWN)?.[0];
    if (!fine) return quick;
    return coarse ? markProvisional(qualifiers, fine) : fine;
}
