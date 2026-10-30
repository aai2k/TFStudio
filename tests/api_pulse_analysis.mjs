/**
 * The headless API's pulseAnalysis and setPulseSpectrum (src/api/pulse.js)
 * against the Pulse Analysis window's own code and the GD/GDD numbers.
 *
 *   1. On the corpus designs with no catalog, pulseAnalysis is
 *      computePulseAnalysis, the function the window's worker calls, with the
 *      request its hook builds: on two designs over front, back and the whole
 *      part, R and T, s, p and avg, at 0 and 45 degrees, in each of the three
 *      shapes away from its opening duration or bandwidth and order; on the
 *      others at one of those, with passes, a chirp of the input's own and
 *      another centre, taken in turn. A request the model cannot compute is
 *      refused with the model's reason. Without options it takes the window's
 *      opening settings, as the window opens on each corpus design; with one
 *      side empty the side is the merit rows', as groupDelay's, where the
 *      window opens on the side with layers. A side with no layers gives its
 *      bare surface.
 *   2. The design's own spectrum: with source 'design' the centre is the
 *      centroid Apply sets, and the pulse the window's with source 'file'.
 *   3. Choice 7's sample on Chirped mirror start: at the opening settings the
 *      output curve has 308 samples, the spectrum 709 and the output peaks at
 *      0.904804; with its own spectrum, 178 and 0.987253. The time curves are
 *      the transform's samples from the first to the last above 1e-4 of the
 *      Fourier-limited peak; the spectrum curves a fresh evaluation when the
 *      band the view draws has fewer than 600 transform samples, and those
 *      samples when it has more. Past 4000 samples each curve keeps the lowest
 *      and highest of each run of its own values.
 *   4. The objects' CSV is the window's Results table through its Copy CSV,
 *      the input's FWHM row only when the input is chirped.
 *   5. Cross-checks: coatingGdd is groupDelay's GDD at the same wavelengths,
 *      times the passes, on one side and through the whole part; outOfRange is
 *      the window's range notice for the side computed.
 *   6. setPulseSpectrum: a file reads as the curve editor's Load file reads
 *      it and rows as typed into it, both kept as Apply keeps them, and a
 *      design saved and opened again holds the spectrum.
 *   7. Refusals with their codes and fields.
 *
 * Run: node tests/api_pulse_analysis.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspect, isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

// The window's CSV writer sits in a module of React components.
globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { computePulseAnalysis, pulseFromSettings, spectrumCentreField } = await import('../src/components/windows/analysis/pulseAnalysis/pulseModel.js');
const { pulseSession } = await import('../src/components/windows/analysis/pulseAnalysis/sessionState.js');
const { resultsTable } = await import('../src/components/windows/analysis/pulseAnalysis/viewModel.js');
const { emptyTable } = await import('../src/components/windows/dataExchange/curveEditor/curveTable.js');
const { pulseSpectrumFromTable } = await import('../src/components/windows/dataExchange/curveEditor/curveApply.js');
const { tableFromText } = await import('../src/components/windows/dataExchange/curveEditor/tableText.js');
const { sessionDefaults } = await import('../src/constants/analysisDefaults.js');
const en = (await import('../src/constants/locales/en.js')).default;
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { materialsRangeCoverage, rangeMaterials } = await import('../src/utils/materials/materialRange.js');
const { createCoatingResponses, propagatePulse } = await import('../src/utils/physics/pulsePropagation.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-pulse-'));
const DEFAULTS = sessionDefaults('pulseAnalysis');

// ── The designs ────────────────────────────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const corpus = opened.filter(([, design]) => resolves(design));
const unresolved = opened.filter(([, design]) => !resolves(design));
const chirpedMirror = corpus.find(([name]) => name === 'pulse-spectrum')?.[1];
const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^8 H' });

// The window's settings at their opening values, with `changes` on top, as
// the hook turns them into the worker's request (usePulseAnalysis.js).
const OPENING = { ...DEFAULTS, order: 2, gdd: 0, tod: 0, passes: 1, source: 'model' };
function windowRequest(design, settings) {
    const s = { ...OPENING, ...settings };
    const pulse = pulseFromSettings({ ...s, spectrum: design.pulseSpectrum ?? null });
    return { pulse, side: s.side, target: s.target, polarization: s.pol, thetaDeg: s.theta, passes: Math.max(1, Math.round(s.passes)) };
}
// The window's pulse in the API's fields, or the model's reason it has none.
const rising = ({ x, y }) => ({ wavelength: [...x].reverse(), values: [...y].reverse() });
const timed = ({ x, y }) => ({ t: x, intensity: y });
function windowPulse(design, settings) {
    const r = computePulseAnalysis(withHerpinRecords(design), windowRequest(design, settings));
    if (!r.valid) return { reason: r.reason };
    const m = r.metrics;
    return {
        converged: r.converged, chirped: r.chirped,
        metrics: [m.flpFwhmFs, m.inputFwhmFs, m.outputFwhmFs, m.outputRmsFs, m.peakVsFlp, m.transformLimitedRatio, m.energyRatio, m.delayFs,
            m.residualGddFs2, m.residualTodFs3, m.inputBandwidthNm, m.outputBandwidthNm, m.outputTimeBandwidth],
        time: { flp: timed(r.time.flp), input: timed(r.time.input), output: timed(r.time.output) },
        spectrum: { input: rising(r.spectrum.input), output: rising(r.spectrum.output), coatingGdd: rising(r.spectrum.coatingGddFs2), compensatingGdd: rising(r.spectrum.compensatingGddFs2), band: r.spectrum.bandNm },
        echoDelay: r.echoDelayFs,
    };
}
const apiPulse = p => {
    const m = p.metrics;
    return {
        converged: p.converged, chirped: p.chirped,
        metrics: [m.flpFwhm, m.inputFwhm, m.outputFwhm, m.outputRms, m.peakVsFlp, m.transformLimitedRatio, m.energyRatio, m.delay,
            m.residualGdd, m.residualTod, m.inputBandwidth, m.outputBandwidth, m.timeBandwidth],
        time: p.time, spectrum: p.spectrum, echoDelay: p.echoDelay,
    };
};
// The API's options for window settings, and whether its answer, or its
// refusal, is the window's.
const optionsOf = s => ({
    side: s.side === 'whole' ? 'total' : s.side, response: s.target, pol: s.pol, angle: s.theta, shape: s.shape,
    centre: s.centerWavelength, duration: s.duration, bandwidth: s.bandwidth, order: s.order, passes: s.passes, gdd: s.gdd, tod: s.tod,
});
// How the API words each reason the model gives no pulse.
const REASON_WORDS = {
    spectrumReachesZeroFrequency: 'pulseAnalysis: the pulse is too short for its centre wavelength',
    responseUnavailable: "pulseAnalysis: the coating's response is not available",
    noOutput: 'pulseAnalysis: no light comes out',
};
function sameAsWindow(design, settings) {
    const shown = windowPulse(design, settings);
    let got;
    const err = thrown(() => { got = api.pulseAnalysis(design, optionsOf({ ...OPENING, ...settings })); });
    if (shown.reason) return !!err && err.message.startsWith(REASON_WORDS[shown.reason]) && !err.code;
    return !err && same(apiPulse(got), shown);
}

// ── 1. The window's numbers ────────────────────────────────────────────────
// Each shape away from the opening values of its own settings.
const SHAPES = [{ shape: 'gaussian', duration: 15 }, { shape: 'sech2', duration: 12 }, { shape: 'superGaussian', bandwidth: 60, order: 4 }];
const COMBINATIONS = [['front', 'R'], ['front', 'T'], ['back', 'R'], ['back', 'T'], ['whole', 'T']]
    .flatMap(([side, target]) => ['s', 'p', 'avg'].flatMap(pol => [0, 45].map(theta => ({ side, target, pol, theta }))));
// Coated on the front alone and on the back alone, every combination in each
// shape; one combination on each of the others, with passes, a chirp of the
// input's own and another centre in turn.
const FULL = ['pulse-spectrum', 'back-only-side'];
const EXTRA = [{ passes: 1 }, { passes: 3, centerWavelength: 700 }, { gdd: 40, tod: 300 }, { passes: 2, gdd: -25, centerWavelength: 900 }];
{
    const cases = corpus.flatMap(([name, design], i) => (FULL.includes(name) ? COMBINATIONS.flatMap(c => SHAPES.map(shape => [name, design, { ...c, ...shape }]))
        : [[name, design, { ...COMBINATIONS[(i * 7) % COMBINATIONS.length], ...SHAPES[i % SHAPES.length], ...EXTRA[i % EXTRA.length] }]]));
    const wrong = cases.filter(([, design, c]) => !sameAsWindow(design, c)).map(([name, , c]) => `${name} ${JSON.stringify(c)}`);
    const covered = new Set(cases.map(([, , c]) => `${c.side} ${c.target} ${c.pol} ${c.theta} ${c.shape}`));
    const refused = cases.filter(([, design, c]) => windowPulse(design, c).reason).length;
    ok(`on ${corpus.length} designs, pulseAnalysis is computePulseAnalysis with the hook's request: every combination in every shape on ${FULL.length}, ${refused} the model cannot compute refused`,
        corpus.length >= 12 && FULL.every(name => corpus.some(([n]) => n === name)) && covered.size === 90 && wrong.length === 0, wrong.slice(0, 4).join('\n'));
}
{
    // The window opens on each design with its saved defaults and the side
    // that holds layers (sessionState.js), and computes nothing for a side
    // with none.
    const ownLayers = (design, side) => (design[side === 'back' ? 'backLayers' : 'frontLayers'] || []).some(layer => layer.material && layer.thickness > 0);
    const opening = corpus.map(([name, design], i) => [name, design, pulseSession.read(design, `opening-${i}`)]).filter(([, design, s]) => ownLayers(design, s.side));
    const wrong = opening.filter(([, design, s]) => {
        const p = api.pulseAnalysis(design);
        return p.mode !== s.side || !same(apiPulse(p), windowPulse(design, s));
    }).map(([name]) => name);
    const p = api.pulseAnalysis(mirror);
    const factory = pulseSession.read(mirror, 'factory');
    const settings = ['centerWavelength', 'duration', 'bandwidth', 'theta', 'shape', 'target', 'pol', 'order', 'gdd', 'tod', 'passes', 'source', 'side'].map(key => factory[key]);
    ok(`without options it takes the window's opening settings, a 10 fs Gaussian at 800 nm reflected once at 0 degrees, avg, on the side the window opens on for every corpus design (${opening.length})`,
        same([settings, opening.length >= 12, wrong, [p.mode, p.response, p.pol, p.angle, p.passes, p.source, p.centre, p.echoDelay]],
            [[800, 10, 100, 0, 'gaussian', 'R', 'avg', 2, 0, 0, 1, 'model', 'front'], true, [], ['front', 'R', 'avg', 0, 1, 'model', 800, null]]), wrong.join(', '));

    // With one side empty the window opens on the side with layers, and the
    // call stays on the side the merit rows score, as groupDelay does: the
    // back coated alone on a design with both sides, and a design coated on
    // the back alone that keeps its front layers.
    const backOnly = api.stackFromFormula(api.newDesign({ name: 'Back coated', surfaceMode: 'both_independent' }), { formula: '(HL)^4 H', side: 'back' });
    const bothCoated = api.stackFromFormula(api.setDesignSetup(mirror, { surfaceMode: 'both_independent' }), { formula: '(HL)^2', side: 'back' });
    const frontKept = api.setDesignSetup(bothCoated, { surfaceMode: 'back_only' });
    const sides = [backOnly, frontKept].map((design, i) => [pulseSession.read(design, `one-side-${i}`).side, api.pulseAnalysis(design, { centre: 600, duration: 20 }).mode,
        api.groupDelay(design, { from: 590, to: 610 }).mode]);
    ok('with one side empty the default side is the merit rows\' side, as groupDelay\'s, not the window\'s', same(sides, [['back', 'front', 'front'], ['front', 'back', 'back']]), JSON.stringify(sides));
}
{
    // Chirped mirror start is coated on the front alone, so its back is the
    // bare surface, which the model computes and the window does not show.
    const got = api.pulseAnalysis(chirpedMirror, { side: 'back', pol: 's' });
    ok('a side with no layers gives its bare surface', chirpedMirror.backLayers.length === 0 && got.mode === 'back'
        && same(apiPulse(got), windowPulse(chirpedMirror, { side: 'back', pol: 's' })) && got.metrics.energyRatio < 0.1, `${got.metrics.energyRatio}`);
}

// ── 2. The design's own spectrum ───────────────────────────────────────────
{
    const centroid = spectrumCentreField(chirpedMirror.pulseSpectrum);
    const own = api.pulseAnalysis(chirpedMirror, { source: 'design' });
    const at = api.pulseAnalysis(chirpedMirror, { source: 'design', centre: 790, pol: 'p', angle: 20 });
    ok('with source design the centre is the centroid Apply sets, and the pulse is the window\'s with source file',
        centroid > 0 && same([own.centre, own.source, at.centre], [centroid, 'design', 790])
        && same([apiPulse(own), apiPulse(at)], [windowPulse(chirpedMirror, { source: 'file', centerWavelength: centroid }),
            windowPulse(chirpedMirror, { source: 'file', centerWavelength: 790, pol: 'p', theta: 20 })]), `${centroid} ${own.centre}`);
    const model = api.pulseAnalysis(chirpedMirror);
    ok('with source model the design\'s spectrum is not read and the centre is 800 nm', model.centre === 800 && !same(apiPulse(model), apiPulse(own)));
}

// ── 3. Choice 7's sample ───────────────────────────────────────────────────
// The transform of a request, as computePulseAnalysis takes it.
function transformOf(design, settings) {
    const request = windowRequest(design, settings);
    return propagatePulse({ pulse: request.pulse, responses: createCoatingResponses(withHerpinRecords(design), request), passes: request.passes });
}
// The samples of the transform at or above 1e-4 of the Fourier-limited peak,
// from the first to the last.
function aboveFloor(raw, intensity) {
    const scale = 1 / raw.metrics.flp.peak;
    const kept = [...intensity.keys()].filter(i => intensity[i] * scale >= 1e-4);
    return Array.from({ length: kept.at(-1) - kept[0] + 1 }, (_, k) => kept[0] + k);
}
{
    const opening = api.pulseAnalysis(chirpedMirror);
    const own = api.pulseAnalysis(chirpedMirror, { source: 'design' });
    const peak = p => Number(Math.max(...p.time.output.intensity).toFixed(6));
    const sample = [opening.time.output.t.length, opening.spectrum.input.wavelength.length, peak(opening), own.time.output.t.length, peak(own)];
    ok('on Chirped mirror start at the opening settings the output curve holds 308 samples, the spectrum 709 and the output peaks at 0.904804; with its own spectrum 178 and 0.987253',
        same(sample, [308, 709, 0.904804, 178, 0.987253]), JSON.stringify(sample));

    const raw = transformOf(chirpedMirror, { side: 'front' });
    const rawOwn = transformOf(chirpedMirror, { side: 'front', source: 'file', centerWavelength: own.centre });
    const scale = 1 / raw.metrics.flp.peak;
    const indices = aboveFloor(raw, raw.outputIntensity);
    // The band's samples, and those where the input is at or above 1e-3 of its peak.
    const drawn = r => {
        const power = [...r.band.input.re.keys()].map(i => r.band.input.re[i] ** 2 + r.band.input.im[i] ** 2);
        return [power.length, power.filter(value => value >= 1e-3 * Math.max(...power)).length];
    };
    const counts = [raw.time.length, ...drawn(raw), rawOwn.time.length, ...drawn(rawOwn)];
    ok('there the transform holds 4096 samples and the output curve is each one above 1e-4 of the Fourier-limited peak, at its absolute delay; of its 237 band samples the 119 the spectrum view draws are evaluated afresh on a sixth of their step; with its own spectrum 65536 samples, whose 1909 drawn are kept as they are',
        same(counts, [4096, 237, 119, 65536, 2434, 1909])
        && same(opening.time.output, { t: indices.map(i => raw.time[i] + raw.referenceDelayFs), intensity: indices.map(i => raw.outputIntensity[i] * scale) })
        && opening.spectrum.input.wavelength.length === 6 * (119 - 1) + 1 && own.spectrum.input.wavelength.length === 1909, JSON.stringify(counts));

    // A chirp of 20000 fs² spreads the input over more than 4000 samples.
    const spread = api.pulseAnalysis(chirpedMirror, { gdd: 20000 });
    const rawSpread = transformOf(chirpedMirror, { side: 'front', gdd: 20000 });
    const all = aboveFloor(rawSpread, rawSpread.inputIntensity);
    const run = Math.ceil(2 * all.length / 4000);
    const thinned = [];
    for (let start = 0; start < all.length; start += run) {
        const part = all.slice(start, start + run);
        const values = part.map(i => rawSpread.inputIntensity[i]);
        const [low, high] = [part[values.indexOf(Math.min(...values))], part[values.indexOf(Math.max(...values))]];
        thinned.push(...(low === high ? [low] : [Math.min(low, high), Math.max(low, high)]));
    }
    const spreadScale = 1 / rawSpread.metrics.flp.peak;
    ok('past 4000 samples a curve keeps the lowest and highest of each run, in order',
        all.length > 4000 && spread.time.input.t.length <= 4000 && same(spread.time.input, { t: thinned.map(i => rawSpread.time[i]), intensity: thinned.map(i => rawSpread.inputIntensity[i] * spreadScale) }),
        `${all.length} ${spread.time.input.t.length}`);

    // With its own spectrum the band holds more than 4000 drawn samples, and
    // each spectrum curve is thinned on its own values, as the window draws it.
    const settings = { source: 'file', centerWavelength: own.centre, gdd: 20000 };
    const thinSpectrum = api.pulseAnalysis(chirpedMirror, { source: 'design', gdd: 20000 }).spectrum;
    const lengths = ['input', 'output', 'coatingGdd', 'compensatingGdd'].map(key => thinSpectrum[key].wavelength.length);
    ok('past 4000 samples each spectrum curve is the window\'s, on wavelengths of its own',
        same(thinSpectrum, windowPulse(chirpedMirror, settings).spectrum) && Math.max(...lengths) <= 4000 && !same(thinSpectrum.input.wavelength, thinSpectrum.compensatingGdd.wavelength),
        JSON.stringify(lengths));
}

// ── 4. The CSV ─────────────────────────────────────────────────────────────
{
    const cases = [['opening', chirpedMirror, {}], ['chirped', chirpedMirror, { gdd: 60 }], ['mirror', mirror, { centre: 550, duration: 20, passes: 2 }],
        ['whole part', corpus.find(([name]) => name === 'back-only-side')?.[1], { side: 'total', response: 'T' }]];
    const wrong = cases.filter(([what, design, options], i) => {
        const file = path.join(WORK, `${i}.csv`);
        new objects.Design(design).pulse(options).saveCsv(file);
        const r = computePulseAnalysis(withHerpinRecords(design), windowRequest(design, {
            side: options.side === 'total' ? 'whole' : 'front', target: options.response ?? 'R', centerWavelength: options.centre ?? 800,
            duration: options.duration ?? 10, passes: options.passes ?? 1, gdd: options.gdd ?? 0,
        }));
        const table = resultsTable(r, en.pulseAnalysis, en.units);
        return fs.readFileSync(file, 'utf8') !== csvFromRows(table.columns, table.rows) || (what === 'chirped') !== r.chirped;
    }).map(([what]) => what);
    ok('the CSV is the window\'s Results table through its Copy CSV, the input\'s FWHM only for a chirped input', wrong.length === 0, wrong.join(', '));
    const shown = inspect(new objects.Design(mirror).pulse({ centre: 550, passes: 3 }));
    ok('a pulse prints its settings', shown === '<Pulse front R avg at 0 degrees, centre 550 nm, 3 passes>', shown);
}

// ── 5. Cross-checks ────────────────────────────────────────────────────────
{
    // coatingGdd at a few of its wavelengths against groupDelay's GDD there,
    // which averages s and p as the spectrum view does.
    const backOnly = corpus.find(([name]) => name === 'back-only-side')?.[1];
    const cases = [[chirpedMirror, { side: 'front', response: 'R', pol: 'avg', angle: 0, passes: 1 }], [chirpedMirror, { side: 'front', response: 'R', pol: 's', angle: 30, passes: 3 }],
        [backOnly, { side: 'back', response: 'T', pol: 'p', angle: 45, passes: 1 }], [backOnly, { side: 'total', response: 'T', pol: 'avg', angle: 20, passes: 2 }]];
    const off = cases.map(([design, c]) => {
        const { passes, ...shared } = c;
        const { wavelength, values } = api.pulseAnalysis(design, { ...c, centre: 800, duration: 15 }).spectrum.coatingGdd;
        const picks = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => Math.round(f * (wavelength.length - 1)));
        return Math.max(...picks.map(i => {
            const gdd = passes * api.groupDelay(design, { ...shared, from: wavelength[i], to: wavelength[i] + 1, step: 1 }).gdd[0];
            return Math.abs(values[i] - gdd) / Math.max(1, Math.abs(gdd));
        }));
    });
    ok('coatingGdd is groupDelay\'s GDD at the same wavelengths times the passes, on one side and through the whole part', off.every(d => d <= 1e-9), JSON.stringify(off));
}
{
    // The SiO2/Ta2O5 design with its front Ta2O5 made MgF2, on BK7, which
    // passes light at 400 nm where its silicon plate absorbs it all: Ta2O5's
    // data start at 500 nm, inside the band of a 5 fs pulse at 400 nm.
    const ta2o5 = api.openDesign(fixtureFile('absorbing-substrate-both-sides-total'));
    const backOnly = api.setDesignSetup(api.setLayer(ta2o5, { side: 'front', index: ta2o5.frontLayers.findIndex(l => l.material === 'builtin:Ta2O5'), material: 'builtin:MgF2' }), { substrate: 'BK7' });
    const names = side => {
        const p = api.pulseAnalysis(backOnly, { centre: 400, duration: 5, side, response: 'T' });
        const notice = materialsRangeCoverage(rangeMaterials(backOnly, side === 'total' ? 'whole' : side), p.spectrum.band).offenders;
        return same(p.outOfRange, notice) ? p.outOfRange.map(o => o.name) : `${JSON.stringify(p.outOfRange)} against ${JSON.stringify(notice)}`;
    };
    const said = ['front', 'back', 'total'].map(names);
    ok('outOfRange is the window\'s notice for the side computed: nothing on the front, Ta2O5 on the back and through the whole part', same(said, [[], ['Ta2O5'], ['Ta2O5']]), JSON.stringify(said));
}

// ── 6. setPulseSpectrum ────────────────────────────────────────────────────
{
    const text = 'Wavelength (um)\tIntensity\tPhase (rad)\n0.78\t0.2\t0.3\n0.79\t0.6\t0.1\n0.80\t1\t0\n0.81\t0.6\t0.1\n0.82\t0.2\t0.3\n';
    const file = path.join(WORK, 'spectrum.txt');
    fs.writeFileSync(file, text);
    const fromFile = api.setPulseSpectrum(mirror, file);
    const read = tableFromText(text, emptyTable('pulse'), 'spectrum.txt');
    const rows = [[810, 0.5], [800, 1], [790, 0.5], [780, 0.1]];
    const fromRows = api.setPulseSpectrum(mirror, rows);
    const typed = pulseSpectrumFromTable({ ...emptyTable('pulse'), rows: rows.map(([w, i]) => [w, i, NaN]) });
    ok('a file reads as Load file reads it, its unit from its heading, and rows as typed into the editor, both kept as Apply keeps them',
        same([fromFile.pulseSpectrum, fromFile.pulseSpectrum.xUnit, fromFile.pulseSpectrum.source, fromRows.pulseSpectrum, typed.rows.map(row => row[0]), fromRows.frontLayers],
            [pulseSpectrumFromTable(read.table), 'um', 'spectrum.txt', typed, [780, 790, 800, 810], mirror.frontLayers]), JSON.stringify(fromFile.pulseSpectrum));
    const saved = path.join(WORK, 'spectrum.tfs');
    api.saveDesign(fromFile, saved);
    const back = api.openDesign(saved);
    ok('a design saved and opened again holds the spectrum and computes the same pulse', same(back.pulseSpectrum, fromFile.pulseSpectrum)
        && same(apiPulse(api.pulseAnalysis(back, { source: 'design' })), apiPulse(api.pulseAnalysis(fromFile, { source: 'design' }))));
    const phased = api.pulseAnalysis(fromFile, { source: 'design' });
    ok('a phase in the table makes the input chirped', phased.chirped && !api.pulseAnalysis(fromRows, { source: 'design' }).chirped);
}

// ── 7. Refusals ────────────────────────────────────────────────────────────
{
    const REFUSED = [
        ['an option it does not take', () => api.pulseAnalysis(mirror, { center: 800 }), 'unknownOption', { option: 'center' }, /unknown option 'center'; the options are source, shape, centre, duration, bandwidth, order, gdd, tod, side, response, pol, angle, passes$/],
        ['a source it does not have', () => api.pulseAnalysis(mirror, { source: 'file' }), 'badValue', { option: 'source', value: 'file' }, /source is 'model' or 'design', not "file"$/],
        ['a shape it does not have', () => api.pulseAnalysis(mirror, { shape: 'lorentzian' }), 'badValue', { option: 'shape', value: 'lorentzian' }, /shape is 'gaussian', 'sech2' or 'superGaussian', not "lorentzian"$/],
        ['a centre of 0', () => api.pulseAnalysis(mirror, { centre: 0 }), 'badValue', { option: 'centre', value: 0 }, /centre is a wavelength in nm above 0, not 0$/],
        ['a duration below 0', () => api.pulseAnalysis(mirror, { duration: -5 }), 'badValue', { option: 'duration', value: -5 }, /duration is a duration in fs above 0, not -5$/],
        ['a bandwidth of 0', () => api.pulseAnalysis(mirror, { bandwidth: 0 }), 'badValue', { option: 'bandwidth', value: 0 }, /bandwidth is a spectral FWHM in nm above 0, not 0$/],
        ['an order of 0', () => api.pulseAnalysis(mirror, { order: 0 }), 'badValue', { option: 'order', value: 0 }, /order is a super-Gaussian order above 0, not 0$/],
        ['a GDD that is not a number', () => api.pulseAnalysis(mirror, { gdd: '100' }), 'badValue', { option: 'gdd', value: '100' }, /gdd is a GDD in fs², not "100"$/],
        ['a TOD that is not finite', () => api.pulseAnalysis(mirror, { tod: Infinity }), 'badValue', { option: 'tod', value: Infinity }, /tod is a TOD in fs³, not Infinity$/],
        ['a response it does not have', () => api.pulseAnalysis(mirror, { response: 'A' }), 'badValue', { option: 'response', value: 'A' }, /response is 'R' or 'T', not "A"$/],
        ['a polarization it does not have', () => api.pulseAnalysis(mirror, { pol: 'x' }), 'badValue', { option: 'pol', value: 'x' }, /pol is 'avg', 's' or 'p', not "x"$/],
        ['an angle of 90', () => api.pulseAnalysis(mirror, { angle: 90 }), 'badValue', { option: 'angle', value: 90 }, /angle is an angle of incidence in degrees, 0 <= angle < 90, not 90$/],
        ['passes that are not whole', () => api.pulseAnalysis(mirror, { passes: 2.5 }), 'badValue', { option: 'passes', value: 2.5 }, /passes is a whole number of bounces, 1 or more, not 2.5$/],
        ['passes of 0', () => api.pulseAnalysis(mirror, { passes: 0 }), 'badValue', { option: 'passes', value: 0 }, /passes is a whole number of bounces, 1 or more, not 0$/],
        ['a side it does not have', () => api.pulseAnalysis(mirror, { side: 'whole' }), 'badValue', { option: 'side', value: 'whole' }, /side is 'front', 'back' or 'total', not "whole"$/],
        ['the whole part in reflection', () => api.pulseAnalysis(mirror, { side: 'total' }), 'badValue', { option: 'side', value: 'total', takes: "'front' or 'back' with response 'R'" }, /^pulseAnalysis: the whole part is computed in transmission alone, so with response 'R' side is 'front' or 'back', not 'total'$/],
        ['source design on a design with no spectrum', () => api.pulseAnalysis(mirror, { source: 'design' }), 'noPulseSpectrum', {}, /^pulseAnalysis: the design holds no pulse spectrum with light in it; set one with setPulseSpectrum, or take source 'model'$/],
    ];
    for (const [what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call: 'pulseAnalysis', ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`pulseAnalysis refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith('pulseAnalysis: ')], [code, { call: 'pulseAnalysis', ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const glass = api.setDesignSetup(mirror, { incidentMedium: 'BK7' });
    const FAILED = [
        ['a pulse too short for its centre wavelength', () => api.pulseAnalysis(mirror, { duration: 1 }), /^pulseAnalysis: the pulse is too short for its centre wavelength: part of its spectrum reaches zero frequency$/],
        ['light totally reflected inside the part', () => api.pulseAnalysis(glass, { side: 'total', response: 'T', angle: 60 }), /^pulseAnalysis: no light comes out: the part absorbs all of it, or at this angle reflects all of it inside$/],
        ['light all absorbed in a silicon plate', () => api.pulseAnalysis(api.openDesign(fixtureFile('absorbing-substrate-both-sides-total')), { side: 'total', response: 'T', centre: 400, duration: 5 }), /^pulseAnalysis: no light comes out: the part absorbs all of it/],
    ];
    for (const [what, make, pattern] of FAILED) {
        const err = thrown(make) ?? {};
        ok(`pulseAnalysis says why for ${what}, as the window does`, pattern.test(err.message) && !err.code, err.message);
    }
    const [[name, lost] = []] = unresolved;
    const messages = ['pulseAnalysis', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));

    const ROWS = [
        ['a row of one number', [[800], [810, 1]]], ['a row of four numbers', [[800, 1, 0, 0], [810, 1]]], ['a row that is not numbers', [[800, '1'], [810, 1]]],
        ['a number', 800], ['an empty path', ''],
    ];
    for (const [what, value] of ROWS) {
        const err = thrown(() => api.setPulseSpectrum(mirror, value)) ?? {};
        ok(`setPulseSpectrum refuses ${what}`, err.code === 'badValue' && err.fields?.option === 'fileOrRows' && err.fields?.call === 'setPulseSpectrum'
            && /^setPulseSpectrum: fileOrRows is the path of a text table, or rows \[wavelength nm, intensity\] or \[wavelength nm, intensity, phase rad\], not /.test(err.message), err.message);
    }
    const unread = path.join(WORK, 'missing.txt');
    const empty = path.join(WORK, 'empty.txt');
    fs.writeFileSync(empty, 'no numbers here\n');
    const NOT_APPLIED = [
        ['one row', () => api.setPulseSpectrum(mirror, [[800, 1]]), /^setPulseSpectrum: a spectrum needs at least two rows with a wavelength above zero and an intensity not below zero$/],
        ['no light', () => api.setPulseSpectrum(mirror, [[800, 0], [810, 0]]), /^setPulseSpectrum: no row has an intensity above zero$/],
        ['a phase on some rows', () => api.setPulseSpectrum(mirror, [[800, 1, 0], [810, 1]]), /^setPulseSpectrum: some rows have a phase and others none; give every row a phase, or none$/],
        ['a file that is not there', () => api.setPulseSpectrum(mirror, unread), /^setPulseSpectrum: .*missing\.txt: /],
        ['a file with no columns', () => api.setPulseSpectrum(mirror, empty), /^setPulseSpectrum: .*empty\.txt holds no wavelength and intensity columns$/],
    ];
    for (const [what, make, pattern] of NOT_APPLIED) {
        const err = thrown(make) ?? {};
        ok(`setPulseSpectrum refuses ${what}, as Apply does`, pattern.test(err.message), err.message);
    }
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
