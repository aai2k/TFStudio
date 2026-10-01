/**
 * Material comments reach the Material Editor whole, and the built-in catalog
 * holds no Custom placeholder.
 *
 * The built-in catalog stopped every refractiveindex.info comment at 100 or 160
 * characters, mid-word, and the RefractiveIndex.info importer stopped the
 * reference at 200. Neither cuts now: a built-in material and an imported copy
 * of the same page carry the page's comment and reference in full, on separate
 * lines.
 *
 * Custom was a constant n = 1.5, k = 0 entry in the built-in catalog. User
 * materials belong in user catalogs, so a design that still names Custom
 * reports it as missing rather than computing with n = 1.5.
 *
 * Run: node tests/material_comments.mjs
 */

import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { parseMaterialDoc } from '../src/utils/materials/riiDatabase/materialParser.js';
import { riiToMaterialEntry } from '../src/utils/materials/riiDatabase/catalogEntry.js';
import { buildBuiltinCatalog } from '../src/utils/materials/catalogManager/builtinCatalog.js';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import { unresolvedMaterials } from '../src/utils/materials/designMaterials.js';
import {
    MATERIALS, MATERIAL_MAP, MATERIAL_GROUPS, SUBSTRATE_MATERIALS, LAYER_MATERIALS,
} from '../src/utils/materials/materialDatabase.js';
import { BUILTIN_RII_DATA } from '../src/utils/materials/builtinRiiData.js';

// ── An import keeps a reference longer than 200 characters ───────────────────
//
// The In2O3-SnO2 page by König as the database writes it, with its table cut
// to three rows: the reference runs over four lines and carries HTML.

const KONIG_PAGE = `REFERENCES: |
    T. A. F. König, P. A. Ledin, J. Kerszulis, M. A. Mahmoud, M. A. El-Sayed, J. R. Reynolds, V. V. Tsukruk.
    Electrically tunable plasmonic behavior of nanocube-polymer nanomaterials induced by a redox-active electrochromic polymer.
    <a href="https://doi.org/10.1021/nn501601e"><i>ACS Nano</i> <b>8</b>, 6182-6192 (2014)</a>
    (Numerical data kindly provided by Tobias König)
COMMENTS: |
    72 nm ITO film on BK7 glass substrate. Purchased from Delta Technology (CG-60IN-CUV), 15–25 ohms.
DATA:
  - type: tabulated nk
    data: |
        0.30091 2.33827 0.11276749
        0.50141 1.91217 0.0039348
        0.99844 1.3089 0.01285273
`;

const konig = parseMaterialDoc(yaml.load(KONIG_PAGE), 'other/mixed crystals/In2O3-SnO2/nk/Konig.yml');
assert.ok(konig.references.length > 200,
    `the fixture's reference is longer than the old 200-character cut (${konig.references.length})`);

const imported = riiToMaterialEntry(konig, 'Konig', 'In2O3-SnO2');
assert.equal(imported.comment, `${konig.comments}\n${konig.references}`,
    'the imported comment is the page comment and the whole reference, one per line');
assert.ok(imported.comment.endsWith('ACS Nano 8, 6182-6192 (2014) (Numerical data kindly provided by Tobias König)'),
    `the reference arrives to its last word: ${imported.comment}`);

const noComment = riiToMaterialEntry({ ...konig, comments: '' }, 'Konig', 'In2O3-SnO2');
assert.equal(noComment.comment, konig.references, 'a page without a comment gives the reference alone');

// ── The built-in catalog shows whole comments ────────────────────────────────

const builtin = buildBuiltinCatalog().materials;

for (const [id, { description }] of Object.entries(BUILTIN_RII_DATA)) {
    assert.equal(builtin[id].comment, description, `${id}: the catalog shows the generated description`);
}

// The four that stopped mid-word before, each checked against its last words.
const lastWords = {
    ZnS: 'Contractor Report CRDEC-CR-88009 (1987)',
    ZnSe: 'Contractor Report CRDEC-CR-88009 (1987)',
    Au: 'Optical constants of the noble metals. Phys. Rev. B 6, 4370-4379 (1972)',
    ITO: konig.references,
};
for (const [id, end] of Object.entries(lastWords)) {
    assert.ok(builtin[id].comment.endsWith(end), `${id} shows its whole reference: ${builtin[id].comment}`);
}

for (const material of MATERIALS) {
    assert.ok(!material.description.includes('—'), `${material.id}: no em dash in the description`);
}

// ── Custom is not a built-in material ────────────────────────────────────────

assert.equal(Object.keys(builtin).length, 5 + Object.keys(BUILTIN_RII_DATA).length,
    'Air and the four Sellmeier materials, then one material per generated table');
assert.equal(MATERIAL_MAP.Custom, undefined, 'Custom is not in the built-in library');
for (const [name, list] of Object.entries({ MATERIAL_GROUPS, SUBSTRATE_MATERIALS, LAYER_MATERIALS })) {
    assert.ok(!list.includes('Custom'), `${name} does not name Custom`);
}

initCatalogs({});
const oldDesign = {
    incidentMedium: 'Air',
    substrate: { material: 'BK7' },
    frontLayers: [{ material: 'Custom' }, { material: 'builtin:Custom' }, { material: 'builtin:TiO2' }],
    backLayers: [],
};
assert.deepEqual(unresolvedMaterials(oldDesign), ['Custom', 'builtin:Custom'],
    'a design that names Custom reports it as missing, like any material this machine lacks');

console.log('material_comments: passed');
