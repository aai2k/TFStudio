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
const { readPulseSpectrum, designGddTarget } =
    await import('../src/components/windows/analysis/pulseAnalysis/usePulseAnalysis.js');
const { pulseSession } = await import('../src/components/windows/analysis/pulseAnalysis/sessionState.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { default: en } = await import('../src/constants/locales/en.js');

let fails = 0;
const ok = (condition, message) => { if (!condition) { console.error('FAIL:', message); fails++; } };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

// Macleod, Thin-Film Optical Filters, 5th ed., Table 11.1: a 23-layer chirped
// reflector, optical thicknesses in waves at 700 nm, layer 1 next to air.
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
    const flpPeak = Math.max(...view.time.flp.y);
    ok(rel(flpPeak, 1) < 1e-3, `the FLP curve peaks at 1 (${flpPeak})`);
    for (const key of ['flp', 'input', 'output']) {
        ok(view.time[key].t.length <= 4000 && view.time[key].t.length === view.time[key].y.length,
            `${key} curve is thinned to at most 4000 points (${view.time[key].t.length})`);
    }
    const outputPeakAt = view.time.output.t[view.time.output.y.indexOf(Math.max(...view.time.output.y))];
    ok(Math.abs(outputPeakAt - view.metrics.delayFs) < 3, `the output curve sits at its delay (${outputPeakAt} fs vs ${view.metrics.delayFs} fs)`);
    ok(view.metrics.outputFwhmFs < view.metrics.inputFwhmFs, 'four bounces recompress the chirped input');
    ok(Math.max(...view.spectrum.input) === 1, 'the input spectrum peaks at 1');
    ok(Math.max(...view.spectrum.output) < 1, 'the output spectrum shows the reflectance lost');
    ok(view.spectrum.bandNm[0] < 820 && view.spectrum.bandNm[1] > 820, 'the drawn band holds the carrier');
    ok(view.spectrum.compensatingGddFs2.every(value => value === -140), 'the compensating GDD is minus the typed GDD');
    ok(view.echoDelayFs === null, 'only Whole part reports an echo');
    ok(JSON.parse(JSON.stringify(view)).valid, 'the result survives a structured clone');
}

// Whole part reports the substrate echo; an empty side reports why it is blank.
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
    ok(Math.abs(spectrum.centerWavelengthNm - 800) < 2, `the carrier is the spectrum's centroid (${spectrum.centerWavelengthNm} nm)`);
    const fromFile = computePulseAnalysis(design, {
        ...request, passes: 1,
        pulse: pulseFromSettings({ ...settings, source: 'file', spectrumFile: spectrum, centerWavelength: spectrum.centerWavelengthNm, gdd: 0 }),
    });
    ok(fromFile.valid && fromFile.chirped, 'a file spectrum with a phase runs and counts as chirped');
    ok(readPulseSpectrum('no numbers here', 'bad.txt') === null, 'a file with no table is refused');
    ok(pulseFromSettings({ ...settings, source: 'file' }).shape === 'table', 'File with nothing loaded asks for a file');
}

// ── GDD target and session ───────────────────────────────────────────────────
{
    ok(designGddTarget(design.meritOperands, 'R') === -32, 'reflection target is the mean of the enabled GDD targets');
    ok(designGddTarget(design.meritOperands, 'T') === 5, 'transmission reads the transmission targets');
    ok(designGddTarget([], 'R') === null, 'no target, no value');
    const state = pulseSession.normalize
        ? pulseSession.normalize({ side: 'whole', target: 'R' })
        : null;
    if (state) ok(state.target === 'T', 'Whole part is transmission only');
}

if (fails) {
    console.error(`\n${fails} failure(s)`);
    process.exit(1);
}
console.log('pulse_analysis_window: all checks passed');
