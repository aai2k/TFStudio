/**
 * End-to-end: load the generated seed catalogs and evaluate every material the
 * same way catalogManager.makeGetNK does (evalN + kTable interp, or tabData),
 * asserting finite, physical n,k across each material's wavelength range.
 *
 * Run after `npm run seed`: node tests/library_catalog_integration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'seed', 'library');
const REQUIRED_CATALOGS = [
    'library_coatings.catalog.json',
    'library_substrates.catalog.json',
];

for (const file of REQUIRED_CATALOGS) {
    if (!fs.existsSync(path.join(SEED, file))) {
        throw new Error(`Required bundled material catalog is missing: build/seed/library/${file}`);
    }
}

let total = 0, bad = 0;
const problems = [];
for (const file of fs.readdirSync(SEED).filter(f => f.endsWith('.catalog.json'))) {
    const cat = JSON.parse(fs.readFileSync(path.join(SEED, file), 'utf-8'));
    for (const mat of Object.values(cat.materials)) {
        total++;
        const hasTable = mat.formulaNum === -1 || (Array.isArray(mat.kTable) && mat.kTable.length > 0);
        if (hasTable && mat.interp !== 'pchip') {
            bad++;
            problems.push(`${cat.id}:${mat.id} is tabulated but does not store interp=pchip`);
            continue;
        }
        const getNK = makeGetNK(mat);
        const lo = mat.lambdaMin * 1000, hi = mat.lambdaMax * 1000;
        for (const lam of [lo, (lo + hi) / 2, hi]) {
            const [n, k] = getNK(lam);
            // Generous physical envelope: metals legitimately have n<1 in the
            // visible and large n,k in the far-IR. The test only flags non-finite
            // values or formula blow-ups (the symptom of a mis-decoded model).
            if (!isFinite(n) || !isFinite(k) || n < 0 || n > 150 || k < 0 || k > 300) {
                bad++; problems.push(`${cat.id}:${mat.id} @${lam.toFixed(0)}nm → n=${n}, k=${k}`); break;
            }
        }
    }
}
console.log(`Materials evaluated: ${total}`);
console.log(`Out-of-range / non-finite: ${bad}`);
if (problems.length) { problems.slice(0, 20).forEach(p => console.log('  ✗ ' + p)); process.exit(1); }
console.log('\n✓ All seeded library materials evaluate to physical n,k');
