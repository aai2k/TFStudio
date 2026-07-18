/**
 * Projected backtracking line search for the CG engine.
 *
 * Starts from the LARGEST useful step (the one that moves the largest free
 * coordinate across the whole box) so the first probe is meaningful even when
 * ‖∇MF‖ is tiny, then shrinks geometrically and returns the best strictly-
 * improving probe. A pure Armijo test is unreliable here because gᵀd can be
 * vanishingly small near shallow minima; best-improving + box projection is the
 * robust choice and CG's superlinear behavior still emerges from the conjugate
 * directions. Returns { thk, mf, alpha } or null if nothing improved.
 *
 * `engine` supplies the box (D_MIN/D_MAX), the previous accepted step (_alpha,
 * warm start), the box projection (clampVec) and the merit evaluation (mfAt).
 */
export function projectedLineSearch(engine, x, dir, mf0) {
  let dmax = 0;
  for (let i = 0; i < dir.length; i++) {
    const ad = Math.abs(dir[i]);
    if (ad > dmax) dmax = ad;
  }
  if (dmax === 0) return null;

  // α0: move the largest coord by the full box span. Bias toward the previous
  // accepted α (warm start) by starting a little above it but never exceeding
  // the box-spanning step.
  const aBox = (engine.D_MAX - engine.D_MIN) / dmax;
  let a = aBox;
  if (engine._alpha && engine._alpha * 4 < aBox) a = engine._alpha * 4;

  const shrink = 0.5;
  const MAX_BT = 44;            // 0.5^44 ≈ 6e-14 of the box span
  let best = null;
  for (let bt = 0; bt < MAX_BT; bt++) {
    const trial = engine.clampVec(x.map((xi, i) => xi + a * dir[i]));
    const mfT = engine.mfAt(trial);
    if (best === null || mfT < best.mf) best = { thk: trial, mf: mfT, alpha: a };
    // Once we have improvement and the probe starts climbing again, we've
    // bracketed the descent — stop.
    else if (best.mf < mf0 && mfT > best.mf) break;
    a *= shrink;
  }
  return (best && best.mf < mf0) ? best : null;
}
