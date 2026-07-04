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

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const MATERIALS = path.join(ROOT, 'materials');
const SEED = path.join(ROOT, 'build', 'seed');
// RefractiveIndex.info local clone. Prefers TFS_RII_SOURCE (set by
// build-release.ps1 when refractiveindex-db/database is checked into the
// repo), falling back to the old external CLAUDE.md location.
const RII_SRC = process.env.TFS_RII_SOURCE
    || path.resolve(ROOT, '..', '..', 'reference', 'refractiveindex-db', 'database');

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

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

function genRii(buildDate) {
    if (!fs.existsSync(RII_SRC)) {
        console.log(`  ! RII source not found at ${RII_SRC} — offline RII mirror NOT bundled.`);
        return;
    }
    const outDir = path.join(SEED, 'rii-db');
    rmrf(outDir); mkdirp(outDir);
    fs.copyFileSync(path.join(RII_SRC, 'catalog-nk.yml'), path.join(outDir, 'catalog-nk.yml'));
    const count = copyTree(path.join(RII_SRC, 'data'), path.join(outDir, 'data'));
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
genRii(buildDate);
console.log('Done.');
