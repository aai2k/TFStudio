/**
 * TFCalc .MAT importer checks.
 *
 *  1. Table files (multi-point, single-point, records sharing a line).
 *  2. Sellmeier 3 with Schott's N-FK5 coefficients maps onto TFStudio formula 2
 *     and gives Schott's n_d.
 *  3. Every other formula family: exact mappings agree with the manual's
 *     formula evaluated directly; Hartmann and Drude arrive as sampled tables;
 *     k formulas arrive as k tables.
 *  4. Maintainer-only: every file in the local TFCalc install parses.
 *
 * Run: node tests/tfcalc_parser.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTFCalcFile } from '../src/utils/materials/tfcalcParser.js';
import { evalN } from '../src/utils/materials/dispersionFormulas.js';
import { interpK } from '../src/utils/materials/catalogManager/dispersion.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);

// ── Tables ────────────────────────────────────────────────────────────────────
const table = 'VERSION*1*\nFORMAT*1*\nPOINTS*3*\nDATA1*1*550.0*2.385*0.0*\nDATA1*2*450.0*2.469*0.01*\nDATA1*3*650.0*2.337*0.0*\nCOMMENT*sputtered*\nEOF*\n';
const t = parseTFCalcFile(table, 'TIO2.MAT');
ok(t.formulaNum === -1 && t.tabData.length === 3, 'table imported as tabular');
ok(t.tabData[0][0] === 450 && t.tabData[2][0] === 650, 'rows sorted by wavelength');
ok(t.tabData[0][2] === 0.01, 'k column kept');
ok(t.name === 'TIO2' && t.id === 'TIO2', 'name from file name');
ok(t.comment === 'sputtered', 'comment record kept');
near(t.lambdaMin, 0.45, 1e-12, 'lambdaMin from table');
ok(t.group === 'Imported', 'default group');
ok(parseTFCalcFile(table, 'X.MAT', { group: 'Substrate' }).group === 'Substrate', 'group option');

const single = parseTFCalcFile('VERSION*1*\nFORMAT*1*\nPOINTS*1*\nDATA1*1*550.0*4.2*0.0*\nCOMMENT**\nEOF*\n', 'H.MAT');
ok(single.tabData.length === 1 && single.tabData[0][1] === 4.2, 'single-point table kept as one row');
near(single.nd, 4.2, 1e-12, 'single point gives a constant n_d');

const um = parseTFCalcFile(table, 'T.MAT', { wavelengthUnit: 'um' });
ok(um.tabData[0][0] === 450000, 'µm option scales wavelengths to nm');

// ── Sellmeier 3 (N-FK5 substrate as shipped, all records on one line) ────────
const fk5 = 'VERSION*1*FORMAT*2*4*1*245.0*2325.0*DATA2*1*8.44309338e-1*4.75111955e-3*3.44147824e-1*DATA2*2*1.49814849e-2*9.10790213e-1*9.78600293e1*DATA2*3*0.00000000*0.00000000*0.00000000*COMMENT*Data from Schott*EOF*';
const f = parseTFCalcFile(fk5, 'FK5.MAT');
ok(f.formulaNum === 2, 'Sellmeier 3 maps onto TFStudio formula 2 (Sellmeier 1)');
ok(f.coefficients.length === 6 && f.coefficients[5] === 97.8600293, 'six coefficients in B1 C1 … order');
near(f.lambdaMin, 0.245, 1e-12, 'range min in µm');
near(f.lambdaMax, 2.325, 1e-12, 'range max in µm');
near(evalN(f.formulaNum, f.coefficients, 0.58756), 1.48749, 2e-5, 'N-FK5 n_d reproduced');
ok(f.kTable.length === 0, 'k Zero gives no k table');
ok(f.tfcalc.nCode === 4 && f.tfcalc.kCode === 1, 'formula codes recorded');

// ── Other families against the manual's formulas ──────────────────────────────
function formulaFile(nCode, kCode, slots) {
    const s = slots.slice(); while (s.length < 9) s.push(0);
    return `VERSION*1*\nFORMAT*2*${nCode}*${kCode}*400.0*800.0*\nDATA2*1*${s[0]}*${s[1]}*${s[2]}*\nDATA2*2*${s[3]}*${s[4]}*${s[5]}*\nDATA2*3*${s[6]}*${s[7]}*${s[8]}*\nEOF*\n`;
}
const lam = 0.6, l2 = lam * lam;

const s1 = parseTFCalcFile(formulaFile(1, 1, [1.2, 0.9, 0.01]), 'S1.MAT');
ok(s1.formulaNum === 101, 'Sellmeier 1 → formula 101');
near(evalN(101, s1.coefficients, lam), Math.sqrt(1.2 + 0.9 * l2 / (l2 - 0.01)), 1e-12, 'Sellmeier 1 value');

const s2 = parseTFCalcFile(formulaFile(2, 1, [1.1, 0.8, 0.01, 0.5, 100]), 'S2.MAT');
near(evalN(101, s2.coefficients, lam), Math.sqrt(1.1 + 0.8 * l2 / (l2 - 0.01) + 0.5 * l2 / (l2 - 100)), 1e-12, 'Sellmeier 2 value');

const s2p = parseTFCalcFile(formulaFile(3, 1, [1.1, 0.8, 0.01, -0.02]), 'S2P.MAT');
ok(s2p.formulaNum === 8, 'Sellmeier 2′ → formula 8');
near(evalN(8, s2p.coefficients, lam), Math.sqrt(1.1 + 0.8 * l2 / (l2 - 0.01) - 0.02 * l2), 1e-12, 'Sellmeier 2′ value (sign of the λ² term)');

const c = parseTFCalcFile(formulaFile(5, 3, [2.2, 0.02, 0.001, 0, 0, 0, 1e-4, 0.3]), 'C.MAT');
ok(c.formulaNum === 102, 'Cauchy → formula 102');
near(evalN(102, c.coefficients, lam), 2.2 + 0.02 / l2 + 0.001 / (l2 * l2), 1e-12, 'Cauchy value');
ok(c.kTable.length > 0, 'exponential k sampled to a k table');
near(interpK(c.kTable, lam), 1e-4 * Math.exp(0.3 / lam), 1e-7, 'exponential k value');

const sch = parseTFCalcFile(formulaFile(8, 1, [2.3, -0.01, 0.02, 0.001, 0, 0]), 'SCH.MAT');
ok(sch.formulaNum === 1, 'Schott → formula 1');
near(evalN(1, sch.coefficients, lam), Math.sqrt(2.3 - 0.01 * l2 + 0.02 / l2 + 0.001 / (l2 * l2)), 1e-12, 'Schott value');

const h1 = parseTFCalcFile(formulaFile(6, 2, [1.4, 0.05, 0.1, 0, 0, 0, 2, 1, 0.5]), 'H1.MAT');
ok(h1.formulaNum === -1 && h1.tabData.length === 200, 'Hartmann 1 sampled to a table');
const h1row = h1.tabData.find(r => Math.abs(r[0] - 600) < 1.5);
const nH1 = 1.4 + 0.05 / (h1row[0] / 1000 - 0.1);
near(h1row[1], nH1, 1e-12, 'Hartmann 1 sampled n');
near(h1row[2], 1 / (nH1 * (2 * h1row[0] / 1000 + 1 / (h1row[0] / 1000) + 0.5 / Math.pow(h1row[0] / 1000, 3))), 1e-12, 'Sellmeier k sampled with it');
ok(h1.tfcalc.sampledFrom === 'Hartmann 1', 'sampled-from recorded');

const h2 = parseTFCalcFile(formulaFile(7, 1, [1.4, 0.01, 0.1]), 'H2.MAT');
const h2row = h2.tabData.find(r => Math.abs(r[0] - 600) < 1.5);
near(h2row[1], 1.4 + 0.01 / Math.pow(h2row[0] / 1000 - 0.1, 2), 1e-12, 'Hartmann 2 sampled n');

const d = parseTFCalcFile(formulaFile(9, 4, [1.0, 50, 0.2]), 'D.MAT');
const drow = d.tabData.find(r => Math.abs(r[0] - 600) < 1.5);
{
    const L = drow[0] / 1000, L2 = L * L, den = L2 + 0.04;
    const re = 1.0 - 50 * 0.04 * L2 / den, im = 50 * 0.2 * L2 * L / den;
    near(drow[1] * drow[1] - drow[2] * drow[2], re, 1e-9, 'Drude n²−k² reproduced');
    near(2 * drow[1] * drow[2], im, 1e-9, 'Drude 2nk reproduced');
}

let threw = false;
try { parseTFCalcFile('<xml/>', 'BAD.MAT'); } catch (_) { threw = true; }
ok(threw, 'non-TFCalc text rejected');
threw = false;
try { parseTFCalcFile(formulaFile(5, 4, [2.2]), 'BADK.MAT'); } catch (_) { threw = true; }
ok(threw, 'Drude k without Drude n rejected');

// The record delimiter inside a comment does not make the file unreadable.
const starred = parseTFCalcFile('VERSION*1*FORMAT*1*POINTS*1*DATA1*1*550*2.0*0*COMMENT*TiO2 * 2 runs*EOF*', 'STAR.MAT');
ok(starred.tabData.length === 1 && starred.comment === 'TiO2*2 runs', 'asterisk inside a comment is kept as comment text');

// A k formula with all-zero coefficients (unused slots) leaves k at 0 rather than rejecting the material.
const h1zero = parseTFCalcFile(formulaFile(6, 2, [1.4, 0.05, 0.1]), 'H1Z.MAT');
ok(h1zero.tabData.length === 200 && h1zero.tabData.every(r => r[2] === 0), 'Hartmann with a zero Sellmeier k imports with k = 0');

// ── Maintainer-only: the local TFCalc install ────────────────────────────────
const ROOT = 'D:\\Kalovaya_massa\\TFCALc';
if (fs.existsSync(ROOT)) {
    let parsed = 0, formula = 0, empty = 0;
    const errors = [];
    for (const sub of ['MATERIAL', 'SUBSTRAT']) {
        const dir = path.join(ROOT, sub);
        for (const file of fs.readdirSync(dir).filter(n => /\.mat$/i.test(n))) {
            const text = fs.readFileSync(path.join(dir, file), 'latin1');
            // A table saved with no rows is a real TFCalc file that carries nothing to import.
            if (/POINTS\*0\*/.test(text)) { empty++; continue; }
            try {
                const m = parseTFCalcFile(text, file, { group: sub === 'SUBSTRAT' ? 'Substrate' : undefined });
                parsed++;
                if (m.tfcalc.format === 2) formula++;
                const coversD = m.lambdaMin <= 0.58756 && m.lambdaMax >= 0.58756;
                if (!(m.nd > 0) && m.formulaNum !== -1 && coversD) errors.push(`${file}: no n_d`);
            } catch (e) { errors.push(`${file}: ${e.message}`); }
        }
    }
    ok(errors.length === 0, `all ${parsed} TFCalc files parse (${formula} formulas, ${empty} empty tables skipped)${errors.length ? ': ' + errors.slice(0, 5).join('; ') : ''}`);
} else {
    console.log('(maintainer section not run: local TFCalc install not present)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
