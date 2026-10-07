/**
 * In-place radix-2 complex fast Fourier transform.
 *
 * Iterative decimation in time: a bit-reversal permutation followed by
 * log2(N) butterfly passes. Cooley and Tukey, Math. Comp. 19, 297-301 (1965);
 * the loop structure follows Press et al., Numerical Recipes, 3rd ed., §12.2.
 *
 * The transform computed is
 *
 *     X[k] = Σ_m x[m] · exp(sign · 2πi·k·m / N),   k = 0 … N−1
 *
 * with no normalization in either direction. `sign` is −1 or +1. N must be a
 * power of two. Real and imaginary parts are held in two Float64Arrays and
 * overwritten.
 */

export function isPowerOfTwo(n) {
    return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function bitReverse(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let swap = re[i]; re[i] = re[j]; re[j] = swap;
            swap = im[i]; im[i] = im[j]; im[j] = swap;
        }
    }
}

/**
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {-1|1} sign  sign of the exponent
 */
export function fftInPlace(re, im, sign) {
    const n = re.length;
    if (!isPowerOfTwo(n) || im.length !== n) {
        throw new Error('fftInPlace: length must be a power of two and equal for both parts');
    }
    bitReverse(re, im);
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const angle = sign * 2 * Math.PI / size;
        // Twiddle factors are taken from the angle directly rather than by
        // repeated multiplication, which would accumulate rounding over a
        // long transform.
        for (let k = 0; k < half; k++) {
            const wr = Math.cos(angle * k);
            const wi = Math.sin(angle * k);
            for (let start = 0; start < n; start += size) {
                const a = start + k;
                const b = a + half;
                const tr = wr * re[b] - wi * im[b];
                const ti = wr * im[b] + wi * re[b];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
}
