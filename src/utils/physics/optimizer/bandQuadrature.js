/**
 * Trapezoid-rule weights for n samples on a uniform band grid, summing to 1, so
 * Σ wᵢ fᵢ is the band average (1/Δλ)∫f dλ. A plain mean of the same samples
 * counts the two band edges twice as heavily as the trapezoid rule does, an
 * error of (edge mean − band mean)/(n − 1) that grows as the grid gets coarser;
 * the trapezoid error falls as the square of the step instead. Every band
 * average, integral, range target and flatness row, with its Jacobian,
 * curvature and needle-scan gradient, weights its samples with these.
 */
export function bandQuadratureWeights(n) {
    const w = new Float64Array(n);
    if (n === 1) { w[0] = 1; return w; }
    const h = 1 / (n - 1);
    w.fill(h);
    w[0] = h / 2;
    w[n - 1] = h / 2;
    return w;
}
