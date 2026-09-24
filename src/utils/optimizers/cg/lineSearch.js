/**
 * Projected backtracking line search with the Armijo sufficient-decrease test,
 * for the CG engine.
 *
 * A probe x⁺ = P(x + α·d) is accepted only when
 *     MF(x⁺) ≤ MF(x) + c₁·∇MFᵀ(x⁺ − x),   c₁ = 1e-4
 * (Nocedal & Wright, Numerical Optimization 2e, Eq. 3.4 and Algorithm 3.1).
 * P is the engine's projection (clampVec: lower thickness bound, locked
 * layers). The test uses the displacement P actually made, not α·d: the Armijo
 * rule along the projection arc (Bertsekas, Nonlinear Programming 2e, §2.3.2),
 * so a probe clipped at the lower bound is judged by the move it made.
 *
 * First trial step: the largest free layer moves across the scan range, from
 * the lower thickness bound D_MIN up to SCAN_TOP_NM (or up to the caller's
 * upper bound when that is lower), or by four times the previous accepted step
 * when that is shorter, since the search only shrinks. The scan range is not a
 * thickness bound: it limits how far one probe looks along the direction, and
 * a layer can pass it over successive steps. It is the range the synthesis
 * tools were benchmarked with. With CG as their inner refiner, Gradual
 * Evolution and Needle rely on the long probes, which can fold thin layers down
 * to the floor and move a thick seed: with a gradient-scaled or half-wave first
 * probe, Gradual Evolution stalls on the 3-line bandpass benchmark case at 4
 * layers, MF 0.52, where this scan reaches 41 layers, MF 0.086.
 *
 * An engine that sets `_probeSpans`, the per-layer half-wave spans of
 * physics/optimizer/halfWaveSpan.js, starts instead from the step at which the
 * first layer along the direction has moved by its span. Refining a fixed
 * stack, the long scan's first probes land on arbitrary fringes, and the
 * Refinement window's CG reaches a lower merit from the half-wave probe on
 * four of the five benchmark cases.
 *
 * The step halves until a probe passes, then keeps halving while passing probes
 * still lower the merit, and the lowest one is returned: nonlinear CG builds its
 * conjugate directions on a near-minimizing step (N&W §5.2).
 *
 * `engine` supplies the box (D_MIN, D_MAX), the previous step (_alpha), the
 * optional spans (_probeSpans), the projection (clampVec) and the merit
 * (mfAt). `g` is ∇MF at x.
 * Returns { thk, mf, alpha } or null when no probe passes.
 */
const ARMIJO_C1 = 1e-4;
const SCAN_TOP_NM = 2000;
const SHRINK = 0.5;
const WARM_START_GROWTH = 4;
const MAX_BT = 44;            // 0.5^44 ≈ 6e-14 of the first trial step

// Step at which the first layer along `dir` has moved by its span, nm, or
// Infinity when no moving layer has a finite span.
function spanLimitedStep(spans, dir) {
  let step = Infinity;
  for (let i = 0; i < dir.length; i++) {
    if (dir[i] !== 0 && Number.isFinite(spans[i])) step = Math.min(step, spans[i] / Math.abs(dir[i]));
  }
  return step;
}

function firstTrialStep(engine, dir) {
  let largest = 0;
  for (let i = 0; i < dir.length; i++) largest = Math.max(largest, Math.abs(dir[i]));
  const longScan = (Math.min(SCAN_TOP_NM, engine.D_MAX) - engine.D_MIN) / largest;
  const spanStep = engine._probeSpans ? spanLimitedStep(engine._probeSpans, dir) : Infinity;
  const scan = Number.isFinite(spanStep) ? spanStep : longScan;
  const warm = engine._alpha * WARM_START_GROWTH;
  return engine._alpha > 0 && warm < scan ? warm : scan;
}

// Armijo test on the projected probe; the probe must also be a descent move,
// gᵀ(x⁺ − x) < 0, since projection can turn part of a descent direction away.
function armijoPasses(g, x, trial, mf0, mfT) {
  let change = 0;
  for (let i = 0; i < x.length; i++) change += g[i] * (trial[i] - x[i]);
  return change < 0 && mfT <= mf0 + ARMIJO_C1 * change;
}

export function projectedLineSearch(engine, x, dir, mf0, g) {
  let slope = 0;
  for (let i = 0; i < dir.length; i++) slope += g[i] * dir[i];
  if (!(slope < 0)) return null;

  let a = firstTrialStep(engine, dir);
  let best = null;
  for (let bt = 0; bt < MAX_BT; bt++, a *= SHRINK) {
    const trial = engine.clampVec(x.map((xi, i) => xi + a * dir[i]));
    if (trial.every((t, i) => t === x[i])) break;
    const mfT = engine.mfAt(trial);
    const passes = armijoPasses(g, x, trial, mf0, mfT);
    if (passes && (best === null || mfT < best.mf)) best = { thk: trial, mf: mfT, alpha: a };
    else if (best !== null) break;
  }
  return best;
}
