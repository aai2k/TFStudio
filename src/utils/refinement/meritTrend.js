// Add one optimizer sample to an MF trajectory. Progress and done messages can
// report the same iteration; replace that last point instead of creating a
// zero-width segment. Keeping this transform pure also lets the run keep the
// exact trajectory it reports live for the Design History row.
export function appendMfSample(history, iter, mf) {
    const x = Number(iter), y = Number(mf);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return history;
    const point = { iter: Math.max(0, x), mf: y };
    const prev = history[history.length - 1];
    if (prev?.iter === point.iter) {
        if (prev.mf === point.mf) return history;
        return [...history.slice(0, -1), point];
    }
    return [...history, point];
}
