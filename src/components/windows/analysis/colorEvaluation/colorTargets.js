/**
 * The merit function's colour rows that Color Evaluation draws on its diagram:
 * the RCOL rows over R and the TCOL rows over T, scored at the window's
 * polarization, illuminant and observer. The window and the merit function
 * compute the same side in each environment, so the side needs no check.
 *
 * A row is drawn on the diagram of its own coordinates. Two rows at one angle
 * that fix a point on a diagram's plane meet in one diamond there, labelled
 * with the angle: x and y on x, y; u′ and v′ on u′, v′; a* and b*, or C*ab and
 * hab, on the two CIELAB diagrams, which show one plane; u* and v*, or C*uv
 * and huv, on C*uv, huv. The k-th row of a coordinate at an angle pairs with
 * the k-th row of its partner there. A row with no partner, Y, L* and the
 * quantities no plane holds (λd, purity, CCT, Duv) are not drawn.
 */
import { formatTheta } from '../opticalEvaluation/model.js';

const ROW_TYPES = { R: 'RCOL', T: 'TCOL' };
const DEGREE = Math.PI / 180;

const cartesian = (first, second) => [first, second];
// C* is the distance from the white and h the angle from the positive first
// axis, degrees (CIE 15:2004 §8.2).
const polar = (chroma, hue) => [chroma * Math.cos(hue * DEGREE), chroma * Math.sin(hue * DEGREE)];

const CIELAB = [[['a*', 'b*'], cartesian], [['C*ab', 'hab'], polar]];
const PLANE_PAIRS = {
    xy: [[['x', 'y'], cartesian]],
    uv: [[["u'", "v'"], cartesian]],
    ab: CIELAB,
    chAb: CIELAB,
    chUv: [[['u*', 'v*'], cartesian], [['C*uv', 'huv'], polar]],
};

// What a row is scored under that must be what the window shows for the row
// to be drawn; the average polarization is the unset default.
const AGREES = [
    (op, view) => op.type === ROW_TYPES[view.characteristic],
    (op, view) => (op.pol || 'avg') === view.pol,
    (op, view) => op.illuminant === view.illuminant,
    (op, view) => String(op.observer) === String(view.observer),
];

// The targets of `rows` in the coordinates `quantities`, as `{ aoi, values }`,
// one per pair of rows at one angle.
function pairsOf(rows, quantities) {
    const byAngle = new Map();
    for (const op of rows) {
        const k = quantities.indexOf(op.color);
        if (k < 0) continue;
        const aoi = Number(op.aoi) || 0;
        if (!byAngle.has(aoi)) byAngle.set(aoi, [[], []]);
        byAngle.get(aoi)[k].push(Number(op.target));
    }
    return [...byAngle].flatMap(([aoi, [firsts, seconds]]) => firsts
        .slice(0, seconds.length)
        .map((value, i) => ({ aoi, values: [value, seconds[i]] })));
}

/**
 * The diamonds the diagram `view.diagram` draws for the merit rows `rows`,
 * each `{ value: [first, second], label }` on the diagram's plane, as
 * buildChromaticityOption takes its targets (chartFigure.js). `view` holds the
 * window's characteristic, pol, illuminant and observer ('2' or '10').
 */
export function colorTargetMarks(rows, view) {
    const scored = (rows || []).filter(op => op.enabled && Number.isFinite(Number(op.target))
        && AGREES.every(agrees => agrees(op, view)));
    return (PLANE_PAIRS[view.diagram] || []).flatMap(([quantities, toPlane]) => pairsOf(scored, quantities)
        .map(({ aoi, values }) => ({ value: toPlane(...values), label: `${formatTheta(aoi)}°` })));
}
