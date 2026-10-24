/**
 * A band's peak, edge and FWHM and an edge against angle (src/api/bandFeature.js)
 * against the Specification window's checks, and the edge against spectrum.
 *
 *   1. On the corpus designs with no catalog, the cone design among them,
 *      over two bands and a spread of quantities, angles, directions, levels,
 *      edge sides and steps: bandFeature's peak, edge and width each equal
 *      the value checkSpecification gives a CENTRAL_LAMBDA, EDGE_LAMBDA or
 *      FWHM check with the same settings, a missing crossing null with the
 *      check's reason, and the mode the check's; a FWHM's width is right −
 *      left and its centre their midpoint; the peak an edge or width reports
 *      is the peak feature's.
 *   2. On designs with no cone: edgeShift's edge at each angle equals
 *      bandFeature's, its shift is the edge less the first, and the edge
 *      lies within one grid step of where `spectrum` at that angle, every
 *      0.5 nm, crosses the level.
 *   3. The objects: a spectrum curve's peak(), edge() and fwhm() are
 *      bandFeature at the curve's quantity and angle, on the design as it was
 *      when the spectrum was computed; design.edgeShift() is edgeShift; a
 *      curve that is not a spectrum's, a band outside the curve, an option a
 *      feature does not take and a value it cannot take are refused in the
 *      objects' words.
 *
 * Run: node tests/api_band_feature.mjs
 */
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { makeConeSpec, coneIsActive } = await import('../src/utils/physics/optimizer.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };

const tf = await objects.start();

const CHANNELS = { R: ['R', 'avg'], T: ['T', 'avg'], A: ['A', 'avg'], Rs: ['R', 's'], Rp: ['R', 'p'], Ts: ['T', 's'], Tp: ['T', 'p'] };
const FLAGS = { 0.1: 2, 0.01: 3, 0.001: 4 };
const KINDS = { peak: 'CENTRAL_LAMBDA', edge: 'EDGE_LAMBDA', fwhm: 'FWHM' };
const VALUE = { peak: 'peak', edge: 'edge', fwhm: 'width' };
// The options each feature takes of a setting.
const OWN = { peak: ['direction', 'step'], edge: ['direction', 'level', 'edgeSide', 'step'], fwhm: ['direction', 'level', 'step'] };
const defined = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

// ── 1. The corpus against the checks ──────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const designs = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]).filter(([, design]) => !thrown(() => api.spectrum(design, { from: 500, to: 501 })));
const BANDS = [[400, 800], [500, 600]];
// None takes a step on a peak found without one: the peak of R, the dip of T or A.
const SETTINGS = [
    { quantity: 'T', angle: 0 },
    { quantity: 'R', angle: 45, level: 0.3 },
    { quantity: 'Ts', angle: 45, direction: 'min', edgeSide: 'right' },
    { quantity: 'Rp', angle: 0, direction: 'min', step: 0.1 },
    { quantity: 'A', angle: 30, level: 0.8, edgeSide: 'left' },
    { quantity: 'Tp', angle: 0, level: 0.9, step: 0.01 },
];
// A design under a cone takes seconds a call, so it is read on one band and
// two of the settings.
const CONED = { bands: [[500, 600]], settings: SETTINGS.slice(0, 2), fine: [] };
const isConed = design => coneIsActive(makeConeSpec(design.cone || {}));

// The options of `feature` among `settings`, and the check of the same.
function asked(feature, settings, [from, to]) {
    const own = Object.fromEntries(OWN[feature].map(key => [key, settings[key]]));
    const [channel, pol] = CHANNELS[settings.quantity];
    return {
        options: defined({ feature, from, to, quantity: settings.quantity, angle: settings.angle, ...own }),
        check: defined({ kind: KINDS[feature], channel, pol, aoi: settings.angle, lambdaStart: from, lambdaEnd: to, ...own, step: undefined, flag: FLAGS[own.step] }),
    };
}

// The finest step, on a band narrow enough to scan quickly.
const FINE = Object.keys(KINDS).map(feature => asked(feature, { quantity: 'T', angle: 0, step: 0.001 }, [545, 555]));
const coned = designs.filter(([, design]) => isConed(design)).length;
{
    const wrong = { value: [], mode: [], width: [], peak: [] };
    let counted = 0, found = 0;
    for (const [name, design] of designs) {
        const { bands, settings: spread, fine } = isConed(design) ? CONED : { bands: BANDS, settings: SETTINGS, fine: FINE };
        const cases = [...bands.flatMap(band => spread.flatMap(settings => Object.keys(KINDS).map(feature => asked(feature, settings, band)))), ...fine];
        const verdict = api.checkSpecification(api.setSpecification(design, cases.map(c => c.check)));
        cases.forEach(({ options }, i) => {
            const got = api.bandFeature(design, options);
            const value = got[VALUE[options.feature]];
            const row = verdict.rows[i];
            const said = `${name} ${JSON.stringify(options)}`;
            if (!isDeepStrictEqual([value, got.reason ?? null], [row.value, row.reason])) wrong.value.push(`${said}: ${value} / ${row.value} ${row.reason}`);
            if (got.mode !== verdict.mode) wrong.mode.push(name);
            if (options.feature === 'peak') return;
            counted++;
            if (value !== null) found++;
            if (got.width && (got.width !== got.right - got.left || got.centre !== (got.left + got.right) / 2)) wrong.width.push(said);
            const peak = api.bandFeature(design, asked('peak', options, [options.from, options.to]).options);
            if (peak.peak !== got.peak || peak.peakValue !== got.peakValue) wrong.peak.push(`${said}: ${got.peak} / ${peak.peak}`);
        });
    }
    ok('the corpus has designs to read, one of them under a cone', designs.length > 10 && coned > 0, `${designs.length} designs, ${coned} under a cone`);
    ok('crossings are found on some and missed on others', found > 50 && found < counted, `${found} of ${counted}`);
    ok('bandFeature\'s peak, edge and width are the CENTRAL_LAMBDA, EDGE_LAMBDA and FWHM checks\' values, a missing crossing null with the check\'s reason',
        wrong.value.length === 0, wrong.value.slice(0, 3).join('; '));
    ok('and its mode is the one the checks were scored on', wrong.mode.length === 0, wrong.mode.slice(0, 3).join(', '));
    ok('a width is right − left and its centre their midpoint', wrong.width.length === 0, wrong.width.slice(0, 3).join('; '));
    ok('the peak an edge or a width reports is the peak feature\'s', wrong.peak.length === 0, wrong.peak.slice(0, 3).join('; '));
}


// ── 2. edgeShift against bandFeature and spectrum ─────────────────────────
{
    const lwp = tf.newDesign('Long-wave pass');
    lwp.stack('(0.5H L 0.5H)^8');
    const plain = [['lwp', lwp._data, [600, 760]], ...designs.filter(([, d]) => !isConed(d)).map(([name, d]) => [name, d, [400, 800]])];
    const ANGLES = [0, 15, 30, 45];
    const STEP = 0.5;
    const wrong = { edge: [], shift: [], spectrum: [] };
    let crossings = 0;
    for (const [name, design, [from, to]] of plain) {
        const moved = api.edgeShift(design, { from, to, angles: ANGLES, quantity: 'T' });
        const s = api.spectrum(design, { from, to, step: STEP, angles: ANGLES });
        ANGLES.forEach((angle, i) => {
            const one = api.bandFeature(design, { feature: 'edge', from, to, angle });
            if (!isDeepStrictEqual([moved.edge[i], moved.peak[i], moved.levelValue[i], moved.reason[i]], [one.edge, one.peak, one.levelValue, one.reason])) wrong.edge.push(`${name} ${angle}`);
            const meant = moved.edge[i] === null || moved.edge[0] === null ? null : moved.edge[i] - moved.edge[0];
            if (moved.shift[i] !== meant) wrong.shift.push(`${name} ${angle}`);
            if (moved.edge[i] === null) return;
            crossings++;
            // A pair of neighbouring samples within one step of the edge that straddles the level.
            const T = s.angles[angle].T, at = Math.floor((moved.edge[i] - from) / STEP), level = moved.levelValue[i];
            const straddles = [at - 1, at, at + 1].some(j => j >= 0 && j + 1 < T.length && (T[j] - level) * (T[j + 1] - level) <= 0);
            if (!straddles) wrong.spectrum.push(`${name} ${angle}: ${moved.edge[i]}`);
        });
    }
    ok('edgeShift\'s edge at each angle is bandFeature\'s, and its shift the edge less the first', crossings > 10 && wrong.edge.length === 0 && wrong.shift.length === 0,
        `${crossings} crossings; ${[...wrong.edge, ...wrong.shift].slice(0, 4).join('; ')}`);
    ok('the edge lies within one grid step of where the spectrum at that angle crosses the level', wrong.spectrum.length === 0, wrong.spectrum.slice(0, 4).join('; '));
}

// ── 3. The objects ─────────────────────────────────────────────────────────
{
    const design = tf.newDesign('Bandpass');
    design.stack('(HL)^4 HH (LH)^4');
    const kept = structuredClone(design._data);
    const s = design.spectrum(500, 600, { angles: [0, 30] });
    const read = [s.T.peak(), s.angle(30).Rp.fwhm(520, 580, { level: 0.3, direction: 'min', step: 0.1 }), s.T.edge(520, 580, { edgeSide: 'right' })];
    design.stack('(HL)^2');
    const after = [s.T.peak(), s.angle(30).Rp.fwhm(520, 580, { level: 0.3, direction: 'min', step: 0.1 }), s.T.edge(520, 580, { edgeSide: 'right' })];
    const meant = [
        api.bandFeature(kept, { feature: 'peak', from: 500, to: 600, quantity: 'T', angle: 0 }),
        api.bandFeature(kept, { feature: 'fwhm', from: 520, to: 580, quantity: 'Rp', angle: 30, level: 0.3, direction: 'min', step: 0.1 }),
        api.bandFeature(kept, { feature: 'edge', from: 520, to: 580, quantity: 'T', angle: 0, edgeSide: 'right' }),
    ];
    ok('a curve\'s peak(), fwhm() and edge() are bandFeature at its quantity and angle, on the design as it was when the spectrum was computed',
        isDeepStrictEqual(read, meant) && isDeepStrictEqual(after, meant) && meant[1].width > 0, JSON.stringify(read[1]));
    const lwp = tf.newDesign('Long-wave pass');
    lwp.stack('(0.5H L 0.5H)^8');
    ok('design.edgeShift() is edgeShift', isDeepStrictEqual(lwp.edgeShift(600, 760, [0, 30], { quantity: 'Tp', level: 0.4 }),
        api.edgeShift(lwp._data, { from: 600, to: 760, angles: [0, 30], quantity: 'Tp', level: 0.4 })));
    const REFUSED = [
        [() => s.T.peak(450, 600), 'peak: the curve is from 500 to 600 nm, and the band 450 to 600 nm is not inside it'],
        [() => s.T.peak(500, 600, { level: 0.5 }), "peak: unknown option 'level'; the options are direction, step"],
        [() => s.T.fwhm({ step: 0.5 }), 'fwhm: step is 1, 0.1, 0.01 or 0.001 nm, not 0.5'],
        [() => s.R.peak({ step: 0.1 }), 'peak: step is 1, as the peak of R is found without a step, not 0.1'],
        [() => s.T.edge({ edgeSide: 'up' }), "edge: edgeSide is 'left' or 'right', not \"up\""],
        [() => design.groupDelay(500, 600, { step: 10 }).gd.peak(), "peak: only a spectrum's curves have peak(), since it is found on the design the spectrum was computed on"],
        [() => s.T.density().edge(), "edge: only a spectrum's curves have edge(), since it is found on the design the spectrum was computed on"],
        [() => lwp.edgeShift(600, 760, []), 'edgeShift: angles is a list of angles of incidence in degrees, each 0 <= angle < 90, not []'],
        [() => lwp.edgeShift(700, 600, [0]), 'edgeShift: start and end are wavelengths in nm, 0 < start < end'],
        [() => lwp.edgeShift(600, 760, [0], { to: 800 }), "edgeShift: unknown option 'to'; the options are quantity, level, edgeSide, direction, step"],
        [() => api.bandFeature(lwp._data, { feature: 'width', from: 600, to: 700 }), "bandFeature: feature is 'peak', 'edge' or 'fwhm', not \"width\""],
    ];
    const said = REFUSED.map(([make]) => thrown(make)?.message);
    ok('a curve that is not a spectrum\'s, a band outside the curve, and an option or value a feature does not take are refused in the objects\' words',
        isDeepStrictEqual(said, REFUSED.map(([, words]) => words)), said.join(' / '));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
