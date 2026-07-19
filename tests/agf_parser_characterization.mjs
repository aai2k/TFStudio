/**
 * Characterization test for the AGF (Zemax ASCII Glass Format) parser.
 *
 * The parser had no dedicated coverage, so this locks its current behaviour
 * against the bundled SCHOTT June-2025 catalog before/after refactoring:
 * a structural fingerprint over every parsed field of all 366 glasses, plus
 * an explicit spot-check of N-BK7 (dispersion coefficients + Beer–Lambert
 * k-table derived from the IT transmittance block).
 */

import { parseAGF, validateAGFMaterial } from '../src/utils/materials/agfParser.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const agfPath = join(here, '..', 'build', 'seed', 'agf', 'schott2025.AGF');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const eq = (a, b, msg) => ok(a === b, `${msg} (${a} === ${b})`);

// Deterministic fingerprint over the full parse, so any field drift is caught.
function fingerprint(cat) {
    let h = 0;
    const push = (s) => { const str = String(s); for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; };
    const ids = Object.keys(cat.materials);
    push(cat.id); push(cat.name); push(ids.length);
    for (const id of ids) {
        const m = cat.materials[id];
        push(id); push(m.formulaNum); push(m.nd); push(m.vd); push(m.excludeSub); push(m.status);
        push(m.coefficients.join(',')); push(m.lambdaMin); push(m.lambdaMax);
        push(m.density); push(m.tce1); push(m.tce2); push(m.dPgF); push(m.comment);
        push(m.kTable.map(k => k.lam_um + ':' + k.k).join('|'));
    }
    return h >>> 0;
}

const text = readFileSync(agfPath, 'utf8');
const cat = parseAGF(text, 'schott2025');

eq(cat.id, 'schott2025', 'catalog id preserved from catalogId arg');
eq(Object.keys(cat.materials).length, 366, 'all glasses parsed');
eq(fingerprint(cat), 779850973, 'full-parse fingerprint stable');

// N-BK7 spot-check — dispersion coefficients and derived k-table.
const bk = cat.materials['N-BK7'];
ok(!!bk, 'N-BK7 present');
eq(bk.nd, 1.5168, 'N-BK7 nd');
eq(bk.vd, 64.17, 'N-BK7 vd');
eq(bk.coefficients.length, 10, 'N-BK7 coefficients padded to 10');
eq(bk.coefficients[0], 1.03961212, 'N-BK7 first Sellmeier coefficient');
eq(bk.kTable.length, 25, 'N-BK7 k-table length');
eq(bk.density, 2.51, 'N-BK7 density');
eq(bk.comment, 'step 0.5 available', 'N-BK7 GC comment');

// CC comment used as catalog name when no catalogId is passed.
const cat2 = parseAGF(text);
eq(cat2.name, 'SCHOTT June 2025 preferred, inquiry, AR glasses', 'CC line becomes catalog name');
eq(cat2.id, 'schott_june_2025_preferred_inquiry_ar_glasses', 'name slugified into id');

// validateAGFMaterial contract.
eq(validateAGFMaterial(bk).length, 0, 'valid glass yields no warnings');
eq(validateAGFMaterial({ id: '', formulaNum: 99, coefficients: [] }).length, 3, 'invalid glass yields three warnings');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
