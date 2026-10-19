/**
 * The headless API with a data folder. init({ dataDir }) reads the user's
 * catalogs the way the app reads them at startup, so a design that names a
 * material of the user's own catalog and carries no copy of it opens and shows
 * the spectrum and n,k the app shows for it (design_file_corpus.golden.json,
 * user-catalog-no-copy/catalog-present). A folder without Materials is refused,
 * and init can then be tried again.
 *
 * Run: node tests/api_user_catalogs.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { movedValues } from './_designCorpusGolden.mjs';

const api = await import('../src/api/index.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'designs', 'user-catalog-no-copy');
const CASE = 'user-catalog-no-copy/catalog-present';
const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'design_file_corpus.golden.json'), 'utf8')).cases[CASE];
const { spectrum: [from, to, step], angles, nk } = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'designs', 'manifest.json'), 'utf8'))
    .fixtures['user-catalog-no-copy'];

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

// A data folder as a user's install holds it: Materials with the catalog
// folders, and the fixture's user catalog in its place.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-data-'));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-empty-'));
const materialsDir = path.join(root, 'Materials');
for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) fs.mkdirSync(path.join(materialsDir, sub), { recursive: true });
fs.copyFileSync(path.join(FIXTURE, 'catalogs', 'catalog-present', 'user', 'user_lab.catalog.json'), path.join(materialsDir, 'user', 'user_lab.catalog.json'));

let refused = false;
try { await api.init({ dataDir: empty }); } catch (err) { refused = /holds no Materials folder/.test(err.message); }
ok('a data folder without Materials is refused', refused);
const started = await api.init({ dataDir: root });
ok('init can be tried again with another folder', started.wasm === true && started.dataDir === root && started.unreadable.length === 0);
ok('the user\'s catalog materials are found', api.findMaterials('user_lab').some(m => m.id === 'user_lab:Ta2O5' && m.catalog === 'user_lab'));

const design = api.openDesign(path.join(FIXTURE, 'Lab Ta2O5 mirror.tfs'));
const num = x => (typeof x !== 'number' ? x ?? null : Number.isFinite(x) ? Number(x.toPrecision(12)) : String(x));
const s = api.spectrum(design, { from, to, step, angles });
const shown = {
    spectrum: {
        lambda: s.lambda.map(num),
        angles: Object.fromEntries(Object.entries(s.angles).map(([angle, series]) => [angle,
            Object.fromEntries(Object.entries(series).map(([q, values]) => [q, values.map(num)]))])),
    },
    materials: Object.fromEntries(Object.keys(expected.materials).map(id => [id,
        api.materialNK(id, nk, design).nk.map(({ wavelength, n, k }) => [wavelength, num(n), num(k)])])),
};
const golden = { spectrum: expected.spectrum, materials: Object.fromEntries(Object.entries(expected.materials).map(([id, m]) => [id, m.nk])) };
const moved = movedValues({ [CASE]: golden }, { [CASE]: shown });
for (const m of moved.slice(0, 10)) console.error(`  ${m.at}: ${JSON.stringify(m.before)} -> ${JSON.stringify(m.after)}`);
ok('a design on the user\'s catalog shows the app\'s spectrum and n,k', moved.length === 0 && s.lambda.length > 0, `${moved.length} values moved`);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
