// The probe-needle cycle of the deep synthesis (needle.c needle_run with
// insert=probe, deep=0; giga4.c carve): a needle at the probe thickness at the
// best scanned positions, refined, kept when it gains.

import { removeThin } from './design.js';
import { enough, record } from './trace.js';
import { MAX_CANDIDATES, scanWindow } from './needleScan.js';
import { MIN_NEW_NM, applyNeedle } from './needleInsert.js';

export const PROBE_NM = 1e-4;          // needle.c 101: probe needle, nm
export const GAIN_TOL = 1e-12;         // needle.c 516, giga4.c 305: a new merit counts below old * (1 - GAIN_TOL)

const never = () => false;

// needle.c 510-515: refined; a probe that refinement did not grow past
// MIN_NEW_NM goes, and the rest is refined again.
function refineProbe(ev, layers) {
    const r = ev.refine(layers);
    if (!r.layers.some(l => l.thickness < MIN_NEW_NM)) return r;
    return ev.refine(removeThin(r.layers, MIN_NEW_NM));
}

// needle.c 505-516, giga4.c carve 296-311: each candidate in order inserted at
// the probe thickness (at least the floor) and refined; a design longer than
// cap is skipped. The first that lowers mf by more than GAIN_TOL, or null.
export function probeStep(ev, layers, mf, { cands, cap = Infinity }) {
    const probe = Math.max(PROBE_NM, ev.floor);
    for (const cand of cands) {
        const trial = applyNeedle(layers, cand, probe);
        if (trial.length > cap) continue;
        const r = refineProbe(ev, trial);
        if (r.mf < mf * (1 - GAIN_TOL)) return { layers: r.layers, mf: r.mf };
    }
    return null;
}

function cycleStop(layers, { maxLayers, log, targetMf, shouldStop }) {
    if (layers.length >= maxLayers) return 'maxLayers';
    if (shouldStop()) return 'stopped';
    return enough(log.trace, targetMf) ? 'enough' : null;
}

// needle.c needle_run 456-468 with the probe branch 500-535 (insert=probe,
// deep=0): refine, then insert the first candidate among the best `tries`
// that gains, until a stop. Records every design it holds to `log`.
// Reasons: 'maxLayers', 'stopped', 'enough', 'optimal' (no candidate),
// 'noGain' (no candidate gains).
export function probeNeedleRun(ev, layers, { tries, maxLayers, log, targetMf, shouldStop = never }) {
    const max = Math.min(Math.max(1, tries), MAX_CANDIDATES);
    const r = ev.refine(layers);
    let cur = { layers: r.layers, mf: r.mf };
    record(log, cur.mf, cur.layers);
    for (let insertions = 0; ; insertions++) {
        const stop = cycleStop(cur.layers, { maxLayers, log, targetMf, shouldStop });
        if (stop) return { ...cur, reason: stop, insertions };
        const cands = scanWindow(ev, cur.layers, { max });
        const next = cands.length > 0 ? probeStep(ev, cur.layers, cur.mf, { cands }) : null;
        if (!next) return { ...cur, reason: cands.length > 0 ? 'noGain' : 'optimal', insertions };
        cur = next;
        record(log, cur.mf, cur.layers);
    }
}
