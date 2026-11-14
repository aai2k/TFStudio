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

/** The colour row type of each side the window shows. */
export const ROW_TYPES = { R: 'RCOL', T: 'TCOL' };
const DEGREE = Math.PI / 180;

// Two coordinates that fix a point on a plane, as Color list ids: `toPlane`
// places their two values on the plane and `fromPlane` reads them back from a
// point there.
const cartesian = quantities => ({ quantities, toPlane: (p, q) => [p, q], fromPlane: (p, q) => [p, q] });
// C* is the distance from the white and h the angle from the positive first
// axis, degrees, 0 to 360 (CIE 15:2004 §8.2).
const polar = quantities => ({
    quantities,
    toPlane: (chroma, hue) => [chroma * Math.cos(hue * DEGREE), chroma * Math.sin(hue * DEGREE)],
    fromPlane: (p, q) => [Math.hypot(p, q), (Math.atan2(q, p) / DEGREE + 360) % 360],
});

const XY = cartesian(['x', 'y']);
const UV = cartesian(["u'", "v'"]);
const LAB = cartesian(['a*', 'b*']);
const LCH_AB = polar(['C*ab', 'hab']);
const LUV = cartesian(['u*', 'v*']);
const LCH_UV = polar(['C*uv', 'huv']);

const PLANE_PAIRS = { xy: [XY], uv: [UV], ab: [LAB, LCH_AB], chAb: [LAB, LCH_AB], chUv: [LUV, LCH_UV] };

/** The two coordinates a target drawn on each diagram is written in: the ones it is drawn in. */
export const DRAWN_PAIRS = { xy: XY, uv: UV, ab: LAB, chAb: LCH_AB, chUv: LCH_UV };

// What a row is scored under that must be what the window shows for the row
// to be drawn; the average polarization is the unset default.
const AGREES = [
    (op, view) => op.type === ROW_TYPES[view.characteristic],
    (op, view) => (op.pol || 'avg') === view.pol,
    (op, view) => op.illuminant === view.illuminant,
    (op, view) => String(op.observer) === String(view.observer),
];

// The rows of `rows` in the coordinates `quantities`, as `{ aoi, ops }`, the
// two rows of one point at one angle.
function pairsOf(rows, quantities) {
    const byAngle = new Map();
    for (const op of rows) {
        const k = quantities.indexOf(op.color);
        if (k < 0) continue;
        const aoi = Number(op.aoi) || 0;
        if (!byAngle.has(aoi)) byAngle.set(aoi, [[], []]);
        byAngle.get(aoi)[k].push(op);
    }
    return [...byAngle].flatMap(([aoi, [firsts, seconds]]) => firsts
        .slice(0, seconds.length)
        .map((first, i) => ({ aoi, ops: [first, seconds[i]] })));
}

/**
 * The diamonds the diagram `view.diagram` draws for the merit rows `rows`,
 * each `{ value: [first, second], label, rows, pair }`: its point on the
 * diagram's plane and label, as buildChromaticityOption takes its targets
 * (chartFigure.js), the ids of its two rows and the coordinates they hold.
 * `view` holds the window's characteristic, pol, illuminant and observer ('2'
 * or '10').
 */
export function colorTargetMarks(rows, view) {
    const scored = (rows || []).filter(op => op.enabled && Number.isFinite(Number(op.target))
        && AGREES.every(agrees => agrees(op, view)));
    return (PLANE_PAIRS[view.diagram] || []).flatMap(pair => pairsOf(scored, pair.quantities)
        .map(({ aoi, ops }) => ({
            value: pair.toPlane(...ops.map(op => Number(op.target))),
            label: `${formatTheta(aoi)}°`,
            rows: ops.map(op => op.id),
            pair,
        })));
}
