/**
 * Pulse propagation validation.
 *
 * Run: node tests/pulse_propagation.mjs
 *
 * Each case is checked against an answer from outside the propagation code: a
 * closed form, the transfer matrix, or a direct numerical integral. Where two
 * runs are compared instead, the case says so.
 *
 *   1. The FFT against a direct DFT, both signs, and a round trip.
 *   2. A flat unity response returns the input unchanged.
 *   3. Transform-limited time-bandwidth products: 2 ln2/π for a Gaussian and
 *      4 ln²(1+√2)/π² for sech², and the input FWHM equal to the one asked for.
 *   4. A pure delay exp(iωτ) moves the pulse by τ and leaves its shape, and the
 *      transform alone, told nothing of the delay, puts the pulse at +τ.
 *   5. A pure GDD φ2 broadens a transform-limited Gaussian of intensity FWHM τ
 *      to τ·√(1 + (4 ln2·φ2/τ²)²) (Macleod, Thin-Film Optical Filters, 5th
 *      ed., Eq. 11.14 with τ = 2√(ln2)·μ), and leaves φ2 as residual GDD.
 *   6. A chirped input meets the opposite GDD over several passes and comes
 *      out transform limited; a typed TOD moves the input's centroid by
 *      TOD·ln2/τ² and stays as residual TOD. Two runs: input GDD and element
 *      GDD add with one sign.
 *   7. The delay read off the analytic group delay equals the centroid shift of
 *      the transformed pulse, for a real stack: the transform and the GD/GDD
 *      evaluator agree on the sign of time.
 *   8. |r|² and |t|² scaled as documented equal R and T from the TMM, on the
 *      front side and on the back.
 *   9. A response that rings for longer than the largest allowed window is
 *      reported unconverged, and converges once the window may grow enough.
 *  10. A Gires-Tournois interferometer with a nondispersive spacer and an ideal
 *      back mirror: its impulse response is a reflection s at t = 0 and echoes
 *      (1 − s²)(−s)^(m−1) at t = mT, so a pulse much shorter than T comes back as
 *      separate pulses carrying s², (1 − s²)², (1 − s²)²s², … of the energy,
 *      with the centroid at T.
 *  11. The Fourier-limited pulse of a chirped Gaussian is the transform limit.
 *  12. Super-Gaussian spectra against a direct integral, and tables: a sampled
 *      Gaussian, and a table phase whose GDD and TOD read back exactly.
 *  13. Whole part: |H|² = T_front·P·T_back from the TMM, and a bare plate's
 *      delay.
 *  14. A spectrum file wider than its line against a direct integral; the
 *      transform never exceeds the size allowed.
 *  15. Total internal reflection, through the whole part and into one side.
 *  16. Echoes folded back onto the pulse by the window are caught.
 *  17. The zero-frequency share against its closed form, either side of the
 *      threshold.
 *  Misc: passes, and the s and p average against the two channels' energies.
 */
import { fftInPlace } from '../src/utils/physics/pulsePropagation/fft.js';
import {
    propagatePulse, createCoatingResponses, carrierOmega, wavelengthFromOmega,
    omegaWidthFromWavelengthWidth, wavelengthWidthFromOmegaWidth, transformLimitedOmegaWidth,
} from '../src/utils/physics/pulsePropagation.js';
import { pulseSpectrumModel } from '../src/utils/physics/pulsePropagation/pulseSpectrum.js';
import { tmm } from '../src/utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

let fails = 0;
const ok = (condition, message) => { if (!condition) { console.error('FAIL:', message); fails++; } };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
// The band stops where the input spectral intensity falls to 1e-12 of its peak,
// which moves a duration by a few parts in 1e7 (Gaussian) to 1e6 (sech²), and
// for the shortest pulses at zero frequency, which moves a 5 fs sech² at
// 800 nm by 5e-6. Comparisons against closed forms in time allow for that.
const CUT = 1e-5;

// ── 1. FFT ───────────────────────────────────────────────────────────────────
{
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, k) => Math.sin(1.7 * k) + 0.3 * Math.cos(0.2 * k * k));
    const im = Float64Array.from({ length: n }, (_, k) => Math.cos(0.9 * k) - 0.1 * k / n);
    for (const sign of [-1, 1]) {
        const fr = re.slice(), fi = im.slice();
        fftInPlace(fr, fi, sign);
        let worst = 0;
        for (let k = 0; k < n; k++) {
            let sr = 0, si = 0;
            for (let m = 0; m < n; m++) {
                const a = sign * 2 * Math.PI * k * m / n;
                sr += re[m] * Math.cos(a) - im[m] * Math.sin(a);
                si += re[m] * Math.sin(a) + im[m] * Math.cos(a);
            }
            worst = Math.max(worst, Math.hypot(sr - fr[k], si - fi[k]));
        }
        ok(worst < 1e-12, `FFT sign ${sign} matches direct DFT (max error ${worst})`);
    }
    const fr = re.slice(), fi = im.slice();
    fftInPlace(fr, fi, -1);
    fftInPlace(fr, fi, 1);
    let worst = 0;
    for (let k = 0; k < n; k++) worst = Math.max(worst, Math.hypot(fr[k] / n - re[k], fi[k] / n - im[k]));
    ok(worst < 1e-14, `FFT round trip (max error ${worst})`);
}

const LAMBDA0 = 800;
const OMEGA0 = carrierOmega(LAMBDA0);
const deltaOmegaOf = wavelengthNm => carrierOmega(wavelengthNm) - OMEGA0;

/**
 * A unit-magnitude response exp(iψ(Δω)) with its analytic derivatives, given
 * as `derivatives(Δω) → [ψ, ψ', ψ'', ψ''']`.
 */
const phaseResponse = derivatives => wavelengthNm => {
    const [phase, gdFs, gddFs2, todFs3] = derivatives(deltaOmegaOf(wavelengthNm));
    return { valid: true, re: Math.cos(phase), im: Math.sin(phase), gdFs, gddFs2, todFs3 };
};
const unity = phaseResponse(() => [0, 0, 0, 0]);
const pureGdd = gdd => phaseResponse(d => [gdd * d * d / 2, gdd * d, gdd, 0]);
const pureTod = tod => phaseResponse(d => [tod * d ** 3 / 6, tod * d * d / 2, tod * d, tod]);

/**
 * Intensity FWHM of the pulse whose spectrum is a(Δω)·exp(iφ(Δω)) on [low, high],
 * from A(t) = ∫ Ã(Δω) exp(−iΔωt) dΔω by Simpson's rule at every time asked for:
 * no transform and no grid shared with the propagation code. The peak is looked
 * for within ±span.
 */
function directFwhm({ amplitude, phase = () => 0, low, high, span, intervals = 4000 }) {
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
const allPass = phaseResponse((d) => {
    const gamma = RING_GAMMA;
    const q = gamma * gamma + d * d;
    return [2 * Math.atan2(d, gamma), 2 * gamma / q, -4 * gamma * d / (q * q),
        -4 * gamma * (gamma * gamma - 3 * d * d) / (q * q * q)];
});

// ── 2. Unity response ────────────────────────────────────────────────────────
for (const shape of ['gaussian', 'sech2']) {
    const result = propagatePulse({
        pulse: { shape, centerWavelengthNm: LAMBDA0, durationFs: 10 }, responses: [unity],
    });
    ok(result.valid && result.converged, `${shape}: unity case converges`);
    let worst = 0;
    const peak = Math.max(...result.inputIntensity);
    for (let i = 0; i < result.time.length; i++) {
        worst = Math.max(worst, Math.abs(result.outputIntensity[i] - result.inputIntensity[i]) / peak);
    }
    ok(worst < 1e-12, `${shape}: unity response leaves the intensity unchanged (${worst})`);
    const m = result.metrics;
    ok(rel(m.input.fwhmFs, 10) < CUT, `${shape}: input FWHM ${m.input.fwhmFs} equals 10 fs`);
    ok(rel(m.broadening, 1) < 1e-12, `${shape}: broadening ${m.broadening} is 1`);
    ok(Math.abs(m.delayFs) < 1e-9, `${shape}: delay ${m.delayFs} is 0`);
    ok(rel(m.energyRatio, 1) < 1e-12, `${shape}: energy ratio ${m.energyRatio} is 1`);
    ok(rel(m.output.transformLimitedRatio, 1) < 1e-9,
        `${shape}: TL ratio ${m.output.transformLimitedRatio} is 1`);
    ok(m.output.residual.gddFs2 === 0, `${shape}: residual GDD ${m.output.residual.gddFs2} is 0`);
}

// ── 3. Time-bandwidth products ───────────────────────────────────────────────
{
    const expected = {
        gaussian: 2 * Math.LN2 / Math.PI,
        sech2: 4 * Math.log(1 + Math.SQRT2) ** 2 / Math.PI ** 2,
    };
    for (const [shape, tbp] of Object.entries(expected)) {
        for (const durationFs of [5, 30, 200]) {
            const result = propagatePulse({
                pulse: { shape, centerWavelengthNm: LAMBDA0, durationFs }, responses: [unity],
            });
            ok(result.valid, `${shape} ${durationFs} fs at ${LAMBDA0} nm is accepted`);
            if (!result.valid) continue;
            ok(rel(result.metrics.input.timeBandwidth, tbp) < CUT,
                `${shape} ${durationFs} fs: TBP ${result.metrics.input.timeBandwidth} equals ${tbp}`);
        }
    }
}

// ── 4. Pure delay ────────────────────────────────────────────────────────────
{
    const delay = 1234.5;
    const result = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 20 },
        responses: [phaseResponse(d => [(OMEGA0 + d) * delay, delay, 0, 0])],
    });
    const m = result.metrics;
    ok(rel(m.delayFs, delay) < 1e-12, `pure delay: ${m.delayFs} equals ${delay}`);
    ok(rel(result.referenceDelayFs, delay) < 1e-12, `pure delay: reference delay ${result.referenceDelayFs}`);
    ok(rel(m.broadening, 1) < 1e-9, `pure delay: broadening ${m.broadening} is 1`);
    ok(Math.abs(m.output.centroidFs) < 1e-9, `pure delay: output centred once the delay is removed`);

    // Told nothing of the delay, the transform alone must put the pulse at +τ.
    // The run is unconverged by design: its analytic delay, zero, disagrees.
    const untold = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 20 },
        responses: [phaseResponse(d => [(OMEGA0 + d) * 40, 0, 0, 0])],
        maxPoints: 2 ** 12,
    }).metrics;
    const shift = untold.output.centroidFs - untold.input.centroidFs;
    ok(Math.abs(shift - 40) < 1e-6, `the transform puts a pulse delayed by exp(iω·40 fs) at +40 fs (${shift})`);
}

// ── 5. Pure GDD on a Gaussian ────────────────────────────────────────────────
for (const gdd of [50, -50, 400, -1500]) {
    const tau = 15;
    const result = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau },
        responses: [pureGdd(gdd)],
    });
    const m = result.metrics;
    const expected = Math.sqrt(1 + (4 * Math.LN2 * gdd / (tau * tau)) ** 2);
    ok(result.converged, `GDD ${gdd}: converged`);
    ok(rel(m.broadening, expected) < CUT, `GDD ${gdd}: broadening ${m.broadening} equals ${expected}`);
    ok(rel(m.output.residual.gddFs2, gdd) < 1e-12, `GDD ${gdd}: residual GDD ${m.output.residual.gddFs2}`);
    ok(rel(m.peakRatio, 1 / expected) < CUT, `GDD ${gdd}: peak ratio ${m.peakRatio} equals ${1 / expected}`);
}

// ── 6. Compression over several passes ───────────────────────────────────────
for (const shape of ['gaussian', 'sech2']) {
    const result = propagatePulse({
        pulse: { shape, centerWavelengthNm: LAMBDA0, durationFs: 12, gddFs2: 240 },
        responses: [pureGdd(-60)],
        passes: 4,
    });
    const m = result.metrics;
    ok(m.input.fwhmFs > 3 * 12, `${shape}: chirped input is stretched (${m.input.fwhmFs} fs)`);
    ok(rel(m.output.fwhmFs, 12) < CUT, `${shape}: four passes of −60 fs² recompress to 12 fs (${m.output.fwhmFs})`);
    ok(rel(m.output.transformLimitedRatio, 1) < 1e-8, `${shape}: recompressed pulse is transform limited`);
    ok(Math.abs(m.output.residual.gddFs2) < 1e-9, `${shape}: residual GDD ${m.output.residual.gddFs2} is 0`);
}

// Positive input GDD and positive element GDD add: glass on a glass-chirped pulse.
{
    const pulse = { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 12, gddFs2: 100 };
    const same = propagatePulse({ pulse, responses: [pureGdd(100)] }).metrics;
    const whole = propagatePulse({ pulse: { ...pulse, gddFs2: 200 }, responses: [unity] }).metrics;
    // The two runs evaluate one spectral phase, but may do it on different
    // grids, which cut the band at different samples and move a duration by up
    // to a few parts in 1e8.
    ok(rel(same.output.fwhmFs, whole.output.fwhmFs) < 1e-7,
        `input GDD and element GDD add with one sign (${same.output.fwhmFs} vs ${whole.output.fwhmFs})`);
}

// A typed TOD. By Parseval the centroid is the mean group delay, ⟨TOD·Δω²/2⟩,
// and a Gaussian of intensity FWHM τ has spectral variance 2 ln2/τ², so the
// input sits at TOD·ln2/τ²; the TOD stays as residual TOD.
{
    const tau = 20;
    const tod = 2000;
    const typed = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau, todFs3: tod }, responses: [unity],
    }).metrics;
    ok(rel(typed.input.centroidFs, tod * Math.LN2 / tau ** 2) < 1e-9,
        `typed TOD: input centroid ${typed.input.centroidFs} equals ${tod * Math.LN2 / tau ** 2}`);
    ok(rel(typed.output.residual.todFs3, tod) < 1e-12, `typed TOD: residual TOD ${typed.output.residual.todFs3}`);
    const element = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau }, responses: [pureTod(tod)], passes: 3,
    }).metrics;
    ok(rel(element.output.residual.todFs3, 3 * tod) < 1e-12, `three passes of TOD: residual TOD ${element.output.residual.todFs3}`);
    ok(rel(element.delayFs, 3 * tod * Math.LN2 / tau ** 2) < 1e-9, `three passes of TOD: delay ${element.delayFs}`);
}

// ── 7. Analytic delay against the transformed pulse ──────────────────────────
const N_H = 2.51660, N_L = 1.45991, QW0 = 760;
function quarterWaveMirror(pairs) {
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
{
    // Every band ends inside the TiO2 table, which stops near 826 nm. Past a
    // table's end n holds its last value, and the kink that leaves in the phase
    // is resolved only as finely as the step; the 60 fs band at 770 nm ends at
    // 819 nm.
    const design = quarterWaveMirror(8);
    for (const [centerWavelengthNm, polarization, thetaDeg] of [[760, 's', 0], [700, 'p', 45], [770, 'avg', 30]]) {
        const result = propagatePulse({
            pulse: { shape: 'gaussian', centerWavelengthNm, durationFs: 60 },
            responses: createCoatingResponses(design, { polarization, thetaDeg }),
        });
        const m = result.metrics;
        const centroidShift = result.referenceDelayFs + m.output.centroidFs - m.input.centroidFs;
        ok(Math.abs(m.delayFs - centroidShift) < 1e-6 * Math.abs(m.delayFs),
            `mirror ${centerWavelengthNm} nm ${polarization} ${thetaDeg}°: analytic delay ${m.delayFs} equals centroid shift ${centroidShift}`);
        ok(m.delayFs > 0, `mirror ${centerWavelengthNm} nm: the stack delays the pulse (${m.delayFs} fs)`);
    }
}

// ── 8. |H|² equals R and T ───────────────────────────────────────────────────
{
    const design = quarterWaveMirror(4);
    const resolve = designMaterialLookup(design);
    for (const polarization of ['s', 'p']) {
        for (const thetaDeg of [0, 45]) {
            const [rFn] = createCoatingResponses(design, { target: 'R', polarization, thetaDeg });
            const [tFn] = createCoatingResponses(design, { target: 'T', polarization, thetaDeg });
            for (const wavelengthNm of [600, 760, 820]) {
                const layers = design.frontLayers.map(layer => ({
                    n: resolve(layer.material).getNK(wavelengthNm), d: layer.thickness,
                }));
                const reference = tmm(wavelengthNm, thetaDeg, polarization,
                    resolve('Air').getNK(wavelengthNm), resolve('BK7').getNK(wavelengthNm), layers);
                const r = rFn(wavelengthNm), t = tFn(wavelengthNm);
                ok(rel(r.re ** 2 + r.im ** 2, reference.R) < 1e-12, `|r|² = R at ${wavelengthNm} nm ${polarization} ${thetaDeg}°`);
                ok(rel(t.re ** 2 + t.im ** 2, reference.T) < 1e-12, `|t'|² = T at ${wavelengthNm} nm ${polarization} ${thetaDeg}°`);
            }
        }
    }
    // The back side: the back layers met from the exit medium, so in reverse of
    // their order from the substrate. An asymmetric stack tells the two apart.
    const backOnly = {
        ...design, frontLayers: [],
        backLayers: [{ material: 'SiO2', thickness: 140 }, { material: 'TiO2', thickness: 60 }, { material: 'SiO2', thickness: 90 }],
    };
    for (const target of ['R', 'T']) {
        const [fn] = createCoatingResponses(backOnly, { side: 'back', target, polarization: 'p', thetaDeg: 30 });
        for (const wavelengthNm of [600, 760]) {
            const layers = [...backOnly.backLayers].reverse().map(layer => ({
                n: resolve(layer.material).getNK(wavelengthNm), d: layer.thickness,
            }));
            const reference = tmm(wavelengthNm, 30, 'p',
                resolve('Air').getNK(wavelengthNm), resolve('BK7').getNK(wavelengthNm), layers);
            const point = fn(wavelengthNm);
            ok(rel(point.re ** 2 + point.im ** 2, reference[target]) < 1e-12,
                `back side: |H|² = ${target} at ${wavelengthNm} nm p 30°`);
        }
    }
}

// ── 9. Wrap-around is detected, not drawn ────────────────────────────────────
{
    const pulse = { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 20 };
    const small = propagatePulse({ pulse, responses: [allPass], maxPoints: 2 ** 13 });
    ok(small.valid && !small.converged && small.points === 2 ** 13,
        `ringing response with a small window is unconverged at the largest size allowed (guard ${small.guardEnergy})`);
    const large = propagatePulse({ pulse, responses: [allPass] });
    ok(large.converged, `ringing response converges with room to grow (${large.points} points)`);
    ok(rel(large.metrics.energyRatio, 1) < 1e-9, `all-pass keeps the energy (${large.metrics.energyRatio})`);
}

// ── 10. Gires-Tournois echoes ────────────────────────────────────────────────
/**
 * A Gires-Tournois interferometer with a nondispersive spacer of round trip T,
 * front-face coefficient s and an ideal back mirror:
 * H = (s + e^{iωT}) / (1 + s·e^{iωT}) in the exp(−iωt) convention.
 */
function gtiResponse(T, s) {
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
{
    // 150 µm air spacer (round trip T ≈ 1 ps), front face R = 4%.
    const T = 2 * 150e3 / 299.792458;
    const s = -0.2;
    const gti = gtiResponse(T, s);
    const result = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 100 }, responses: [gti],
    });
    ok(result.converged, `GTI converges (${result.points} points, ${result.windowFs.toFixed(0)} fs)`);
    const total = result.inputIntensity.reduce((sum, value) => sum + value, 0);
    for (let m = 0; m <= 3; m++) {
        let energy = 0;
        result.time.forEach((time, index) => {
            const absolute = time + result.referenceDelayFs;
            if (Math.abs(absolute - m * T) < T / 2) energy += result.outputIntensity[index];
        });
        const expected = m === 0 ? s * s : (1 - s * s) ** 2 * s ** (2 * (m - 1));
        // The response is exact; only the band cut at 1e-12 of the peak and
        // the echoes' overlap with the next half period remain.
        ok(rel(energy / total, expected) < 1e-9, `GTI echo ${m}: energy ${energy / total} equals ${expected}`);
    }
    ok(rel(result.metrics.delayFs, T) < 1e-9, `GTI: delay ${result.metrics.delayFs} equals the round trip ${T}`);
}

// ── 11. Fourier-limited pulse ────────────────────────────────────────────────
{
    const tau = 12;
    const gdd = 300;
    const result = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau, gddFs2: gdd },
        responses: [unity],
    });
    const m = result.metrics;
    const stretch = Math.sqrt(1 + (4 * Math.LN2 * gdd / (tau * tau)) ** 2);
    ok(rel(m.flp.fwhmFs, tau) < CUT, `FLP of a chirped Gaussian is the transform limit (${m.flp.fwhmFs})`);
    ok(rel(m.input.fwhmFs, tau * stretch) < CUT, `chirped input FWHM ${m.input.fwhmFs} equals ${tau * stretch}`);
    ok(rel(m.peakVsFlp, 1 / stretch) < CUT, `peak against the FLP ${m.peakVsFlp} equals ${1 / stretch}`);
    // The sampled maximum sits at most half a sample from the true peak, which
    // lowers it by under 3e-4 at 48 samples per duration.
    const flpPeak = Math.max(...result.flpIntensity);
    ok(rel(flpPeak, m.flp.peak) < 3e-4, 'the FLP curve and its peak share one scale');
}

// ── 12. Super-Gaussian and tabulated spectra ─────────────────────────────────
{
    // Order 2 is the Gaussian of the same spectral FWHM.
    const tau = 20;
    const bandwidthNm = wavelengthWidthFromOmegaWidth(LAMBDA0, transformLimitedOmegaWidth('gaussian', tau));
    const gaussian = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau }, responses: [pureGdd(200)],
    }).metrics;
    const order2 = propagatePulse({
        pulse: { shape: 'superGaussian', centerWavelengthNm: LAMBDA0, bandwidthNm, order: 2 },
        responses: [pureGdd(200)],
    }).metrics;
    ok(rel(order2.flp.fwhmFs, tau) < CUT, `super-Gaussian order 2: FLP ${order2.flp.fwhmFs} equals ${tau}`);
    ok(rel(order2.output.fwhmFs, gaussian.output.fwhmFs) < CUT,
        `super-Gaussian order 2 broadens as the Gaussian (${order2.output.fwhmFs} vs ${gaussian.output.fwhmFs})`);

    // The spectral FWHM entered in nm is the one the spectrum has, and the
    // order shapes the spectrum: the transform-limited duration of
    // |Ã|² = exp(−ln2·|2Δω/W|^p) against a direct integral.
    for (const order of [2, 4, 10]) {
        const W = omegaWidthFromWavelengthWidth(LAMBDA0, 60);
        const m = propagatePulse({
            pulse: { shape: 'superGaussian', centerWavelengthNm: LAMBDA0, bandwidthNm: 60, order },
            responses: [unity],
        }).metrics;
        ok(rel(m.input.bandwidth.fwhmNm, 60) < 1e-9, `super-Gaussian order ${order}: spectral FWHM ${m.input.bandwidth.fwhmNm} nm is 60 nm`);
        const edge = (W / 2) * Math.log2(1e12) ** (1 / order);
        const direct = directFwhm({
            amplitude: d => Math.exp(-0.5 * Math.LN2 * Math.abs(2 * d / W) ** order),
            low: -edge, high: edge, span: 60,
        });
        ok(rel(m.flp.fwhmFs, direct) < CUT, `super-Gaussian order ${order}: FLP ${m.flp.fwhmFs} fs equals ${direct} fs`);
    }
    ok(rel(omegaWidthFromWavelengthWidth(LAMBDA0, wavelengthWidthFromOmegaWidth(LAMBDA0, 0.3)), 0.3) < 1e-12,
        'wavelength and angular-frequency widths convert both ways');

    // A table sampled from a chirped Gaussian behaves as that Gaussian.
    const width = transformLimitedOmegaWidth('gaussian', tau);
    const rows = Array.from({ length: 801 }, (_, index) => {
        const deltaOmega = (index - 400) * width / 100;
        const wavelengthNm = wavelengthFromOmega(OMEGA0 + deltaOmega);
        return {
            wavelengthNm,
            intensity: Math.exp(-4 * Math.LN2 * (deltaOmega / width) ** 2),
            phaseRad: 150 * deltaOmega * deltaOmega / 2,
        };
    });
    const table = {
        wavelengthNm: rows.map(row => row.wavelengthNm),
        intensity: rows.map(row => row.intensity),
        phaseRad: rows.map(row => row.phaseRad),
    };
    const fromTable = propagatePulse({
        pulse: { shape: 'table', centerWavelengthNm: LAMBDA0, table }, responses: [unity],
    }).metrics;
    const analytic = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau, gddFs2: 150 }, responses: [unity],
    }).metrics;
    // With a hundred rows across the FWHM the table gives the Gaussian's
    // durations to within the band cut's few parts in 1e7.
    ok(rel(fromTable.flp.fwhmFs, tau) < CUT, `table: FLP ${fromTable.flp.fwhmFs} equals ${tau}`);
    ok(rel(fromTable.input.fwhmFs, analytic.input.fwhmFs) < CUT,
        `table: chirped input ${fromTable.input.fwhmFs} equals ${analytic.input.fwhmFs}`);
    // The not-a-knot spline reproduces a cubic, so the phase's GDD reads back
    // to round-off.
    ok(rel(fromTable.output.residual.gddFs2, 150) < 1e-9, `table: phase carries ${fromTable.output.residual.gddFs2} fs²`);

    // A table cut at the half-maximum points, where its end conditions matter:
    // a phase that is a GDD, then one that is a TOD, read back exactly.
    const cut = rows.filter(row => Math.abs(carrierOmega(row.wavelengthNm) - OMEGA0) <= width / 2 * (1 + 1e-12));
    const phaseTable = phase => ({
        wavelengthNm: cut.map(row => row.wavelengthNm),
        intensity: cut.map(row => row.intensity),
        phaseRad: cut.map(row => phase(carrierOmega(row.wavelengthNm) - OMEGA0)),
    });
    const gddRead = propagatePulse({
        pulse: { shape: 'table', centerWavelengthNm: LAMBDA0, table: phaseTable(d => 150 * d * d / 2) }, responses: [unity],
    }).metrics;
    ok(rel(gddRead.output.residual.gddFs2, 150) < 1e-9, `cut table: GDD ${gddRead.output.residual.gddFs2} reads back as 150 fs²`);
    const todRead = propagatePulse({
        pulse: { shape: 'table', centerWavelengthNm: LAMBDA0, table: phaseTable(d => 2000 * d ** 3 / 6) }, responses: [unity],
    }).metrics;
    ok(rel(todRead.output.residual.todFs3, 2000) < 1e-9, `cut table: TOD ${todRead.output.residual.todFs3} reads back as 2000 fs³`);

    // A phase's value and slope at the carrier only set its origin in time:
    // a constant and a linear phase leave the pulse the Fourier-limited one.
    const linear = propagatePulse({
        pulse: { shape: 'table', centerWavelengthNm: LAMBDA0, table: phaseTable(d => 0.7 + 35 * d) }, responses: [unity],
    }).metrics;
    ok(Math.abs(linear.input.centroidFs - linear.flp.centroidFs) < 1e-9 && rel(linear.input.peak, linear.flp.peak) < 1e-12,
        `a linear table phase is removed (centroid ${linear.input.centroidFs} fs)`);
}

// ── 13. Whole part in transmission ───────────────────────────────────────────
{
    const design = {
        ...quarterWaveMirror(2),
        substrate: { material: 'BK7', thickness: 2 },
        backLayers: [{ material: 'SiO2', thickness: 140 }, { material: 'TiO2', thickness: 60 }],
    };
    // The reference enters the substrate at a real angle. The part keeps
    // n0·sin θ0 throughout, as Snell's law does, which in an absorbing substrate
    // makes the angle complex: with BK7's k of about 1e-8 the two differ at that
    // order at oblique incidence. At normal incidence, or in lossless SiO2, they
    // agree to round-off.
    for (const [substrate, exit, polarization, thetaDeg, tolerance] of [
        ['BK7', 'Air', 's', 0, 1e-12], ['BK7', 'Air', 'p', 40, 1e-7],
        ['BK7', 'MgF2', 's', 0, 1e-12], ['SiO2', 'MgF2', 'p', 40, 1e-12],
    ]) {
        const part = { ...design, substrate: { material: substrate, thickness: 2 }, exitMedium: exit };
        const resolve = designMaterialLookup(part);
        const [whole] = createCoatingResponses(part, { side: 'whole', polarization, thetaDeg });
        for (const wavelengthNm of [600, 700, 820]) {
            const nk = id => resolve(id).getNK(wavelengthNm);
            const front = tmm(wavelengthNm, thetaDeg, polarization, nk('Air'), nk(substrate),
                part.frontLayers.map(layer => ({ n: nk(layer.material), d: layer.thickness })));
            const thetaSub = Math.asin(Math.sin(thetaDeg * Math.PI / 180) / nk(substrate)[0]) * 180 / Math.PI;
            const back = tmm(wavelengthNm, thetaSub, polarization, nk(substrate), nk(exit),
                part.backLayers.map(layer => ({ n: nk(layer.material), d: layer.thickness })));
            // Bulk transmittance of one pass, exp(−4πkd/(λ cos θs)), d = 2 mm.
            const pass = Math.exp(-4 * Math.PI * nk(substrate)[1] * 2e6 / (wavelengthNm * Math.cos(thetaSub * Math.PI / 180)));
            const point = whole(wavelengthNm);
            ok(rel(point.re ** 2 + point.im ** 2, front.T * pass * back.T) < tolerance,
                `whole part ${substrate} into ${exit} ${polarization} ${thetaDeg}° ${wavelengthNm} nm: |H|² = T_front·P·T_back`);
        }
    }
    // A bare plate delays a long pulse by its group delay at the carrier.
    const plate = { ...design, frontLayers: [], backLayers: [] };
    const [bare] = createCoatingResponses(plate, { side: 'whole' });
    const result = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 2000 }, responses: [bare],
    });
    const carrierDelay = bare(LAMBDA0).gdFs;
    ok(carrierDelay > 9000, `2 mm of BK7 delays by about 10 ps (${carrierDelay} fs)`);
    // The delay is the group delay averaged over the spectrum, which for a 2 ps
    // pulse differs from the carrier's by the plate's TOD times the spectral
    // variance over two: about 1e-9 of it.
    ok(rel(result.metrics.delayFs, carrierDelay) < 1e-8, `bare plate: pulse delay ${result.metrics.delayFs} equals ${carrierDelay}`);
    // The energy out is the transmittance averaged over the spectrum, which
    // across a 2 ps pulse's band differs from the carrier's by about 4e-11.
    ok(rel(result.metrics.energyRatio, bare(LAMBDA0).re ** 2 + bare(LAMBDA0).im ** 2) < 1e-9,
        'bare plate: energy out is the two faces\' transmittance');
}

// ── 14. A wide spectrum file, and the largest transform ──────────────────────
{
    // A measured file far wider than its line: a 5 nm line read over 400-1100 nm
    // at 0.5 nm. The band ends a row past where the line falls below 1e-12 of its
    // peak, so the wide file and the same rows trimmed to ±25 nm give one pulse,
    // and that pulse is the direct integral of the interpolated spectrum. The
    // interpolation puts faint echoes at 2π over the row spacing, about 4.3 ps,
    // which the window must hold rather than fold onto the pulse.
    const width = omegaWidthFromWavelengthWidth(LAMBDA0, 5);
    const line = wavelengthNm => Math.exp(-4 * Math.LN2 * ((carrierOmega(wavelengthNm) - OMEGA0) / width) ** 2);
    const rows = [];
    for (let wavelengthNm = 400; wavelengthNm <= 1100; wavelengthNm += 0.5) rows.push(wavelengthNm);
    const tableOf = list => ({ wavelengthNm: list, intensity: list.map(line) });
    const widePulse = { shape: 'table', centerWavelengthNm: LAMBDA0, table: tableOf(rows) };
    const wide = propagatePulse({ pulse: widePulse, responses: [pureGdd(5000)] });
    const trimmed = propagatePulse({
        pulse: { shape: 'table', centerWavelengthNm: LAMBDA0, table: tableOf(rows.filter(value => Math.abs(value - LAMBDA0) <= 25)) },
        responses: [pureGdd(5000)],
    });
    ok(wide.valid && wide.converged, 'a spectrum file wider than its line still fits');
    ok(wide.metrics.output.fwhmFs === trimmed.metrics.output.fwhmFs,
        `the wide file gives the trimmed file's pulse (${wide.metrics.output.fwhmFs} vs ${trimmed.metrics.output.fwhmFs} fs)`);
    const model = pulseSpectrumModel(widePulse, 1e-12);
    const direct = directFwhm({
        amplitude: model.amplitude, phase: d => 5000 * d * d / 2, low: model.low, high: model.high, span: 400,
    });
    ok(rel(wide.metrics.output.fwhmFs, direct) < 1e-6,
        `spectrum file: output FWHM ${wide.metrics.output.fwhmFs} fs equals the direct integral ${direct} fs`);

    // A response that rings far longer than the largest transform runs at that
    // size, never past it, and says it did not fit.
    const capped = propagatePulse({
        pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 10, gddFs2: 2000 },
        responses: [allPass], maxPoints: 2 ** 14,
    });
    ok(capped.valid && !capped.converged && capped.points === 2 ** 14,
        `the largest transform asked for is the largest used (${capped.points} points, converged ${capped.converged})`);
}

// ── 15. Total internal reflection inside the part ────────────────────────────
{
    const stack = { material: 'TiO2', thickness: 80 };
    const intoSubstrate = {
        incidentMedium: 'Al2O3', exitMedium: 'Al2O3', substrate: { material: 'SiO2', thickness: 1 },
        surfaceMode: 'front_only', frontLayers: [stack], backLayers: [stack],
    };
    const outOfSubstrate = {
        incidentMedium: 'BK7', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        surfaceMode: 'front_only', frontLayers: [stack], backLayers: [stack],
    };
    for (const [name, design, thetaDeg] of [['into the substrate', intoSubstrate, 70], ['out of the substrate', outOfSubstrate, 60]]) {
        const [whole] = createCoatingResponses(design, { side: 'whole', polarization: 'p', thetaDeg });
        const point = whole(LAMBDA0);
        ok(point.re === 0 && point.im === 0, `whole part, TIR ${name}: nothing comes out`);
        const result = propagatePulse({ pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 20 }, responses: [whole] });
        ok(!result.valid && result.reason === 'noOutput', `whole part, TIR ${name}: refused, not drawn from noise`);
    }
    // One side in transmission past the critical angle into a lossless
    // substrate: the transmitted wave is evanescent and carries no power.
    const side = {
        incidentMedium: 'Al2O3', exitMedium: 'Air', substrate: { material: 'SiO2', thickness: 1 },
        surfaceMode: 'front_only', frontLayers: [stack], backLayers: [],
    };
    for (const polarization of ['s', 'p', 'avg']) {
        const responses = createCoatingResponses(side, { side: 'front', target: 'T', polarization, thetaDeg: 70 });
        ok(responses.every(fn => fn(LAMBDA0).re === 0 && fn(LAMBDA0).im === 0), `front T past the critical angle, ${polarization}: nothing comes out`);
        const result = propagatePulse({ pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 20 }, responses });
        ok(!result.valid && result.reason === 'noOutput', `front T past the critical angle, ${polarization}: refused, not drawn from rounding`);
    }
}

// ── 16. Echoes folded onto the pulse by the window are caught ────────────────
{
    // 100 fs pulses sample every 100/48 fs. A round trip of 2048 samples puts
    // the echo at 2T exactly one window of 4096 samples after the reflection at
    // t = 0, so in that window it lands on the reflection with the guard band
    // empty; only the delay check sees it.
    const T = 2048 * 100 / 48;
    const result = propagatePulse({ pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 100 }, responses: [gtiResponse(T, -0.2)] });
    ok(result.converged, `folded GTI converges once the window grows (${result.points} points)`);
    ok(rel(result.metrics.delayFs, T) < 1e-6, `folded GTI: delay ${result.metrics.delayFs} equals the round trip ${T}`);
    ok(Math.abs(result.delayMismatchFs) < 1e-3, `folded GTI: analytic delay and centroid agree (${result.delayMismatchFs} fs)`);
}
{
    // A faint echo, H = 1 + a·e^{iωT} with a = 0.004 and T = 132 fs, too weak to
    // move the centroid past the delay check when folded. The RMS width weights
    // it by t², so a fold shows there: with the echo held, the intensity is the
    // pulse plus a² of it at T, whose moments are known exactly.
    const a = 0.004;
    const T = 132;
    // GD = Im(H'/H) with H' = i·a·T·e^{iωT}; GDD and TOD are its derivatives.
    const echo = (wavelengthNm) => {
        const theta = carrierOmega(wavelengthNm) * T;
        const q = 1 + 2 * a * Math.cos(theta) + a * a;
        return {
            valid: true,
            re: 1 + a * Math.cos(theta),
            im: a * Math.sin(theta),
            gdFs: a * T * (a + Math.cos(theta)) / q,
            gddFs2: -a * T * T * (1 - a * a) * Math.sin(theta) / (q * q),
            todFs3: -a * T ** 3 * (1 - a * a) * (Math.cos(theta) * q + 4 * a * Math.sin(theta) ** 2) / q ** 3,
        };
    };
    const tau = 10;
    const result = propagatePulse({ pulse: { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: tau }, responses: [echo] });
    const share = a * a / (1 + a * a);
    const sigma2 = tau * tau / (8 * Math.LN2);
    const rms = Math.sqrt(sigma2 + share * T * T - (share * T) ** 2);
    ok(result.converged && rel(result.metrics.output.rmsFs, rms) < 1e-9,
        `faint echo: RMS width ${result.metrics.output.rmsFs} fs equals ${rms} fs, the echo held at ${T} fs`);
    ok(Math.abs(result.metrics.delayFs - share * T) < 1e-9, `faint echo: delay ${result.metrics.delayFs} fs equals ${share * T} fs`);
}

// ── 17. Zero frequency ───────────────────────────────────────────────────────
{
    // A sech² intensity spectrum sech²(sΔω) puts (1 − tanh(s·ω0))/2 of its energy
    // at or below zero frequency. At 800 nm a 5 fs pulse puts 8e-10 there and is
    // kept; a 4.5 fs pulse puts 6e-9 and is refused.
    const share = durationFs => {
        const s = Math.PI * (durationFs / (2 * Math.log(1 + Math.SQRT2))) / 2;
        return (1 - Math.tanh(s * OMEGA0)) / 2;
    };
    const kept = propagatePulse({ pulse: { shape: 'sech2', centerWavelengthNm: LAMBDA0, durationFs: 5 }, responses: [unity] });
    ok(kept.valid && share(5) < 1e-9, `sech² 5 fs at 800 nm, ${share(5).toExponential(2)} below zero frequency, is kept`);
    const refused = propagatePulse({ pulse: { shape: 'sech2', centerWavelengthNm: LAMBDA0, durationFs: 4.5 }, responses: [unity] });
    ok(!refused.valid && refused.reason === 'spectrumReachesZeroFrequency', 'sech² 4.5 fs at 800 nm is refused');
    // The band ends where the intensity is 1e-12 of its peak, which leaves
    // out a tail of about 1e-12 of the spectrum's energy.
    ok(rel(refused.removedEnergy, share(4.5)) < 1e-3,
        `the share refused, ${refused.removedEnergy}, is the closed form ${share(4.5)}`);
}

// ── Misc: passes, polarization average, short pulses ─────────────────────────
{
    const pulse = { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 15 };
    const three = propagatePulse({ pulse, responses: [pureGdd(40)], passes: 3 }).metrics;
    const once = propagatePulse({ pulse, responses: [pureGdd(120)] }).metrics;
    ok(rel(three.output.fwhmFs, once.output.fwhmFs) < 1e-9, 'three passes of 40 fs² equal one of 120 fs²');
    ok(rel(three.output.residual.gddFs2, 120) < 1e-12, 'three passes of 40 fs² leave 120 fs²');

    // Unpolarized light is half s and half p, whose intensities add: the energy
    // out is the mean of the two channels', which a mean of fields would miss.
    const design = quarterWaveMirror(8);
    const centred = { ...pulse, centerWavelengthNm: 760 };
    const energy = polarization => propagatePulse({
        pulse: centred, responses: createCoatingResponses(design, { target: 'T', polarization, thetaDeg: 45 }),
    }).metrics.energyRatio;
    const [avg, s, p] = ['avg', 's', 'p'].map(energy);
    ok(rel(avg, (s + p) / 2) < 1e-12, `avg at 45°: energy out ${avg} is the mean of s ${s} and p ${p}`);

    const tooShort = propagatePulse({
        pulse: { shape: 'sech2', centerWavelengthNm: 3000, durationFs: 2 }, responses: [unity],
    });
    ok(!tooShort.valid && tooShort.reason === 'spectrumReachesZeroFrequency',
        'a spectrum with real energy at zero frequency is refused');
}

if (fails) {
    console.error(`\n${fails} failure(s)`);
    process.exit(1);
}
console.log('pulse_propagation: all checks passed');
