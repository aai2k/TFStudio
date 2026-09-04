/**
 * gen_coating_materials.mjs: write the material definitions that built-in
 * coatings carry with them, src/utils/coatingLibrary/builtin/materialData.js.
 *
 * A built-in coating that uses a material outside the built-in library carries
 * that material's n,k data inside the entry, so the coating resolves on any
 * installation. Every such definition is sampled here, once per material, from
 * a local copy of the refractiveindex.info database (CC0). One id therefore
 * means one dataset in every coating that names it, and a coating applied to a
 * design after another coating that shares a material computes with the same
 * data as its preview.
 *
 * Tabulated pages keep their own wavelength points, thinned to at most MAX_ROWS
 * with the last point always kept. Formula pages are evaluated on a 1%
 * logarithmic grid. Both are clipped to 200-20000 nm, the range the
 * RefractiveIndex.info importer uses, a tabulated page keeping the one point
 * beyond each end so its table covers the whole clip. n is written to 5
 * decimals and k to 6 significant figures.
 *
 * The database is looked up in this order: TFS_RII_SOURCE, the
 * refractiveindex-db submodule, ../../reference/refractiveindex-db.
 *
 * Usage: node tools/gen_coating_materials.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import yaml from 'js-yaml';
import { evalFormulaN, parseMaterialDoc } from '../src/utils/materials/riiDatabase.js';
import { createPchipInterpolator } from '../src/utils/materials/pchip.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'utils', 'coatingLibrary', 'builtin', 'materialData.js');
const LAMBDA_MIN = 200;
const LAMBDA_MAX = 20000;
const MAX_ROWS = 400;
const LOG_STEP = 1.01;

/**
 * The materials, by id: the page under database/data, the display name shown
 * in the Design Editor, and the citation carried in the definition's comment.
 */
const MATERIALS = [
    { id: 'rii:Ag-Yang', page: 'main/Ag/nk/Yang.yml', name: 'Ag (evaporated film)',
        cite: 'H. U. Yang et al., Optical dielectric function of silver, Phys. Rev. B 91, 235137 (2015).' },
    { id: 'rii:Al-McPeak', page: 'main/Al/nk/McPeak.yml', name: 'Al (sputtered film)',
        cite: 'K. M. McPeak et al., Plasmonic films can easily be better, ACS Photonics 2, 326 (2015); single-crystal-quality sputtered aluminium.' },
    { id: 'rii:Al2O3-Boidin', page: 'main/Al2O3/nk/Boidin.yml', name: 'Al2O3 (film)',
        cite: 'R. Boidin et al., Pulsed laser deposited alumina thin films, Ceram. Int. 42, 1177 (2016).' },
    { id: 'rii:Au-Ordal', page: 'main/Au/nk/Ordal.yml', name: 'Au (evaporated film)',
        cite: 'M. A. Ordal et al., Optical properties of Au, Ni and Pb at submillimeter wavelengths, Appl. Opt. 26, 744 (1987).' },
    { id: 'rii:CaF2-Li', page: 'main/CaF2/nk/Li.yml', name: 'CaF2 (crystal)',
        cite: 'H. H. Li, Refractive index of alkaline earth halides and its wavelength and temperature derivatives, J. Phys. Chem. Ref. Data 9, 161 (1980).' },
    { id: 'rii:Cr-Rakic', page: 'main/Cr/nk/Rakic-LD.yml', name: 'Cr (Lorentz-Drude model)',
        cite: 'A. D. Rakic et al., Optical properties of metallic films for vertical-cavity optoelectronic devices, Appl. Opt. 37, 5271 (1998); Lorentz-Drude model.' },
    { id: 'rii:F2-Schott', page: 'specs/schott/optical/F2.yml', name: 'F2 (flint glass)',
        cite: 'SCHOTT optical glass F2, Sellmeier fit plus tabulated absorption from the SCHOTT Zemax catalog.' },
    { id: 'rii:Ge-Li', page: 'main/Ge/nk/Li-293K.yml', name: 'Ge (crystal, 293 K)',
        cite: 'H. H. Li, Refractive index of silicon and germanium and its wavelength and temperature derivatives, J. Phys. Chem. Ref. Data 9, 561 (1980).' },
    { id: 'rii:HfO2-Siefke', page: 'main/HfO2/nk/Siefke.yml', name: 'HfO2 (ALD film, deep ultraviolet)',
        cite: 'T. Siefke et al., Atomic layer deposition for hafnium oxide-based meta-optics in the ultraviolet spectral range, J. Eur. Opt. Soc. Rapid Publ. 22, 33 (2026); plasma-enhanced ALD film.' },
    { id: 'rii:ITO-Minenkov', page: 'other/mixed crystals/In2O3-SnO2/nk/Minenkov-glass.yml', name: 'ITO (sputtered film on glass)',
        cite: 'A. Minenkov et al., indium tin oxide film on glass, ellipsometric characterisation.' },
    { id: 'rii:Nb2O5-Lemarchand', page: 'main/Nb2O5/nk/Lemarchand.yml', name: 'Nb2O5 (sputtered film)',
        cite: 'F. Lemarchand, private communication (2013); sputtered Nb2O5 film, measured by the method of Gao, Lemarchand and Lequime, Opt. Express 20, 15734 (2012).' },
    { id: 'rii:Ni-Johnson', page: 'main/Ni/nk/Johnson.yml', name: 'Ni (nickel)',
        cite: 'P. B. Johnson and R. W. Christy, optical constants of the transition metals, room temperature.' },
    { id: 'rii:PC-Zhang', page: 'organic/(C16H14O3)n - polycarbonate/nk/Zhang.yml', name: 'Polycarbonate',
        cite: 'X. Zhang et al., complex refractive indices of polymers in the visible and near infrared.' },
    { id: 'rii:Si-Franta', page: 'main/Si/nk/Franta-25C.yml', name: 'Si (crystalline wafer, 25 C)',
        cite: 'D. Franta et al., temperature-dependent dispersion model of crystalline silicon at 25 C.' },
    { id: 'rii:Si3N4-Kischkat', page: 'main/Si3N4/nk/Kischkat.yml', name: 'Si3N4 (film)',
        cite: 'J. Kischkat et al., Mid-infrared optical properties of thin films of aluminum oxide, titanium dioxide, silicon dioxide, aluminum nitride and silicon nitride, Appl. Opt. 51, 6789 (2012).' },
    { id: 'rii:Si3N4-Luke', page: 'main/Si3N4/nk/Luke.yml', name: 'Si3N4 (silicon nitride film)',
        cite: 'K. Luke et al., stoichiometric silicon nitride film, Sellmeier fit.' },
    { id: 'rii:SiO2-Franta', page: 'main/SiO2/nk/Franta.yml', name: 'SiO2 (film)',
        cite: 'D. Franta et al., dispersion model for amorphous silicon dioxide covering the ultraviolet to the infrared.' },
    { id: 'rii:SiO2-Lemarchand', page: 'main/SiO2/nk/Lemarchand.yml', name: 'SiO2 (sputtered film)',
        cite: 'F. Lemarchand, private communication (2013); sputtered SiO2 film, measured by the method of Gao, Lemarchand and Lequime, Opt. Express 20, 15734 (2012).' },
    { id: 'rii:SodaLime-Rubin', page: 'glass/misc/soda-lime/nk/Rubin-clear.yml', name: 'Soda lime glass (clear float)',
        cite: 'M. Rubin, optical properties of soda lime silica glasses, clear window glass.' },
    { id: 'rii:Ta2O5-Gao', page: 'main/Ta2O5/nk/Gao.yml', name: 'Ta2O5 (sputtered film)',
        cite: 'L. Gao, F. Lemarchand, M. Lequime, Exploitation of multiple incidences spectrometric measurements for thin film reverse engineering, Opt. Express 20, 15734 (2012).' },
    { id: 'rii:TiN-Beliaev', page: 'main/TiN/nk/Beliaev-sputtering.yml', name: 'TiN (sputtered film)',
        cite: 'L. Yu. Beliaev et al., Optical properties of plasmonic titanium nitride thin films from ultraviolet to mid-infrared wavelengths deposited by pulsed-DC sputtering, thermal and plasma-enhanced atomic layer deposition, Opt. Mater. 143, 114237 (2023), 50 nm film by pulsed-DC sputtering.' },
    { id: 'rii:TiO2-Franta', page: 'main/TiO2/nk/Franta.yml', name: 'TiO2 (film)',
        cite: 'D. Franta et al., dispersion model for titanium dioxide films from the ultraviolet to the infrared.' },
    { id: 'rii:TiO2-Siefke', page: 'main/TiO2/nk/Siefke.yml', name: 'TiO2 (ALD film)',
        cite: 'T. Siefke et al., Materials pushing the application limits of wire grid polarizers further into the deep ultraviolet spectral range, Adv. Opt. Mater. 4, 1780 (2016).' },
    { id: 'rii:VO2-25C', page: 'main/VO2/nk/Beaini-25C.yml', name: 'VO2 (film, 25 C, semiconducting)',
        cite: 'R. Beaini et al., optical properties of vanadium dioxide films below the metal-insulator transition.' },
    { id: 'rii:ZnS-Amotchkina', page: 'main/ZnS/nk/Amotchkina.yml', name: 'ZnS (e-beam film)',
        cite: 'T. Amotchkina et al., Characterization of e-beam evaporated Ge, YbF3, ZnS and LaF3 thin films for laser-oriented coatings, Appl. Opt. 59, A40 (2020).' },
    { id: 'rii:ZnSe-Querry', page: 'main/ZnSe/nk/Querry.yml', name: 'ZnSe (crystal)',
        cite: 'M. R. Querry, Optical constants of minerals and other materials from the millimeter to the ultraviolet, CRDEC-CR-88009 (1987).' },
    { id: 'rii:ZrO2-Synowicki', page: 'main/ZrO2/nk/Synowicki.yml', name: 'ZrO2 (film)',
        cite: 'R. A. Synowicki et al., ellipsometric characterisation of zirconium dioxide films.' },
];

function riiDataDir() {
    const candidates = [
        process.env.TFS_RII_SOURCE,
        path.join(ROOT, 'refractiveindex-db', 'database'),
        path.resolve(ROOT, '..', '..', 'reference', 'refractiveindex-db', 'database'),
    ].filter(Boolean);
    const found = candidates.find(dir => fs.existsSync(path.join(dir, 'data')));
    if (!found) throw new Error(`refractiveindex.info database not found; looked in ${candidates.join(', ')}`);
    return path.join(found, 'data');
}

const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`;

// The page's own points over the clip, thinned to MAX_ROWS. The first point
// outside each end is kept too, so the table brackets the clip with measured
// data instead of stopping just short of it.
function sampleTable(mat, lo, hi) {
    const table = mat.tableNK;
    let first = table.findIndex(row => row[0] >= lo);
    if (first < 0) throw new Error('no tabulated points inside the clip');
    if (first > 0 && table[first][0] > lo) first--;
    let last = table.length - 1;
    while (last > 0 && table[last][0] > hi) last--;
    if (last < table.length - 1 && table[last][0] < hi) last++;
    const rows = table.slice(first, last + 1);
    if (rows.length < 2) throw new Error('fewer than two tabulated points inside the clip');
    const kAt = mat.tableK?.length ? createPchipInterpolator(mat.tableK) : null;
    const every = Math.max(1, Math.ceil(rows.length / MAX_ROWS));
    const kept = rows.filter((_, i) => i % every === 0);
    if (kept[kept.length - 1] !== rows[rows.length - 1]) kept.push(rows[rows.length - 1]);
    const how = every === 1 ? `the ${rows.length} tabulated points` : `every ${ordinal(every)} of the ${rows.length} tabulated points`;
    return { rows: kept.map(([lambda, n, k]) => [lambda, n, kAt ? kAt(lambda) : k]), how };
}

// The formula on a 1% logarithmic grid over its own range. A page's absorption
// table may cover less than the formula; beyond its ends k holds the end
// value, the reading the RefractiveIndex.info importer gives it too (a table
// that ends at k = 0 says the material is transparent from there on).
function sampleFormula(mat, lo, hi) {
    const [formulaLo, formulaHi] = mat.wavelengthRange || [lo, hi];
    lo = Math.max(lo, formulaLo);
    hi = Math.min(hi, formulaHi);
    const kAt = mat.tableK?.length ? createPchipInterpolator(mat.tableK) : null;
    const grid = [];
    for (let lambda = lo; lambda < hi; lambda *= LOG_STEP) grid.push(Math.round(lambda * 10) / 10);
    grid.push(hi);
    return { rows: grid.map(lambda => [lambda, evalFormulaN(mat, lambda), kAt ? kAt(lambda) : 0]), how: 'the dispersion formula on a 1% logarithmic grid' };
}

function sample(mat) {
    const { rows, how } = mat.tableNK ? sampleTable(mat, LAMBDA_MIN, LAMBDA_MAX) : sampleFormula(mat, LAMBDA_MIN, LAMBDA_MAX);
    const data = rows.map(([lambda, n, k]) => {
        if (!(n > 0) || !Number.isFinite(k) || k < -1e-9) throw new Error(`bad point at ${lambda} nm: n=${n} k=${k}`);
        return [Number(lambda.toFixed(3)), Number(n.toFixed(5)), k <= 0 ? 0 : Number(k.toPrecision(6))];
    });
    for (let i = 1; i < data.length; i++) {
        if (!(data[i][0] > data[i - 1][0])) throw new Error(`wavelengths not increasing at ${data[i][0]} nm`);
    }
    return { data, how };
}

const quote = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function renderMaterial(spec, data, how) {
    const lo = data[0][0];
    const hi = data[data.length - 1][0];
    const comment = `refractiveindex.info ${spec.page}. ${spec.cite} Sampled from ${how} over ${Math.round(lo)}-${Math.round(hi)} nm.`;
    const lines = [];
    for (let i = 0; i < data.length; i += 4) {
        lines.push('            ' + data.slice(i, i + 4).map(row => `[${row.join(', ')}]`).join(', ') + ',');
    }
    return [
        `    ${quote(spec.id)}: {`,
        `        id: ${quote(spec.id)},`,
        `        name: ${quote(spec.name)},`,
        '        formulaNum: -1,',
        `        lambdaMin: ${Number((lo / 1000).toFixed(6))},`,
        `        lambdaMax: ${Number((hi / 1000).toFixed(6))},`,
        "        interp: 'pchip',",
        `        comment: ${quote(comment)},`,
        '        tabData: [',
        ...lines,
        '        ],',
        '    },',
    ].join('\n');
}

const dataDir = riiDataDir();
console.log(`refractiveindex.info data: ${dataDir}`);
const blocks = [];
for (const spec of [...MATERIALS].sort((a, b) => a.id.localeCompare(b.id))) {
    const file = path.join(dataDir, spec.page);
    const mat = parseMaterialDoc(yaml.load(fs.readFileSync(file, 'utf8')), spec.page);
    const { data, how } = sample(mat);
    blocks.push(renderMaterial(spec, data, how));
    console.log(`  ${spec.id.padEnd(22)} ${data.length} rows, ${data[0][0]}-${data[data.length - 1][0]} nm`);
}

const header = `/**
 * Material definitions that travel with built-in coatings, one per id.
 *
 * Generated by tools/gen_coating_materials.mjs from the refractiveindex.info
 * database. Do not edit by hand: change the generator's table and rerun it.
 * Entries take these through embedded() in ./materials.js, which is what makes
 * one id mean the same data in every coating that carries it.
 */
export const EMBEDDED_MATERIAL_DATA = {
`;
fs.writeFileSync(OUT, header + blocks.join('\n') + '\n};\n', 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)} (${MATERIALS.length} materials)`);
