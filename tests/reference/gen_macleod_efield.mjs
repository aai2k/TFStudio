/**
 * Freeze an Essential Macleod electric-field export into macleod_efield.json.
 *
 * Essential Macleod exports the field as three columns, in volts per metre for
 * an incident irradiance of 1 W/m²: the component normal to the layers, the
 * component parallel to them, and their resultant. That is the only oracle
 * available for the two p-polarized components separately, so the fixture
 * carries all three.
 *
 * Indices are resolved here and written into the fixture alongside the
 * thicknesses, so the committed test compares math against math and cannot be
 * knocked over by a change to the material database.
 *
 * Run (maintainer only; needs the validation export, which is not in the repo):
 *   node tests/reference/gen_macleod_efield.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CASE = 'X:/TFStudio Dev/validation/macleod/21 Layer Longwave Pass Filter';
const DESIGN = 'C:/Users/color/Documents/TFStudio/Projects/macleod/21 Layer Longwave Pass Filter.tfs';
const OUT = path.join(HERE, 'macleod_efield.json');

const { resolveDesignMaterial } =
    await import(pathToFileURL(path.join(REPO, 'src/utils/materials/designMaterials.js')).href);

const WAVELENGTHS = [400, 510, 600, 800, 1000];
const ANGLES = [0, 45, 60];
// Depths to keep from each export, as a stride through its rows. The full
// export is 243 rows per case; every ninth keeps the fixture small while still
// crossing high- and low-index layers and passing through nodes and peaks.
const STRIDE = 9;

function readCsv(file) {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const header = lines[0].split(',');
    const cols = Object.fromEntries(header.map(h => [h, []]));
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        for (let c = 0; c < header.length; c++) cols[header[c]].push(Number(parts[c]));
    }
    return cols;
}

const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
const matOf = id => {
    const { material, status } = resolveDesignMaterial(design, id);
    if (status === 'missing') throw new Error(`design cannot resolve material ${id}`);
    return material;
};
const incident = matOf(design.incidentMedium);
const substrate = matOf(design.substrate.material);
const layerDefs = design.frontLayers
    .filter(l => l.material && l.thickness > 0)
    .map(l => ({ material: matOf(l.material), thickness: l.thickness }));

const edges = [0];
for (const l of layerDefs) edges.push(edges[edges.length - 1] + l.thickness);

const cases = [];
for (const lambda of WAVELENGTHS) {
    const layers = layerDefs.map(l => ({ n: l.material.getNK(lambda), d: l.thickness }));
    for (const angle of ANGLES) {
        for (const pol of ['s', 'p']) {
            const file = path.join(CASE, 'exports/electric_field', `efield_${lambda}nm_${angle}deg_${pol}.csv`);
            const em = readCsv(file);
            const points = [];
            for (let i = 0; i < em.Depth_nm.length; i += STRIDE) {
                const z = em.Depth_nm[i];
                // The normal component steps across an interface, so a sample
                // sitting exactly on one has two legitimate values and is no
                // use as a fixture point.
                if (edges.some(edge => Math.abs(edge - z) < 1e-6)) continue;
                points.push({
                    z,
                    normal: em.Normal_Vpm[i],
                    parallel: em.Parallel_Vpm[i],
                    total: em.Total_Vpm[i],
                });
            }
            cases.push({
                lambda, angle, pol,
                n0: incident.getNK(lambda), ns: substrate.getNK(lambda),
                layers, points,
            });
        }
    }
}

fs.writeFileSync(OUT, JSON.stringify({
    source: 'Essential Macleod 11.09.0605, design "21 Layer Longwave Pass Filter"',
    quantity: 'field amplitude in V/m for an incident irradiance of 1 W/m^2',
    depth: 'nm from the incident-medium boundary',
    columns: 'normal to the layers, parallel to them, and their resultant',
    generated: new Date().toISOString(),
    cases,
}, null, 1) + '\n', 'utf8');

console.log(`wrote ${OUT}: ${cases.length} cases, ${cases.reduce((n, c) => n + c.points.length, 0)} points`);
