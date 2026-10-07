/**
 * Pulse Analysis window: what the worker returns and how the window reads it.
 *
 * Run: node tests/pulse_analysis_window.mjs
 *
 * The physics is checked in pulse_propagation.mjs. This file checks the layer
 * above it: the worker operation, the scaling of the drawn curves, the chart
 * options for both views, the Results rows, the spectrum-file reader, the GDD
 * target the "From target" button reads, and the session rule that Whole part
 * is transmission only.
 */
import './_uiShim.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { computePulseAnalysis, pulseFromSettings } =
    await import('../src/components/windows/analysis/pulseAnalysis/pulseModel.js');
const { buildPulseChartOption } = await import('../src/components/windows/analysis/pulseAnalysis/chartModel.js');
const { readoutParts, resultsTable } = await import('../src/components/windows/analysis/pulseAnalysis/viewModel.js');
const { readPulseSpectrum, designGddTarget, gddFromTarget } =
    await import('../src/components/windows/analysis/pulseAnalysis/usePulseAnalysis.js');
const { gddAxisRange } = await import('../src/components/windows/analysis/pulseAnalysis/chartModel.js');
const { pulseProblem, carrierOmega, wavelengthFromOmega } = await import('../src/utils/physics/pulsePropagation.js');
const { pulseSession } = await import('../src/components/windows/analysis/pulseAnalysis/sessionState.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { default: en } = await import('../src/constants/locales/en.js');

let fails = 0;
const ok = (condition, message) => { if (!condition) { console.error('FAIL:', message); fails++; } };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

// Macleod, Thin-Film Optical Filters, 5th ed., Table 11.1: a 23-layer chirped
// reflector, optical thicknesses in waves at 700 nm, layer 1 next to air. The
// book gives no indices; 2.4468 and 1.4553 are TFStudio's own TiO2 and SiO2 at
// 700 nm, and BK7 stands for the book's glass.
const OT = [0.048, 0.239, 0.336, 0.208, 0.231, 0.197, 0.225, 0.292, 0.292, 0.287, 0.279, 0.288,
    0.282, 0.285, 0.275, 0.291, 0.306, 0.324, 0.362, 0.320, 0.355, 0.323, 0.273];
const design = {
    name: 'chirped', incidentMedium: 'Air', substrate: { material: 'BK7', thickness: 1 }, exitMedium: 'Air',
    surfaceMode: 'front_only', backLayers: [],
    frontLayers: OT.map((q, i) => ({ material: i % 2 === 0 ? 'TiO2' : 'SiO2', thickness: q * 700 / (i % 2 === 0 ? 2.4468 : 1.4553) })),
    meritOperands: [
        { type: 'GDD', enabled: true, target: -30, lambdaStart: 760 },
        { type: 'GDDFLAT', enabled: true, target: -34, lambdaStart: 760, lambdaEnd: 860 },
        { type: 'GDD', enabled: false, target: 999, lambdaStart: 800 },
        { type: 'GDDT', enabled: true, target: 5, lambdaStart: 800 },
    ],
};
const text = en.pulseAnalysis;

const settings = {
    source: 'model', shape: 'gaussian', centerWavelength: 820, duration: 15, bandwidth: 100, order: 2,
    gdd: 140, tod: 0, spectrumFile: null,
};
const request = { pulse: pulseFromSettings(settings), side: 'front', target: 'R', polarization: 's', thetaDeg: 0, passes: 4 };

// ── Worker result ────────────────────────────────────────────────────────────
const view = dispatchAnalysisEvaluation('pulseAnalysis', { design, request });
{
    ok(view.valid && view.converged, 'the chirped mirror run is valid and fits its window');
    ok(view.chirped, 'a typed GDD makes the input differ from its FLP');
    // The sampled maximum sits at most half a sample from the true peak.
    const flpPeak = Math.max(...view.time.flp.y);
    ok(rel(flpPeak, 1) < 3e-4, `the FLP curve peaks at 1 (${flpPeak})`);
    for (const key of ['flp', 'input', 'output']) {
        ok(view.time[key].x.length <= 4000 && view.time[key].x.length === view.time[key].y.length,
            `${key} curve is thinned to at most 4000 points (${view.time[key].x.length})`);
    }
    // The peak and the centroid of a pulse with a tail on one side differ by a
    // fraction of its width, here about half a femtosecond.
    const outputPeakAt = view.time.output.x[view.time.output.y.indexOf(Math.max(...view.time.output.y))];
    ok(Math.abs(outputPeakAt - view.metrics.delayFs) < 3, `the output curve sits at its delay (${outputPeakAt} fs vs ${view.metrics.delayFs} fs)`);
    const oneBounce = computePulseAnalysis(design, { ...request, passes: 1 });
    ok(view.metrics.outputFwhmFs < oneBounce.metrics.outputFwhmFs && oneBounce.metrics.outputFwhmFs < view.metrics.inputFwhmFs,
        `each bounce recompresses the chirped input further (${view.metrics.inputFwhmFs}, ${oneBounce.metrics.outputFwhmFs}, ${view.metrics.outputFwhmFs} fs)`);
    ok(Math.max(...view.spectrum.input.y) === 1, 'the input spectrum peaks at 1');
    ok(Math.max(...view.spectrum.output.y) < 1, 'the output spectrum shows the reflectance lost');
    ok(view.spectrum.bandNm[0] < 820 && view.spectrum.bandNm[1] > 820, 'the drawn band holds the carrier');
    ok(view.spectrum.compensatingGddFs2.y.every(value => value === -140), 'the compensating GDD is minus the typed GDD');
    ok(view.echoDelayFs === null, 'only Whole part reports an echo');
    ok(structuredClone(view).valid, 'the result survives a structured clone');
    // The GDD axis is ranged on the bulk of the curve, so it holds the coating's
    // GDD near the carrier however far the reflection minima throw the rest.
    const range = gddAxisRange(view);
    const near = view.spectrum.coatingGddFs2.x.findIndex(wavelength => wavelength <= 820);
    const atCarrier = view.spectrum.coatingGddFs2.y[near];
    ok(range && atCarrier >= range.range[0] && atCarrier <= range.range[1], `the GDD axis holds the GDD at the carrier (${atCarrier} fs²)`);
}

// Thinning keeps a narrow peak: a 100 µm layer sends echoes back every 1.7 ps,
// so the output curve has far more samples than are drawn, and its drawn peak
// must still be the readout's, to the half sample the readout looks between.
{
    const thick = {
        ...design, frontLayers: [{ material: 'TiO2', thickness: 1e5 }], meritOperands: [],
    };
    const ringing = computePulseAnalysis(thick, {
        pulse: pulseFromSettings({ ...settings, duration: 5, gdd: 0 }),
        side: 'front', target: 'R', polarization: 's', thetaDeg: 0, passes: 1,
    });
    const drawnPeak = Math.max(...ringing.time.output.y);
    ok(ringing.valid && rel(drawnPeak, ringing.metrics.peakVsFlp) < 3e-4,
        `the drawn output peak is the readout's (${drawnPeak} vs ${ringing.metrics.peakVsFlp})`);
}

// Whole part reports the substrate echo; a pulse too short for its carrier is
// refused with words for why.
{
    const whole = computePulseAnalysis(design, { ...request, side: 'whole', target: 'T', passes: 1, pulse: { ...request.pulse, gddFs2: 0 } });
    ok(whole.valid && whole.echoDelayFs > 9000, `Whole part: echo of 1 mm BK7 after ${whole.echoDelayFs} fs`);
    ok(!whole.chirped, 'no typed chirp: the input is its own FLP');
    const tooShort = computePulseAnalysis(design, { ...request, pulse: { ...request.pulse, shape: 'sech2', centerWavelengthNm: 4000, durationFs: 2 } });
    ok(!tooShort.valid && tooShort.reason === 'spectrumReachesZeroFrequency', 'a pulse too short for its carrier is reported, not drawn');
    ok(typeof text.errors[tooShort.reason] === 'string', 'and the window has words for it');
}

// ── Chart options ────────────────────────────────────────────────────────────
{
    const labels = { flp: 'FLP', input: 'In', output: 'Out', inputSpectrum: 'S in', outputSpectrum: 'S out',
        coatingGdd: 'GDD', compensatingGdd: '-GDD in', timeAxis: 't', intensityAxis: 'I',
        wavelengthAxis: 'λ', spectralAxis: 'S', gddAxis: 'GDD' };
    const colors = { background: '#000', paper: '#111', grid: '#222', text: '#eee' };
    const curveColors = { flp: '#4fc3f7', input: '#9e9e9e', output: '#ffb74d', gdd: '#ef5350' };
    const absolute = buildPulseChartOption({ view, mode: 'time', timeAxis: 'absolute', labels, colors, curveColors, materialBands: [] });
    const removed = buildPulseChartOption({ view, mode: 'time', timeAxis: 'removed', labels, colors, curveColors, materialBands: [] });
    const lines = option => option.series.filter(series => series.type === 'line');
    ok(lines(absolute).length === 3, 'time view draws FLP, chirped input and output');
    const firstX = option => lines(option)[2].data[0][0];
    ok(Math.abs(firstX(absolute) - firstX(removed) - view.metrics.delayFs) < 1e-9, 'removing the delay shifts only the output, by the delay');
    ok(lines(absolute)[0].data[0][0] === lines(removed)[0].data[0][0], 'the FLP does not move');
    const spectrum = buildPulseChartOption({ view, mode: 'spectrum', timeAxis: 'removed', labels, colors, curveColors, materialBands: [] });
    ok(Array.isArray(spectrum.yAxis) && spectrum.yAxis.length === 2, 'spectrum view has an intensity axis and a GDD axis');
    ok(lines(spectrum).filter(series => series.yAxisIndex === 1).length === 2, 'coating GDD and compensating GDD go on the GDD axis');
    const unchirped = buildPulseChartOption({ view: { ...view, chirped: false }, mode: 'time', timeAxis: 'removed', labels, colors, curveColors, materialBands: [] });
    ok(lines(unchirped).length === 2, 'with no chirp the input is the FLP and is not drawn twice');
}

// ── Readout and Results ──────────────────────────────────────────────────────
{
    const parts = readoutParts(view.metrics, text);
    ok(parts.length === 5 && parts[0].startsWith('FLP 15.00 fs'), `readout leads with the FLP (${parts[0]})`);
    const table = resultsTable(view, text);
    ok(table.rows.length === 13, `Results carry every number (${table.rows.length} rows)`);
    const peak = table.rows.find(row => row.quantity === text.rowPeak);
    ok(rel(peak.value, 100 * view.metrics.peakVsFlp) < 1e-12 && peak.unit === '%', 'a percentage row holds the percentage');
    const csv = csvFromRows(table.columns, table.rows);
    ok(csv.split('\n').length === 14 && csv.includes(String(view.metrics.delayFs)), 'the CSV keeps the raw values');
}

// ── Spectrum file ────────────────────────────────────────────────────────────
{
    const rows = [];
    for (let wavelength = 700; wavelength <= 900; wavelength += 2) {
        const intensity = Math.exp(-(((wavelength - 800) / 30) ** 2));
        rows.push(`${wavelength}\t${intensity.toFixed(6)}\t${(0.001 * (wavelength - 800) ** 2).toFixed(6)}`);
    }
    const spectrum = readPulseSpectrum(`Wavelength (nm)\tIntensity\tPhase\n${rows.join('\n')}`, 'measured.txt');
    ok(spectrum && spectrum.rows === 101, 'a three-column table reads in full');
    ok(spectrum.table.phaseRad.length === 101, 'the third column is the phase');
    const fromFile = computePulseAnalysis(design, {
        ...request, passes: 1,
        pulse: pulseFromSettings({ ...settings, source: 'file', spectrumFile: spectrum, centerWavelength: spectrum.centerWavelengthNm, gdd: 0 }),
    });
    ok(fromFile.valid && fromFile.chirped, 'a file spectrum with a curved phase runs and counts as chirped');
    // A phase linear in frequency only moves the pulse in time.
    const linearRows = rows.map(row => row.split('\t').slice(0, 2).concat(
        (0.3 + 25 * (carrierOmega(Number(row.split('\t')[0])) - carrierOmega(800))).toFixed(9)).join('\t'));
    const linear = readPulseSpectrum(`Wavelength (nm)\tIntensity\tPhase\n${linearRows.join('\n')}`, 'linear.txt');
    const fromLinear = computePulseAnalysis(design, {
        ...request, passes: 1,
        pulse: pulseFromSettings({ ...settings, source: 'file', spectrumFile: linear, centerWavelength: linear.centerWavelengthNm, gdd: 0 }),
    });
    ok(fromLinear.valid && !fromLinear.chirped, 'a phase linear in frequency is not a chirp');
    ok(readPulseSpectrum('no numbers here', 'bad.txt') === null, 'a file with no table is refused');
    ok(pulseProblem(pulseFromSettings({ ...settings, source: 'file' })) === 'table', 'File with nothing loaded asks for a file');
}

// A spectrum symmetric in frequency about 800 nm, written as a spectrometer
// records it: per unit wavelength, I_λ = I_ω·|dω/dλ| ∝ I_ω/λ², on rows even in
// wavelength. Read back per unit frequency, its centroid in frequency is 800 nm.
// Against wavenumber the same light is per unit frequency as it stands. The
// carrier is rounded to 0.01 nm.
{
    const omegaC = carrierOmega(800);
    const perFrequency = wavelength => Math.exp(-(((carrierOmega(wavelength) - omegaC) / 0.08) ** 2));
    const even = [];
    for (let wavelength = 650; wavelength <= 1000; wavelength += 0.5) even.push(wavelength);
    const nm = readPulseSpectrum(
        `Wavelength (nm)\tIntensity\n${even.map(w => `${w}\t${perFrequency(w) / (w * w)}`).join('\n')}`, 'nm.txt');
    ok(Math.abs(nm.centerWavelengthNm - 800) <= 0.01, `per unit wavelength: carrier ${nm.centerWavelengthNm} nm is 800 nm`);
    const cm = readPulseSpectrum(
        `Wavenumber (cm-1)\tIntensity\n${even.map(w => `${1e7 / w}\t${perFrequency(w)}`).join('\n')}`, 'cm.txt');
    ok(Math.abs(cm.centerWavelengthNm - 800) <= 0.01, `per unit wavenumber: carrier ${cm.centerWavelengthNm} nm is 800 nm`);
    ok(Math.abs(wavelengthFromOmega(omegaC) - 800) < 1e-12, 'the carrier conversions are inverse');
}

// ── GDD target and session ───────────────────────────────────────────────────
{
    const front = { side: 'front', surfaceMode: 'front_only' };
    ok(designGddTarget(design.meritOperands, { ...front, target: 'R' }) === -32,
        'reflection target is the mean of the enabled GDD targets');
    ok(designGddTarget(design.meritOperands, { ...front, target: 'T' }) === 5, 'transmission reads the transmission targets');
    ok(designGddTarget([], { ...front, target: 'R' }) === null, 'no target, no value');
    ok(designGddTarget(design.meritOperands, { side: 'back', surfaceMode: 'front_only', target: 'R' }) === null,
        'the side the merit function does not score has no target');
    ok(designGddTarget(design.meritOperands, { side: 'back', surfaceMode: 'back_only', target: 'R' }) === -32,
        'a back-only design scores the back side');
    ok(designGddTarget(design.meritOperands, { side: 'whole', surfaceMode: 'front_only', target: 'T' }) === null,
        'no target describes the whole part');
    // Four bounces of a −32 fs² mirror remove +128 fs² of input chirp.
    ok(gddFromTarget(-32, 4) === 128, 'From target sets the chirp the bounces remove');
    const copy = 'pulse-test-copy';
    pulseSession.read(design, copy);
    ok(pulseSession.write(design, { side: 'whole', target: 'R' }, copy).target === 'T',
        'Whole part is transmission only');
    ok(pulseSession.write(design, { side: 'front', target: 'R' }, copy).target === 'R',
        'a coating side keeps reflection');
}

if (fails) {
    console.error(`\n${fails} failure(s)`);
    process.exit(1);
}
console.log('pulse_analysis_window: all checks passed');
