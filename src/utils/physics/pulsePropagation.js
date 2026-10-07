/**
 * Pulse propagation: an ultrashort pulse sent through or off a coating.
 *
 * The output spectrum is the input spectrum times the coating's full complex
 * coefficient, raised to the number of passes, and the output pulse is its
 * Fourier transform. GD and GDD are the second-order expansion of that same
 * coefficient's phase (Macleod, Thin-Film Optical Filters, 5th ed., §11,
 * Eq. 11.17); nothing here truncates it.
 *
 * Layout:
 *   pulseSpectrum.js    input pulse spectra: Gaussian, sech², super-Gaussian or
 *                       a measured table, with a typed GDD and TOD on top
 *   coatingResponse.js  a side's or the whole part's complex r or t with its
 *                       analytic GD, GDD and TOD, one function per polarization
 *   propagate.js        frequency grid, transform, time-window check
 *   bandSampling.js     the band of frequencies and the spectra built on it
 *   metrics.js          durations, delay, peak ratio, TBP, residual GDD and TOD
 *   notAKnotSpline.js   the cubic spline a tabulated spectral phase is read with
 *   fft.js              radix-2 complex FFT
 *
 * Units: time fs, angular frequency rad/fs, wavelength nm, GDD fs², TOD fs³.
 * Convention: exp(−iωt), as in the transfer matrix, so the group delay of a
 * coefficient is the derivative of its argument and positive GDD is an
 * up-chirp.
 */

export {
    carrierOmega, wavelengthFromOmega, pulseProblem,
    omegaWidthFromWavelengthWidth, wavelengthWidthFromOmegaWidth, transformLimitedOmegaWidth,
} from './pulsePropagation/pulseSpectrum.js';
export { createCoatingResponses } from './pulsePropagation/coatingResponse.js';
export { propagatePulse } from './pulsePropagation/propagate.js';
