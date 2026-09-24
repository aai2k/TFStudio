/**
 * Per-scan turning-point / level-crossing cut rules, shared by _scanCutMono
 * for the two optical-feedback strategies.
 *
 * The rules read a moving average of the last W scans, and that average
 * describes the signal (W - 1)/2 scans in the past. A rule that closed the
 * shutter on the scan where it recognized its event would overshoot by that
 * lag plus its confirmation scans even on a noiseless signal. So the rules
 * place the cut in time instead: a level cut waits for the model's own
 * moving average some scans ahead of the target and adds that lead to the
 * crossing time interpolated between scans, and a turning cut forecasts the
 * vertex from the curvature of the smoothed signal whenever that curvature
 * stands clear of the noise. The shutter runs on a timer, so a cut can fall
 * between scans, but never before the scan that decided it.
 */

// Double-precision ripple on a computed signal sits near 1e-16. A second
// difference this small is arithmetic, not a turning point, so it never
// counts as curvature even on a noiseless monitor.
const RIPPLE = 1e-12;

// One turning-mode scan of the reversal rule. Tracks the running extreme
// within a tight window around the model's predicted extremum (hysteretic 3σ
// band) and cuts `confirmScans` after it reverses: the recognition Macleod
// describes (Thin-Film Optical Filters, 5th ed., Fig. 13.37), late by the
// reversal it waits for. Mutates `st` = { runExtS, runExtD, runExtT, confirm };
// `tc` = { extIsMax, trackD0, trackD1, armD, confirmScans, noiseFrac,
// absNoiseFrac, bufFill }. Returns { d, t } to cut at, or null.
export function _turningStep(sS, d_now, t, st, tc) {
    const sigmaS = (tc.noiseFrac * Math.abs(sS) + (tc.absNoiseFrac || 0)) / Math.sqrt(tc.bufFill);
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
    return st.confirm >= tc.confirmScans ? { d: d_now, t } : null;
}

// One turning-mode forecast. Fits the parabola through the last three
// smoothed readings `hist` (oldest first, one scan apart) and moves its vertex
// forward by the smoothing lag `lagT`: a moving average keeps a parabola's
// vertex in the middle of its window. The layer is cut at that vertex once it
// falls before the next scan. The curvature is trusted only while it exceeds
// three standard deviations of its own noise (the second difference of a
// W-scan average carries 2σ/W) on `confirmScans` consecutive scans, so on a
// realistically noisy signal the forecast stays silent and the reversal rule
// decides. Mutates `st.forecast`; `tc` as for _turningStep plus
// { lagT, dt, r }. Returns { d, t } to cut at, or null.
export function _turningForecast(hist, d_now, t, st, tc) {
    if (hist.length < 3 || d_now < tc.armD) { st.forecast = 0; return null; }
    const [s0, s1, s2] = hist;
    const bend = s2 - 2 * s1 + s0;
    const sigma = Math.max(RIPPLE, tc.noiseFrac * Math.abs(s2) + (tc.absNoiseFrac || 0));
    const rightWay = tc.extIsMax ? bend < 0 : bend > 0;
    if (!rightWay || Math.abs(bend) <= 6 * sigma / tc.bufFill) { st.forecast = 0; return null; }
    st.forecast++;
    const slope = (3 * s2 - 4 * s1 + s0) / 2;
    const tV = t - tc.lagT - (slope / bend) * tc.dt;
    const dV = tc.r * tV;
    if (st.forecast < tc.confirmScans || tV >= t + tc.dt || dV < tc.trackD0 || dV > tc.trackD1) return null;
    const tCut = Math.max(t, tV);
    return { d: tc.r * tCut, t: tCut };
}

// One level-mode scan. Armed at `armD` (the turning point that opens the
// branch the target sits on), it recognizes the smoothed signal crossing
// `level` in direction `dir`, interpolates the crossing time between the
// scans either side of it, and cuts `leadT` after that crossing once
// `confirmScans` scans have counted it (the scan that saw the crossing is the
// first). Mutates `st` = { prevDiff, crossed, tCross, confirm }; `lc` =
// { level, dir, armD, confirmScans, leadT, dt, r }. Returns { d, t } to cut
// at, or null.
export function _levelStep(sS, d_now, t, st, lc) {
    const diff = sS - lc.level;
    if (st.prevDiff !== null && !st.crossed && d_now >= lc.armD
        && (lc.dir > 0 ? st.prevDiff < 0 && diff >= 0 : st.prevDiff > 0 && diff <= 0)) {
        st.crossed = true;
        st.tCross = t - lc.dt * diff / (diff - st.prevDiff);
    }
    st.prevDiff = diff;
    if (!st.crossed) return null;
    st.confirm++;
    if (st.confirm < lc.confirmScans) return null;
    const tCut = Math.max(t, st.tCross + lc.leadT);
    return { d: lc.r * tCut, t: tCut };
}
