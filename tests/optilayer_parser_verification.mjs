/**
 * Verifies optilayerParser.js against the real OptiLayer catalog.
 *
 *  1. Every .lm/.sub file parses without error.
 *  2. For analytic families (Sellmeier/Cauchy/Schott) that ALSO carry an embedded
 *     sampled n-table, the parser's analytic n(λ) reproduces that table — i.e. our
 *     decoded formula IS the formula OptiLayer used. Tolerance: Δn < 1e-4.
 *  3. Tabulated (nType 0) imports reproduce their own data exactly.
 *
 * Run: node tests/optilayer_parser_verification.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptiLayerFile } from '../src/utils/materials/optilayerParser.js';
import { evalN } from '../src/utils/materials/dispersionFormulas.js';

// Maintainer-only: the raw .lm/.sub source files are NOT in the repo. Drop them
// into materials/lm-sub/ to run this verification; otherwise it skips.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'materials', 'lm-sub');

if (!fs.existsSync(DIR)) {
    console.log('SKIP: .lm/.sub source (materials/lm-sub/) not present — maintainer-only parser verification.');
    process.exit(0);
}

const files = fs.readdirSync(DIR).filter(f => /\.(lm|sub)$/i.test(f));
let parsed = 0, failed = 0, formulaChecked = 0, tableChecked = 0;
let maxFormulaErr = 0, maxFormulaFile = '';
const failures = [];
const byFormula = {};

for (const f of files) {
    const text = fs.readFileSync(path.join(DIR, f), 'utf-8');
    const doc = JSON.parse(text);
    let mat;
    try {
        mat = parseOptiLayerFile(text, f);
        parsed++;
    } catch (e) {
        failed++;
        failures.push(`${f}: ${e.message}`);
        continue;
    }
    byFormula[mat.formulaNum] = (byFormula[mat.formulaNum] || 0) + 1;

    const wl = doc.wavelength, nArr = doc.n;
    const hasTable = Array.isArray(wl) && wl.length > 1 && Array.isArray(nArr) && nArr.length === wl.length;

    if (mat.formulaNum >= 1 && hasTable) {
        // Compare analytic n to OptiLayer's own sampled n at every grid point.
        for (let i = 0; i < wl.length; i++) {
            const nAnalytic = evalN(mat.formulaNum, mat.coefficients, wl[i] / 1000);
            const err = Math.abs(nAnalytic - nArr[i]);
            if (err > maxFormulaErr) { maxFormulaErr = err; maxFormulaFile = `${f} @${wl[i]}nm`; }
            if (err > 1e-4) failures.push(`${f} @${wl[i]}nm: analytic ${nAnalytic.toFixed(6)} vs table ${nArr[i].toFixed(6)} (Δ=${err.toExponential(2)})`);
        }
        formulaChecked++;
    } else if (mat.formulaNum === -1 && hasTable) {
        // Tabular import must equal the source rows exactly.
        if (mat.tabData.length !== wl.length) failures.push(`${f}: tabData length ${mat.tabData.length} != ${wl.length}`);
        else for (let i = 0; i < wl.length; i++) {
            if (mat.tabData[i][0] !== wl[i] || mat.tabData[i][1] !== nArr[i]) {
                failures.push(`${f} row ${i}: tabData mismatch`); break;
            }
        }
        tableChecked++;
    }
}

console.log(`Files:            ${files.length}`);
console.log(`Parsed OK:        ${parsed}`);
console.log(`Parse failures:   ${failed}`);
console.log(`formulaNum spread:`, byFormula);
console.log(`Formula-vs-table checks: ${formulaChecked} files`);
console.log(`Tabular exact checks:    ${tableChecked} files`);
console.log(`Max |Δn| analytic-vs-table: ${maxFormulaErr.toExponential(3)}  (${maxFormulaFile})`);

if (failures.length) {
    console.log(`\nFAILURES (${failures.length}, first 20):`);
    for (const m of failures.slice(0, 20)) console.log('  ✗ ' + m);
    process.exit(1);
}
console.log('\n✓ ALL CHECKS PASSED');
