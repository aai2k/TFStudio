/**
 * References the pulse propagation tests check against, built with no code
 * from the propagation itself: analytic responses with their exact phase
 * derivatives, a quarter-wave mirror, and the FWHM of a pulse by direct
 * integration of its spectrum.
 *
 * Conventions as in the propagation code: exp(−iωt), Δω in rad/fs, time in fs,
 * wavelength in nm.
 */
import { carrierOmega } from '../src/utils/physics/pulsePropagation.js';

export const LAMBDA0 = 800;
export const OMEGA0 = carrierOmega(LAMBDA0);
const deltaOmegaOf = wavelengthNm => carrierOmega(wavelengthNm) - OMEGA0;

/**
 * A unit-magnitude response exp(iψ(Δω)) with its analytic derivatives, given
 * as `derivatives(Δω) → [ψ, ψ', ψ'', ψ''']`.
 */
export const phaseResponse = derivatives => wavelengthNm => {
    const [phase, gdFs, gddFs2, todFs3] = derivatives(deltaOmegaOf(wavelengthNm));
    return { valid: true, re: Math.cos(phase), im: Math.sin(phase), gdFs, gddFs2, todFs3 };
};
export const unity = phaseResponse(() => [0, 0, 0, 0]);
export const pureGdd = gdd => phaseResponse(d => [gdd * d * d / 2, gdd * d, gdd, 0]);
export const pureTod = tod => phaseResponse(d => [tod * d ** 3 / 6, tod * d * d / 2, tod * d, tod]);

/**
 * Intensity FWHM of the pulse whose spectrum is a(Δω)·exp(iφ(Δω)) on [low, high],
 * from A(t) = ∫ Ã(Δω) exp(−iΔωt) dΔω by Simpson's rule at every time asked for:
 * no transform and no grid shared with the propagation code. The peak is looked
 * for within ±span.
 */
export function directFwhm({ amplitude, phase = () => 0, low, high, span, intervals = 4000 }) {
    const h = (high - low) / intervals;
    const nodes = Array.from({ length: intervals + 1 }, (_, k) => {
        const deltaOmega = low + k * h;
        const weight = (k === 0 || k === intervals ? 1 : (k % 2 ? 4 : 2)) * h / 3;
        const a = amplitude(deltaOmega) * weight;
        return { deltaOmega, re: a * Math.cos(phase(deltaOmega)), im: a * Math.sin(phase(deltaOmega)) };
    });
    const intensity = (t) => {
        let re = 0, im = 0;
        for (const node of nodes) {
            const c = Math.cos(node.deltaOmega * t), s = Math.sin(node.deltaOmega * t);
            re += node.re * c + node.im * s;
            im += node.im * c - node.re * s;
        }
        return re * re + im * im;
    };
    const scan = Array.from({ length: 401 }, (_, k) => -span + k * span / 200);
    const values = scan.map(intensity);
    const top = values.indexOf(Math.max(...values));
    let [a, b] = [scan[Math.max(0, top - 1)], scan[Math.min(400, top + 1)]];
    const golden = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 80; i++) {
        const left = b - golden * (b - a), right = a + golden * (b - a);
        if (intensity(left) < intensity(right)) a = left; else b = right;
    }
    const half = intensity((a + b) / 2) / 2;
    const bisect = (inside, outside) => {
        for (let i = 0; i < 60; i++) {
            const middle = (inside + outside) / 2;
            if (intensity(middle) >= half) inside = middle; else outside = middle;
        }
        return (inside + outside) / 2;
    };
    const first = values.findIndex(value => value >= half);
    let last = values.length - 1;
    while (values[last] < half) last--;
    return bisect(scan[last], scan[last + 1]) - bisect(scan[first], scan[first - 1]);
}

// An all-pass resonance (γ + iΔ)/(γ − iΔ): |H| = 1, energy stored for ~1/γ.
const RING_GAMMA = 2e-4;
export const allPass = phaseResponse((d) => {
    const gamma = RING_GAMMA;
    const q = gamma * gamma + d * d;
    return [2 * Math.atan2(d, gamma), 2 * gamma / q, -4 * gamma * d / (q * q),
        -4 * gamma * (gamma * gamma - 3 * d * d) / (q * q * q)];
});

const N_H = 2.51660, N_L = 1.45991, QW0 = 760;

/** A TiO2/SiO2 quarter-wave mirror at 760 nm on BK7: `pairs` pairs and a closing TiO2 layer. */
export function quarterWaveMirror(pairs) {
    const frontLayers = [];
    for (let i = 0; i < pairs; i++) {
        frontLayers.push({ material: 'TiO2', thickness: QW0 / (4 * N_H) },
            { material: 'SiO2', thickness: QW0 / (4 * N_L) });
    }
    frontLayers.push({ material: 'TiO2', thickness: QW0 / (4 * N_H) });
    return {
        incidentMedium: 'Air', substrate: { material: 'BK7', thickness: 1 }, exitMedium: 'Air',
        surfaceMode: 'front_only', frontLayers, backLayers: [],
    };
}

/**
 * A Gires-Tournois interferometer with a nondispersive spacer of round trip T,
 * front-face coefficient s and an ideal back mirror:
 * H = (s + e^{iωT}) / (1 + s·e^{iωT}) in the exp(−iωt) convention.
 */
export function gtiResponse(T, s) {
    return phaseResponse((d) => {
        const theta = (OMEGA0 + d) * T;
        const z = [Math.cos(theta), Math.sin(theta)];
        const phase = Math.atan2(z[1], s + z[0]) - Math.atan2(s * z[1], 1 + s * z[0]);
        const q = 1 + s * s + 2 * s * Math.cos(theta);
        const k = 1 - s * s;
        return [
            phase,
            T * k / q,
            2 * s * T * T * k * Math.sin(theta) / (q * q),
            2 * s * T ** 3 * k * (Math.cos(theta) * q + 4 * s * Math.sin(theta) ** 2) / q ** 3,
        ];
    });
}
