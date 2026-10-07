/**
 * Maintainer-only: the 15 sample coatings CODE V ships, each a .seq and the
 * .mul CODE V saved from it. They are Synopsys files and stay out of the
 * repository; without them this test prints SKIP and passes.
 *
 *  1. parseCodevSeq(.seq) and parseCodevMul(.mul) give the same stack: title,
 *     REF, wavelengths, angles, media, every layer's code and index, its
 *     thickness in nm to float32 precision (the .mul stores it as a float32
 *     in waves of REF), and the MIC tables.
 *  2. The n CODE V stored for each MIC material at the analysis wavelengths
 *     is the n micIndexAt computes, to CODE V's float32 precision.
 *  3. Every stack converts to TFStudio materials and layers.
 *
 * Run: node tests/codev_coating_samples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseCodevSeq, codevStackToDesign } from '../src/utils/io/codevCoatingFile.js';
import { readCodevMul } from '../src/utils/io/codevCoating/parseMul.js';
import { micIndexAt } from '../src/utils/io/codevCoating/micIndex.js';

const SAMPLES = 'X:\\TFStudio Dev\\reference\\code v\\coating';
if (!fs.existsSync(SAMPLES)) {
    console.log(`SKIP  CODE V sample coatings not found at ${SAMPLES}`);
    process.exit(0);
}

// Thickness: the .mul holds T = n·d/REF as a float32, 2^-24 relative, and
// CODE V forms it in float32 arithmetic; 2^-21 leaves room for both.
const THICKNESS = 2 ** -21;
// Wavelengths: CODE V builds a WLG list by adding the step to a float32 in µm
// again and again, so the last of the 51 WLG points of the DWDM sample sits
// 1.7e-3 nm (1.1e-6) off the value min + i·step the reader gives.
const WAVELENGTH = 2e-6;
// CODE V's own n at an MWL point is up to 3 float32 steps off the table.
const MIC_N = 4e-7;

let checks = 0;
const near = (actual, expected, relative, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${message}: ${actual} vs ${expected}`);
};
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };

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

const files = fs.readdirSync(SAMPLES);
const seqFiles = files.filter(file => /\.seq$/i.test(file));
for (const seqFile of seqFiles) {
    const base = seqFile.replace(/\.seq$/i, '');
    const mulFile = files.find(file => file.toLowerCase() === `${base}.mul`.toLowerCase());
    assert.ok(mulFile, `${base}: its .mul is there`);
    const fromSeq = parseCodevSeq(fs.readFileSync(path.join(SAMPLES, seqFile), 'utf8'));
    const { stack: fromMul, sampled } = readCodevMul(fs.readFileSync(path.join(SAMPLES, mulFile), 'utf8'));
    sameStack(fromSeq, fromMul, base);
    storedIndexMatches(fromMul, sampled, base);
    equal(fromSeq.warnings, [], `${base}: read without a warning`);
    const design = codevStackToDesign(fromMul, { sourceName: mulFile });
    equal(design.layers.length, fromMul.layers.length, `${base}: converts`);
}
equal(seqFiles.length, 15, 'all 15 samples were read');

console.log(`codev_coating_samples: ${checks} checks passed`);
