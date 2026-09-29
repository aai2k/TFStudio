// The run's trace and keeper (the lab's methods.c 33-98): the merit and layer
// count of every design a run holds, the stop rule read off them, and the best
// design within a layer cap. These are the run's accumulators: the functions
// here change the trace or keeper they are given.

export const STOP_LAYERS = 15;          // methods.c 89: layers the stop rule looks back over
export const STOP_GAIN = 0.1;           // methods.c 90: least relative gain over those layers
export const DEFAULT_TARGET_MF = 1e-4;  // methods.c 88: stop_mf of 0.01%, as MF

export function makeTrace() {
    return { points: [] };
}

// methods.c keeper_init 61-65.
export function makeKeeper(cap) {
    return { cap, layers: null, mf: Infinity };
}

// methods.c keeper_offer 67-72: kept when within the cap and below the kept
// merit. keep may be null.
export function offer(keep, mf, layers) {
    if (!keep || !(layers.length <= keep.cap && mf < keep.mf)) return;
    keep.layers = layers.map(l => ({ material: l.material, thickness: l.thickness }));
    keep.mf = mf;
}

// methods.c trace_push 33-37; n is the layer count.
export function push(trace, mf, n) {
    trace.points.push({ mf, n });
}

// methods.c trace_design 54-57.
export function record(log, mf, layers) {
    push(log.trace, mf, layers.length);
    offer(log.keep, mf, layers);
}

// cavity.c 348 trace_append_run: another run's points after this one's.
export function appendPoints(trace, points) {
    for (const p of points) push(trace, p.mf, p.n);
}

function lowest(points, keep) {
    let best = Infinity;
    for (const p of points) if (keep(p) && p.mf < best) best = p.mf;
    return best;
}

// methods.c trace_enough 85-98: enough when the best merit so far is at or
// below targetMf, or when the last STOP_LAYERS added layers lowered the best
// merit by less than STOP_GAIN of the best before them. Merits and layer
// counts only, so where it stops does not depend on the thread count.
export function enough(trace, targetMf = DEFAULT_TARGET_MF) {
    const pts = trace.points;
    if (pts.length === 0) return false;
    const best = lowest(pts, () => true);
    if (best <= targetMf) return true;
    const n = pts[pts.length - 1].n;
    const before = lowest(pts, p => p.n <= n - STOP_LAYERS);
    return Number.isFinite(before) && best > (1 - STOP_GAIN) * before;
}
