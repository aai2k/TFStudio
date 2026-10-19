/**
 * The headless API (src/api/) against the design-file corpus, in plain Node
 * with no browser globals. Every fixture whose variant needs no catalog of the
 * user's (tests/fixtures/designs/) opens with openDesign and shows the
 * spectrum, the merit and the n,k the app shows for it, as
 * design_file_corpus.golden.json records them; saved and opened again it shows
 * the same; and the merit rows the app wrote into it go back through setMerit
 * and score the same.
 *
 * Run: node tests/api_corpus.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { movedValues } from './_designCorpusGolden.mjs';
import { golden, manifest, fixtureFile, ownName, apiValues, expectedValues } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };

const started = await api.init();
ok('init loads the WASM kernel', started.wasm === true);

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-'));

// ── The corpus ───────────────────────────────────────────────────────────
const corpus = { results: {}, golden: {}, reopened: [], blocked: [], names: [] };
for (const [name, fixture] of Object.entries(manifest.fixtures)) {
    for (const [label, variant] of Object.entries(fixture.variants)) {
        if (variant.catalogs || variant.seed) continue;
        const key = `${name}/${label}`;
        const file = fixtureFile(name);
        const design = api.openDesign(file);
        const expected = golden[key];
        corpus.golden[key] = expectedValues(expected);
        corpus.results[key] = apiValues(design, fixture, expected);
        if (expected.spectrum.blocked) {
            const refused = throws(() => api.spectrum(design, { from: 400, to: 800 }), new RegExp(expected.spectrum.blocked.join('|')));
            if (!refused) corpus.blocked.push(key);
            continue;
        }
        if (!/\0/.test(fs.readFileSync(file, 'latin1')) && design.name !== ownName(file)) corpus.names.push(`${key}: ${design.name}`);
        const saved = path.join(TEMP, `${name}-${label}.tfs`);
        api.saveDesign(design, saved);
        const again = apiValues(api.openDesign(saved), fixture, expected);
        if (JSON.stringify(again) !== JSON.stringify(corpus.results[key])) corpus.reopened.push(key);
    }
}
const moved = movedValues(corpus.golden, corpus.results);
for (const m of moved.slice(0, 10)) console.error(`  ${m.key}${m.at}: ${JSON.stringify(m.before)} -> ${JSON.stringify(m.after)}`);
const cases = Object.keys(corpus.results).length;
console.log(`=== Headless API ===\n  ${cases} corpus cases`);
ok('every corpus case shows the app\'s numbers', cases >= 20 && moved.length === 0, `${moved.length} values moved`);
ok('a design whose materials resolve to nothing gets no spectrum', corpus.blocked.length === 0, corpus.blocked.join(', '));
ok('a design keeps the name it holds', corpus.names.length === 0, corpus.names.join('; '));
ok('saved and opened again it shows the same', corpus.reopened.length === 0, corpus.reopened.join(', '));
{
    const unnamed = path.join(TEMP, 'Unnamed AR.tfs');
    fs.writeFileSync(unnamed, JSON.stringify({ name: '  ', substrate: { material: 'BK7', thickness: 1 }, frontLayers: [] }));
    ok('a design without a name is named after its file', api.openDesign(unnamed).name === 'Unnamed AR');
}

{
    // Every merit row this build's app wrote into a corpus design goes back
    // through setMerit and scores the same. A newer release's rows carry fields
    // this build does not know, which setMerit refuses like a misspelling.
    const mismatched = [];
    for (const [name, fixture] of Object.entries(manifest.fixtures)) {
        if (name === 'newer-release-unknown-fields' || !Object.values(fixture.variants).some(v => !v.catalogs && !v.seed)) continue;
        const design = api.openDesign(fixtureFile(name));
        if (!(design.meritOperands || []).length || golden[`${name}/${Object.keys(fixture.variants)[0]}`]?.spectrum?.blocked) continue;
        try {
            const again = api.merit(api.setMerit(design, design.meritOperands));
            if (again.total !== api.merit(design).total) mismatched.push(`${name}: ${again.total} vs ${api.merit(design).total}`);
        } catch (err) { mismatched.push(`${name}: ${err.message}`); }
    }
    ok('the app\'s own merit rows go back through setMerit unchanged', mismatched.length === 0, mismatched.join('; '));
}

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
