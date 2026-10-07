/**
 * Input pulse spectra.
 *
 * A pulse is a carrier wavelength, a spectral amplitude and a spectral phase,
 * all written down in the frequency offset Δω = ω − ω0 rather than obtained by
 * transforming a time profile, so the spectrum carries no sampling error of its
 * own. Every model is normalised to unit spectral amplitude at its peak.
 *
 * Conventions:
 *   time factor exp(−iωt), the same as the transfer matrix (tmmcore), so a
 *   transfer function exp(iψ(ω)) delays the pulse by dψ/dω
 *   Δω in rad/fs, time in fs, wavelength in nm
 *   typed spectral phase φ(Δω) = GDD·Δω²/2 + TOD·Δω³/6; GDD > 0 delays the
 *   higher frequencies, as glass does (an up-chirp)
 *
 * Shapes, with τ the intensity FWHM in time of the transform-limited pulse:
 *
 *   gaussian       |Ã(Δω)| = exp(−τ²Δω² / (8 ln2))
 *   sech2          |Ã(Δω)| = sech(π T0 Δω / 2),  τ = 2 ln(1 + √2) · T0
 *   superGaussian  |Ã(Δω)|² = exp(−ln2 · |2Δω/W|^p), W the intensity FWHM in
 *                  angular frequency and p the order; p = 2 is the Gaussian
 *   table          spectral intensity per unit frequency and, optionally, phase,
 *                  read against wavelength, interpolated in ω, zero outside
 *                  the table
 *
 * The Gaussian pair is Macleod, Thin-Film Optical Filters, 5th ed., Eqs. 11.7
 * and 11.8, with τ = 2√(ln2)·μ and τ·Δω = 4 ln2 (p. 416). The sech pair is
 * ∫ sech(t/T0) e^{iΔωt} dt = π T0 sech(π T0 Δω / 2), the hyperbolic secant
 * being its own Fourier transform; the sech² intensity FWHM 1.7627·T0 and the
 * product 0.315 are in Kärtner, Ultrafast Optics, MIT 6.977 notes, §2.8,
 * Table 2.2. The products of intensity FWHM in time and in frequency are
 * 2 ln2 / π ≈ 0.441 and 4 ln²(1 + √2) / π² ≈ 0.315.
 *
 * A super-Gaussian's width is entered as a FWHM in wavelength. Its profile is
 * symmetric in frequency, so the half-maximum points sit at ω0 ± W/2 and the
 * wavelength width converts to W exactly: Δλ = 2πc·(1/(ω0 − W/2) − 1/(ω0 + W/2)).
 *
 * A table's phase is in rad with the same convention as the transfer matrix:
 * the group delay it carries is +dφ/dω. It is interpolated by a not-a-knot
 * cubic spline, which reads a phase that is a GDD and a TOD back exactly, and
 * its derivatives are the spline's own. Its value and slope at the carrier are
 * removed, as the typed phase has none: they set only the pulse's phase and
 * time origin, which a measured phase leaves arbitrary. The intensity is
 * interpolated by PCHIP, the rule tabulated materials use, which never
 * overshoots below zero.
 */

import { C_NM_PER_FS } from '../../../tmmcore.js';
import { createPchipInterpolator } from '../../materials/pchip.js';
import { createNotAKnotSpline } from './notAKnotSpline.js';

const SECH2_FWHM_PER_T0 = 2 * Math.log(1 + Math.SQRT2);

export function carrierOmega(centerWavelengthNm) {
    return 2 * Math.PI * C_NM_PER_FS / centerWavelengthNm;
}

/** Vacuum wavelength in nm of an angular frequency in rad/fs. */
export function wavelengthFromOmega(omega) {
    return 2 * Math.PI * C_NM_PER_FS / omega;
}

/**
 * Intensity FWHM in angular frequency, rad/fs, of a profile symmetric in ω: the
 * positive root W of Δλ = 2πc·(1/(ω0 − W/2) − 1/(ω0 + W/2)), written as
 * 4ω0² / (k + √(k² + 4ω0²)) with k = 4πc/Δλ so no digits cancel.
 */
export function omegaWidthFromWavelengthWidth(centerWavelengthNm, widthNm) {
    const omega0 = carrierOmega(centerWavelengthNm);
    const k = 4 * Math.PI * C_NM_PER_FS / widthNm;
    return 4 * omega0 * omega0 / (k + Math.sqrt(k * k + 4 * omega0 * omega0));
}

function largest(values) {
    let peak = -Infinity;
    for (const value of values) if (value > peak) peak = value;
    return peak;
}

/** Intensity FWHM in wavelength, nm, of a profile symmetric in ω. */
export function wavelengthWidthFromOmegaWidth(centerWavelengthNm, widthRadPerFs) {
    const omega0 = carrierOmega(centerWavelengthNm);
    const half = widthRadPerFs / 2;
    return half < omega0 ? wavelengthFromOmega(omega0 - half) - wavelengthFromOmega(omega0 + half) : NaN;
}

/**
 * Intensity FWHM in angular frequency of a transform-limited Gaussian or sech²
 * pulse of intensity FWHM τ in time.
 */
export function transformLimitedOmegaWidth(shape, durationFs) {
    if (shape === 'sech2') return 4 * Math.log(1 + Math.SQRT2) * SECH2_FWHM_PER_T0 / (Math.PI * durationFs);
    return 4 * Math.LN2 / durationFs;
}

function gaussianModel(durationFs, floor) {
    const width = durationFs * durationFs / (8 * Math.LN2);
    const half = Math.sqrt(4 * Math.LN2 * Math.log(1 / floor)) / durationFs;
    return {
        amplitude: deltaOmega => Math.exp(-width * deltaOmega * deltaOmega),
        low: -half, high: half, resolutionFs: durationFs,
    };
}

function sech2Model(durationFs, floor) {
    const scale = Math.PI * (durationFs / SECH2_FWHM_PER_T0) / 2;
    const half = Math.acosh(1 / Math.sqrt(floor)) / scale;
    return {
        amplitude: deltaOmega => 1 / Math.cosh(scale * deltaOmega),
        low: -half, high: half, resolutionFs: durationFs,
    };
}

function superGaussianModel(pulse, floor) {
    const order = pulse.order;
    const width = omegaWidthFromWavelengthWidth(pulse.centerWavelengthNm, pulse.bandwidthNm);
    const half = (width / 2) * Math.log2(1 / floor) ** (1 / order);
    return {
        amplitude: deltaOmega => Math.exp(-0.5 * Math.LN2 * Math.abs(2 * deltaOmega / width) ** order),
        low: -half, high: half,
        // The transform-limited Gaussian of the same spectral FWHM; exact for p = 2.
        resolutionFs: 4 * Math.LN2 / width,
    };
}

/** Half-maximum width of sampled (x, y) points, by straight lines between them. */
function sampledHalfWidth(xs, ys) {
    const peak = largest(ys);
    const above = ys.map(y => y >= peak / 2);
    const first = above.indexOf(true);
    const last = above.lastIndexOf(true);
    const crossing = (inside, outside) => {
        if (outside < 0 || outside >= xs.length) return xs[inside];
        const t = (peak / 2 - ys[outside]) / (ys[inside] - ys[outside]);
        return xs[outside] + t * (xs[inside] - xs[outside]);
    };
    return crossing(last, last + 1) - crossing(first, first - 1);
}

/** A phase spline less its value and slope at Δω = 0, with derivatives to match. */
function aboutCarrier(spline) {
    const { value, derivatives: [slope] } = spline.derivativesAt(0);
    const phase = deltaOmega => spline(deltaOmega) - value - slope * deltaOmega;
    phase.derivativesAt = (deltaOmega) => {
        const point = spline.derivativesAt(deltaOmega);
        return {
            value: point.value - value - slope * deltaOmega,
            derivatives: [point.derivatives[0] - slope, point.derivatives[1], point.derivatives[2]],
        };
    };
    return phase;
}

/** Index range of the rows at or above `level`, one more row on each side. */
function rowsAbove(rows, level) {
    let first = 0;
    while (first < rows.length - 1 && rows[first].intensity < level) first++;
    let last = rows.length - 1;
    while (last > first && rows[last].intensity < level) last--;
    return [Math.max(0, first - 1), Math.min(rows.length - 1, last + 1)];
}

/**
 * The rows of a spectrum table the model reads: positive wavelength, finite
 * phase and intensity not below zero, in order of rising ω, the first of any
 * rows that share an ω.
 */
function tableRows(table) {
    return table.wavelengthNm
        .map((wavelengthNm, index) => ({
            omega: wavelengthNm > 0 ? carrierOmega(wavelengthNm) : NaN,
            intensity: table.intensity[index],
            phase: table.phaseRad?.[index] ?? 0,
        }))
        .filter(row => Number.isFinite(row.omega) && row.intensity >= 0 && Number.isFinite(row.phase))
        .sort((left, right) => left.omega - right.omega)
        .filter((row, index, sorted) => index === 0 || row.omega > sorted[index - 1].omega);
}

/**
 * Centroid in angular frequency, rad/fs, of a spectrum table, ∫ω·I dω / ∫I dω,
 * by the trapezoid rule over the rows the model reads; NaN when it carries no
 * light.
 */
export function spectrumCentroidOmega(table) {
    const rows = tableRows(table);
    let weight = 0;
    let moment = 0;
    for (let index = 1; index < rows.length; index++) {
        const [left, right] = [rows[index - 1], rows[index]];
        const width = right.omega - left.omega;
        weight += width * (left.intensity + right.intensity) / 2;
        moment += width * (left.omega * left.intensity + right.omega * right.intensity) / 2;
    }
    return weight > 0 ? moment / weight : NaN;
}

function tableModel(pulse, floor) {
    const omega0 = carrierOmega(pulse.centerWavelengthNm);
    const rows = tableRows(pulse.table).map(row => ({ ...row, omega: row.omega - omega0 }));
    if (rows.length < 2) throw new Error('A pulse spectrum needs at least two rows');
    const peak = largest(rows.map(row => row.intensity));
    if (!(peak > 0)) throw new Error('A pulse spectrum needs a positive intensity');
    const intensity = createPchipInterpolator(rows.map(row => [row.omega, row.intensity / peak]));
    const inside = deltaOmega => deltaOmega >= rows[0].omega && deltaOmega <= rows[rows.length - 1].omega;
    const [first, last] = rowsAbove(rows, floor * peak);
    const low = rows[first].omega;
    const high = rows[last].omega;
    return {
        amplitude: deltaOmega => inside(deltaOmega) ? Math.sqrt(Math.max(0, intensity(deltaOmega))) : 0,
        tablePhase: aboutCarrier(createNotAKnotSpline(rows.map(row => [row.omega, row.phase]))),
        low, high,
        resolutionFs: 4 * Math.LN2 / sampledHalfWidth(
            rows.map(row => row.omega), rows.map(row => row.intensity)),
    };
}

function shapeModel(pulse, floor) {
    if (pulse.shape === 'gaussian') return gaussianModel(pulse.durationFs, floor);
    if (pulse.shape === 'sech2') return sech2Model(pulse.durationFs, floor);
    if (pulse.shape === 'superGaussian') return superGaussianModel(pulse, floor);
    if (pulse.shape === 'table') return tableModel(pulse, floor);
    throw new Error(`Unknown pulse shape: ${pulse.shape}`);
}

// What each shape needs before it can be modelled, as [problem, satisfied].
const SHAPE_NEEDS = {
    gaussian: [['duration', pulse => pulse.durationFs > 0]],
    sech2: [['duration', pulse => pulse.durationFs > 0]],
    superGaussian: [['bandwidth', pulse => pulse.bandwidthNm > 0], ['order', pulse => pulse.order > 0]],
    table: [['table', pulse => pulse.table?.wavelengthNm?.length >= 2]],
};

/** Why a pulse cannot be modelled, or null. */
export function pulseProblem(pulse) {
    const needs = [['centerWavelength', value => value.centerWavelengthNm > 0], ...(SHAPE_NEEDS[pulse.shape] || [])];
    return needs.find(([, satisfied]) => !satisfied(pulse))?.[0] ?? null;
}

/**
 * The spectrum of a pulse: amplitude, phase and phase derivatives as functions
 * of Δω, the band [low, high] outside which the intensity is below `floor` of
 * its peak (for a table, out to the row beyond the last one above it), and the
 * transform-limited duration that sizes the time step.
 */
export function pulseSpectrumModel(pulse, floor) {
    const model = shapeModel(pulse, floor);
    const gdd = pulse.gddFs2 || 0;
    const tod = pulse.todFs3 || 0;
    const tablePhase = model.tablePhase;
    return {
        omega0: carrierOmega(pulse.centerWavelengthNm),
        amplitude: model.amplitude,
        low: model.low,
        high: model.high,
        resolutionFs: model.resolutionFs,
        phase: deltaOmega => deltaOmega * deltaOmega * (gdd / 2 + tod * deltaOmega / 6)
            + (tablePhase ? tablePhase(deltaOmega) : 0),
        phaseDerivatives: (deltaOmega) => {
            const table = tablePhase ? tablePhase.derivativesAt(deltaOmega).derivatives : [0, 0, 0];
            return {
                gdFs: deltaOmega * (gdd + tod * deltaOmega / 2) + table[0],
                gddFs2: gdd + tod * deltaOmega + table[1],
                todFs3: tod + table[2],
            };
        },
    };
}

/**
 * A rough span of time about t = 0 that the input pulse covers: its
 * transform-limited duration plus twice the larger group delay its own phase
 * gives at the band's edges. Used only to size the first time window, which is
 * then grown until the result fits.
 */
export function inputTimeExtent(model) {
    const [low, high] = [model.low, model.high].map(deltaOmega => Math.abs(model.phaseDerivatives(deltaOmega).gdFs));
    return model.resolutionFs + 2 * Math.max(low, high);
}
