/**
 * Files CODE V saved and the numbers CODE V printed, against the reader.
 *
 *  1. The seven .mul files CODE V 11.2 saved (format 6) from TFStudio
 *     exports, kept in tests/reference/codev beside their .seq. Each .mul
 *     read with parseCodevMul gives the stack parseCodevSeq reads from its
 *     .seq: title, REF, the wavelengths as the same float32 in µm, angles,
 *     media, every layer's code and index, its thickness in nm to float32
 *     precision (the .mul stores it as a float32 in waves of REF), and the
 *     MIC tables. The n and k CODE V stored for each MIC material at the
 *     analysis wavelengths are those micIndexAt and micExtinctionAt give;
 *     the worst miss is printed.
 *  2. Maintainer-only: the 15 sample coatings CODE V ships (format 5), each a
 *     .seq and the .mul CODE V saved from it, with the checks of part 1 but
 *     for the stored k (see storedIndexMatches), and
 *     the listing of a CODE V 11.2 run that entered each .seq afresh and
 *     printed MPR and MAN (codev_checks3.lis): each .seq read with
 *     parseCodevSeq, turned into TFStudio materials and layers with
 *     codevStackToDesign and computed with the TFStudio transfer-matrix
 *     kernel, against Rs, Rp, Ts, Tp at every angle and wavelength, and its
 *     MIC materials' n and k against MPR. The worst miss of each is printed.
 *  3. Maintainer-only: Essential Macleod's CODE V export of an Al mirror,
 *     written with decimal commas, read as the same file with decimal points
 *     reads; that file against the MPR and MAN of the CODE V 11.2 run that
 *     entered it (codev_checks7.lis), as in part 2.
 *
 * The CODE V samples, Macleod's export and the listings are not in the
 * repository; without them parts 2 and 3 print SKIP.
 *
 * Run: node tests/codev_coating_samples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseCodevSeq, codevStackToDesign } from '../src/utils/io/codevCoatingFile.js';
import { readCodevMul } from '../src/utils/io/codevCoating/parseMul.js';
import { readMulRecord } from '../src/utils/io/codevCoating/mulRecord.js';
import { micExtinctionAt, micIndexAt } from '../src/utils/io/codevCoating/micIndex.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { tmm } from '../src/tmmcore.js';
import { listingRun, manRows, mprSection } from './reference/codevListing.mjs';

const SAVED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'codev');
const SAMPLES = 'X:\\TFStudio Dev\\reference\\code v\\coating';
const LISTINGS = 'X:\\TFStudio Dev\\reference\\code v\\listings';
const MACLEOD = 'X:\\TFStudio Dev\\reference\\code v\\macleod\\al_mirror.seq';

// Thickness: the .mul holds T = n·d/REF as a float32, so the thickness read
// back from it is up to 2^-24 off from storage alone; the samples' worst is
// 1.3 times that (silver, 8e-8). 2^-21 leaves room.
const THICKNESS = 2 ** -21;
// CODE V's own n and k at an MWL point are up to 3 float32 steps off the table.
const STORED_NK = 4e-7;
// Wavelengths, as float32 in µm. CODE V 11.2 stores a WL value λ as the
// float32 of λ/1000 (450 nm as 0.4499999881), and a WLG point as the reader
// builds it, so part 1 asks for the same float32. The format 5 samples store
// the float32 product of λ and the float32 of 0.001 (450 nm as
// 0.4500000179), one float32 step at most from it.
const FORMAT5_WAVELENGTH = 2 ** -23;
// Parts 2 and 3. R, T, n and k: half a unit in the sixth decimal printed, and
// as much again for the single precision CODE V's numbers are held in (one
// step of an n near 3 is 2.4e-7). The DWDM sample misses most on the edge of
// its passband at 1552.8 nm, where Rs changes by 2 per nm: 8.8e-5 there is
// that edge moved by 4.5e-5 nm, less than one single-precision step of the
// wavelength (1.2e-4 nm).
const RT = 1e-6;
const NK = 7.5e-7;
const RT_EDGE = { WDM_200Ghz_1547nm_1557nm: 1e-4 };

let checks = 0;
const near = (actual, expected, relative, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${message}: ${actual} vs ${expected}`);
    return Math.abs(actual - expected);
};
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const within = (actual, expected, tolerance, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
    return Math.abs(actual - expected);
};
const readText = (folder, file) => fs.readFileSync(path.join(folder, file), 'utf8');

function sameStack(fromSeq, fromMul, { wavelengthsUm, wavelengthTolerance }, name) {
    for (const field of ['title', 'refNm', 'anglesDeg', 'incident', 'substrate']) {
        equal(fromMul[field], fromSeq[field], `${name}: ${field}`);
    }
    equal(fromSeq.wavelengthsNm.length, wavelengthsUm.length, `${name}: wavelength count`);
    fromSeq.wavelengthsNm.forEach((lam, i) => near(Math.fround(lam / 1000), Math.fround(wavelengthsUm[i]),
        wavelengthTolerance, `${name}: wavelength ${i + 1}, as float32 in µm`));
    equal(fromMul.layers.length, fromSeq.layers.length, `${name}: layer count`);
    fromSeq.layers.forEach((layer, i) => {
        const other = fromMul.layers[i];
        equal([other.code, other.index], [layer.code, layer.index], `${name}: layer ${i + 1} code and index`);
        near(other.thicknessNm, layer.thicknessNm, THICKNESS, `${name}: layer ${i + 1} thickness`);
    });
    equal(Object.keys(fromMul.mic), Object.keys(fromSeq.mic), `${name}: MIC labels`);
    for (const [label, rows] of Object.entries(fromSeq.mic)) {
        equal(fromMul.mic[label].length, rows.length, `${name}: MIC ${label} row count`);
        rows.forEach((row, r) => row.forEach((value, c) => {
            near(fromMul.mic[label][r][c], value, 1e-12, `${name}: MIC ${label} row ${r + 1}`);
        }));
    }
}

// The n and k CODE V stored at the analysis wavelengths, which it computed at
// the float32 wavelengths it stores. The k of the format 5 samples follows
// another rule between MWL points than the k CODE V 11.2 prints for the same
// tables (SiO at 450 nm: 0.0729 stored, 0.080305 printed by CODE V 11.2, which
// micExtinctionAt gives), so there only n is checked. Returns the worst miss.
function storedIndexMatches(stack, sampled, { wavelengthsUm, withK }, name) {
    let worst = 0;
    for (const [label, { n, k }] of Object.entries(sampled)) {
        wavelengthsUm.forEach((um, i) => {
            const lam = um * 1000;
            worst = Math.max(worst, near(micIndexAt(stack.mic[label], lam), n[i], STORED_NK, `${name}: ${label} n at ${lam} nm`));
            if (withK) worst = Math.max(worst, near(micExtinctionAt(stack.mic[label], lam), k[i], STORED_NK, `${name}: ${label} k at ${lam} nm`));
        });
    }
    return worst;
}

// A .seq and the .mul CODE V saved from it: the same stack, and the n and k
// CODE V stored. Returns the stack read from the .seq and the worst n, k miss.
function checkSaved(seqText, mulText, format5, name) {
    const fromSeq = parseCodevSeq(seqText);
    const { stack: fromMul, sampled } = readCodevMul(mulText);
    const { wavelengthsUm } = readMulRecord(mulText);
    sameStack(fromSeq, fromMul, { wavelengthsUm, wavelengthTolerance: format5 ? FORMAT5_WAVELENGTH : 0 }, name);
    const worst = storedIndexMatches(fromMul, sampled, { wavelengthsUm, withK: !format5 }, name);
    const design = codevStackToDesign(fromMul, { sourceName: name });
    equal(design.layers.length, fromMul.layers.length, `${name}: converts`);
    return { fromSeq, worst };
}

// R and T against MAN, and n and k against MPR, of one CODE V 11.2 run of
// `stack`. `nTolerance` gives a material's n tolerance where it is not NK.
// Returns the worst misses as text, a material with its own tolerance apart.
function againstRun(stack, lines, name, { rt = RT, nTolerance = {} } = {}) {
    const design = codevStackToDesign(stack, { sourceName: name });
    const getNK = Object.fromEntries(design.materials.map(({ key, material }) => [key, makeGetNK(material)]));
    const wavelengths = stack.wavelengthsNm;
    let worstRT = 0;
    manRows(lines).forEach(([angle, printedNm, Rs, Rp, Ts, Tp], row) => {
        const lam = wavelengths[row % wavelengths.length];
        equal(lam.toFixed(1), printedNm.toFixed(1), `${name}: MAN row ${row + 1} wavelength`);
        const index = (key) => getNK[key](lam);
        const layers = design.layers.map(layer => ({ n: index(layer.materialKey), d: layer.thickness }));
        const s = tmm(lam, angle, 's', index(design.incidentKey), index(design.substrateKey), layers);
        const p = tmm(lam, angle, 'p', index(design.incidentKey), index(design.substrateKey), layers);
        const where = `${name}, ${angle}°, ${printedNm} nm`;
        worstRT = Math.max(worstRT, within(s.R, Rs, rt, `${where}: Rs`), within(p.R, Rp, rt, `${where}: Rp`),
            within(s.T, Ts, rt, `${where}: Ts`), within(p.T, Tp, rt, `${where}: Tp`));
    });
    const n = mprSection(lines, 'REFRACTIVE INDICES - DISPERSIVE MATERIALS');
    const k = mprSection(lines, 'EXTINCTION COEFFICIENTS - DISPERSIVE MATERIALS');
    equal(Object.keys(n), Object.keys(stack.mic), `${name}: MPR prints every MIC material`);
    let text = `R, T ${worstRT.toExponential(1)}`;
    let worstNK = null;
    for (const [label, { wl, values }] of Object.entries(n)) {
        const misses = wl.map((printedNm, i) => {
            const lam = wavelengths[i];
            equal(lam.toFixed(2), printedNm.toFixed(2), `${name}: MPR wavelength ${i + 1}`);
            return Math.max(
                within(micIndexAt(stack.mic[label], lam), values[i], nTolerance[label] ?? NK, `${name}: ${label} n at ${lam} nm`),
                within(micExtinctionAt(stack.mic[label], lam), k[label]?.values[i] ?? 0, NK, `${name}: ${label} k at ${lam} nm`));
        });
        if (label in nTolerance) text += `, ${label} n, k ${Math.max(...misses).toExponential(1)}`;
        else worstNK = Math.max(worstNK ?? 0, ...misses);
    }
    return worstNK === null ? text : `${text}, n, k ${worstNK.toExponential(1)}`;
}

// ── 1. TFStudio exports saved by CODE V 11.2 ─────────────────────────────────
{
    const names = fs.readdirSync(SAVED).filter(file => /\.mul$/.test(file)).map(file => file.slice(0, -4));
    equal(names.length, 7, 'seven .mul files saved by CODE V 11.2');
    for (const name of names) {
        const { fromSeq, worst } = checkSaved(readText(SAVED, `${name}.seq`), readText(SAVED, `${name}.mul`), false, name);
        // tfs_cr41 writes its 41 wavelengths in one WL command, of which
        // CODE V 11.2 kept 21 ("Extra data ... ignored"), and so does the reader.
        equal(fromSeq.warnings.map(w => w.kind), name === 'tfs_cr41' ? ['extraValues'] : [], `${name}: warnings`);
        console.log(`  ${name}: stored n, k ${worst.toExponential(1)}`);
    }
}

// ── 2. CODE V's sample coatings ──────────────────────────────────────────────
if (fs.existsSync(SAMPLES)) {
    const listingPath = path.join(LISTINGS, 'codev_checks3.lis');
    const listing = fs.existsSync(listingPath) ? fs.readFileSync(listingPath, 'utf8') : null;
    if (!listing) console.log(`SKIP  part 2 against CODE V 11.2: listing not found at ${listingPath}`);
    const files = fs.readdirSync(SAMPLES);
    const seqFiles = files.filter(file => /\.seq$/i.test(file));
    for (const seqFile of seqFiles) {
        const base = seqFile.replace(/\.seq$/i, '');
        const mulFile = files.find(file => file.toLowerCase() === `${base}.mul`.toLowerCase());
        assert.ok(mulFile, `${base}: its .mul is there`);
        const { fromSeq, worst } = checkSaved(readText(SAMPLES, seqFile), readText(SAMPLES, mulFile), true, base);
        equal(fromSeq.warnings, [], `${base}: read without a warning`);
        const run = listing ? `, ${againstRun(fromSeq, listingRun(listing, `CODE V> IN s_${base}`), base,
            { rt: RT_EDGE[base] ?? RT })}` : '';
        console.log(`  ${base}: stored n ${worst.toExponential(1)}${run}`);
    }
    equal(seqFiles.length, 15, 'all 15 samples were read');
} else {
    console.log(`SKIP  part 2: CODE V sample coatings not found at ${SAMPLES}`);
}

// ── 3. Essential Macleod's CODE V export ─────────────────────────────────────
// Its tables run from 400 to 700 nm in 100 points, of which CODE V reads the
// first 21, to 460.61 nm; the analysis runs to 700 nm. SiO2 and the glass end
// on three points in a straight line, which CODE V continues ("Index data is
// linear with wavelength"); Al takes the spline, whose end parabola runs on
// for 240 nm, about 80 times its 3.03 nm spacing, and its k is held. There
// the n of Al computed here falls short of CODE V's, by 3.0e-4 at 700 nm, and
// R misses by 5.0e-5; micIndex.js gives what is known of the cause.
const MACLEOD_AL_N = 3.1e-4;
const MACLEOD_RT = 5.1e-5;

// The 21-value limit on each MIC line of Macleod's export, from line `from`.
const macleodExtraValues = (from) => ['MWL', 'SiO2', 'EXT', 'Al', 'EXT', 'Glass', 'EXT']
    .map((command, i) => ({ kind: 'extraValues', command, line: from + i, count: 79, limit: 21 }));

function checkMacleod() {
    const dotsPath = path.join(LISTINGS, 'macleod_dots.seq');
    const listingPath = path.join(LISTINGS, 'codev_checks7.lis');
    if (!fs.existsSync(MACLEOD) || !fs.existsSync(dotsPath)) {
        console.log(`SKIP  part 3: Essential Macleod's export not found at ${MACLEOD} or ${dotsPath}`);
        return;
    }
    const comma = parseCodevSeq(fs.readFileSync(MACLEOD, 'utf8'));
    const dots = parseCodevSeq(fs.readFileSync(dotsPath, 'utf8'));
    equal(dots.warnings, macleodExtraValues(11), "Macleod: CODE V's 21 values kept on each MWL, n and EXT line, as in its run");
    equal(comma.warnings, [{ kind: 'decimalComma', line: 11 }, ...macleodExtraValues(11)], 'Macleod: decimal commas noted once');
    equal({ ...comma, warnings: [] }, { ...dots, warnings: [] }, 'Macleod: decimal commas read as points');
    if (!fs.existsSync(listingPath)) {
        console.log(`SKIP  part 3 against CODE V 11.2: listing not found at ${listingPath}`);
        return;
    }
    const lines = listingRun(fs.readFileSync(listingPath, 'utf8'), 'CODE V> IN macleod_dots');
    console.log(`  Macleod: ${againstRun(dots, lines, 'Macleod', { rt: MACLEOD_RT, nTolerance: { Al: MACLEOD_AL_N } })}`);
}
checkMacleod();

console.log(`codev_coating_samples: ${checks} checks passed`);
