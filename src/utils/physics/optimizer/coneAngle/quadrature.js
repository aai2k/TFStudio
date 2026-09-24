/**
 * Gauss–Legendre and Clenshaw–Curtis quadrature nodes/weights.
 *
 * Gauss–Legendre: standard Newton iteration on the Legendre polynomial Pₙ;
 * exact for polynomials up to degree 2n−1. Cached by n.
 *
 * Clenshaw–Curtis: the n + 1 Chebyshev points cos(kπ/n), exact to degree n.
 * For an integrand analytic near the interval, which a resonance close to the
 * real axis makes the usual case for a cone average, it converges at the same
 * rate per point as Gauss–Legendre (L. N. Trefethen, "Is Gauss quadrature
 * better than Clenshaw–Curtis?", SIAM Review 50, 67 (2008)), and its points for
 * n are a subset of those for 2n, so comparing n with 2n costs only the new
 * points. Cached by n.
 */

const _glCache = new Map();
const _ccCache = new Map();

const _gcd = (a, b) => (b ? _gcd(b, a % b) : a);

// cos(kπ/n) from k/n in lowest terms, so the same point is the same double
// whichever n it is computed for.
function _chebyshevPoint(k, n) {
    if (k === 0) return 1;
    const g = _gcd(k, n);
    return Math.cos((k / g) * Math.PI / (n / g));
}

// The weight of interior point i (0 < i < n): 2/n times one minus the cosine
// series of clencurt at θ = iπ/n, terms subtracted in the same order.
function _ccInteriorWeight(n, i) {
    const theta = Math.PI * i / n;
    const even = n % 2 === 0;
    const last = even ? n / 2 - 1 : (n - 1) / 2;
    let v = 1;
    for (let j = 1; j <= last; j++) v -= 2 * Math.cos(2 * j * theta) / (4 * j * j - 1);
    if (even) v -= Math.cos(n * theta) / (n * n - 1);
    return 2 * v / n;
}

/**
 * Clenshaw–Curtis nodes/weights on [-1, 1], n ≥ 1: x[k] = cos(kπ/n), k = 0…n.
 * Weights from Trefethen, Spectral Methods in MATLAB (SIAM, 2000), program
 * clencurt.
 */
export function clenshawCurtis(n) {
    const cached = _ccCache.get(n);
    if (cached) return cached;
    const x = new Array(n + 1);
    const w = new Array(n + 1);
    for (let k = 0; k <= n; k++) x[k] = _chebyshevPoint(k, n);
    w[0] = w[n] = n % 2 === 0 ? 1 / (n * n - 1) : 1 / (n * n);
    for (let i = 1; i < n; i++) w[i] = _ccInteriorWeight(n, i);
    const res = { x, w };
    _ccCache.set(n, res);
    return res;
}

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
