/**
 * Writes the old-design fixtures in tests/fixtures/designs/ with the code of the
 * release that wrote each one.
 *
 *   node tools/design-corpus/generate.mjs <fixture>[,<fixture>...] [--out <dir>]
 *
 * Each fixture names its writer release in tests/fixtures/designs/manifest.json.
 * The release is extracted from its tag (see tagRuntime.mjs); the design is
 * built with that release's own renderer modules (builders.mjs) and written by
 * its own save-design handler, and any catalog a variant needs is written by
 * its own catalog code. The output lands in <out>/<fixture>/: the .tfs under
 * the file name the release gave it, and catalogs/<variant>/ holding the
 * Materials folder of that variant.
 *
 * Fixtures are written once and committed. A fixture folder that already
 * exists is never written over: the generator exists to show where a fixture
 * came from and to add new ones. To check that a committed fixture is what its
 * release writes, generate it again into another folder with --out and compare.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    REPO, extractTag, fixClockAndRandom, installRendererGlobals, restoreClockAndRandom, tagHasModule, tagMain, tagModule,
} from './tagRuntime.mjs';
import { BUILDERS } from './builders.mjs';

const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'designs');
const MANIFEST = path.join(FIXTURES, 'manifest.json');
const SELF = fileURLToPath(import.meta.url);

function readManifest() {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function argValue(args, flag) {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : null;
}

// A seed for the stand-in random source, from the fixture name, so two
// fixtures written by one release do not share ids.
function seedOf(name) {
    let hash = 2166136261;
    for (const ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    return hash;
}

function copyTree(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory()) copyTree(src, dst);
        else fs.copyFileSync(src, dst);
    }
}

/** Build one fixture into `outDir/<name>`, in this process. */
async function writeOne(name, outDir) {
    const entry = readManifest().fixtures[name];
    if (!entry) throw new Error(`${name} is not in ${path.relative(REPO, MANIFEST)}`);
    const build = BUILDERS[name];
    if (!build) throw new Error(`no builder for ${name} in builders.mjs`);
    const target = path.join(outDir, name);
    if (fs.existsSync(target)) throw new Error(`${target} exists; a fixture is never written over`);

    // A file another program writes is still built from a release's design
    // object, that of the release the manifest names as its tag.
    const tag = entry.writer === 'script' ? entry.tag : entry.writer;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-corpus-gen-'));
    try {
        const out = path.join(scratch, 'out');
        fs.mkdirSync(out);
        let tagDir = extractTag(tag);
        let dataDir = null;
        let main = null;
        // A data folder of the release's own. Called again, it starts another
        // installation: the same release on a second computer.
        const install = (label = 'data', release = tag) => {
            tagDir = extractTag(release);
            dataDir = path.join(scratch, label);
            main = tagMain(tagDir, dataDir);
            installRendererGlobals(main.electronAPI);
            return main;
        };
        fixClockAndRandom(seedOf(name));
        install();
        const kit = {
            tag,
            get tagDir() { return tagDir; },
            mod: rel => tagModule(tagDir, rel),
            has: rel => tagHasModule(tagDir, rel),
            get main() { return main; },
            get materialsDir() { return main.ctx.materialsDir; },
            install,
            // The same installation upgraded to (or started with) `release`:
            // its data folder stays, the code reading it is that release's.
            release(release) {
                tagDir = extractTag(release);
                main = tagMain(tagDir, dataDir);
                globalThis.electronAPI = main.electronAPI;
            },
            // The design files the release wrote into project folder 'Corpus',
            // kept as the fixture's design file.
            collect() {
                const dir = path.join(main.ctx.projectsDir, 'Corpus');
                for (const file of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, file), path.join(out, file));
            },
            // The release's save-design handler, given the object as is.
            async save(design) {
                const result = await main.call('save-design', 'Corpus', design);
                if (!result?.success) throw new Error(`save-design failed: ${JSON.stringify(result)}`);
                kit.collect();
                return result;
            },
            // The Materials folder as it stands now, kept as catalog variant `variant`.
            snapshotCatalogs(variant, relPaths = null) {
                const dst = path.join(out, 'catalogs', variant);
                fs.mkdirSync(dst, { recursive: true });
                const materials = main.ctx.materialsDir;
                const files = relPaths ?? listFiles(materials);
                for (const rel of files) {
                    fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
                    fs.copyFileSync(path.join(materials, rel), path.join(dst, rel));
                }
            },
            // A file written by a short script rather than by a release.
            writeRaw(fileName, bytes) {
                fs.writeFileSync(path.join(out, fileName), bytes);
            },
        };
        await build(kit);
        restoreClockAndRandom();
        copyTree(out, target);
        console.log(`wrote ${path.relative(REPO, target) || target} (${entry.writer === 'script' ? `script, ${tag}` : tag})`);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

// The files under Materials, less the refractiveindex.info mirror (a link to
// the whole database) and the seed's version marker.
function listFiles(root, rel = '') {
    const out = [];
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const next = rel ? path.join(rel, entry.name) : entry.name;
        if (next === 'refractiveindex-db' || next === '.seed-version') continue;
        if (entry.isDirectory()) out.push(...listFiles(root, next));
        else out.push(next);
    }
    return out;
}

async function main() {
    const args = process.argv.slice(2);
    const outDir = path.resolve(argValue(args, '--out') || FIXTURES);
    const one = argValue(args, '--one');
    if (one) {
        await writeOne(one, outDir);
        return;
    }
    const names = (args.find(a => !a.startsWith('--') && a !== argValue(args, '--out')) || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length) {
        console.error('Name the fixtures to write: node tools/design-corpus/generate.mjs <fixture>[,<fixture>...] [--out <dir>]');
        process.exit(2);
    }
    // Each fixture in a process of its own, so no release's module state
    // (a catalog registry, an id counter) carries from one fixture to the next.
    let failed = 0;
    for (const name of names) {
        const run = spawnSync(process.execPath, [SELF, '--one', name, '--out', outDir], { stdio: 'inherit' });
        if (run.status !== 0) failed++;
    }
    process.exit(failed ? 1 : 0);
}

main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});
