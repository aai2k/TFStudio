/**
 * The wavelengths a spectrum is computed at. A spectrum read in nm or µm is
 * sampled evenly in wavelength; one read in cm⁻¹, THz or eV evenly in
 * wavenumber, since each of those is proportional to 1/λ.
 */
import { buildLambdaGrid } from './thinFilmMath.js';

/**
 * Wavelengths whose wavenumbers ν̃ = 10⁷/λ (cm⁻¹, λ in nm) are evenly spaced.
 *
 * The wavenumbers run from that of lambdaStart down to that of lambdaEnd every
 * `wavenumberStep`, counted and closed off as buildLambdaGrid does it, so the
 * wavelengths come out ascending, with any shorter interval at the long-wave
 * end. The points are rounded to 1e-9 nm as there, and the two ends are the
 * range's own: converting there and back would leave them off by rounding.
 */
export function buildWavenumberGrid(lambdaStart, lambdaEnd, wavenumberStep) {
    const first = 1e7 / lambdaStart;
    const offsets = buildLambdaGrid(0, first - 1e7 / lambdaEnd, wavenumberStep);
    const lambdas = offsets.map(offset => Math.round(1e7 / (first - offset) * 1e9) / 1e9);
    if (lambdas.length) {
        lambdas[0] = Math.round(lambdaStart * 1e9) / 1e9;
        lambdas[lambdas.length - 1] = Math.round(lambdaEnd * 1e9) / 1e9;
    }
    return lambdas;
}

/**
 * The wavelengths a spectrum is computed at. `evenIn` is 'wavenumber' for a
 * spectrum read in cm⁻¹, THz or eV, which takes `wavenumberStep` in cm⁻¹;
 * otherwise the grid is even in wavelength at `lambdaStep` nm. The range and
 * the nm step default as in evaluateSpectrum.
 */
export function spectralGrid({
    lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5, wavenumberStep, evenIn,
}) {
    return evenIn === 'wavenumber'
        ? buildWavenumberGrid(lambdaStart, lambdaEnd, wavenumberStep)
        : buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep);
}
