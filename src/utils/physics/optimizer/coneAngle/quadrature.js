/**
 * Gauss–Legendre quadrature nodes/weights.
 *
 * Standard Newton iteration on the Legendre polynomial Pₙ; exact for polynomials
 * up to degree 2n−1. n ≤ ~64 is plenty (cone grids are 10–20). Cached by n.
 */

const _glCache = new Map();

// Nodes/weights on [-1, 1].
export function gaussLegendre(n) {
    if (n < 1) return { x: [0], w: [2] };
    const cached = _glCache.get(n);
    if (cached) return cached;
    const x = new Array(n);
    const w = new Array(n);
    const m = (n + 1) >> 1;
    for (let i = 0; i < m; i++) {
        // initial guess (Chebyshev-like) for the i-th root
        let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
        let z1, pp;
        do {
            let p1 = 1, p2 = 0;
            for (let j = 0; j < n; j++) {
                const p3 = p2;
                p2 = p1;
                p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
            }
            // pp = derivative of Pₙ at z
            pp = n * (z * p1 - p2) / (z * z - 1);
            z1 = z;
            z = z1 - p1 / pp;
        } while (Math.abs(z - z1) > 1e-15);
        x[i]         = -z;
        x[n - 1 - i] =  z;
        const wi = 2 / ((1 - z * z) * pp * pp);
        w[i]         = wi;
        w[n - 1 - i] = wi;
    }
    const res = { x, w };
    _glCache.set(n, res);
    return res;
}

// Map GL nodes/weights from [-1,1] to [a,b].
export function glOn(a, b, n) {
    const { x, w } = gaussLegendre(n);
    const half = (b - a) / 2, mid = (a + b) / 2;
    const nodes = new Array(n), wts = new Array(n);
    for (let i = 0; i < n; i++) { nodes[i] = mid + half * x[i]; wts[i] = w[i] * half; }
    return { nodes, wts };
}
