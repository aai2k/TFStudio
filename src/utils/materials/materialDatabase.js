/**
 * Built-in optical material database.
 *
 * Air and the Sellmeier materials are written out here. The tabulated
 * materials come from the refractiveindex.info database (CC0); their rows and
 * descriptions are generated into builtinRiiData.js by
 * tools/gen_builtin_materials.mjs.
 *
 * Each material exposes:
 *   getNK(lambda_nm) -> [n, k]   (n~  = n + ik, k >= 0)
 */

import {
    createPchipInterpolator,
    createTabulatedNKSampler,
    TABULATED_INTERPOLATION,
} from './pchip.js';
import { BUILTIN_RII_DATA } from './builtinRiiData.js';
import { evalN } from './dispersionFormulas.js';

// Attach the material's valid wavelength range [minNm, maxNm] to its getNK
// function so the catalog/UI can report and plot the ACTUAL extent instead of a
// generic placeholder. Range is informational only: getNK still clamps/evaluates
// outside it, so TMM results are unaffected.
function tagRange(fn, rangeNm) { if (rangeNm) fn.rangeNm = rangeNm; return fn; }

// n^2(lam) = 1 + sum Bi*lam^2/(lam^2 - Ci)   lam in um, evaluated as formula 101
// with a leading constant of 1, so n is NaN where n^2 has no real, positive root.
// rangeNm: [minNm, maxNm] literature validity range of the Sellmeier fit (optional).
function sellmeier(coeffs, rangeNm) {
    const coefficients = [1, ...coeffs.flat()];
    const fn = (lambda_nm) => [evalN(101, coefficients, lambda_nm / 1000), 0];
    fn.dispersionFormula = { formulaNum: 101, coefficients };
    return tagRange(fn, rangeNm);
}

// data: [[lambda_nm, n, k], ...]  sorted ascending. The valid range is exactly the
// tabulated extent (getNK clamps to the endpoints outside it).
function tabulated(data) {
    return createTabulatedNKSampler(data);
}

// ── SCHOTT N-BK7 internal transmittance → extinction coefficient k ────────────
// Real BK7 is NOT perfectly transparent: the SCHOTT N-BK7 datasheet publishes an
// internal transmittance τi (here for d = 10 mm). A physically correct substrate
// must absorb more as it gets thicker, so we derive k(λ) from τi:
//      α(λ) = −ln(τi) / d        (absorption coefficient, 1/mm)
//      k(λ) = α(λ) · λ / (4π)    (λ and d in the same length unit)
// In the visible τi ≈ 0.997–0.998 ⇒ k ≈ 1e-8 (a 1 mm slab absorbs ~0.02 %, a
// 25 mm slab ~0.5 %); it climbs steeply in the UV. Source: SCHOTT N-BK7
// internal transmittance datasheet. (Sellmeier n is unchanged.)
const BK7_TI_10MM = [
    [310, 0.590], [320, 0.780], [334, 0.910], [350, 0.974], [365, 0.986],
    [370, 0.989], [380, 0.993], [390, 0.995], [400, 0.997], [405, 0.997],
    [420, 0.997], [436, 0.997], [460, 0.997], [500, 0.998], [546, 0.998],
    [580, 0.998], [620, 0.998], [660, 0.998], [700, 0.998], [1060, 0.999],
    [1530, 0.992], [1970, 0.933], [2325, 0.793], [2500, 0.665],
];
const BK7_K_TABLE = BK7_TI_10MM.map(([lamNm, ti]) => {
    const d_mm = 10;
    const alpha_per_mm = -Math.log(Math.min(Math.max(ti, 1e-6), 1)) / d_mm;
    const lam_mm = lamNm / 1e6;                 // nm → mm
    return [lamNm, alpha_per_mm * lam_mm / (4 * Math.PI)];
});
const _bk7KAt = createPchipInterpolator(BK7_K_TABLE);
function bk7ExtinctionK(lambda_nm) {
    return _bk7KAt(lambda_nm);
}
const _bk7Sellmeier = sellmeier([
    [1.03961212, 0.00600069867],
    [0.23179234, 0.02001791440],
    [1.01046945, 103.560653],
]);
const _bk7GetNK = tagRange(
    lambda_nm => [_bk7Sellmeier(lambda_nm)[0], bk7ExtinctionK(lambda_nm)],
    [300, 2500]);
_bk7GetNK.interp = TABULATED_INTERPOLATION;
_bk7GetNK.kTable = BK7_K_TABLE;
_bk7GetNK.kInterpolator = _bk7KAt;
_bk7GetNK.kInterpolatorUnit = 'nm';
_bk7GetNK.dispersionFormula = _bk7Sellmeier.dispersionFormula;

// The tabulated materials, in catalog order. Each takes its rows and
// description from the refractiveindex.info page builtinRiiData.js names for it.
const RII_MATERIALS = [
    { id: 'TiO2',  name: 'TiO2 (anatase)',        color: '#e8a600', group: 'Dielectric' },
    { id: 'Ta2O5', name: 'Ta2O5',                 color: '#2fa84f', group: 'Dielectric' },
    { id: 'Nb2O5', name: 'Nb2O5',                 color: '#7f9c00', group: 'Dielectric' },
    { id: 'HfO2',  name: 'HfO2',                  color: '#12a150', group: 'Dielectric' },
    { id: 'ZrO2',  name: 'ZrO2 (cubic zirconia)', color: '#d6289b', group: 'Dielectric' },
    { id: 'ZnS',   name: 'ZnS',                   color: '#b08a00', group: 'Dielectric' },
    { id: 'ZnSe',  name: 'ZnSe',                  color: '#f58231', group: 'Dielectric' },
    { id: 'Si',    name: 'Si (Silicon)',          color: '#c0392b', group: 'Semiconductor' },
    { id: 'Ge',    name: 'Ge (Germanium)',        color: '#8e1f1f', group: 'Semiconductor' },
    { id: 'Au',    name: 'Au (Gold)',             color: '#ffb300', group: 'Metal' },
    { id: 'Ag',    name: 'Ag (Silver)',           color: '#8fa3b0', group: 'Metal' },
    { id: 'Cr',    name: 'Cr (Chromium)',         color: '#5c6b7a', group: 'Metal' },
    { id: 'ITO',   name: 'ITO',                   color: '#8e2fc0', group: 'TCO' },
].map(material => ({
    ...material,
    description: BUILTIN_RII_DATA[material.id].description,
    getNK: tabulated(BUILTIN_RII_DATA[material.id].rows),
}));

const _materials = [
    {
        id: 'Air',
        name: 'Air',
        color: '#38bdf8',
        group: 'Ambient',
        description: 'Air / Vacuum (n=1.0)',
        getNK: Object.assign(() => [1.0, 0], { constantNK: [1, 0] })
    },
    {
        id: 'SiO2',
        name: 'SiO2 (Fused Silica)',
        color: '#00a5c8',
        group: 'Dielectric',
        description: 'Fused silica\nMalitson, J. Opt. Soc. Am. 55, 1205 (1965)',
        getNK: sellmeier([
            [0.6961663, 0.0684043 ** 2],
            [0.4079426, 0.1162414 ** 2],
            [0.8974794, 9.896161  ** 2]
        ], [210, 6700])   // Malitson 1965 validity 0.21–6.7 µm
    },
    {
        id: 'BK7',
        name: 'BK7 (Schott)',
        color: '#0f6fd1',
        group: 'Substrate',
        description: 'Borosilicate glass N-BK7\nSCHOTT (Sellmeier n + internal-transmittance k)',
        // n: SCHOTT Sellmeier;  k: derived from SCHOTT N-BK7 internal
        // transmittance so a thick substrate absorbs realistically (see above).
        getNK: _bk7GetNK,  // SCHOTT Sellmeier validity 0.30–2.5 µm
    },
    {
        id: 'MgF2',
        name: 'MgF2',
        color: '#2c7be5',
        group: 'Dielectric',
        description: 'Magnesium fluoride\nDodge, Appl. Opt. 23, 1980 (1984)',
        getNK: sellmeier([
            [0.48755108, 0.04338408 ** 2],
            [0.39875031, 0.09461442 ** 2],
            [2.31203530, 23.793604  ** 2]
        ], [200, 7000])   // Dodge 1984 validity 0.2–7.0 µm
    },
    {
        id: 'Al2O3',
        name: 'Al2O3 (Sapphire)',
        color: '#00968a',
        group: 'Dielectric',
        description: 'Aluminium oxide\nMalitson & Dodge, J. Opt. Soc. Am. 62 (1972)',
        getNK: sellmeier([
            [1.4313493, 0.0726631 ** 2],
            [0.6505471, 0.1193242 ** 2],
            [5.3414021, 18.028251 ** 2]
        ], [200, 5500])   // Malitson & Dodge 1972 validity 0.2–5.5 µm
    },
    ...RII_MATERIALS,
];

export const MATERIALS = _materials;
export const MATERIAL_MAP = Object.fromEntries(_materials.map(m => [m.id, m]));
export const MATERIAL_GROUPS = ['Ambient', 'Substrate', 'Dielectric', 'Semiconductor', 'Metal', 'TCO'];
export function getMaterial(id) { return MATERIAL_MAP[id] ?? MATERIAL_MAP['Air']; }
export function getNK(materialId, lambda_nm) { return getMaterial(materialId).getNK(lambda_nm); }
export const SUBSTRATE_MATERIALS = ['BK7', 'SiO2', 'Ge', 'Si'];
export const LAYER_MATERIALS = _materials.filter(m => m.id !== 'Air').map(m => m.id);
