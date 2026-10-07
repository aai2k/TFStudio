/**
 * Pulse propagation validation.
 *
 * Run: node tests/pulse_propagation.mjs
 *
 * Every case has an answer that does not come from the propagation code:
 *
 *   1. The FFT against a direct DFT, both signs, and a round trip.
 *   2. A flat unity response returns the input unchanged.
 *   3. Transform-limited time-bandwidth products: 2 ln2/π for a Gaussian and
 *      4 ln²(1+√2)/π² for sech², and the input FWHM equal to the one asked for.
 *   4. A pure delay exp(iωτ) moves the pulse by τ and leaves its shape.
 *   5. A pure GDD φ2 broadens a transform-limited Gaussian of intensity FWHM τ
 *      to τ·√(1 + (4 ln2·φ2/τ²)²) (Macleod, Thin-Film Optical Filters, 5th
 *      ed., Eq. 11.14 with τ = 2√(ln2)·μ), and leaves φ2 as residual GDD.
 *   6. A chirped input meets the opposite GDD over several passes and comes
 *      out transform limited.
 *   7. The delay read off the analytic group delay equals the centroid shift of
 *      the transformed pulse, for a real stack: the transform and the GD/GDD
 *      evaluator agree on the sign of time.
 *   8. |r|² and |t|² scaled as documented equal R and T from the TMM.
 *   9. A response that rings for longer than the largest allowed window is
 *      reported unconverged, and converges once the window may grow enough.
 *  10. A Gires-Tournois interferometer with a nondispersive spacer and an ideal
 *      back mirror: its impulse response is a reflection s at t = 0 and echoes
 *      (1 − s²)(−s)^(m−1) at t = mT, so a pulse much shorter than T comes back as
 *      separate pulses carrying s², (1 − s²)², (1 − s²)²s², … of the energy,
 *      with the centroid at T.
 */
import { fftInPlace } from '../src/utils/physics/pulsePropagation/fft.js';
import {
    propagatePulse, createCoatingResponses, carrierOmega, wavelengthFromOmega,
    omegaWidthFromWavelengthWidth, wavelengthWidthFromOmegaWidth, transformLimitedOmegaWidth,
} from '../src/utils/physics/pulsePropagation.js';
import { tmm } from '../src/utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

let fails = 0;
const ok = (condition, message) => { if (!condition) { console.error('FAIL:', message); fails++; } };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
// The band stops where the input spectral intensity falls to 1e-12 of its peak,
// which moves a duration by a few parts in 1e7 (Gaussian) to 1e6 (sech²).
// Comparisons against closed forms in time allow for that and no more.
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
    // The two runs size their windows differently, so they agree to the energy
    // the guard band allows to wrap, not to round-off.
    ok(rel(same.output.fwhmFs, whole.output.fwhmFs) < 1e-7,
        `input GDD and element GDD add with one sign (${same.output.fwhmFs} vs ${whole.output.fwhmFs})`);
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
    // Inside the TiO2 table, which ends near 826 nm: past a table's end n holds
    // its last value, and the kink that leaves in the phase is a property of
    // the data, which a sampled spectrum resolves only as finely as its step.
    const design = quarterWaveMirror(8);
    for (const [centerWavelengthNm, polarization, thetaDeg] of [[760, 's', 0], [700, 'p', 45], [790, 'avg', 30]]) {
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
}

// ── 9. Wrap-around is detected, not drawn ────────────────────────────────────
{
    // An all-pass resonance (γ + iΔ)/(γ − iΔ): |H| = 1, energy stored for ~1/γ.
    const gamma = 2e-4;
    const allPass = phaseResponse((d) => {
        const q = gamma * gamma + d * d;
        return [2 * Math.atan2(d, gamma), 2 * gamma / q, -4 * gamma * d / (q * q),
            -4 * gamma * (gamma * gamma - 3 * d * d) / (q * q * q)];
    });
    const pulse = { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 20 };
    const small = propagatePulse({ pulse, responses: [allPass], maxPoints: 2 ** 13 });
    ok(small.valid && !small.converged, `ringing response with a small window is unconverged (guard ${small.guardEnergy})`);
    const large = propagatePulse({ pulse, responses: [allPass] });
    ok(large.converged, `ringing response converges with room to grow (${large.points} points)`);
    ok(rel(large.metrics.energyRatio, 1) < 1e-9, `all-pass keeps the energy (${large.metrics.energyRatio})`);
}

// ── 10. Gires-Tournois echoes ────────────────────────────────────────────────
{
    // 150 µm air spacer (round trip T ≈ 1 ps), front face R = 4%, ideal back
    // mirror: H = (s + e^{iωT}) / (1 + s·e^{iωT}) in the exp(−iωt) convention.
    const T = 2 * 150e3 / 299.792458;
    const s = -0.2;
    const gti = phaseResponse((d) => {
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
        ok(rel(energy / total, expected) < 1e-6, `GTI echo ${m}: energy ${energy / total} equals ${expected}`);
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
    const flpPeak = Math.max(...result.flpIntensity);
    ok(rel(flpPeak, m.flp.peak) < 1e-3, 'the FLP curve and its peak share one scale');
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

    // The spectral FWHM entered in nm is the one the spectrum has.
    for (const order of [2, 4, 10]) {
        const m = propagatePulse({
            pulse: { shape: 'superGaussian', centerWavelengthNm: LAMBDA0, bandwidthNm: 60, order },
            responses: [unity],
        }).metrics;
        ok(rel(m.input.bandwidth.fwhmNm, 60) < 1e-9, `super-Gaussian order ${order}: spectral FWHM ${m.input.bandwidth.fwhmNm} nm is 60 nm`);
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
    ok(rel(fromTable.flp.fwhmFs, tau) < 1e-4, `table: FLP ${fromTable.flp.fwhmFs} equals ${tau}`);
    ok(rel(fromTable.input.fwhmFs, analytic.input.fwhmFs) < 1e-4,
        `table: chirped input ${fromTable.input.fwhmFs} equals ${analytic.input.fwhmFs}`);
    ok(rel(fromTable.output.residual.gddFs2, 150) < 1e-3, `table: phase carries ${fromTable.output.residual.gddFs2} fs²`);
}

// ── 13. Whole part in transmission ───────────────────────────────────────────
{
    const design = {
        ...quarterWaveMirror(2),
        substrate: { material: 'BK7', thickness: 2 },
        backLayers: [{ material: 'SiO2', thickness: 140 }, { material: 'TiO2', thickness: 60 }],
    };
    const resolve = designMaterialLookup(design);
    for (const [polarization, thetaDeg] of [['s', 0], ['p', 40]]) {
        const [whole] = createCoatingResponses(design, { side: 'whole', polarization, thetaDeg });
        for (const wavelengthNm of [600, 700, 820]) {
            const nk = id => resolve(id).getNK(wavelengthNm);
            const front = tmm(wavelengthNm, thetaDeg, polarization, nk('Air'), nk('BK7'),
                design.frontLayers.map(layer => ({ n: nk(layer.material), d: layer.thickness })));
            const thetaSub = Math.asin(Math.sin(thetaDeg * Math.PI / 180) / nk('BK7')[0]) * 180 / Math.PI;
            const back = tmm(wavelengthNm, thetaSub, polarization, nk('BK7'), nk('Air'),
                design.backLayers.map(layer => ({ n: nk(layer.material), d: layer.thickness })));
            // Bulk transmittance of one pass, exp(−4πkd/(λ cos θs)), d = 2 mm.
            const pass = Math.exp(-4 * Math.PI * nk('BK7')[1] * 2e6 / (wavelengthNm * Math.cos(thetaSub * Math.PI / 180)));
            const point = whole(wavelengthNm);
            // BK7 carries k ≈ 1e-8 here. The TMM's transmittance out of an absorbing
            // medium (Macleod Eq. 2.83) and the separate bulk pass account for it
            // differently at that order, so they agree to 1e-8, not to round-off.
            ok(rel(point.re ** 2 + point.im ** 2, front.T * pass * back.T) < 1e-7,
                `whole part ${polarization} ${thetaDeg}° ${wavelengthNm} nm: |H|² = T_front·P·T_back`);
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
    ok(rel(result.metrics.delayFs, carrierDelay) < 1e-6, `bare plate: pulse delay ${result.metrics.delayFs} equals ${carrierDelay}`);
    ok(rel(result.metrics.energyRatio, bare(LAMBDA0).re ** 2 + bare(LAMBDA0).im ** 2) < 1e-6,
        'bare plate: energy out is the two faces\' transmittance');
}

// ── Misc: passes, polarization average, short pulses ─────────────────────────
{
    const pulse = { shape: 'gaussian', centerWavelengthNm: LAMBDA0, durationFs: 15 };
    const three = propagatePulse({ pulse, responses: [pureGdd(40)], passes: 3 }).metrics;
    const once = propagatePulse({ pulse, responses: [pureGdd(120)] }).metrics;
    ok(rel(three.output.fwhmFs, once.output.fwhmFs) < 1e-9, 'three passes of 40 fs² equal one of 120 fs²');
    ok(rel(three.output.residual.gddFs2, 120) < 1e-12, 'three passes of 40 fs² leave 120 fs²');

    const design = quarterWaveMirror(8);
    const centred = { ...pulse, centerWavelengthNm: 760 };
    const avg = propagatePulse({ pulse: centred, responses: createCoatingResponses(design, { polarization: 'avg' }) });
    const s = propagatePulse({ pulse: centred, responses: createCoatingResponses(design, { polarization: 's' }) });
    ok(rel(avg.metrics.output.fwhmFs, s.metrics.output.fwhmFs) < 1e-9, 'at normal incidence avg equals s');

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
