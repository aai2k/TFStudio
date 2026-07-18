/**
 * Conjugate-direction math for the CG engine (Polak–Ribière+ with automatic
 * restart and a descent-direction guard). Pure vector helpers — no engine state.
 */

/** Squared gradient norm ‖g‖². */
export function gradNorm2(g) {
  let s = 0;
  for (let i = 0; i < g.length; i++) s += g[i] * g[i];
  return s;
}

/**
 * Build the next search direction.
 *
 * Polak–Ribière+ β = max(0, gₖᵀ(gₖ−gₖ₋₁)/gₖ₋₁ᵀgₖ₋₁) with an automatic restart
 * (β forced to 0) every `restartEvery` iterations. If the resulting conjugate
 * direction is not a descent direction (gᵀd ≥ 0, which can happen with PR+ after
 * a poor line search) it resets to steepest descent.
 *
 * @param {{ g:number[], prevG:number[]|null, prevDir:number[]|null,
 *           iter:number, restartEvery:number, gNorm2:number }} req
 * @returns {{ dir: number[], gDotDir: number, beta: number }}
 */
export function conjugateStep({ g, prevG, prevDir, iter, restartEvery, gNorm2 }) {
  let beta = 0;
  if (prevG && prevDir && (iter % restartEvery) !== 0) {
    let num = 0, den = 0;
    for (let i = 0; i < g.length; i++) {
      num += g[i] * (g[i] - prevG[i]);
      den += prevG[i] * prevG[i];
    }
    beta = den > 0 ? Math.max(0, num / den) : 0;
  }

  const dir = new Array(g.length);
  let gDotDir = 0;
  for (let i = 0; i < g.length; i++) {
    dir[i] = -g[i] + (beta && prevDir ? beta * prevDir[i] : 0);
    gDotDir += g[i] * dir[i];
  }
  // Guard: if the conjugate direction is not a descent direction, reset to
  // steepest descent.
  if (gDotDir >= 0) {
    for (let i = 0; i < g.length; i++) dir[i] = -g[i];
    gDotDir = -gNorm2;
    beta = 0;
  }
  return { dir, gDotDir, beta };
}
