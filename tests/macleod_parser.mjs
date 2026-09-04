/**
 * Essential Macleod importer checks.
 *
 *  1. Sellmeier and Cauchy materials in both file variants (database .tfx and
 *     exported .mtx) give the n the program itself shows: 1.51852 and 2.31349
 *     at 550 nm, N-BK7's 1.51680 at the d-line.
 *  2. Coefficients are converted from the database's wavelength unit.
 *  3. Table materials, k tables, internal-transmittance flag, notes.
 *  4. Compressed library files are refused; units.tfp is read.
 *  5. Maintainer-only: every file in the local Standard database parses.
 *
 * Run: node tests/macleod_parser.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseMacleodFile, parseMacleodUnits } from '../src/utils/materials/macleodParser.js';
import { evalN } from '../src/utils/materials/dispersionFormulas.js';
import { interpK } from '../src/utils/materials/catalogManager/dispersion.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);

// Files as Essential Macleod wrote them for the two test materials (nm database).
const sellTfx = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="Test Sellmeier" NType="2" KType="1" TType="-1"><NKPoints><NKPoint W="100" n="1" k="0"/><NKPoint W="1000" n="1" k="0"/></NKPoints><Cauchy Max="0" Min="0"><Parameter N="0" A="1"/></Cauchy><Sellmeier Max="2500" Min="300"><Parameter N="0" A="1.03961212" B="6000.69867"/><Parameter N="1" A="0.231792344" B="20017.9144"/><Parameter N="2" A="1.01046945" B="103560653"/></Sellmeier><KPoints><KPoint W="400" k="0.001"/><KPoint W="1000" k="0.0002"/></KPoints><KCauchy><Parameter N="0" A="0"/></KCauchy><KExp><Parameter A="0" B="0"/></KExp><Notes></Notes></EssentialMacleodMaterial>\r\n';
const sellMtx = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="Test Sellmeier" NType="2" KType="1" TintType="-1"><NKPoints><NKPoint W=" 100" n=" 1" k=" 0"/><NKPoint W=" 1000" n=" 1" k=" 0"/></NKPoints><KPoints><KPoint W=" 400" k=" .001"/><KPoint W=" 1000" k=" .0002"/></KPoints><CauchyPoints Max=" 0" Min=" 0"><CauchyPoint A=" 1"/></CauchyPoints><SellmeierPoints Max=" 2500" Min=" 300"><SellmeierPoint A=" 1.03961212" B=" 6000.69867"/><SellmeierPoint A=" .231792344" B=" 20017.9144"/><SellmeierPoint A=" 1.01046945" B=" 103560653"/></SellmeierPoints><TintPoints><TintPoint W=" 100" T=" 100"/><TintPoint W=" 1000" T=" 100"/></TintPoints><Notes/></EssentialMacleodMaterial>\r\n';
const cauchyTfx = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="Test Cauchy" NType="3" KType="1" TType="-1"><NKPoints><NKPoint W="100" n="1" k="0"/><NKPoint W="1000" n="1" k="0"/></NKPoints><Cauchy Max="1000" Min="361.2"><Parameter N="0" A="2.25228"/><Parameter N="1" A="-14139.9"/><Parameter N="2" A="9878430000"/></Cauchy><Sellmeier Max="0" Min="0"><Parameter N="0" A="0" B="0"/></Sellmeier><KPoints><KPoint W="400" k="0.001"/><KPoint W="700" k="0.0002"/></KPoints><KCauchy><Parameter N="0" A="0"/></KCauchy><KExp><Parameter A="0" B="0"/></KExp><Notes></Notes></EssentialMacleodMaterial>\r\n';
const cauchyMtx = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="Test Cauchy" NType="3" KType="1" TintType="-1"><NKPoints><NKPoint W=" 100" n=" 1" k=" 0"/><NKPoint W=" 1000" n=" 1" k=" 0"/></NKPoints><KPoints><KPoint W=" 400" k=" .001"/><KPoint W=" 700" k=" .0002"/></KPoints><CauchyPoints Max=" 1000" Min=" 361.2"><CauchyPoint A=" 2.25228"/><CauchyPoint A="-14139.9"/><CauchyPoint A=" 9878430000"/></CauchyPoints><SellmeierPoints Max=" 0" Min=" 0"><SellmeierPoint A=" 0" B=" 0"/></SellmeierPoints><TintPoints><TintPoint W=" 100" T=" 100"/><TintPoint W=" 1000" T=" 100"/></TintPoints><Notes/></EssentialMacleodMaterial>\r\n';
const glassTfx = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="Glass &amp; more" NType="1" KType="1" TType="1"><NKPoints><NKPoint W="700" n="1.51305984923238" k="4.46080017368899E-09"/><NKPoint W="300" n="1.55277000402566" k="6.43180283077527E-06"/><NKPoint W="500" n="1.52140986177255" k="6.37896002686489E-09"/></NKPoints><Cauchy Max="0" Min="0"><Parameter N="0" A="1"/></Cauchy><Sellmeier Max="0" Min="0"><Parameter N="0" A="0" B="0"/></Sellmeier><KPoints><KPoint W="100" k="0"/><KPoint W="1000" k="0"/></KPoints><KCauchy><Parameter N="0" A="0"/></KCauchy><KExp><Parameter A="0" B="0"/></KExp><TintPoints Thickness="25"><TintPoint W="310" T="7"/><TintPoint W="700" T="99.8"/></TintPoints><Notes>Borosilicate crown glass\r\n\r\nThe values are those for Schott BK 7 glass.\r\n</Notes></EssentialMacleodMaterial>\r\n';

// ── Sellmeier ─────────────────────────────────────────────────────────────────
for (const [label, text, fileName] of [['tfx', sellTfx, 'M13.tfx'], ['mtx', sellMtx, 'test sellmeier.mtx']]) {
    const m = parseMacleodFile(text, fileName);
    ok(m.name === 'Test Sellmeier', `${label}: name from Name attribute`);
    ok(m.formulaNum === 101, `${label}: Sellmeier → formula 101`);
    ok(m.coefficients.length === 7 && m.coefficients[0] === 1, `${label}: constant 1 plus three A,B pairs`);
    near(m.coefficients[2], 0.00600069867, 1e-15, `${label}: B converted from nm² to µm²`);
    near(m.lambdaMin, 0.3, 1e-12, `${label}: range min in µm`);
    near(m.lambdaMax, 2.5, 1e-12, `${label}: range max in µm`);
    near(evalN(101, m.coefficients, 0.58756), 1.51680, 5e-6, `${label}: N-BK7 n_d`);
    near(evalN(101, m.coefficients, 0.55), 1.51852, 5e-6, `${label}: n at 550 nm as the program shows`);
    ok(m.kTable.length === 2 && m.kTable[0].lam_um === 0.4 && m.kTable[1].k === 0.0002, `${label}: k table in µm`);
    near(interpK(m.kTable, 0.55), 0.0008, 1e-12, `${label}: k at 550 nm as the program shows`);
    ok(m.macleod.nType === 2 && m.macleod.kType === 1 && m.macleod.internalTransmittance === false, `${label}: model codes recorded`);
    ok(m.macleod.terms === 3, `${label}: term count recorded`);
}

// ── Cauchy ────────────────────────────────────────────────────────────────────
for (const [label, text, fileName] of [['tfx', cauchyTfx, 'M14.tfx'], ['mtx', cauchyMtx, 'test cauchy.mtx']]) {
    const m = parseMacleodFile(text, fileName);
    ok(m.formulaNum === 102, `${label}: Cauchy → formula 102`);
    near(m.coefficients[1], -0.0141399, 1e-12, `${label}: A₁ converted from nm² to µm²`);
    near(m.coefficients[2], 0.00987843, 1e-12, `${label}: A₂ converted from nm⁴ to µm⁴`);
    ok(String(m.coefficients[1]) === '-0.0141399' && String(m.coefficients[2]) === '0.00987843',
        `${label}: converted coefficients carry the file's digits, no conversion noise`);
    near(evalN(102, m.coefficients, 0.55), 2.31349, 5e-6, `${label}: n at 550 nm as the program shows`);
    near(interpK(m.kTable, 0.55), 0.0006, 1e-12, `${label}: k at 550 nm as the program shows`);
    near(m.lambdaMin, 0.3612, 1e-12, `${label}: range min`);
}

// A µm database stores the same material with B in µm²; the unit option must
// give the same coefficients.
const sellUm = sellTfx.replace('B="6000.69867"', 'B="0.00600069867"').replace('B="20017.9144"', 'B="0.0200179144"').replace('B="103560653"', 'B="103.560653"')
    .replace('Max="2500" Min="300"', 'Max="2.5" Min="0.3"').replace('W="400" k', 'W="0.4" k').replace('W="1000" k="0.0002"', 'W="1" k="0.0002"');
const mUm = parseMacleodFile(sellUm, 'M13.tfx', { wavelengthUnit: 'um' });
near(mUm.coefficients[2], 0.00600069867, 1e-15, 'µm database: B taken as µm²');
near(mUm.lambdaMax, 2.5, 1e-12, 'µm database: range');
near(mUm.kTable[1].lam_um, 1, 1e-12, 'µm database: k table wavelengths');

// A Cauchy series longer than three terms stays a formula with every term.
const longCauchy = cauchyTfx.replace('<Parameter N="2" A="9878430000"/>', '<Parameter N="2" A="9878430000"/><Parameter N="3" A="1e15"/>');
const lc = parseMacleodFile(longCauchy, 'M15.tfx');
ok(lc.formulaNum === 102 && lc.coefficients.length === 4, 'four-term Cauchy keeps all four terms as formula 102');
{
    const L = 0.55;
    near(evalN(102, lc.coefficients, L),
        2.25228 - 0.0141399 / (L * L) + 0.00987843 / Math.pow(L, 4) + 1e15 * 1e-18 / Math.pow(L, 6), 1e-9,
        'four-term series evaluates every term in µm');
    near(interpK(lc.kTable, L), 0.0006, 1e-12, 'k table kept beside the long series');
}
ok(lc.macleod.terms === 4, 'term count recorded');

// ── Table material ────────────────────────────────────────────────────────────
const g = parseMacleodFile(glassTfx, 'M1.tfx');
ok(g.name === 'Glass & more', 'XML entity in name decoded');
ok(g.formulaNum === -1 && g.tabData.length === 3 && g.tabData[0][0] === 300, 'table rows sorted, wavelengths in nm');
near(g.tabData[1][1], 1.52140986177255, 1e-15, 'n kept verbatim');
near(g.tabData[0][2], 6.43180283077527e-6, 1e-20, 'k kept verbatim');
ok(g.macleod.internalTransmittance === true, 'internal transmittance table flagged');
ok(g.comment === 'Borosilicate crown glass The values are those for Schott BK 7 glass.', 'notes become the comment');
near(g.nd, 1.5168, 2e-3, 'n_d interpolated from the table');

// ── Refusals and units ────────────────────────────────────────────────────────
let threw = '';
try { parseMacleodFile('MT1\rN\u00d9-\u0000\u00007\u0000garbage', 'M1.mtx'); } catch (e) { threw = e.message; }
ok(/compressed/.test(threw), 'compressed library file refused with a pointer to the database');
threw = '';
try { parseMacleodFile('<?xml version="1.0"?><Other/>', 'x.tfx'); } catch (e) { threw = e.message; }
ok(/not an Essential Macleod/.test(threw), 'foreign XML refused');

ok(parseMacleodUnits('"Essential Macleod Units V5.0"\r\n"Wavelength",.000001,"µm","####0.00"\r\n') === 'um', 'units.tfp in µm');
ok(parseMacleodUnits('"Wavelength",1E-09,"nm","####0.00"') === 'nm', 'units.tfp in nm');
ok(parseMacleodUnits('') === null && parseMacleodUnits('"Thickness",.000001,"µm"') === null, 'missing file or wavelength line → null');
ok(parseMacleodUnits('"Wavelength",0.01,"cm-1"') === 'unsupported', 'another wavelength unit → unsupported');

threw = '';
try { parseMacleodFile(sellTfx.replace('NType="2"', 'NType="4"'), 'M9.tfx'); } catch (e) { threw = e.message; }
ok(/model 4/.test(threw), 'an unknown refractive index model is refused, not read as the placeholder table');

// Database files number their terms; the number, not the position, is the power.
const numbered = cauchyTfx.replace('<Parameter N="0" A="2.25228"/><Parameter N="1" A="-14139.9"/><Parameter N="2" A="9878430000"/>',
    '<Parameter N="2" A="9878430000"/><Parameter N="1" A="-14139.9"/><Parameter N="3" A="1e15"/>');
const nb = parseMacleodFile(numbered, 'M16.tfx');
ok(nb.coefficients.length === 4 && nb.coefficients[0] === 0, 'a missing q = 0 term is a zero constant');
near(nb.coefficients[1], -0.0141399, 1e-12, 'q = 1 term at its own power');
near(nb.coefficients[3], 1e-3, 1e-15, 'q = 3 term converted with its own exponent');

// ── Maintainer-only: the local Standard database ─────────────────────────────
const DB = 'C:\\Users\\Public\\Documents\\Thin Film Center\\Materials\\Standard';
if (fs.existsSync(DB)) {
    const errors = [];
    let parsed = 0;
    for (const file of fs.readdirSync(DB).filter(n => /^M\d+\.tfx$/i.test(n))) {
        try { parseMacleodFile(fs.readFileSync(path.join(DB, file), 'utf8'), file); parsed++; }
        catch (e) { errors.push(`${file}: ${e.message}`); }
    }
    ok(errors.length === 0 && parsed >= 13, `all ${parsed} database files parse${errors.length ? ': ' + errors.join('; ') : ''}`);
} else {
    console.log('(maintainer section not run: local Essential Macleod database not present)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
