/**
 * Global tabulated-material interpolation regression.
 *
 * Independent oracle values below were generated with SciPy 1.18.0
 * PchipInterpolator. The coating migration case pins the separately measured
 * linear-to-PCHIP change so a later GD/GDD change cannot absorb it silently.
 */

import assert from 'node:assert/strict';
import {
    createPchipInterpolator,
    createTabulatedNKSampler,
    TABULATED_INTERPOLATION,
} from '../src/utils/materials/pchip.js';
import { MATERIALS, getMaterial } from '../src/utils/materials/materialDatabase.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { normalizeCatalogMaterials } from '../src/utils/materials/catalogManager/persistence.js';
import { buildBuiltinCatalog } from '../src/utils/materials/catalogManager/builtinCatalog.js';
import { buildNKFromDraft, draftToMaterial } from '../src/components/windows/design/materialEditor/materialDraft.js';
import { sampleMaterial } from '../src/utils/materials/riiDatabase/sampling.js';
import { riiToMaterialEntry } from '../src/utils/materials/riiDatabase/catalogEntry.js';
import { tmm } from '../src/utils/physics/thinFilmMath.js';

const near = (actual, expected, tolerance = 1e-12, message = '') => {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}: got ${actual}, expected ${expected}, tolerance ${tolerance}`);
};

// Nonuniform, nonmonotone reference data exercises both endpoint limiting and
// zero slopes at local extrema. These values match SciPy's independent PCHIP.
const oracle = createPchipInterpolator([
    [0, 1], [0.7, 2.4], [1.9, 2.1], [3, 4], [5.5, 3.7],
]);
const oracleValues = [
    [0, 1],
    [0.2, 1.5662191192266381],
    [0.7, 2.4],
    [1.1, 2.322222222222222],
    [1.9, 2.1],
    [2.5, 3.179188580015026],
    [3, 4],
    [4.2, 3.9668224],
    [5.5, 3.7],
];
for (const [x, expected] of oracleValues) near(oracle(x), expected, 2e-14, `PCHIP oracle at ${x}`);

assert.equal(oracle(-10), 1, 'values below the table clamp to its first point');
assert.equal(oracle(10), 3.7, 'values above the table clamp to its last point');
assert.equal(oracle.interp, TABULATED_INTERPOLATION);

const twoPoint = createPchipInterpolator([[400, 1.5], [600, 1.7]]);
near(twoPoint(450), 1.55, 1e-14, 'two points reduce exactly to a straight line');
near(twoPoint(500), 1.6, 1e-14, 'two-point midpoint');

const duplicate = createPchipInterpolator([[400, 1.4], [500, 1.5], [500, 1.6], [600, 1.7]]);
assert.equal(duplicate(500), 1.6, 'a repeated wavelength keeps the last supplied value');

const nkRows = [[400, 1.5, 0], [500, 1.8, 0.04], [650, 1.65, 0.01], [800, 1.7, 0.02]];
const directNK = createTabulatedNKSampler(nkRows);
assert.deepEqual(directNK(500), [1.8, 0.04], 'n,k sampler reproduces table knots exactly');
assert.equal(directNK.interp, TABULATED_INTERPOLATION);
assert.deepEqual(directNK.rangeNm, [400, 800]);

// Every built-in raw table is audited within each segment. PCHIP must remain
// inside the envelope of the two bracketing data values, including k >= 0.
let auditedColumns = 0;
let auditedSamples = 0;
for (const material of MATERIALS) {
    const rows = material.getNK?.tabData;
    if (!rows) continue;
    assert.equal(material.getNK.interp, TABULATED_INTERPOLATION, `${material.id} advertises PCHIP`);
    for (let column = 1; column <= 2; column++) {
        auditedColumns++;
        for (let i = 0; i < rows.length - 1; i++) {
            const lo = Math.min(rows[i][column], rows[i + 1][column]);
            const hi = Math.max(rows[i][column], rows[i + 1][column]);
            for (let sample = 1; sample < 20; sample++) {
                const wavelength = rows[i][0] + sample * (rows[i + 1][0] - rows[i][0]) / 20;
                const value = material.getNK(wavelength)[column - 1];
                const tolerance = 2e-13 * Math.max(1, Math.abs(lo), Math.abs(hi));
                assert.ok(value >= lo - tolerance && value <= hi + tolerance,
                    `${material.id} column ${column} overshoots at ${wavelength} nm`);
                if (column === 2 && lo >= 0) {
                    assert.ok(value >= -tolerance, `${material.id} produces negative k at ${wavelength} nm`);
                }
                auditedSamples++;
            }
        }
    }
}

const bk7 = getMaterial('BK7');
assert.equal(bk7.getNK.interp, TABULATED_INTERPOLATION, 'BK7 tabulated k advertises PCHIP');
for (const [wavelength, expectedK] of bk7.getNK.kTable) {
    near(bk7.getNK(wavelength)[1], expectedK, 1e-24, `BK7 k knot at ${wavelength} nm`);
}
for (let i = 0; i < bk7.getNK.kTable.length - 1; i++) {
    const left = bk7.getNK.kTable[i];
    const right = bk7.getNK.kTable[i + 1];
    const lo = Math.min(left[1], right[1]);
    const hi = Math.max(left[1], right[1]);
    for (let sample = 1; sample < 20; sample++) {
        const wavelength = left[0] + sample * (right[0] - left[0]) / 20;
        const value = bk7.getNK(wavelength)[1];
        assert.ok(value >= -1e-24 && value >= lo - 1e-24 && value <= hi + 1e-24,
            `BK7 k overshoots at ${wavelength} nm`);
        auditedSamples++;
    }
}
auditedColumns++;
assert.equal(auditedColumns, 25, 'all built-in tabulated n and k columns were audited');
assert.ok(auditedSamples > 36000, 'the built-in audit samples every segment densely');

// Catalog and Material Editor previews must evaluate the same user table.
const catalogMaterial = {
    id: 'measured', name: 'Measured', formulaNum: -1, tabData: nkRows,
    coefficients: [], kTable: [],
};
const catalogNK = makeGetNK(catalogMaterial);
const draft = {
    type: 'tabular',
    rows: nkRows.map(([lam, n, k]) => ({ lam: String(lam), n: String(n), k: String(k) })),
};
const editorNK = buildNKFromDraft(draft);
for (const wavelength of [350, 425, 550, 725, 900]) {
    assert.deepEqual(editorNK(wavelength), catalogNK(wavelength),
        `Material Editor and catalog agree at ${wavelength} nm`);
}

const normalized = normalizeCatalogMaterials({
    id: 'legacy', source: 'user', materials: { measured: { ...catalogMaterial } },
});
assert.equal(normalized.materials.measured.interp, TABULATED_INTERPOLATION,
    'legacy catalog tables are migrated to explicit PCHIP metadata');
assert.equal(draftToMaterial({
    ...draft,
    id: 'measured', name: 'Measured', lambdaMinNm: '400', lambdaMaxNm: '800', color: 'auto',
}).interp, TABULATED_INTERPOLATION, 'new user table stores PCHIP metadata');
assert.equal(buildBuiltinCatalog().materials.TiO2.interp, TABULATED_INTERPOLATION,
    'built-in catalog exposes its interpolation rule');

const riiKMerge = sampleMaterial({
    tableNK: [[650, 1.5, 0]],
    tableK: [[400, 1], [470, 2.4], [590, 2.1], [700, 4], [950, 3.7]],
}, 400, 950, 1);
near(riiKMerge[0][2], 3.179188580015026, 2e-14,
    'RefractiveIndex.info separate k tables use PCHIP when merged');
const riiEntry = riiToMaterialEntry({
    tableNK: [[400, 1.5, 0], [550, 1.45, 0], [700, 1.43, 0]],
    wavelengthRange: [400, 700],
    references: 'Synthetic test table', comments: '', dataPath: 'test.yml',
}, 'test', 'Synthetic');
assert.equal(riiEntry.interp, TABULATED_INTERPOLATION,
    'RefractiveIndex.info catalog entries store PCHIP metadata');

// Migration baseline: fixed (HL)^8 TiO2/SiO2 on BK7, 400 to 800 nm.
// The layer thicknesses are the 550 nm quarter-wave values from the old linear
// TiO2 rule. Only between-knot TiO2 evaluation differs between the two curves.
const high = getMaterial('TiO2');
const low = getMaterial('SiO2');
const substrate = getMaterial('BK7');
const highRows = high.getNK.tabData;
function legacyLinearNK(wavelength) {
    if (wavelength <= highRows[0][0]) return highRows[0].slice(1);
    const last = highRows[highRows.length - 1];
    if (wavelength >= last[0]) return last.slice(1);
    let lo = 0;
    let hi = highRows.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (highRows[mid][0] <= wavelength) lo = mid;
        else hi = mid;
    }
    const fraction = (wavelength - highRows[lo][0]) / (highRows[hi][0] - highRows[lo][0]);
    return [
        highRows[lo][1] + fraction * (highRows[hi][1] - highRows[lo][1]),
        highRows[lo][2] + fraction * (highRows[hi][2] - highRows[lo][2]),
    ];
}

const referenceWavelength = 550;
const highThickness = referenceWavelength / (4 * legacyLinearNK(referenceWavelength)[0]);
const lowThickness = referenceWavelength / (4 * low.getNK(referenceWavelength)[0]);
let maxDeltaPercentagePoints = 0;
let maxDeltaWavelength = 0;
let oldCenter = 0;
let newCenter = 0;
for (let wavelength = 400; wavelength <= 800 + 1e-9; wavelength += 0.1) {
    const oldLayers = [];
    const newLayers = [];
    for (let pair = 0; pair < 8; pair++) {
        oldLayers.push({ n: legacyLinearNK(wavelength), d: highThickness });
        oldLayers.push({ n: low.getNK(wavelength), d: lowThickness });
        newLayers.push({ n: high.getNK(wavelength), d: highThickness });
        newLayers.push({ n: low.getNK(wavelength), d: lowThickness });
    }
    const oldR = tmm(wavelength, 0, 's', [1, 0], substrate.getNK(wavelength), oldLayers).R;
    const newR = tmm(wavelength, 0, 's', [1, 0], substrate.getNK(wavelength), newLayers).R;
    const delta = Math.abs(newR - oldR) * 100;
    if (delta > maxDeltaPercentagePoints) {
        maxDeltaPercentagePoints = delta;
        maxDeltaWavelength = wavelength;
    }
    if (Math.abs(wavelength - referenceWavelength) < 1e-8) {
        oldCenter = oldR * 100;
        newCenter = newR * 100;
    }
}
near(maxDeltaPercentagePoints, 0.046691927379699516, 2e-12,
    'maximum reflectance migration in percentage points');
near(maxDeltaWavelength, 464.6, 2e-10, 'wavelength of maximum reflectance migration');
near(oldCenter, 99.95667582040201, 2e-12, 'old center reflectance percent');
near(newCenter, 99.95666952299118, 2e-12, 'new center reflectance percent');

console.log(`PASS: material_pchip (${auditedColumns} columns, ${auditedSamples} interior samples)`);
