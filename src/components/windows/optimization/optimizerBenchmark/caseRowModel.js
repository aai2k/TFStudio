import { fmtMF, ERR, LIVE } from './model.js';

// Cell status drives the row's text/color; 'pend' vs 'idle' only matters
// while no run has produced any result for this cell yet.
export function rowStatus(r, running) {
    return r.err ? 'err' : (r.mf != null ? 'done' : (r.live ? 'live' : (running ? 'pend' : 'idle')));
}

export function rowMfText(r, running) {
    const liveMf = r.live && r.live.mf;
    return r.err ? 'ERR' : (r.mf != null ? fmtMF(r.mf) : (liveMf != null ? fmtMF(liveMf) + '…' : (running ? '…' : '')));
}

export function rowLayers(r) {
    return r.err ? '' : (r.layers != null ? r.layers : (r.live ? r.live.layers : ''));
}

export function rowColor(status, c) {
    return status === 'err' ? ERR : status === 'live' ? LIVE : status === 'done' ? c.text : c.textDim;
}

// True when a min-thickness (MNT) constraint was active for the cell and the
// realized thinnest layer came in below it.
export function rowViolated(j, r) {
    return !!(j.mnt && r.minThk != null && r.minThk < j.mnt - 0.5);
}

export function rowMinText(r) {
    return r.minThk != null ? `${Math.round(r.minThk)}` : '';
}
