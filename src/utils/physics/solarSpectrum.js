/**
 * ASTM G173-03 reference solar spectrum (AM1.5 global tilt, hemispherical,
 * 37 degree sun-facing tilt), the standard spectrum for PV and solar-control
 * coating integrals (Tsol, Rsol, Asol).
 *
 * Source: NREL ASTM G173-03 reference spectrum
 *   https://www.nrel.gov/grid/solar-resource/spectra-am1.5.html
 *
 * The table is [lambda_nm, E W/m^2/nm] at 5 nm spacing from 280 to 2500 nm,
 * each row the mean of G173 over its 5 nm bin. It is generated from the NREL
 * file by tools/gen_solar_spectrum.mjs (see solarSpectrumData.js).
 * Normalization is not baked in: callers compute sum(w*T)/sum(w), so the
 * absolute scale cancels.
 */
import { AM1_5G_5NM } from './solarSpectrumData.js';

export { AM1_5G_5NM };

const _SOLAR_LAM0 = AM1_5G_5NM[0][0];
const _SOLAR_LAMN = AM1_5G_5NM[AM1_5G_5NM.length - 1][0];

/**
 * Linear interpolation of AM1.5G at an arbitrary wavelength (nm). Returns 0
 * outside [280, 2500]: G173 starts at 280 nm and the table stops at 2500 nm.
 */
export function solarIrradianceAt(lambda_nm) {
    if (lambda_nm < _SOLAR_LAM0 || lambda_nm > _SOLAR_LAMN) return 0;
    const idxF = (lambda_nm - _SOLAR_LAM0) / 5;
    const i = Math.floor(idxF);
    const t = idxF - i;
    const a = AM1_5G_5NM[i][1];
    const b = AM1_5G_5NM[Math.min(i + 1, AM1_5G_5NM.length - 1)][1];
    return a * (1 - t) + b * t;
}

export const SOLAR_RANGE_NM = [_SOLAR_LAM0, _SOLAR_LAMN];
