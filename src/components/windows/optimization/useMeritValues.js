import { designMaterialLookup } from '../../../utils/materials/designMaterials.js';
import { withDesignSampleCounts, makeConeSpec, coneIsActive } from '../../../utils/physics/optimizer.js';
import {
    evaluateForDisplay, meritDisplay, atDefaultSteps, provisionalRows, provisionalMerit, receivedDisplay,
} from '../../../utils/physics/meritDisplay.js';
import { useAnalysisEvaluation } from '../analysis/useAnalysisEvaluation.js';

const { useMemo, useRef } = React;

const NO_VALUES = Object.freeze({ computed: [], errors: [], bandLevels: [], mf: null, omf: null });

/**
 * How useMeritValues reads the rows: `here` evaluates them on the window's
 * thread, `operation` is the analysis worker's evaluation and `payload` what it
 * is sent, `received` turns its answer into values, and `none` stands for no
 * values. `meritOnly` says that only the MF and OMF are shown, which a row
 * without a weight leaves as they are. The merit tables' reading samples band
 * rows for the design's fringes (evaluateForDisplay).
 */
const MERIT_TABLE = Object.freeze({
    none: NO_VALUES,
    here: evaluateForDisplay,
    operation: 'meritDisplay',
    payload: (design, operands) => ({
        design, operands: withDesignSampleCounts(operands, design, designMaterialLookup(design)),
    }),
    received: receivedDisplay,
    meritOnly: false,
});

/** The merit tables' reading for a readout that shows only the MF and OMF. */
export const MERIT_ONLY = Object.freeze({ ...MERIT_TABLE, meritOnly: true });

/**
 * A reading of the MF and OMF that samples band rows for the fringes of `grid`
 * whichever design it evaluates, as a preview of an edit is scored on the grid
 * of the design it edits. The rows are sampled after the first pass has set
 * them at their default steps, since a row sampled at its own Step keeps that
 * Step's count.
 */
export function sampledOn(grid) {
    const resolve = designMaterialLookup(grid);
    const sample = operands => withDesignSampleCounts(operands, grid, resolve);
    return Object.freeze({
        ...MERIT_ONLY,
        here: (design, operands) => meritDisplay(design, sample(operands)),
        payload: (design, operands) => ({ design, operands: sample(operands) }),
    });
}

/**
 * The MF or OMF (`key`) of merit values as calcMF gives it: Infinity where a
 * row has no value, which the values carry as no merit at all.
 */
export function meritOrInfinity(values, key) {
    return values.errors.some(Boolean) ? Infinity : values[key];
}

function evaluateHere(reading, design, operands) {
    try { return reading.here(design, operands); }
    catch { return reading.none; }
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
        return shown(s.none, null, false, { failed: true });
    }
    return last.current?.rows === s.rows ? { ...last.current.shown, busy: true } : shown(s.none, null, false, { busy: true });
}

/**
 * The values the merit tables of the Merit Function Editor and the Refinement
 * window show for `operands` on `design`: each row's value and error, the band
 * levels, and the MF and OMF, with `provisional` (one flag per row, or null)
 * and `mfProvisional` marking those read at a default step. `reading` reads
 * the rows another way for a readout outside the tables: on another design's
 * grid (sampledOn), or an evaluation of its own, such as Layer Sensitivity's.
 * The rows are given as the design holds them, not sampled yet.
 *
 * A row with a fine Step over a wide band takes seconds to evaluate, so the
 * rows are evaluated at once on the window's own thread at their default steps
 * (atDefaultSteps), and again on the analysis worker at their own Steps, whose
 * values replace the first ones when they are for the design and rows still on
 * screen. A row whose first value can differ from its own (provisionalRows) is
 * marked until then, and stays marked if the worker fails; the MF and OMF are
 * marked when such a row has a weight. With no enabled row of a Step of its own
 * the first values are the final ones and the worker is not asked, nor for a
 * reading of the MF and OMF alone (`meritOnly`) when no such row has a weight.
 *
 * While `hold` is on (an optimizer run is being followed) the worker is not
 * asked: a new design every quarter second would only cancel each evaluation
 * before it ends. Under a cone of incidence every row averages many rays, so
 * nothing is evaluated here and the worker answers alone (underCone), at the
 * default steps and with the same rows marked while `hold` is on. `busy` is on
 * while it works there, and `failed` when it could not.
 */
export function useMeritValues(design, operands, hold, reading = MERIT_TABLE) {
    const empty = !design || operands.length === 0;
    const cone = !empty && coneIsActive(makeConeSpec(design.cone || {}));
    const marks = useMemo(() => provisionalRows(operands), [operands]);
    const mfMarked = useMemo(() => provisionalMerit(operands, marks), [operands, marks]);
    const designId = design?.id;
    const rows = useMemo(() => [designId, ...operands.map(op => op.id)].join('\n'), [designId, operands]);
    const coarse = useMemo(() => atDefaultSteps(operands), [operands]);
    const quick = useMemo(
        () => (empty || cone ? reading.none : evaluateHere(reading, design, coarse)),
        [reading, design, coarse, empty, cone]);

    const changes = reading.meritOnly ? mfMarked : marks != null;
    const wanted = !empty && (cone || (changes && !hold));
    const sent = cone && hold ? coarse : operands;
    const payload = useMemo(
        () => (wanted ? reading.payload(design, sent) : null),
        [reading, wanted, design, sent]);
    const worker = useAnalysisEvaluation(wanted, reading.operation, payload);
    const current = wanted && worker.payload === payload;
    const answer = current ? worker.data : null;
    const received = useMemo(() => (answer ? reading.received(answer) : null), [reading, answer]);
    const failed = current && !!worker.error;

    const last = useRef(null);
    return useMemo(() => {
        if (cone) return underCone({ received, failed, hold, marks, mfMarked, rows, none: reading.none }, last);
        last.current = null;
        if (empty) return shown(reading.none);
        return received ? shown(received) : shown(quick, marks, mfMarked);
    }, [reading, empty, cone, received, failed, hold, marks, mfMarked, rows, quick]);
}
