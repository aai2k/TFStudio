/**
 * Per-scan turning-point / level-crossing cut detectors, shared by
 * _scanCutMono for the two optical-feedback strategies.
 */

// Signal crossed sAtTarget in the expected start→target direction this scan.
function _crossedInDir(startDir, up, dn) {
    if (startDir > 0) return up;
    if (startDir < 0) return dn;
    return up || dn;
}

// One turning-mode scan. Tracks the running extreme within a tight window around
// the model's predicted extremum (hysteretic 3σ band) and cuts `confirmScans`
// after it reverses. Mutates `st` = { runExtS, runExtD, runExtT, confirm };
// `tc` = { extIsMax, trackD0, trackD1, armD, confirmScans, noiseFrac, bufFill }.
// Returns { d, t } to cut at, or null.
export function _turningStep(sS, d_now, t, st, tc) {
    const sigmaS = tc.noiseFrac * Math.abs(sS) / Math.sqrt(tc.bufFill);
    const margin = Math.max(2e-4, 3 * sigmaS);
    if (d_now >= tc.trackD0 && d_now <= tc.trackD1) {
        if (tc.extIsMax ? (sS > st.runExtS + margin) : (sS < st.runExtS - margin)) {
            st.runExtS = sS; st.runExtD = d_now; st.runExtT = t;
        }
    }
    const past = d_now >= tc.armD && st.runExtD > 0 &&
        (tc.extIsMax ? (st.runExtS - sS > margin) : (sS - st.runExtS > margin));
    if (!past) { st.confirm = 0; return null; }
    st.confirm++;
    return st.confirm >= tc.confirmScans ? { d: st.runExtD, t: st.runExtT } : null;
}

// One level-mode scan. Cuts `confirmScans` after the smoothed signal crosses the
// theoretical level sAtTarget in the expected direction. Mutates `st` =
// { prevDiff, crossed, confirm }; `lc` = { sAtTarget, startDir, confirmScans }.
// Returns { d, t } to cut at, or null.
export function _levelStep(sS, d_now, t, st, lc) {
    const diff = sS - lc.sAtTarget;
    if (st.prevDiff !== null && !st.crossed) {
        const up = st.prevDiff < 0 && diff >= 0;
        const dn = st.prevDiff > 0 && diff <= 0;
        if (_crossedInDir(lc.startDir, up, dn)) st.crossed = true;
    }
    st.prevDiff = diff;
    if (!st.crossed) return null;
    st.confirm++;
    return st.confirm >= lc.confirmScans ? { d: d_now, t } : null;
}
