/**
 * gen_material_seed.mjs — produce the bundled material seed shipped with TFStudio.
 *
 * Output (build/seed/), wired into the installer via electron-builder
 * extraResources { from: "build/seed", to: "materials-seed" }, and copied into
 * Documents\TFStudio\Materials on first run by seedBundledMaterials() in main.js:
 *
 *   build/seed/
 *     agf/schott2025.AGF                         ← Schott glass catalog (auto-scanned)
 *     rii-db/catalog-nk.yml                       ← RefractiveIndex.info offline mirror
 *     rii-db/data/**.yml
 *     rii-db/manifest.json                        ← { lastUpdated, materialCount, source }
 *
 * The coating/substrate catalogs (build/seed/library/*.catalog.json) are native
 * JSON committed to the repo — they are NOT produced by this script. The committed
 * build/seed/ is the shipped material data; when a source is absent each step here
 * is a no-op that PRESERVES the committed seed rather than wiping it, so
 * `npm run build` works on a fresh clone. Run by the "seed" npm script.
 *
 * Usage: node tools/gen_material_seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const MATERIALS = path.join(ROOT, 'materials');
const SEED = path.join(ROOT, 'build', 'seed');

// RefractiveIndex.info local clone, resolved in priority order:
//   1. TFS_RII_SOURCE            — explicit override (set by build-release.ps1)
//   2. refractiveindex-db/database — in-repo git submodule (default)
//   3. ../../reference/...       — legacy external CLAUDE.md location (last resort)
//
// The submodule is declared in .gitmodules. A plain `git clone` (without
// --recursive) leaves refractiveindex-db/ empty, so ensureSubmodule() checks it
// out on demand. If no source is reachable, genRii() is a no-op that keeps the
// committed build/seed/, so `npm run build` still succeeds.
const RII_SUBMODULE = path.join(ROOT, 'refractiveindex-db', 'database');
const RII_LEGACY = path.resolve(ROOT, '..', '..', 'reference', 'refractiveindex-db', 'database');

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function dirHasFiles(p) {
    try { return fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0; }
    catch { return false; }
}

// Check out the refractiveindex-db submodule if it is registered but empty
// (fresh clone without --recursive). No-op outside a git working copy — e.g. a
// source tarball with no .git — where the committed seed is used instead.
function ensureSubmodule() {
    if (dirHasFiles(RII_SUBMODULE)) return;                       // already present
    if (!fs.existsSync(path.join(ROOT, '.git'))) return;          // not a git checkout
    if (!fs.existsSync(path.join(ROOT, '.gitmodules'))) return;   // nothing to init
    try {
        console.log('  refractiveindex-db submodule not checked out — running git submodule update --init …');
        execSync('git submodule update --init --recursive refractiveindex-db', {
            cwd: ROOT, stdio: 'inherit',
        });
    } catch {
        console.log('  ! git submodule update failed (git installed? network reachable?) — keeping committed seed.');
    }
}

function resolveRiiSrc() {
    if (process.env.TFS_RII_SOURCE) return process.env.TFS_RII_SOURCE;
    ensureSubmodule();
    if (dirHasFiles(RII_SUBMODULE)) return RII_SUBMODULE;
    return RII_LEGACY;
}

// ── 1. Schott AGF catalog (auto-scanned from agf/ at runtime) ────────────────────
function genAgf() {
    const src = path.join(MATERIALS, 'schott2025.AGF');
    if (!fs.existsSync(src)) { console.log('  ! schott2025.AGF not found, skipping'); return; }
    const dst = path.join(SEED, 'agf');
    mkdirp(dst);
    fs.copyFileSync(src, path.join(dst, 'schott2025.AGF'));
    console.log('  schott2025.AGF copied');
}

// ── 2. RefractiveIndex.info offline mirror ──────────────────────────────────────
function copyTree(src, dst) {
    mkdirp(dst);
    let n = 0;
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory()) n += copyTree(s, d);
        else if (e.isFile()) { fs.copyFileSync(s, d); if (e.name.endsWith('.yml')) n++; }
    }
    return n;
}

function genRii(buildDate, riiSrc) {
    if (!dirHasFiles(riiSrc)) {
        console.log(`  ! RII source not found at ${riiSrc} — offline RII mirror NOT bundled (committed seed kept).`);
        return;
    }
    const outDir = path.join(SEED, 'rii-db');
    rmrf(outDir); mkdirp(outDir);
    fs.copyFileSync(path.join(riiSrc, 'catalog-nk.yml'), path.join(outDir, 'catalog-nk.yml'));
    const count = copyTree(path.join(riiSrc, 'data'), path.join(outDir, 'data'));
    const manifest = { lastUpdated: buildDate, materialCount: count, source: 'bundled' };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`  RII mirror: ${count} material files, dated ${buildDate}`);
}

// ── Main ────────────────────────────────────────────────────────────────────────
// Date stamp passed via argv (CI/build supplies it) or env; no Date.now() so the
// generator stays deterministic when invoked from a workflow.
const buildDate = process.argv[2] || process.env.SEED_DATE || new Date().toISOString().slice(0, 10);

console.log('Generating material seed → build/seed/');
mkdirp(SEED);
genAgf();
genRii(buildDate, resolveRiiSrc());
console.log('Done.');
