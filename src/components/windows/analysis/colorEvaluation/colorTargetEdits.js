/**
 * Colour targets edited on Color Evaluation's diagram. A target there is the
 * two merit rows that meet in one diamond (colorTargets.js): a drawing writes
 * two, a drag moves their targets, a delete removes both. Each gesture returns
 * the design's merit rows with the change made, so the Merit Function Editor
 * shows the same rows and the change is one undo step.
 */
import { makeOperand } from '../../../../utils/physics/optimizer.js';
import { TARGET_PLACES } from '../../optimization/meritFunctionEditor/colorTargetModel.js';
import { reportsPlane } from './chartFigure.js';
import { DRAWN_PAIRS, ROW_TYPES } from './colorTargets.js';

// The places a coordinate placed on the diagram is kept to, as the merit
// wizard's colour targets keep it: three for x, y and u′, v′, two for a*, b*.
// C*ab, hab, u*, v*, C*uv and huv lie on the same planes as a*, b*, in the
// same units or in degrees, and keep two: 0.01° of hue at a chroma of 100 is
// under 0.02 ΔE*ab.
const PLACES = {
    x: TARGET_PLACES.xyY[0], y: TARGET_PLACES.xyY[1],
    "u'": TARGET_PLACES.uvY[0], "v'": TARGET_PLACES.uvY[1],
};
const placesOf = quantity => PLACES[quantity] ?? TARGET_PLACES.Lab[1];

/** The values `pair` holds at `point` on the plane, each kept to its places. */
export function valuesAt(pair, point) {
    return pair.fromPlane(...point).map((value, k) => Number(value.toFixed(placesOf(pair.quantities[k]))));
}

/**
 * Of the coating's points on the diagram `diagram`, the entry of `reports`
 * (each `{ theta, report, env }`, as the window shows them) nearest `point`
 * on the plane.
 */
export function nearestCoating(reports, diagram, point) {
    const plane = reportsPlane(reports, diagram);
    let nearest = null;
    let least = Infinity;
    for (const entry of reports) {
        const [p, q] = plane.ofReport(entry.report);
        const distance = Math.hypot(p - point[0], q - point[1]);
        if (distance < least) {
            nearest = entry;
            least = distance;
        }
    }
    return nearest;
}

/**
 * The environment a target drawn beside the coating point `entry` is scored
 * in: under All the one that point is drawn for, otherwise the one shown; none
 * on a design with one environment. `environment` is the window's choice
 * (chrome/environmentChoice.js).
 */
export function scoredEnvironment(entry, environment) {
    if (!environment.shown) return null;
    const number = entry.env?.number ?? environment.views[0].number;
    return environment.views.find(view => view.number === number)?.id ?? null;
}

/**
 * The merit rows `operands` with a target added at `point` on the diagram
 * `view.diagram`: a row of each coordinate that diagram is drawn in, the RCOL
 * or TCOL of the side shown, at the window's polarization, illuminant and
 * observer, weight 1, after the last row. The two take the angle `aoi`, in
 * degrees, or with none the angle of the coating point nearest `point`; they
 * are scored in the environment of the point nearest `point` at that angle.
 */
export function createColorTarget({ operands, point, view, reports, environment, aoi = null }) {
    const pair = DRAWN_PAIRS[view.diagram];
    const atAngle = aoi == null ? [] : reports.filter(entry => entry.theta === aoi);
    const nearest = nearestCoating(atAngle.length ? atAngle : reports, view.diagram, point);
    const env = scoredEnvironment(nearest, environment);
    const values = valuesAt(pair, point);
    const rows = pair.quantities.map((color, k) => makeOperand({
        type: ROW_TYPES[view.characteristic], color, target: values[k], aoi: nearest.theta, pol: view.pol,
        illuminant: view.illuminant, observer: Number(view.observer), weight: 1,
        ...(env == null ? {} : { env }),
    }));
    return [...operands, ...rows];
}

/** `operands` with the two rows of the diamond `mark` moved to `point` on the plane. */
export function moveColorTarget(operands, mark, point) {
    const values = valuesAt(mark.pair, point);
    return operands.map(op => {
        const k = mark.rows.indexOf(op.id);
        return k < 0 ? op : { ...op, target: values[k] };
    });
}

/** `operands` without the two rows of the diamond `mark`. */
export function deleteColorTarget(operands, mark) {
    return operands.filter(op => !mark.rows.includes(op.id));
}

/** The name the target editor overlay knows the diamond `mark` by: its two rows' ids. */
export const markKey = mark => mark.rows.join(' ');

/** The diamonds `marks` as the target editor overlay takes them: points dragged anywhere, in `color`. */
export function editableColorTargets(marks, color) {
    return marks.map(mark => ({
        opId: markKey(mark), shape: 'point', free: true, x0: mark.value[0], y0: mark.value[1], color,
    }));
}
