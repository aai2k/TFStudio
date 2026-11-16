/**
 * The parts of a polyline inside an axis-aligned box.
 *
 * Each segment is cut by the Liang-Barsky parametric test (Liang and Barsky,
 * ACM Transactions on Graphics 3, 1984), so every kept piece lies on its
 * original segment: inside the box the line is drawn exactly as before, and
 * nothing outside it is handed to the chart. A vertex inside the box is kept
 * as given, not recomputed, so a polyline wholly inside comes back unchanged.
 */

const EDGE_VALUE = [box => box.x[0], box => box.x[1], box => box.y[0], box => box.y[1]];

// The parameters t0 <= t1 of the part of the segment from (x0, y0) along
// (dx, dy) that lies in `box`, with the edges that set them, or null when none
// of it does. Edges are numbered as in EDGE_VALUE.
function segmentInBox(x0, y0, dx, dy, box) {
    let t0 = 0, t1 = 1, enter = -1, leave = -1;
    const edges = [
        [-dx, x0 - box.x[0]], [dx, box.x[1] - x0],
        [-dy, y0 - box.y[0]], [dy, box.y[1] - y0],
    ];
    for (let edge = 0; edge < edges.length; edge++) {
        const [p, q] = edges[edge];
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0 && r > t0) { t0 = r; enter = edge; }
        if (p > 0 && r < t1) { t1 = r; leave = edge; }
        if (t0 > t1) return null;
    }
    return { t0, t1, enter, leave };
}

/**
 * Where segment ab meets an edge of the box: on the edge exactly, the other
 * coordinate run from whichever end is nearer the edge. A mirror's outer arcs
 * have vertices out at 1e16, where a double resolves only to a few units, and
 * the parametric point a + t (b - a) carries that error into the cut,
 * enough to leave a cut end short of the edge and inside the view.
 */
function cutPoint(a, b, edge, box) {
    const along = edge < 2 ? 0 : 1, across = 1 - along;
    const value = EDGE_VALUE[edge](box);
    const near = Math.abs(value - a[along]) <= Math.abs(value - b[along]) ? a : b;
    const point = [0, 0];
    point[along] = value;
    point[across] = near[across] + (value - near[along]) * (b[across] - a[across]) / (b[along] - a[along]);
    return point;
}

/**
 * The runs of the polyline (xs[i], ys[i]) inside `box`, `{ x: [min, max],
 * y: [min, max] }`, each an array of [x, y] points, in order along the line.
 */
export function clipPolyline(xs, ys, box) {
    const runs = [];
    let run = null;
    for (let index = 1; index < xs.length; index++) {
        const a = [xs[index - 1], ys[index - 1]], b = [xs[index], ys[index]];
        const kept = segmentInBox(a[0], a[1], b[0] - a[0], b[1] - a[1], box);
        if (!kept) {
            run = null;
            continue;
        }
        if (!run || kept.t0 > 0) {
            run = [kept.t0 > 0 ? cutPoint(a, b, kept.enter, box) : a];
            runs.push(run);
        }
        run.push(kept.t1 < 1 ? cutPoint(a, b, kept.leave, box) : b);
        if (kept.t1 < 1) run = null;
    }
    return runs;
}
