/**
 * Maintainer-only: the 15 sample coatings CODE V ships, each a .seq and the
 * .mul CODE V saved from it, and the listing of a CODE V 11.2 run that entered
 * each .seq afresh and printed MPR and MAN (codev_checks3.lis). They are
 * Synopsys files and CODE V's results for them, and stay out of the
 * repository; without the samples this test prints SKIP and passes, and
 * without the listing it skips part 4.
 *
 *  1. parseCodevSeq(.seq) and parseCodevMul(.mul) give the same stack: title,
 *     REF, wavelengths, angles, media, every layer's code and index, its
 *     thickness in nm to float32 precision (the .mul stores it as a float32
 *     in waves of REF), and the MIC tables.
 *  2. The n CODE V stored for each MIC material at the analysis wavelengths
 *     is the n micIndexAt computes, to CODE V's float32 precision.
 *  3. Every stack converts to TFStudio materials and layers.
 *  4. CODE V 11.2: each .seq read with parseCodevSeq, turned into TFStudio
 *     materials and layers with codevStackToDesign and computed with the
 *     TFStudio transfer-matrix kernel, against the MAN of the 11.2 run (Rs,
 *     Rp, Ts, Tp at every angle and wavelength), and its MIC materials'
 *     micIndexAt and micExtinctionAt against the n and k that run's MPR
 *     printed. The worst miss of each sample is printed.
 *
 * Run: node tests/codev_coating_samples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseCodevSeq, codevStackToDesign } from '../src/utils/io/codevCoatingFile.js';
import { readCodevMul } from '../src/utils/io/codevCoating/parseMul.js';
import { micExtinctionAt, micIndexAt } from '../src/utils/io/codevCoating/micIndex.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { tmm } from '../src/tmmcore.js';
import { listingRun, manRows, mprSection } from './reference/codevListing.mjs';

const SAMPLES = 'X:\\TFStudio Dev\\reference\\code v\\coating';
const LISTING = 'X:\\TFStudio Dev\\reference\\code v\\listings\\codev_checks3.lis';
if (!fs.existsSync(SAMPLES)) {
    console.log(`SKIP  CODE V sample coatings not found at ${SAMPLES}`);
    process.exit(0);
}

// Thickness: the .mul holds T = n·d/REF as a float32, so the thickness read
// back from it is up to 2^-24 off from storage alone; the samples' worst is
// 1.3 times that (silver, 8e-8). 2^-21 leaves room.
const THICKNESS = 2 ** -21;
// Wavelengths: the 51 WLG wavelengths the DWDM sample's .mul stores are, to
// the 10 digits written, those a float32 in µm gives when the step is added
// to it point after point. The last sits 1.7e-3 nm (1.1e-6) above
// min + i·step, which the reader gives.
const WAVELENGTH = 2e-6;
// CODE V's own n at an MWL point is up to 3 float32 steps off the table.
const MIC_N = 4e-7;
// Part 4. R, T, n and k: half a unit in the sixth decimal printed, and as
// much again for the single precision CODE V's numbers are held in (one step
// of an n near 3 is 2.4e-7). The DWDM sample misses most on the edge of its
// passband at 1552.8 nm, where Rs changes by 2 per nm: 8.8e-5 there is that
// edge moved by 4.5e-5 nm, less than one single-precision step of the
// wavelength (1.2e-4 nm).
const RT = 1e-6;
const RT_EDGE = { WDM_200Ghz_1547nm_1557nm: 1e-4 };
const NK = 7.5e-7;

let checks = 0;
const near = (actual, expected, relative, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${message}: ${actual} vs ${expected}`);
};
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const within = (actual, expected, tolerance, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
    return Math.abs(actual - expected);
};

function sameStack(fromSeq, fromMul, name) {
    for (const field of ['title', 'refNm', 'anglesDeg', 'incident', 'substrate']) {
        equal(fromMul[field], fromSeq[field], `${name}: ${field}`);
    }
    equal(fromMul.wavelengthsNm.length, fromSeq.wavelengthsNm.length, `${name}: wavelength count`);
    fromSeq.wavelengthsNm.forEach((lam, i) => near(fromMul.wavelengthsNm[i], lam, WAVELENGTH, `${name}: wavelength ${i + 1}`));
    equal(fromMul.layers.length, fromSeq.layers.length, `${name}: layer count`);
    fromSeq.layers.forEach((layer, i) => {
        const other = fromMul.layers[i];
        equal([other.code, other.index], [layer.code, layer.index], `${name}: layer ${i + 1} code and index`);
        near(other.thicknessNm, layer.thicknessNm, THICKNESS, `${name}: layer ${i + 1} thickness`);
    });
    equal(Object.keys(fromMul.mic), Object.keys(fromSeq.mic), `${name}: MIC labels`);
    for (const [label, rows] of Object.entries(fromSeq.mic)) {
        rows.forEach((row, r) => row.forEach((value, c) => {
            near(fromMul.mic[label][r][c], value, 1e-12, `${name}: MIC ${label} row ${r + 1}`);
        }));
    }
}

function storedIndexMatches(stack, sampled, name) {
    for (const [label, { n }] of Object.entries(sampled)) {
        stack.wavelengthsNm.forEach((lam, i) => {
            near(micIndexAt(stack.mic[label], lam), n[i], MIC_N, `${name}: ${label} n at ${lam} nm`);
        });
    }
}

// The wavelengths of a WLG list as the .mul files store them (see WAVELENGTH):
// a float32 in µm, the step added point after point. With them the DWDM
// sample matches the MAN of the 11.2 run to 8.8e-5; with min + i·step only to
// 2.1e-3. tfs_cr41g.mul, saved by CODE V 11.2 from WLG 400 800 10, stores the
// same running sum, 3.5e-4 nm short of 800 at the end.
function codevWavelengths(seqText, stack) {
    const wlg = /^\s*WLG\s+(\S+)\s+(\S+)\s+(\S+)/im.exec(seqText);
    if (!wlg) return stack.wavelengthsNm;
    const step = Math.fround(Number(wlg[3]) / 1000);
    let um = Math.fround(Number(wlg[1]) / 1000);
    return stack.wavelengthsNm.map(() => {
        const nm = um * 1000;
        um = Math.fround(um + step);
        return nm;
    });
}

function againstRun(stack, seqText, lines, name) {
    const design = codevStackToDesign(stack, { sourceName: name });
    const getNK = Object.fromEntries(design.materials.map(({ key, material }) => [key, makeGetNK(material)]));
    const wavelengths = codevWavelengths(seqText, stack);
    const tolerance = RT_EDGE[name] ?? RT;
    let rt = 0;
    manRows(lines).forEach(([angle, printedNm, Rs, Rp, Ts, Tp], row) => {
        const lam = wavelengths[row % wavelengths.length];
        equal(lam.toFixed(1), printedNm.toFixed(1), `${name}: MAN row ${row + 1} wavelength`);
        const index = (key) => getNK[key](lam);
        const layers = design.layers.map(layer => ({ n: index(layer.materialKey), d: layer.thickness }));
        const s = tmm(lam, angle, 's', index(design.incidentKey), index(design.substrateKey), layers);
        const p = tmm(lam, angle, 'p', index(design.incidentKey), index(design.substrateKey), layers);
        const where = `${name}, ${angle}°, ${printedNm} nm`;
        rt = Math.max(rt, within(s.R, Rs, tolerance, `${where}: Rs`), within(p.R, Rp, tolerance, `${where}: Rp`),
            within(s.T, Ts, tolerance, `${where}: Ts`), within(p.T, Tp, tolerance, `${where}: Tp`));
    });
    const n = mprSection(lines, 'REFRACTIVE INDICES - DISPERSIVE MATERIALS');
    const k = mprSection(lines, 'EXTINCTION COEFFICIENTS - DISPERSIVE MATERIALS');
    equal(Object.keys(n), Object.keys(stack.mic), `${name}: MPR prints every MIC material`);
    let nk = 0;
    for (const [label, { wl, values }] of Object.entries(n)) {
        wl.forEach((lam, i) => {
            nk = Math.max(nk, within(micIndexAt(stack.mic[label], lam), values[i], NK, `${name}: ${label} n at ${lam} nm`),
                within(micExtinctionAt(stack.mic[label], lam), k[label]?.values[i] ?? 0, NK, `${name}: ${label} k at ${lam} nm`));
        });
    }
    console.log(`  ${name}: R, T ${rt.toExponential(1)}${Object.keys(n).length ? `, n, k ${nk.toExponential(1)}` : ''}`);
}

const listing = fs.existsSync(LISTING) ? fs.readFileSync(LISTING, 'utf8') : null;
if (!listing) console.log(`SKIP  part 4: CODE V 11.2 listing not found at ${LISTING}`);
const files = fs.readdirSync(SAMPLES);
const seqFiles = files.filter(file => /\.seq$/i.test(file));
for (const seqFile of seqFiles) {
    const base = seqFile.replace(/\.seq$/i, '');
    const mulFile = files.find(file => file.toLowerCase() === `${base}.mul`.toLowerCase());
    assert.ok(mulFile, `${base}: its .mul is there`);
    const seqText = fs.readFileSync(path.join(SAMPLES, seqFile), 'utf8');
    const fromSeq = parseCodevSeq(seqText);
    const { stack: fromMul, sampled } = readCodevMul(fs.readFileSync(path.join(SAMPLES, mulFile), 'utf8'));
    sameStack(fromSeq, fromMul, base);
    storedIndexMatches(fromMul, sampled, base);
    equal(fromSeq.warnings, [], `${base}: read without a warning`);
    const design = codevStackToDesign(fromMul, { sourceName: mulFile });
    equal(design.layers.length, fromMul.layers.length, `${base}: converts`);
    if (listing) againstRun(fromSeq, seqText, listingRun(listing, `CODE V> IN s_${base}`), base);
}
equal(seqFiles.length, 15, 'all 15 samples were read');

console.log(`codev_coating_samples: ${checks} checks passed`);
