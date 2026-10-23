import { designMaterialLookup } from '../../../utils/materials/designMaterials.js';
import { withDesignSampleCounts, makeConeSpec, coneIsActive } from '../../../utils/physics/optimizer.js';
import {
    evaluateForDisplay, atDefaultSteps, provisionalRows, provisionalMerit, receivedDisplay,
} from '../../../utils/physics/meritDisplay.js';
import { useAnalysisEvaluation } from '../analysis/useAnalysisEvaluation.js';

const { useMemo, useRef } = React;

const NO_VALUES = Object.freeze({ computed: [], errors: [], bandLevels: [], mf: null, omf: null });

function evaluateHere(design, operands) {
    try { return evaluateForDisplay(design, operands); }
    catch { return NO_VALUES; }
}

// `values` as shown: `marks` says which rows were read at a default step where
// they have a Step of their own (provisionalRows), null for none, and
// `mfMarked` whether that reaches the MF and OMF.
function shown(values, marks = null, mfMarked = false, extra = {}) {
    return { ...values, provisional: marks, mfProvisional: mfMarked, busy: false, failed: false, ...extra };
}

// Under a cone: the worker's values. While a run is followed it reads the
// default steps, and the rows that then can read otherwise than at their own
// Steps are marked. While it works, the last values it gave stay as long as
// they are for the same design and rows; after a failure, nothing does.
function underCone(s, last) {
    if (s.received) {
        const coarse = s.hold && s.marks != null;
        last.current = { shown: shown(s.received, coarse ? s.marks : null, coarse && s.mfMarked), rows: s.rows };
        return last.current.shown;
    }
    if (s.failed) {
        last.current = null;
        return shown(NO_VALUES, null, false, { failed: true });
    }
    return last.current?.rows === s.rows ? { ...last.current.shown, busy: true } : shown(NO_VALUES, null, false, { busy: true });
}

/**
 * The values the merit tables of the Merit Function Editor and the Refinement
 * window show for `operands` on `design`: each row's value and error, the band
 * levels, and the MF and OMF, with `provisional` (one flag per row, or null)
 * and `mfProvisional` marking those read at a default step.
 *
 * A row with a fine Step over a wide band takes seconds to evaluate, so the
 * rows are evaluated at once on the window's own thread at their default steps
 * (atDefaultSteps), and again on the analysis worker at their own Steps, whose
 * values replace the first ones when they are for the design and rows still on
 * screen. A row whose first value can differ from its own (provisionalRows) is
 * marked until then, and stays marked if the worker fails; the MF and OMF are
 * marked when such a row has a weight. With no enabled row of a Step of its own
 * the first values are the final ones and the worker is not asked.
 *
 * While `hold` is on (an optimizer run is being followed) the worker is not
 * asked: a new design every quarter second would only cancel each evaluation
 * before it ends. Under a cone of incidence every row averages many rays, so
 * nothing is evaluated here and the worker answers alone (underCone), at the
 * default steps and with the same rows marked while `hold` is on. `busy` is on
 * while it works there, and `failed` when it could not.
 */
export function useMeritValues(design, operands, hold) {
    const empty = !design || operands.length === 0;
    const cone = !empty && coneIsActive(makeConeSpec(design.cone || {}));
    const marks = useMemo(() => provisionalRows(operands), [operands]);
    const mfMarked = useMemo(() => provisionalMerit(operands, marks), [operands, marks]);
    const designId = design?.id;
    const rows = useMemo(() => [designId, ...operands.map(op => op.id)].join('\n'), [designId, operands]);
    const coarse = useMemo(() => atDefaultSteps(operands), [operands]);
    const quick = useMemo(
        () => (empty || cone ? NO_VALUES : evaluateHere(design, coarse)),
        [design, coarse, empty, cone]);

    const wanted = !empty && (cone || (marks != null && !hold));
    const sent = cone && hold ? coarse : operands;
    const payload = useMemo(
        () => (wanted ? { design, operands: withDesignSampleCounts(sent, design, designMaterialLookup(design)) } : null),
        [wanted, design, sent]);
    const worker = useAnalysisEvaluation(wanted, 'meritDisplay', payload);
    const current = wanted && worker.payload === payload;
    const answer = current ? worker.data : null;
    const received = useMemo(() => (answer ? receivedDisplay(answer) : null), [answer]);
    const failed = current && !!worker.error;

    const last = useRef(null);
    return useMemo(() => {
        if (cone) return underCone({ received, failed, hold, marks, mfMarked, rows }, last);
        last.current = null;
        if (empty) return shown(NO_VALUES);
        return received ? shown(received) : shown(quick, marks, mfMarked);
    }, [empty, cone, received, failed, hold, marks, mfMarked, rows, quick]);
}
