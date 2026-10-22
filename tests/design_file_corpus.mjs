/**
 * Design files older releases wrote keep loading and computing the same.
 *
 * Every fixture in tests/fixtures/designs/ (see manifest.json there) was
 * written by a released build's own code. Each is loaded under each of its
 * catalog variants the way the app starts: the real load-folders and catalog
 * handlers over a temporary data folder, then the renderer's own steps
 * (parseFoldersResult, the catalog startup, mergeSessionOverDisk,
 * followedDesigns, withHerpinRecords, resolveEvalMode). From there it records
 * (see _designCorpusApp.mjs):
 *
 *   - the load result: name, id, evaluation mode, layer and operand counts;
 *   - each material: status, conflict flag, name, and n,k at the fixture's
 *     wavelengths, one of them between table nodes;
 *   - R, T and A, unpolarized and for s and p, at the fixture's wavelengths
 *     and angles, through the Optical Evaluation's own computation;
 *   - each merit operand's value and the merit, through the code the Merit
 *     Function Editor displays them with;
 *   - after a save with today's code and a restart, the same again.
 *
 * Everything is compared with design_file_corpus.golden.json: the spectrum
 * to 1e-9 absolute, other numbers to 1e-9 relative, statuses and names exactly.
 * Values are stored to 12 significant digits, so a diff of the golden file
 * shows the numbers that moved and nothing else. A fixture may also list
 * `keeps`, paths into the file that a save must carry over unchanged: the
 * fields a newer release wrote that this one does not know.
 *
 *   node tests/design_file_corpus.mjs
 *   node tests/design_file_corpus.mjs --update <fixture>[,<fixture>...]
 *       after a deliberate change: rewrites the named fixtures' entries,
 *       printing every number that moved, and writes nothing if a number of
 *       any other fixture moved
 *   node tests/design_file_corpus.mjs --init
 *       writes the first golden file; refused when one exists
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { designValues, embedDesignMaterials, installation, paths } from './_designCorpusApp.mjs';
import { fixtureOf, movedValues, show } from './_designCorpusGolden.mjs';
import { initWasmForTest, tmmWasmActive, TMMCORE_WASM_PATH } from './_wasmInit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const FIXTURES = path.join(HERE, 'fixtures', 'designs');
const GOLDEN = path.join(HERE, 'design_file_corpus.golden.json');

await initWasmForTest();

// The version of the tmmcore package the kernel came from.
function packageVersion(file) {
    let dir = path.dirname(file);
    while (!fs.existsSync(path.join(dir, 'package.json')) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
}

// ── Arguments ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const INIT = args.includes('--init');
const updateAt = args.indexOf('--update');
const UPDATE = updateAt >= 0;
const updateNames = UPDATE ? (args[updateAt + 1] || '').split(',').map(s => s.trim()).filter(s => s && !s.startsWith('--')) : [];
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));

function refuse(message) {
    console.error(message);
    process.exit(2);
}
if (UPDATE && updateNames.length === 0) refuse('--update needs the fixtures to rewrite: --update <fixture>[,<fixture>...]');
if (INIT && fs.existsSync(GOLDEN)) {
    refuse(`${path.relative(REPO, GOLDEN)} exists; --init writes only the first golden file. Use --update <fixture>.`);
}
const unknown = updateNames.filter(name => !manifest.fixtures[name]);
if (unknown.length) refuse(`not in the manifest: ${unknown.join(', ')}`);

// ── Data folders ───────────────────────────────────────────────────────────
function copyTree(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory()) copyTree(src, dst);
        else fs.copyFileSync(src, dst);
    }
}

// The catalogs a first start seeds Materials with, the files main/seed.js
// copies from build/seed: the bundled Schott AGF and the library catalogs, as
// the repository holds them (a local `npm run seed` may leave more there). The
// offline refractiveindex.info mirror the seed also unpacks holds no catalog.
const SEEDED = ['agf/schott2025.AGF', 'library/library_coatings.catalog.json', 'library/library_substrates.catalog.json'];
function seedBundled(materialsDir) {
    for (const rel of SEEDED) fs.copyFileSync(path.join(REPO, 'build', 'seed', rel), path.join(materialsDir, rel));
}

// The fixture's design file in project folder 'Corpus' under the name its
// writer gave it, and the variant's Materials folder.
function placeFixture(app, name, variant) {
    const fixtureDir = path.join(FIXTURES, name);
    const designFiles = fs.readdirSync(fixtureDir).filter(file => file.endsWith('.tfs'));
    assert.equal(designFiles.length, 1, `${name}: one design file per fixture`);
    const folder = path.join(app.projectsDir, 'Corpus');
    fs.mkdirSync(folder);
    const file = path.join(folder, designFiles[0]);
    fs.copyFileSync(path.join(fixtureDir, designFiles[0]), file);
    if (variant.catalogs) copyTree(path.join(fixtureDir, 'catalogs', variant.catalogs), app.materialsDir);
    if (variant.seed) seedBundled(app.materialsDir);
    return { folder, original: JSON.parse(paths.decodeText(fs.readFileSync(file))) };
}

function getPath(object, dotted) {
    return dotted.split('.').reduce((at, key) => (at == null ? undefined : at[key]), object);
}

// Save as File > Save does (useDesignActions.js writeToDisk, then
// designFiles.js writeDesignFile). Returns what the written file holds.
async function save(app, first, stored, folder) {
    const item = first.tree.folders.find(f => f.id === 'Corpus').items[0];
    const snapshot = embedDesignMaterials(JSON.parse(JSON.stringify(stored)));
    const result = await app.call('save-design', 'Corpus', structuredClone(embedDesignMaterials(snapshot)), item.mtime);
    const file = path.join(folder, `${paths.safeName(stored.name)}.tfs`);
    const written = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    return {
        written,
        summary: {
            success: result.success === true,
            ...(result.success ? {} : { error: result.error ?? null }),
            tfs_version: written?.tfs_version ?? null,
            keys: written ? Object.keys(written) : [],
            materials: written?.materials ? Object.keys(written.materials) : [],
        },
    };
}

// ── One fixture under one catalog variant ──────────────────────────────────
async function runCase(name, fixture, variant) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-corpus-'));
    try {
        const app = installation(root);
        const { folder, original } = placeFixture(app, name, variant);
        const fileId = typeof original.id === 'string' ? original.id : null;

        const first = await app.start();
        const ids = Object.keys(first.store);
        if (ids.length !== 1) {
            return { load: { designs: ids.length, unread: first.tree.unreadFiles ?? null, error: first.tree.error ?? null } };
        }
        const stored = first.store[ids[0]];
        const values = designValues(stored, fileId, fixture);

        const { written, summary } = await save(app, first, stored, folder);
        values.saved = summary;
        for (const dotted of fixture.keeps || []) {
            assert.notEqual(getPath(original, dotted), undefined, `${name}: the fixture holds ${dotted}`);
            assert.deepEqual(getPath(written, dotted), getPath(original, dotted),
                `${name}/${variant.label}: a save keeps ${dotted} as the file had it`);
        }

        const second = await app.start();
        const again = Object.values(second.store)[0];
        const reloaded = again ? designValues(again, fileId, fixture) : { design: null };
        const loaded = { design: values.design, materials: values.materials, spectrum: values.spectrum, merit: values.merit };
        values.reload = JSON.stringify(reloaded) === JSON.stringify(loaded) ? 'same' : reloaded;
        return values;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

// ── Run ────────────────────────────────────────────────────────────────────
const started = Date.now();
const results = {};
for (const [name, fixture] of Object.entries(manifest.fixtures)) {
    for (const [label, variant] of Object.entries(fixture.variants)) {
        results[`${name}/${label}`] = await runCase(name, fixture, { ...variant, label });
    }
}
const meta = { wasm: tmmWasmActive(), tmmcore: packageVersion(TMMCORE_WASM_PATH), digits: 12 };
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

function writeGolden(cases) {
    const sorted = Object.fromEntries(Object.keys(cases).sort().map(key => [key, cases[key]]));
    fs.writeFileSync(GOLDEN, `${JSON.stringify({ _meta: meta, cases: sorted }, null, 2)}\n`);
}

if (INIT) {
    writeGolden(results);
    console.log(`Wrote ${path.relative(REPO, GOLDEN)}: ${Object.keys(results).length} cases (${elapsed} s).`);
    process.exit(0);
}

assert.ok(fs.existsSync(GOLDEN), `${path.relative(REPO, GOLDEN)} is missing; write the first one with --init`);
const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
if (golden._meta?.wasm !== meta.wasm || golden._meta?.tmmcore !== meta.tmmcore) {
    console.log(`note: golden file made with WASM ${golden._meta?.wasm}, tmmcore ${golden._meta?.tmmcore}; this run WASM ${meta.wasm}, tmmcore ${meta.tmmcore}`);
}
const moved = movedValues(golden.cases, results);
for (const m of moved) console.log(`${m.key}${m.at}: ${show(m.before)} -> ${show(m.after)}`);

if (UPDATE) {
    const named = new Set(updateNames);
    const outside = moved.filter(m => !named.has(fixtureOf(m.key)));
    if (outside.length) {
        console.error(`\n${outside.length} value(s) moved outside ${updateNames.join(', ')}; nothing written.`);
        process.exit(1);
    }
    const cases = Object.fromEntries(Object.entries(golden.cases).filter(([key]) => !named.has(fixtureOf(key))));
    for (const [key, value] of Object.entries(results)) if (named.has(fixtureOf(key))) cases[key] = value;
    writeGolden(cases);
    console.log(`\nRewrote ${updateNames.join(', ')} in ${path.relative(REPO, GOLDEN)}: ${moved.length} value(s) moved (${elapsed} s).`);
    process.exit(0);
}

assert.equal(moved.length, 0, `${moved.length} value(s) differ from ${path.relative(REPO, GOLDEN)}; see above`);
console.log(`Design file corpus passed: ${Object.keys(results).length} cases, WASM ${meta.wasm} (${elapsed} s).`);
