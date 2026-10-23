/**
 * The helpers on a spectrum's curves (src/api/objects/spectrum.js) against the
 * app's own code, and the spectrum's CSV against Measured Spectra's import.
 *
 *   1. On the corpus designs with no catalog, at 0 and 45 degrees: a curve's
 *      ripple over a band is summarize's max − min, and in dB 10·log10 of
 *      their ratio; the optical density of T, Ts and Tp is logValue('OD', T),
 *      the ODMN row's reading, a T of 0 reading 15; at() at a sample is that
 *      sample and between two is on the straight line between them.
 *   2. A band holding a NaN alone has a NaN ripple; R, A and a group delay's
 *      curves have no density; at() outside the curve, and a unit ripple does
 *      not have, are refused.
 *   3. saveCsv puts Measured Spectra's condition lines above the columns:
 *      read back by its import (parseSpectrumTable), a spectrum of one angle
 *      gives that angle, the side the design is scored on and no single
 *      polarization, and its values; one of two angles gives no angle.
 *
 * Run: node tests/api_curve_helpers.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { logValue } = await import('../src/utils/physics/optimizer/logReadings.js');
const { parseSpectrumTable } = await import('../src/utils/io/spectrumTable.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

const tf = await objects.start();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-curve-helpers-'));
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
const BANDS = [[450, 650], [400, 800], [532.5, 533.5]];

// ── 1. The corpus ──────────────────────────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const designs = CORPUS.map(name => [name, new objects.Design(api.openDesign(fixtureFile(name)))])
    .filter(([, design]) => !thrown(() => design.spectrum(500, 501)));
{
    const wrong = { ripple: [], density: [], at: [] };
    for (const [name, design] of designs) {
        const s = design.spectrum(400, 800, { step: 1, angles: [0, 45] });
        const plain = api.spectrum(design._data, { from: 400, to: 800, step: 1, angles: [0, 45] });
        const summary = api.summarize(plain, { bands: BANDS.map(([from, to]) => ({ from, to })) });
        for (const angle of [0, 45]) {
            const curves = s.angle(angle);
            for (const q of QUANTITIES) {
                BANDS.forEach(([from, to], b) => {
                    const { min, max } = summary[angle][b + 1][q];
                    const dB = 10 * Math.log10(max / min);
                    if (!same([curves[q].ripple(from, to), curves[q].ripple(from, to, { unit: 'dB' })], [max - min, dB])) wrong.ripple.push(`${name} ${q}@${angle} ${from}-${to}`);
                });
                // Halfway between samples 100 and 101, a third of the way past sample 250, and on sample 300.
                const c = curves[q];
                const line = (i, f) => c[i] + (c[i + 1] - c[i]) * f;
                const read = [c.at(500.5), c.at(650 + 1 / 3), c.at(700)];
                const meant = [line(100, 0.5), c[250] + (c[251] - c[250]) * ((650 + 1 / 3) - 650) / 1, c[300]];
                if (!read.every((v, i) => Math.abs(v - meant[i]) <= 1e-15) || read[0] < Math.min(c[100], c[101]) || read[0] > Math.max(c[100], c[101])) {
                    wrong.at.push(`${name} ${q}@${angle} ${read} / ${meant}`);
                }
            }
            for (const q of ['T', 'Ts', 'Tp']) {
                if (!same([...curves[q].density()], plain.angles[angle][q].map(v => logValue('OD', v)))) wrong.density.push(`${name} ${q}@${angle}`);
            }
        }
    }
    ok('a curve\'s ripple is summarize\'s max − min over the band, and 10·log10 of their ratio in dB', designs.length > 10 && wrong.ripple.length === 0, wrong.ripple.slice(0, 4).join('; '));
    ok('T, Ts and Tp\'s optical density is logValue(\'OD\', T), the ODMN row\'s reading, at every wavelength', wrong.density.length === 0, wrong.density.slice(0, 4).join('; '));
    ok('at() at a sample is the sample, and between two samples is on the straight line between them', wrong.at.length === 0, wrong.at.slice(0, 4).join('; '));
}
{
    const s = designs[0][1].spectrum(400, 800);
    const blocked = new objects.Spectrum('front', [500, 510], [0], [Object.fromEntries(QUANTITIES.map(q => [q, [0, 1e-20]]))], []);
    ok('a T of 0, or below 1e-15, reads as a density of 15, as the merit\'s floor reads it', same([...blocked.T.density()], [15, 15]),
        String([...blocked.T.density()]));
    ok('a density is a Curve over the same wavelengths', s.T.density() instanceof objects.Curve && s.T.density().wavelength === s.wavelength);
}

// ── 2. NaN and refusals ────────────────────────────────────────────────────
{
    const gappy = new objects.Spectrum('front', [500, 510, 520, 530], [0], [Object.fromEntries(QUANTITIES.map(q => [q, [0.2, NaN, 0.1, 0.4]]))], []);
    ok('a ripple leaves a NaN out, and a band holding a NaN alone has a NaN ripple', gappy.R.ripple() === 0.4 - 0.1 && Number.isNaN(gappy.R.ripple(510, 510))
        && Number.isNaN(gappy.R.ripple(510, 510, { unit: 'dB' })), String([gappy.R.ripple(), gappy.R.ripple(510, 510)]));
    ok('at() next to a NaN is NaN', Number.isNaN(gappy.R.at(505)) && gappy.R.at(525) === 0.1 + (0.4 - 0.1) * 0.5);
    const mirror = tf.newDesign('Mirror');
    mirror.stack('(HL)^4 H');
    const s = mirror.spectrum(400, 800);
    const REFUSED = [
        [() => s.R.density(), "density: optical density is read from a spectrum's T, Ts or Tp, not from R"],
        [() => s.A.density(), "density: optical density is read from a spectrum's T, Ts or Tp, not from A"],
        [() => mirror.groupDelay(500, 600, { step: 10 }).gd.density(), "density: optical density is read from a spectrum's T, Ts or Tp, not from this curve"],
        [() => s.T.at(399.9), 'at: the curve is from 400 to 800 nm, not at 399.9'],
        [() => s.T.at(Number.NaN), 'at: the curve is from 400 to 800 nm, not at NaN'],
        [() => s.T.at('532.5'), 'at: the curve is from 400 to 800 nm, not at "532.5"'],
        [() => s.T.ripple(450, 650, { unit: 'percent' }), 'ripple: unit is \'fraction\' or \'dB\', not "percent"'],
        [() => s.T.ripple(450, 650, { units: 'dB' }), "ripple: unknown option 'units'; the options are unit"],
        [() => s.T.ripple(900, 950), 'ripple: no wavelength of this curve is from 900 to 950 nm'],
    ];
    const said = REFUSED.map(([make]) => thrown(make)?.message);
    ok('density() of R, A or a group delay, at() outside the curve, and a unit ripple does not have are refused', same(said, REFUSED.map(([, words]) => words)), said.join(' / '));
}

// ── 3. The CSV and Measured Spectra ────────────────────────────────────────
{
    const back = designs.find(([, design]) => design.spectrum(500, 501).mode === 'back');
    const cases = [[designs[0][1], 45], [back?.[1], 7.5]].filter(([design]) => design);
    const read = cases.map(([design, angle]) => {
        const file = path.join(WORK, `${angle}.csv`);
        const s = design.spectrum(400, 800, { step: 5, angles: [angle] });
        s.saveCsv(file);
        const parsed = parseSpectrumTable(fs.readFileSync(file, 'utf8'));
        const t = parsed.columns.find(column => column.name === `T at ${angle} deg`);
        return [parsed.aoi, parsed.side, parsed.pol, parsed.headerLines[0], t?.values.length, t?.values.every((v, i) => Math.abs(v - s.T[i]) <= 1e-12)];
    });
    ok('a spectrum of one angle reads back through Measured Spectra\'s import with its angle, its side, no single polarization and its values',
        back && same(read, cases.map(([design, angle]) => [angle, design.spectrum(500, 501).mode === 'back' ? 'back' : 'front', null, `# ${design.name}`, 81, true])),
        JSON.stringify(read));
    const file = path.join(WORK, 'two.csv');
    designs[0][1].spectrum(400, 800, { step: 5, angles: [0, 45] }).saveCsv(file);
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parseSpectrumTable(text);
    ok('one of two angles gives no angle, and its column names stay the last header line', parsed.aoi === null && parsed.side === 'front'
        && text.split('\r\n').slice(0, 3).join('|') === `# ${designs[0][1].name}|# front side|# Polarization: per column` && parsed.headerLines.at(-1).startsWith('Wavelength (nm),R at 0 deg'),
        text.split('\r\n').slice(0, 4).join('|'));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
