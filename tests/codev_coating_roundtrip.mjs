/**
 * CODE V coating writer, read back by the reader.
 *
 *  1. buildCodevSeq → parseCodevSeq → codevStackToDesign gives back the
 *     layers in order, their thicknesses and locked codes, the media, REF,
 *     the wavelengths and angles, and n and k of every material at the
 *     analysis wavelengths to the six decimals written.
 *  2. MIC labels are unique, at most 6 characters; a constant material is
 *     written on its COA line; long lists go over lines ending in "&".
 *  3. A material sampled at more than 21 wavelengths is cut to 21 MIC points,
 *     with a `resampled` warning.
 *  4. An absorbing incident medium or substrate loses its k, with a
 *     `mediumAbsorbs` warning.
 *  5. Each CodevExportError kind, with its values.
 *
 * Run: node tests/codev_coating_roundtrip.mjs
 */
import assert from 'node:assert/strict';
import {
    buildCodevSeq, CodevExportError, CODEV_LIMITS, parseCodevSeq, codevStackToDesign,
} from '../src/utils/io/codevCoatingFile.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';

// n and k are written with six decimals: half a unit there, plus the binary
// rounding of a value that sits exactly on the half.
const WRITTEN = 5e-7 + 1e-12;

let checks = 0;
const near = (actual, expected, tolerance, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };

// n and k as functions of λ in nm. Cauchy-type dielectrics, a metal whose n
// and k both change, and two constants.
const MATERIALS = {
    air: { name: 'Air', nk: () => [1, 0] },
    glass: { name: 'BK7 glass', nk: (l) => [1.5046 + 4200 / l ** 2, 0] },
    ta2o5: { name: 'Ta2O5', nk: (l) => [2.05 + 30000 / l ** 2, 2e-4 * (500 / l) ** 4] },
    silicaA: { name: 'SiO2 (Fused Silica)', nk: (l) => [1.45 + 3500 / l ** 2, 0] },
    silicaB: { name: 'SiO2 (sputtered)', nk: (l) => [1.46 + 3900 / l ** 2, 0] },
    silver: { name: 'Ag', nk: (l) => [0.05 + 1e-4 * l, 0.0065 * l] },
    mgf2: { name: 'MgF2 film', nk: () => [1.38, 0] },
    absorber: { name: 'Dark film', nk: () => [2, 0.5] },
};
const options = (overrides = {}) => ({
    title: 'Round trip',
    saveName: 'round_trip',
    incident: 'air',
    substrate: 'glass',
    wavelengthsNm: [400, 450, 500, 550, 600, 650, 700, 750, 800],
    anglesDeg: [0, 45],
    refNm: 550,
    materialName: (id) => MATERIALS[id].name,
    getNK: (id, lam) => MATERIALS[id].nk(lam),
    layers: [
        { material: 'ta2o5', thickness: 61.25, locked: true },
        { material: 'silicaA', thickness: 94.8765 },
        { material: 'mgf2', thickness: 12.5 },
        { material: 'silicaB', thickness: 100 },
        { material: 'absorber', thickness: 3.1 },
        { material: 'silver', thickness: 120 },
        { material: 'ta2o5', thickness: 20, locked: true },
    ],
    ...overrides,
});
const exportError = (opts, kind, detail, message) => {
    checks++;
    assert.throws(() => buildCodevSeq(opts), (err) => {
        assert.ok(err instanceof CodevExportError, `${message}: a CodevExportError`);
        assert.equal(err.kind, kind, message);
        assert.deepEqual(err.detail, detail, message);
        return true;
    });
};

// ── 1 and 2. Round trip ──────────────────────────────────────────────────────
{
    const opts = options();
    const { text, warnings } = buildCodevSeq(opts);
    equal(warnings, [], 'nothing to warn about');
    const stack = parseCodevSeq(text);
    equal([stack.title, stack.refNm, stack.wavelengthsNm, stack.anglesDeg], [opts.title, 550, opts.wavelengthsNm, [0, 45]],
        'title, REF, WL over two lines joined by "&", ANG');
    equal(stack.warnings, [], 'the written file reads without a warning');
    const design = codevStackToDesign(stack, { sourceName: 'round_trip.seq' });
    equal(design.layers.length, opts.layers.length, 'every layer back');
    equal(design.layers.map(layer => layer.locked), opts.layers.map(layer => !!layer.locked), 'locked layers stay locked');
    opts.layers.forEach((layer, i) => near(design.layers[i].thickness, layer.thickness, 5e-5, `layer ${i + 1} thickness`));

    const getNK = Object.fromEntries(design.materials.map(({ key, material }) => [key, makeGetNK(material)]));
    const sameIndex = (key, id, what) => {
        for (const lam of opts.wavelengthsNm) {
            const [n, k] = getNK[key](lam), [n0, k0] = opts.getNK(id, lam);
            near(n, n0, WRITTEN, `${what} n at ${lam} nm`);
            near(k, k0, WRITTEN, `${what} k at ${lam} nm`);
        }
    };
    opts.layers.forEach((layer, i) => sameIndex(design.layers[i].materialKey, layer.material, `layer ${i + 1}`));
    sameIndex(design.incidentKey, 'air', 'incident medium');
    sameIndex(design.substrateKey, 'glass', 'substrate');

    const labels = Object.keys(stack.mic);
    equal(labels, ['Ta2O5', 'SiO2', 'SiO22', 'Ag', 'BK7gla'], 'one MIC entry per dispersive material, in the order the stack names them');
    checks++;
    assert.ok(labels.every(label => label.length <= 6), 'labels hold at most 6 characters');
    equal(new Set(labels.map(label => label.toUpperCase())).size, labels.length, 'labels are unique');
    equal([stack.layers[2].index, stack.layers[4].index], [{ n: 1.38, k: 0 }, { n: 2, k: 0.5 }],
        'a constant material is written on its COA line, with its k when it absorbs');
    checks++;
    assert.ok(text.split('\r\n').some(line => line.trimEnd().endsWith('&')), 'the file uses "&" continuation');
}

// ── 3. More than 21 points ───────────────────────────────────────────────────
{
    const wavelengthsNm = Array.from({ length: 40 }, (_, i) => 400 + 10 * i);
    const opts = options({ wavelengthsNm, layers: [{ material: 'ta2o5', thickness: 50 }], substrate: 'mgf2' });
    const { text, warnings } = buildCodevSeq(opts);
    equal(warnings, [{ kind: 'resampled', material: 'Ta2O5', from: 40, to: CODEV_LIMITS.micPoints }], 'resampled warning');
    const rows = parseCodevSeq(text).mic.Ta2O5;
    equal(rows.length, CODEV_LIMITS.micPoints, 'the MIC table holds 21 points');
    equal([rows[0][0], rows[rows.length - 1][0]], [400, 790], 'both ends are kept');
    for (const [lam, n, k] of rows) {
        const [n0, k0] = opts.getNK('ta2o5', lam);
        near(n, n0, WRITTEN, `kept point ${lam} nm n`);
        near(k, k0, WRITTEN, `kept point ${lam} nm k`);
    }
}

// ── 4. Absorbing media ───────────────────────────────────────────────────────
{
    const { text, warnings } = buildCodevSeq(options({ incident: 'absorber', substrate: 'silver' }));
    equal(warnings, [
        { kind: 'mediumAbsorbs', role: 'incident', material: 'Dark film' },
        { kind: 'mediumAbsorbs', role: 'substrate', material: 'Ag' },
    ], 'both media reported');
    const stack = parseCodevSeq(text);
    equal(stack.incident, { n: 2, k: 0 }, 'INC is written with n only');
    checks++;
    assert.ok(stack.mic[stack.substrate.label].every(row => row[2] === 0), 'SUB names a MIC entry with no k');
    checks++;
    assert.ok(stack.layers.some(layer => layer.index.label && stack.mic[layer.index.label].some(row => row[2] > 0)),
        'the layer of the same metal keeps its k in its own MIC entry');
}

// ── 5. Export errors ─────────────────────────────────────────────────────────
{
    const many = Array.from({ length: 1001 }, () => ({ material: 'mgf2', thickness: 10 }));
    exportError(options({ layers: many }), 'layers', { count: 1001, limit: 1000 }, 'more than 1000 layers');
    const wavelengths = Array.from({ length: 101 }, (_, i) => 400 + i);
    exportError(options({ wavelengthsNm: wavelengths }), 'wavelengths', { count: 101, limit: 100 }, 'more than 100 wavelengths');
    exportError(options({ wavelengthsNm: [] }), 'wavelengths', { count: 0, limit: 100 }, 'no wavelength');
    exportError(options({ anglesDeg: [0, 10, 20, 30, 40, 50] }), 'angles', { count: 6, limit: 5 }, 'more than 5 angles');
    const noIndex = options({ getNK: (id, lam) => (id === 'ta2o5' ? [NaN, 0] : MATERIALS[id].nk(lam)) });
    exportError(noIndex, 'noIndex', { material: 'Ta2O5' }, 'a material with no index at any analysis wavelength');
}

console.log(`codev_coating_roundtrip: ${checks} checks passed`);
