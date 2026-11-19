/**
 * An AGF IT row printed as zero transmittance.
 *
 * At the short-wave end of a glass's data it is the UV cut-off: the glass is
 * opaque, so k comes from T = 5e-4 (half the last printed digit) at that row's
 * thickness. Anywhere else, such as the 1.06 um rows of the obsolete glasses,
 * it is a gap in the data and is left out.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAGF } from '../src/utils/materials/agfParser.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.abs(b);

const kOpaque = (lam_um, thick_mm) => -Math.log(5e-4) * lam_um * 1e-3 / (4 * Math.PI * thick_mm);

const glass = (name, itRows) => [
    `NM ${name} 2 0 1.5 60 0 0 0`,
    'CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 103.560653 0 0 0 0',
    'LD 0.3 2.5',
    ...itRows.map(row => `IT ${row}`),
].join('\n');

const text = [
    'CC test',
    glass('CUTOFF', ['0.300 0 25', '0.320 0 25', '0.334 0.211 25', '0.350 0.78 25', '1.060 0 25']),
    glass('OLD', ['0.334 0.211 25', '0.350 0.78 25', '1.060 0 25', '2.0 0.9 25']),
    glass('NODATA', ['1.060 0 25', '2.0 0 25']),
    glass('UNSORTED', ['0.350 0.78 25', '0.320 0 25', '0.334 0.211 25']),
].join('\n');
const m = parseAGF(text, 't').materials;

ok(m.CUTOFF.kTable.map(r => r.lam_um).join() === '0.3,0.32,0.334,0.35',
    `cut-off glass keeps its short-wave zero rows and drops the 1.06 um one (got ${m.CUTOFF.kTable.map(r => r.lam_um)})`);
ok(near(m.CUTOFF.kTable[1].k, kOpaque(0.32, 25)), `k at 320 nm is that of T = 5e-4 (got ${m.CUTOFF.kTable[1].k})`);
ok(m.CUTOFF.kTable[1].k > m.CUTOFF.kTable[2].k, 'the cut-off is more absorbing than the first transmitting row');

ok(m.OLD.kTable.map(r => r.lam_um).join() === '0.334,0.35,2', 'an interior zero row is left out');
ok(m.NODATA.kTable.length === 0, 'a glass whose rows are all zero has no k data');
ok(m.UNSORTED.kTable.map(r => r.lam_um).join() === '0.32,0.334,0.35' && m.UNSORTED.kTable[0].k > 0,
    'rows are ordered before the short-wave run is found');

const here = dirname(fileURLToPath(import.meta.url));
const schott = parseAGF(readFileSync(join(here, '..', 'build', 'seed', 'agf', 'schott2025.AGF'), 'utf8'), 'schott2025').materials;
const f2 = schott.F2.kTable.find(r => r.lam_um === 0.32);
ok(f2 && near(f2.k, kOpaque(0.32, 25)), `F2 at 320 nm is opaque (got ${f2 && f2.k})`);
ok(!schott.BK3.kTable.some(r => r.lam_um === 1.06), 'BK3 has no row at 1.06 um');

console.log(fails === 0 ? 'PASS: agf_zero_transmittance' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
