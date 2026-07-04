/**
 * End-to-end: load the generated seed catalogs and evaluate every material the
 * same way catalogManager.makeGetNK does (evalN + kTable interp, or tabData),
 * asserting finite, physical n,k across each material's wavelength range.
 *
 * Run after `npm run seed`: node tests/optilayer_catalog_integration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalN } from '../src/utils/materials/dispersionFormulas.js';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'seed', 'library');

if (!fs.existsSync(SEED)) {
    console.log('SKIP: seed catalogs (build/seed/library/) not present.');
    process.exit(0);
}

function interpK(kTable, lum) {
    if (!kTable || kTable.length === 0) return 0;
    if (lum <= kTable[0].lam_um) return kTable[0].k;
    if (lum >= kTable[kTable.length - 1].lam_um) return kTable[kTable.length - 1].k;
    let lo = 0, hi = kTable.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kTable[m].lam_um <= lum) lo = m; else hi = m; }
    const t = (lum - kTable[lo].lam_um) / (kTable[hi].lam_um - kTable[lo].lam_um);
    return kTable[lo].k + t * (kTable[hi].k - kTable[lo].k);
}
function interpTab(tab, lam) {
    if (lam <= tab[0][0]) return [tab[0][1], tab[0][2] || 0];
    const last = tab[tab.length - 1];
    if (lam >= last[0]) return [last[1], last[2] || 0];
    let lo = 0, hi = tab.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m][0] <= lam) lo = m; else hi = m; }
    const f = (lam - tab[lo][0]) / (tab[hi][0] - tab[lo][0]);
    return [tab[lo][1] + f * (tab[hi][1] - tab[lo][1]), (tab[lo][2] || 0) + f * ((tab[hi][2] || 0) - (tab[lo][2] || 0))];
}
function getNK(mat, lam_nm) {
    if (mat.formulaNum === -1) return interpTab(mat.tabData, lam_nm);
    return [evalN(mat.formulaNum, mat.coefficients, lam_nm / 1000), interpK(mat.kTable, lam_nm / 1000)];
}

let total = 0, bad = 0;
const problems = [];
for (const file of fs.readdirSync(SEED).filter(f => f.endsWith('.catalog.json'))) {
    const cat = JSON.parse(fs.readFileSync(path.join(SEED, file), 'utf-8'));
    for (const mat of Object.values(cat.materials)) {
        total++;
        const lo = mat.lambdaMin * 1000, hi = mat.lambdaMax * 1000;
        for (const lam of [lo, (lo + hi) / 2, hi]) {
            const [n, k] = getNK(mat, lam);
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
