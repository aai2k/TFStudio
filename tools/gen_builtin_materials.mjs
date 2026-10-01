/**
 * gen_builtin_materials.mjs: write the n,k tables of the built-in materials
 * taken from the refractiveindex.info database (CC0), with each page's comment
 * and reference, to src/utils/materials/builtinRiiData.js.
 *
 * materialDatabase.js holds the rest of every built-in material (name, color,
 * group) and the materials that are not a table from a page.
 *
 * A table keeps the page's own points from lmin to lmax nm, skipping any point
 * closer than `step` nm to the last one kept; the last point in that window is
 * always kept. An entry with no window keeps every point of its page, as the
 * RefractiveIndex.info importer does. Wavelengths are rounded to 0.001 nm and
 * n to six significant figures; k is written as the page gives it.
 *
 * A description is the page's comment and reference in full, the same text the
 * RefractiveIndex.info importer stores for that page. The module is read back
 * before it is written, and nothing is written if a description or a row read
 * back differs from its page.
 *
 * The database is looked up in this order: TFS_RII_SOURCE, the
 * refractiveindex-db submodule, ../../reference/refractiveindex-db.
 *
 * Usage: node tools/gen_builtin_materials.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import yaml from 'js-yaml';
import { parseMaterialDoc, riiMaterialComment } from '../src/utils/materials/riiDatabase.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'utils', 'materials', 'builtinRiiData.js');

/**
 * The materials, by id, in built-in catalog order: the page under
 * database/data, and the window (nm) and least spacing (nm) of its table when
 * it does not keep the whole page.
 */
const MATERIALS = [
    { id: 'TiO2', page: 'main/TiO2/nk/Jolivet-anatase.yml', lmin: 370, lmax: 830, step: 5 },
    { id: 'Ta2O5', page: 'main/Ta2O5/nk/Bright-amorphous.yml', lmin: 500, lmax: 2500, step: 10 },
    { id: 'Nb2O5', page: 'main/Nb2O5/nk/Lemarchand.yml', lmin: 250, lmax: 1000, step: 5 },
    { id: 'HfO2', page: 'main/HfO2/nk/Bright.yml', lmin: 380, lmax: 2500, step: 10 },
    { id: 'ZrO2', page: 'main/ZrO2/nk/Synowicki.yml' },
    { id: 'ZnS', page: 'main/ZnS/nk/Querry.yml', lmin: 370, lmax: 2500, step: 10 },
    { id: 'ZnSe', page: 'main/ZnSe/nk/Querry.yml', lmin: 500, lmax: 2500, step: 20 },
    { id: 'Si', page: 'main/Si/nk/Pierce.yml', lmin: 200, lmax: 2060, step: 20 },
    { id: 'Ge', page: 'main/Ge/nk/Nunley.yml', lmin: 250, lmax: 2500, step: 20 },
    { id: 'Au', page: 'main/Au/nk/Johnson.yml', lmin: 188, lmax: 1940, step: 10 },
    { id: 'Ag', page: 'main/Ag/nk/Johnson.yml', lmin: 188, lmax: 1940, step: 10 },
    { id: 'Cr', page: 'main/Cr/nk/Johnson.yml', lmin: 200, lmax: 2000, step: 20 },
    { id: 'ITO', page: 'other/mixed crystals/In2O3-SnO2/nk/Konig.yml', lmin: 300, lmax: 2000, step: 10 },
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

// The page's points inside [lmin, lmax], each at least `step` past the last
// one kept, then the last point inside the window whatever its spacing.
function thinTable(mat, { lmin = 0, lmax = Infinity, step = 0 }) {
    if (mat.type !== 'tabulated_nk') throw new Error(`${mat.dataPath} is not a tabulated n,k page`);
    const inside = mat.tableNK
        .map(([lambda, n, k]) => [Number(lambda.toFixed(3)), n, k])
        .filter(([lambda]) => lambda >= lmin && lambda <= lmax);
    if (inside.length < 2) throw new Error(`${mat.dataPath} has fewer than two points in ${lmin}-${lmax} nm`);
    const kept = [inside[0]];
    for (const row of inside.slice(1)) {
        if (row[0] - kept[kept.length - 1][0] >= step) kept.push(row);
    }
    const last = inside[inside.length - 1];
    if (kept[kept.length - 1][0] !== last[0]) kept.push(last);
    return kept.map(([lambda, n, k]) => [lambda, Number(n.toPrecision(6)), k]);
}

function renderMaterial({ id, page }, description, rows) {
    const lines = [];
    for (let i = 0; i < rows.length; i += 4) {
        lines.push('            ' + rows.slice(i, i + 4).map(row => `[${row.join(', ')}]`).join(', ') + ',');
    }
    return [
        `    ${id}: {`,
        `        page: ${JSON.stringify(page)},`,
        `        description: ${JSON.stringify(description)},`,
        '        rows: [',
        ...lines,
        '        ],',
        '    },',
    ].join('\n');
}

const dataDir = riiDataDir();
console.log(`refractiveindex.info data: ${dataDir}`);
const generated = MATERIALS.map(spec => {
    const mat = parseMaterialDoc(yaml.load(fs.readFileSync(path.join(dataDir, spec.page), 'utf8')), spec.page);
    const rows = thinTable(mat, spec);
    console.log(`  ${spec.id.padEnd(6)} ${rows.length} rows, ${rows[0][0]}-${rows[rows.length - 1][0]} nm`);
    return { spec, mat, rows };
});

const header = `/**
 * n,k tables of the built-in materials taken from the refractiveindex.info
 * database (CC0, https://github.com/polyanskiy/refractiveindex.info-database),
 * with each page's comment and reference. Rows are [wavelength nm, n, k].
 *
 * Generated by tools/gen_builtin_materials.mjs. Do not edit by hand: change
 * the generator's table and rerun it. materialDatabase.js gives each material
 * its name, color and group.
 */
export const BUILTIN_RII_DATA = {
`;
const blocks = generated.map(({ spec, mat, rows }) => renderMaterial(spec, riiMaterialComment(mat), rows));
const source = header + blocks.join('\n') + '\n};\n';

const { BUILTIN_RII_DATA: readBack } =
    await import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
for (const { spec, mat, rows } of generated) {
    const entry = readBack[spec.id];
    if (entry?.description !== riiMaterialComment(mat)) {
        throw new Error(`${spec.id}: the description read back is not the page's comment and reference; nothing written`);
    }
    if (JSON.stringify(entry.rows) !== JSON.stringify(rows)) {
        throw new Error(`${spec.id}: the rows read back differ from the page; nothing written`);
    }
}

fs.writeFileSync(OUT, source, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)} (${MATERIALS.length} materials)`);
