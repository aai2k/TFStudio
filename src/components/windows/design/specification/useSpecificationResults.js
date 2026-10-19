import { evaluateQualifiers, SPECIFICATION_FLAG } from '../../../../utils/synthesis/qualifiers.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { coneIsActive, makeConeSpec } from '../../../../utils/physics/optimizer.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useAnalysisEvaluation } from '../../analysis/useAnalysisEvaluation.js';

const { useMemo, useRef } = React;

const pending = qualifiers => qualifiers.map(() => ({ value: null, pass: null }));

// The analysis worker's pass: every check at its own Step, and FWHM and edge
// checks at SPECIFICATION_FLAG. The first pass, on the window's own thread or
// while a run is followed, searches every peak at the default 1 nm.
const FINE = Object.freeze({ flag: SPECIFICATION_FLAG });
const COARSE = Object.freeze({ coarse: true });

function evaluateHere(qualifiers, design) {
    try { return evaluateQualifiers(qualifiers, design, designMaterialLookup(design), COARSE); }
    catch { return pending(qualifiers); }
}

// The last list of designs while `designs` holds the same ones in the same
// order, so a new array of the designs already evaluated asks for nothing new.
function useSameDesigns(designs) {
    const kept = useRef(designs);
    const same = kept.current.length === designs.length && kept.current.every((d, i) => d === designs[i]);
    if (!same) kept.current = designs;
    return kept.current;
}

/**
 * Each design's Specification results as `options` asks (evaluate.js), by
 * default every check at its own Step and FWHM and edge checks at
 * SPECIFICATION_FLAG, worked out on the analysis worker, since a search at a
 * fine step takes a tenth of a second or more per check. An array in the order
 * of `designs`, with null for a design that could not be evaluated; null itself
 * while the work is under way, or when `active` is off and no results for these
 * designs are held.
 */
export function useFineSpecification(list, active, options = FINE) {
    const designs = useSameDesigns(list);
    const payload = useMemo(() => ({ designs, ...options }), [designs, options]);
    const wanted = active && designs.some(d => d.qualifiers?.length > 0);
    const fine = useAnalysisEvaluation(wanted, 'specification', payload);
    return fine.payload === payload ? fine.data : null;
}

/**
 * The checks' results on the design being shown.
 *
 * Each check is worked out at once with every peak searched at the default
 * 1 nm, so the window answers an edit straight away, and again on the analysis
 * worker (useFineSpecification) at the checks' own steps, whose results replace
 * the first ones when they are for the design and checks still on screen.
 *
 * While a run is being followed (useLiveDesign) the window shows the 1 nm
 * results, four times a second, and asks the worker for nothing: a new design
 * every quarter second would only cancel each fine evaluation before it ends.
 * The fine results follow once the run stops. With the window closed nothing
 * is evaluated.
 *
 * Under a cone of incidence every check averages many rays, which on a thick
 * design takes seconds, so nothing is worked out here: the analysis worker
 * answers alone, as it does for the Merit Function Editor's table, at the
 * default step while a run is followed.
 */
export function useSpecificationResults(qualifiers) {
    const { design, preview } = useLiveDesign();
    const cone = coneIsActive(makeConeSpec(design?.cone || {}));
    const quick = useMemo(() => (cone ? pending(qualifiers) : evaluateHere(qualifiers, design)), [qualifiers, design, cone]);
    const designs = useMemo(() => [{ ...design, qualifiers }], [design, qualifiers]);
    const fine = useFineSpecification(designs, !preview || cone, cone && preview ? COARSE : FINE);
    return fine?.[0] || quick;
}
