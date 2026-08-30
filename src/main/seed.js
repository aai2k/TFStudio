// Bundled material seeding — Schott AGF, the bundled coating/substrate
// catalogs, and the RefractiveIndex.info offline mirror. CommonJS.
//
// `seedBundledMaterials(materialsDir, { isPackaged, srcDir })` is called once at
// startup; `srcDir` is main.js's __dirname (the dev-tree seed root anchor).
const fs = require('fs');
const path = require('path');
const { log } = require('./logger');
const { readJsonSafe } = require('./paths');
const { unzipEntries } = require('./zip');

// Bump to force a re-copy of the bundled AGF / coating-substrate catalogs on next
// launch. (The RII mirror is re-seeded only when the bundled snapshot is newer
// than the local one, so a user's downloaded update is never clobbered by a bump.)
// v3: bundled coating/substrate catalogs live under the 'library' source folder.
const SEED_VERSION = '3';

// Bundled material seed (Schott AGF, the coating/substrate catalogs, and the
// RefractiveIndex.info offline mirror). Packaged via electron-builder extraResources;
// in dev it is the build/seed output of `npm run seed`. See tools/gen_material_seed.mjs.
function resolveSeedDir(isPackaged, srcDir) {
  return isPackaged
    ? path.join(process.resourcesPath, 'materials-seed')
    : path.resolve(srcDir, '..', 'build', 'seed');
}

// Remove bundled-catalog files in `to` that share a seed catalog's id but not
// its current filename — leftovers from a seed file being renamed upstream.
// User-imported catalogs (ids not present in the current seed) are untouched.
function pruneRenamedSeedCatalogs(from, to, seedFiles, target) {
  const seedIds = new Set(seedFiles.map(f => readJsonSafe(path.join(from, f))?.id).filter(Boolean));
  for (const f of fs.readdirSync(to)) {
    if (!f.endsWith('.catalog.json')) continue;
    const existingId = readJsonSafe(path.join(to, f))?.id;
    if (existingId && seedIds.has(existingId) && !seedFiles.includes(f)) {
      try { fs.unlinkSync(path.join(to, f)); log(`Removed stale seed catalog ${target}/${f}`); } catch (_) {}
    }
  }
}

// Copy each seed file into `to`. When `overwrite` is set (AGF on a version
// bump), existing files are replaced; otherwise a file is copied only if
// missing, so materials a user edited/imported into a bundled catalog survive.
function copySeedFiles(from, to, seedFiles, target, overwrite) {
  for (const f of seedFiles) {
    const dst = path.join(to, f);
    if (overwrite || !fs.existsSync(dst)) {
      try { fs.copyFileSync(path.join(from, f), dst); log(`Seeded ${target}/${f}`); }
      catch (err) { log(`Seed copy failed ${target}/${f}: ${err.message}`); }
    }
  }
}

// Copy one bundled catalog source ('agf' or 'library') into materialsDir.
function seedCatalogSource(seedDir, materialsDir, sub, target, fresh) {
  const from = path.join(seedDir, sub);
  if (!fs.existsSync(from)) return;
  const to = path.join(materialsDir, target);
  fs.mkdirSync(to, { recursive: true });
  const seedFiles = fs.readdirSync(from);
  // On a version bump, remove any stale bundled-catalog files left from an
  // earlier seed under a different filename (matched by catalog id), so a
  // renamed catalog never appears twice. User-imported catalogs (other ids)
  // are preserved.
  if (fresh && target === 'library') pruneRenamedSeedCatalogs(from, to, seedFiles, target);
  // AGF refreshes on a version bump; the bundled catalogs are copied only when
  // missing so materials a user imported into a bundled catalog survive bumps.
  const overwriteOnBump = target !== 'library';
  copySeedFiles(from, to, seedFiles, target, fresh && overwriteOnBump);
}

/**
 * Populate Documents\TFStudio\Materials from the bundled seed on first run (or
 * after a SEED_VERSION bump). Copies the Schott AGF and the coating/substrate
 * catalogs, and the RefractiveIndex.info offline mirror. Existing user files are
 * preserved; the RII mirror is only refreshed when the bundled snapshot is newer.
 */
function seedBundledMaterials(materialsDir, { isPackaged, srcDir }) {
  const seedDir = resolveSeedDir(isPackaged, srcDir);
  if (!fs.existsSync(seedDir)) {
    log(`Material seed not found at ${seedDir} — skipping seeding.`);
    return;
  }
  const marker = path.join(materialsDir, '.seed-version');
  let seeded = '';
  try { seeded = fs.readFileSync(marker, 'utf-8').trim(); } catch (_) {}
  const fresh = seeded !== SEED_VERSION;

  // AGF + bundled catalogs: copy each seed file if missing, or overwrite on bump.
  for (const [sub, target] of [['agf', 'agf'], ['library', 'library']]) {
    seedCatalogSource(seedDir, materialsDir, sub, target, fresh);
  }

  try { fs.writeFileSync(marker, SEED_VERSION, 'utf-8'); } catch (_) {}

  // RefractiveIndex.info offline mirror (~56 MB / 4000+ files once unpacked).
  // Deferred off the startup path so first launch isn't blocked; it's only needed
  // once the user opens the RII browser. Idempotent, so a retry next launch is
  // harmless.
  setImmediate(() => {
    seedRiiMirror(seedDir, materialsDir).catch(err => log(`RII seed failed: ${err.message}`));
  });
}

// Seed the offline RII mirror if absent, or if the bundled snapshot is newer than
// what the user currently has (never downgrade a user-downloaded update).
//
// The mirror ships as rii-db.zip with its manifest written loose beside it, so
// the common case (already seeded, nothing newer) costs one small JSON read
// instead of opening the archive.
async function seedRiiMirror(seedDir, materialsDir) {
  const zipPath = path.join(seedDir, 'rii-db.zip');
  const riiDst = path.join(materialsDir, 'refractiveindex-db');
  if (!fs.existsSync(zipPath)) return;
  const localM = readJsonSafe(path.join(riiDst, 'manifest.json'));
  const seedM = readJsonSafe(path.join(seedDir, 'rii-db.manifest.json'));
  const haveLocal = fs.existsSync(path.join(riiDst, 'catalog-nk.yml'));
  if (haveLocal && !((seedM?.lastUpdated || '') > (localM?.lastUpdated || ''))) return;

  // Extract into a staging directory and swap it in, so a first run interrupted
  // part-way leaves the previous mirror rather than a half-written one.
  const staging = riiDst + '.new';
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  let written = 0;
  for (const ent of unzipEntries(fs.readFileSync(zipPath))) {
    const dst = path.join(staging, ent.name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, ent.data);
    // Inflating 4000-odd entries without a break would hold the main process for
    // the whole extract, freezing every IPC call including the window controls.
    if (++written % 64 === 0) await new Promise(r => setImmediate(r));
  }
  if (fs.existsSync(riiDst)) fs.rmSync(riiDst, { recursive: true, force: true });
  fs.renameSync(staging, riiDst);
  log(`Seeded RefractiveIndex.info mirror (${seedM?.materialCount ?? '?'} materials, ${seedM?.lastUpdated ?? '?'})`);
}

module.exports = { SEED_VERSION, seedBundledMaterials };
