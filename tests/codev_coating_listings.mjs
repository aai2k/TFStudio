/**
 * CODE V 11.2 against TFStudio, from the numbers CODE V printed.
 *
 * tests/reference/codev/ holds .seq files TFStudio wrote and CODE V 11.2 ran,
 * the .mul files CODE V saved from them (read in codev_coating_samples.mjs),
 * and codev_11_2.json the tables CODE V printed for them, frozen from the
 * listings of the owner's runs by tests/reference/gen_codev_coating.mjs.
 *
 *  1. Each .seq read with parseCodevSeq, turned into TFStudio materials and
 *     layers with codevStackToDesign, and computed with the TFStudio
 *     transfer-matrix kernel, against MAN: Rs, Rp, Ts, Tp at every angle and
 *     wavelength. mic_narrow analyses past both ends of its MIC table.
 *  2. micIndexAt and micExtinctionAt against the n and k MPR printed for
 *     every MIC material: three 21-point tables at 41 wavelengths, the
 *     3-point table of mic_narrow, probe tables of 2 to 5 points that differ
 *     in n and k, some sampled past both ends, and the Ta2O5 table of tfs_ar4
 *     between its points (TA).
 *  3. The rows codevStackToDesign writes for a MIC material follow CODE V's n
 *     between them to half a unit in the sixth decimal.
 *
 * Run: node tests/codev_coating_listings.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseCodevSeq, codevStackToDesign } from '../src/utils/io/codevCoatingFile.js';
import { micCurve, micExtinctionAt, micIndexAt } from '../src/utils/io/codevCoating/micIndex.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { tmm } from '../src/tmmcore.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'reference', 'codev');
const { data } = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'codev_11_2.json'), 'utf8'));

let checks = 0;
const worst = new Map();
const near = (actual, expected, tolerance, group, message) => {
    checks++;
    const miss = Math.abs(actual - expected);
    if (!(miss <= (worst.get(group) ?? 0))) worst.set(group, miss);
    assert.ok(miss <= tolerance, `${message}: ${actual} vs ${expected}`);
};

// ── 1. R and T against MAN ───────────────────────────────────────────────────
// Half a unit in the sixth decimal CODE V prints, and as much again for the
// single precision its numbers are held in (its .mul files hold float32
// values). tfs_hr45 misses most on the edge of its reflection band at
// 510 nm and 45°, where Rs changes by 0.12 per nm: its worst, 4.6e-6, is that
// edge moved by 4e-5 nm, less than one single-precision step of the
// wavelength there (510 nm in µm, 24 bits: 6e-5 nm).
const RT_TOLERANCE = 1e-6;
const RT_EDGE_TOLERANCE = { tfs_hr45: 5e-6 };

function stackAt(design, getNK, lam) {
    const index = (key) => getNK[key](lam);
    return {
        n0: index(design.incidentKey),
        ns: index(design.substrateKey),
        layers: design.layers.map(layer => ({ n: index(layer.materialKey), d: layer.thickness })),
    };
}

for (const [name, rows] of Object.entries(data.man)) {
    const stack = parseCodevSeq(fs.readFileSync(path.join(FIXTURES, `${name}.seq`), 'utf8'));
    const design = codevStackToDesign(stack, { sourceName: `${name}.seq` });
    const getNK = Object.fromEntries(design.materials.map(({ key, material }) => [key, makeGetNK(material)]));
    for (const [angle, lam, Rs, Rp, Ts, Tp] of rows) {
        const at = stackAt(design, getNK, lam);
        const s = tmm(lam, angle, 's', at.n0, at.ns, at.layers);
        const p = tmm(lam, angle, 'p', at.n0, at.ns, at.layers);
        const where = `${name}, ${angle}°, ${lam} nm`;
        const tolerance = RT_EDGE_TOLERANCE[name] ?? RT_TOLERANCE;
        near(s.R, Rs, tolerance, name, `${where}: Rs`);
        near(p.R, Rp, tolerance, name, `${where}: Rp`);
        near(s.T, Ts, tolerance, name, `${where}: Ts`);
        near(p.T, Tp, tolerance, name, `${where}: Tp`);
    }
}

// ── 2. n and k against MPR ───────────────────────────────────────────────────
// Half a unit in the sixth decimal printed, and one single-precision step of
// an n near 3 (2.4e-7). Two n are not reproduced, see micIndex.js. F5A falls
// ever faster towards long wavelengths, and CODE V's fit of it misses its own
// MWL points (n 1.93 at 600 nm printed as 1.929998, 1.75 at 700 nm as
// 1.750006); at 750 nm, nearer the pole of the curve, the two curves are
// 1.85e-5 apart. TA at 510 nm lies between three points with a flat step,
// which have no Hartmann curve: CODE V prints 2.156753, the parabola through
// them gives 2.155834.
const NK_TOLERANCE = 7.5e-7;
const N_NOT_REPRODUCED = { F5A: 2e-5, 'TA 510': 1e-3 };
for (const { run, label, table, wavelengthsNm, n, k } of data.mic) {
    wavelengthsNm.forEach((lam, i) => {
        const tolerance = N_NOT_REPRODUCED[`${run} ${lam}`] ?? N_NOT_REPRODUCED[run] ?? NK_TOLERANCE;
        near(micIndexAt(table, lam), n[i], tolerance, `n ${run}`, `${run} '${label}' n at ${lam} nm`);
        near(micExtinctionAt(table, lam), k[i], NK_TOLERANCE, `k ${run}`, `${run} '${label}' k at ${lam} nm`);
    });
}

// ── 3. The rows of an imported MIC material ──────────────────────────────────
// TFStudio reads them with straight lines; checked at seven points between
// each two rows.
for (const name of Object.keys(data.man)) {
    const stack = parseCodevSeq(fs.readFileSync(path.join(FIXTURES, `${name}.seq`), 'utf8'));
    const design = codevStackToDesign(stack, { sourceName: `${name}.seq` });
    for (const { key, material } of design.materials.filter(({ key: k }) => k.startsWith('mic:'))) {
        const curve = micCurve(stack.mic[key.slice(4)]);
        const getNK = makeGetNK(material);
        const rows = material.tabData;
        let miss = 0;
        for (let i = 1; i < rows.length; i++) {
            for (let s = 1; s < 8; s++) {
                const lam = rows[i - 1][0] + (rows[i][0] - rows[i - 1][0]) * s / 8;
                miss = Math.max(miss, Math.abs(getNK(lam)[0] - curve.n(lam)), Math.abs(getNK(lam)[1] - curve.k(lam)));
            }
        }
        near(miss, 0, 5e-7 + 1e-12, 'rows', `${name} '${material.name}' between its ${rows.length} rows`);
    }
}

console.log(`  worst miss: ${[...worst].map(([group, miss]) => `${group} ${miss.toExponential(1)}`).join(', ')}`);
console.log(`codev_coating_listings: ${checks} checks passed`);
