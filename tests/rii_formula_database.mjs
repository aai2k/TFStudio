/**
 * Every formula page of the refractiveindex.info database, as TFStudio samples
 * it, against the database's own evaluator.
 *
 * TFStudio's formula 2 dropped its constant on a page with an even number of
 * coefficients, formula 4 took |C4| before raising it to C5, and formulas 1 to
 * 5 clamped n, so a pole inside a page's range stored n = 1 or n = 0.1. Each
 * showed on a handful of pages and nowhere else.
 *
 * Oracle: a port of database/tools/nkexplorer.py (UpdateData), the script the
 * database ships for plotting its pages. A coefficient the page does not give
 * reads as 0 and nothing is clamped. Every sampled n must match it wherever it
 * gives a real, positive n, and the grid points left out must be the ones where
 * it does not.
 *
 * A formula page is stored as its formula, so the material it imports as must
 * give the sampled n at every grid point and none where a point is left out,
 * and its jet, which GD/GDD differentiates, must carry the same value.
 *
 * Needs the refractiveindex-db submodule; says so and passes without it.
 *
 * Run: node tests/rii_formula_database.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import {
    leftOutRanges, parseMaterialDoc, riiToMaterialEntry, sampleMaterial,
} from '../src/utils/materials/riiDatabase.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { evalNJet } from '../src/utils/materials/dispersionFormulas.js';
import { jetScale, wavelengthOmegaJet } from '../src/tmmcore.js';

const series = (from, to, term) => {
    let sum = 0;
    for (let i = from; i <= to; i += 2) sum += term(i);
    return sum;
};

// nkexplorer.py, formula by formula; C(i) is the page's i-th coefficient, wl in µm.
const NKEXPLORER = {
    1: (C, wl) => Math.sqrt(1 + C(1) + series(2, 16, i => C(i) / (1 - (C(i + 1) / wl) ** 2))),
    2: (C, wl) => Math.sqrt(1 + C(1) + series(2, 16, i => C(i) / (1 - C(i + 1) / wl ** 2))),
    3: (C, wl) => Math.sqrt(C(1) + series(2, 16, i => C(i) * wl ** C(i + 1))),
    4: (C, wl) => Math.sqrt(C(1) + C(2) * wl ** C(3) / (wl ** 2 - C(4) ** C(5))
        + C(6) * wl ** C(7) / (wl ** 2 - C(8) ** C(9)) + series(10, 16, i => C(i) * wl ** C(i + 1))),
    5: (C, wl) => C(1) + series(2, 10, i => C(i) * wl ** C(i + 1)),
    6: (C, wl) => 1 + C(1) + series(2, 10, i => C(i) / (C(i + 1) - wl ** -2)),
    7: (C, wl) => C(1) + C(2) / (wl ** 2 - 0.028) + C(3) / (wl ** 2 - 0.028) ** 2
        + C(4) * wl ** 2 + C(5) * wl ** 4 + C(6) * wl ** 6,
    8: (C, wl) => {
        const r = C(1) + C(2) * wl ** 2 / (wl ** 2 - C(3)) + C(4) * wl ** 2;
        return Math.sqrt((2 * r + 1) / (1 - r));
    },
    9: (C, wl) => Math.sqrt(C(1) + C(2) / (wl ** 2 - C(3)) + C(4) * (wl - C(5)) / ((wl - C(5)) ** 2 + C(6))),
};

// The script's n, or NaN where it gives no real, positive one: a form that
// gives n directly can cross 0, and a negative index is no index.
function reference(mat, lambdaNm) {
    const n = NKEXPLORER[mat.riiFormulaNum](i => mat.formulaCoeffs[i - 1] ?? 0, lambdaNm / 1000);
    return n > 0 && Number.isFinite(n) ? n : NaN;
}

// The first wavelength where the samples and the reference disagree, as text,
// or null.
function firstMismatch(mat) {
    let rows;
    try { rows = sampleMaterial(mat); } catch (err) { return err.message; }
    const stored = new Map(rows.map(([lam, n]) => [lam, n]));
    const checked = [...rows.map(([lam]) => lam), ...leftOutRanges(mat).flat()];
    const bad = checked.find(lam => {
        const theirs = reference(mat, lam);
        const ours = stored.get(lam);
        if (!Number.isFinite(theirs)) return ours !== undefined;
        return ours === undefined || Math.abs(ours - theirs) > 1e-12 * Math.abs(theirs);
    });
    return bad === undefined ? null : `${bad} nm: ${stored.get(bad)} vs ${reference(mat, bad)}`;
}

// The jet's value at one wavelength, NaN where it has none.
function jetValue(entry, lambdaNm) {
    const omega = 2 * Math.PI * 299.792458 / lambdaNm;
    const jet = evalNJet(entry.formulaNum, entry.coefficients, jetScale(wavelengthOmegaJet(lambdaNm, omega), 1 / 1000));
    return jet ? jet[0][0] : NaN;
}

// The first wavelength where the stored material disagrees with the samples,
// as text, or null: every grid point, and the jet at the first, middle and
// last sample and at each left-out run's ends.
function storedMismatch(mat) {
    const rows = sampleMaterial(mat);
    const entry = riiToMaterialEntry(mat, 'page', 'book');
    const getNK = makeGetNK(entry);
    const probes = [rows[0], rows[rows.length >> 1], rows[rows.length - 1]];
    const gaps = leftOutRanges(mat).flat();
    const wrong = [
        ...rows.filter(([lam, n]) => getNK(lam)[0] !== n).map(([lam]) => `stored n at ${lam} nm`),
        ...gaps.filter(lam => !Number.isNaN(getNK(lam)[0])).map(lam => `stored n at ${lam} nm, in a left-out band`),
        ...probes.filter(([lam, n]) => !(Math.abs(jetValue(entry, lam) - n) <= 1e-12 * n)).map(([lam]) => `jet at ${lam} nm`),
        ...gaps.filter(lam => !Number.isNaN(jetValue(entry, lam))).map(lam => `jet at ${lam} nm, in a left-out band`),
    ];
    return wrong[0] ?? null;
}

function formulaPages(dataDir) {
    const pages = [];
    for (const rel of readdirSync(dataDir, { recursive: true })) {
        if (!rel.endsWith('.yml')) continue;
        const text = readFileSync(path.join(dataDir, rel), 'utf8');
        if (!/type:\s*formula \d/.test(text)) continue;
        const mat = parseMaterialDoc(yaml.load(text), rel.replace(/\\/g, '/'));
        if (!mat.tableNK && mat.riiFormulaNum) pages.push(mat);
    }
    return pages;
}

const dataDir = fileURLToPath(new URL('../refractiveindex-db/database/data/', import.meta.url));
if (!existsSync(dataDir)) {
    console.log('rii_formula_database: refractiveindex-db is not checked out, so its pages were not compared');
} else {
    const pages = formulaPages(dataDir);
    const counts = {};
    for (const mat of pages) counts[mat.riiFormulaNum] = (counts[mat.riiFormulaNum] || 0) + 1;
    const mismatched = pages.map(mat => [mat.dataPath, firstMismatch(mat)]).filter(([, why]) => why);
    assert.deepEqual(mismatched, [], 'every formula page matches nkexplorer.py');
    const storedWrong = pages.map(mat => [mat.dataPath, storedMismatch(mat)]).filter(([, why]) => why);
    assert.deepEqual(storedWrong, [], 'every formula page imports as a material that gives its samples');
    assert.ok([1, 2, 3, 4, 5, 6, 7, 8, 9].every(f => counts[f] > 0), `pages for each of formulas 1 to 9: ${JSON.stringify(counts)}`);
    const leftOut = pages.filter(mat => leftOutRanges(mat).length).map(mat => mat.dataPath);
    console.log(`rii_formula_database: ${pages.length} formula pages match; points left out on ${leftOut.join(', ')}`);
}

console.log('rii_formula_database: passed');
