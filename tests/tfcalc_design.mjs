/**
 * TFCalc .tfd design reader checks.
 *
 *  1. A four-layer AR as TFCalc writes it: media, substrate, reference
 *     wavelength, layer order reversed into TFStudio front order, physical
 *     thickness kept, lock from the optimize flag, formula and symbols.
 *  2. Back layers, comments, the back surface of the substrate, and the
 *     wavelength unit: pinned by the layers, forced by the switch, noted
 *     when the two disagree.
 *  3. Records: one per line, so a key word inside a comment stays text;
 *     layers taken by number whatever order they were written in.
 *  4. Rejections, a variable material (TFCalc's rugate mechanism) among them.
 *  5. Maintainer-only: every design in the local TFCalc install parses and
 *     pins nanometres.
 *
 * Run: node tests/tfcalc_design.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTFCalcDesign } from '../src/utils/io/designImport/tfcalcDesign.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);

const AR = [
    'VERSION*1*',
    'ENVIRON*350.00*750.00*  5.000*550.00*0.0000*AIR*GLASS*',
    'ENVIRON2*  0.00* 30.00*  1.000*550.00*W*',
    'ENVIRON3*1.0000*GLASS*WHITE*IDEAL*1*',
    'FORMULA2*1*(HL)^2*',
    'SYMBOL*1*H*TIO2*1.0000*1*N*Y*',
    'SYMBOL*2*L*MGF2*1.0000*1*N*Y*',
    'GROUPS*1*',
    'GROUP*1*1.000000*N*',
    'LAYERS*4*',
    'LAYER*1*TIO2*0.286974*16.544623*0.0000*1*Y*N*0.0000*N*N*',
    'LAYER*2*MGF2*0.476049*47.432418*0.0000*1*Y*N*0.0000*N*N*',
    'LAYER*3*TIO2*0.424012*24.445136*0.0000*1*N*N*0.0000*N*N*',
    'LAYER*4*MGF2*1.172405*116.815716*0.0000*1*Y*N*0.0000*N*N*',
    'LAYERS2*0*',
    'TARGETS*0*1000*1*0.00000001*0.100*V*N*Y*Y*0*N*TIO2*MGF2*N*N*******N*N*1000.0*0.0000*1*',
    'AUTOTARG*1*450.00*650.00*  0.00*  0.000000*  0.000000*1.0000*R*A*0*1*1*',
    'VARMATS*0*',
    'ENVIRNS*1*',
    'ENVIRN*1*AIR*GLASS*GLASS*WHITE*IDEAL*1.0000*',
    'PLOT4*R*Y*N*N*0*N*Y*  0.00*  0.50*Y*N*0*0*N*',
    'MNDATA*R*2*1*1*550.00*  0.00*  0.00*1.0000*  0.00*GLASS*Y*  0.00*100.00*0*0*A*N*1.000000*N*50.0000*',
    'COMMENTS*1*',
    'COMMENT*1*Four-Layer Coating~second line*',
    'EOF*',
].join('\r\n');

const d = parseTFCalcDesign(AR, '4LAYER.TFD');
ok(d.program === 'tfcalc' && d.name === '4LAYER', 'program and name from the file name');
ok(d.incidentMedium === 'AIR' && d.substrate === 'GLASS' && d.exitMedium === 'GLASS', 'media and substrate from ENVIRON / ENVIRON3');
near(d.substrateThicknessMm, 1, 1e-12, 'substrate thickness in mm');
near(d.referenceWavelengthNm, 550, 1e-12, 'reference wavelength');
ok(d.front.length === 4 && d.back.length === 0, 'four front layers, no back layers');
ok(d.front[0].material === 'MGF2' && d.front[3].material === 'TIO2', 'file layer 1 (next to the substrate) is last in front order');
near(d.front[0].thicknessNm, 116.815716, 1e-9, 'physical thickness in nm kept');
near(d.front[0].optical.value, 1.172405, 1e-9, 'QWOT kept for the preview');
ok(d.front[1].locked === true && d.front[0].locked === false, 'optimize = N becomes locked');
ok(d.formula === '(HL)^2' && d.symbols.H === 'TIO2' && d.symbols.L === 'MGF2', 'formula and symbols');
ok(d.comments[0] === 'Four-Layer Coating\nsecond line', 'comment with ~ line breaks');
ok(d.notes.some(n => n.code === 'targets' && n.count === 1), 'targets counted in the notes');
ok(d.spectrum.fromNm === 350 && d.spectrum.toNm === 750, 'plot range from ENVIRON');
ok(d.angleDeg === 0, 'normal incidence');
ok(d.backSurface === false && d.wavelengthUnit === 'nm', 'exit medium equal to the substrate: semi-infinite; unit pinned as nm by the layers');
ok(!d.notes.some(n => /^unit/.test(n.code)), 'a file that fits the chosen unit gets no unit note');

// The switch forces a unit; when the layers say otherwise the design says so.
const um = parseTFCalcDesign(AR, 'UM.TFD', { wavelengthUnit: 'um' });
near(um.referenceWavelengthNm, 550000, 1e-6, 'µm setting scales the reference wavelength');
near(um.front[0].thicknessNm, 116.815716, 1e-9, 'physical thickness is nm whatever the wavelength unit');
ok(um.notes.some(n => n.code === 'unitMismatch' && n.chosen === 'um' && n.detected === 'nm'), 'forcing µm on a nm file is noted');

// A file from a µm installation: λ0 = 0.55 with nm layer thicknesses. The
// layers pin the unit, and forcing nm is noted.
const AR_UM = AR.replace('ENVIRON*350.00*750.00*  5.000*550.00*', 'ENVIRON*0.35*0.75*  0.005*0.55*');
const auto = parseTFCalcDesign(AR_UM, 'MICRON.TFD');
near(auto.referenceWavelengthNm, 550, 1e-9, 'a µm file is read in µm without the switch');
ok(auto.wavelengthUnit === 'um' && auto.notes.some(n => n.code === 'unitDetected' && n.unit === 'um'), 'the detected unit is noted');
ok(auto.spectrum.fromNm === 350 && auto.spectrum.toNm === 750, 'the plot range follows the detected unit');
const forcedNm = parseTFCalcDesign(AR_UM, 'MICRON.TFD', { wavelengthUnit: 'nm' });
near(forcedNm.referenceWavelengthNm, 0.55, 1e-12, 'the switch still wins');
ok(forcedNm.notes.some(n => n.code === 'unitMismatch' && n.detected === 'um'), 'and the disagreement is noted');
// Layers with no quarter-wave value pin nothing; the default is nm.
const noQwot = parseTFCalcDesign(AR_UM.replace(/\*\d+\.\d+\*(\d+\.\d+)\*0\.0000\*1\*/g, '*0*$1*0.0000*1*'), 'NOQW.TFD');
ok(noQwot.wavelengthUnit === 'nm' && !noQwot.notes.some(n => /^unit/.test(n.code)), 'without quarter waves the unit stays nm and nothing is noted');

// Back layers, an unused variable material and an oblique environment.
const BACK = [
    'VERSION*1*',
    'ENVIRON*400.00*1200.00*  1.000*555.00*45.0000*AIR*K8*',
    'ENVIRON3*3.0000*AIR*WHITE*IDEAL*1*N*',
    'GROUPS*1*', 'GROUP*1*1.000000*N*N*0.0000*0.0000*',
    'LAYERS*1*',
    'LAYER*1*ZRO2*1.000000*110.370000*0.0000*1*Y*N*0.0000*N*N*',
    'LAYERS2*2*',
    'LAYER2*1*SIO2*0.500000*47.690245*0.0000*1*N*N*0.0000*N*N*',
    'LAYER2*2*TIO2*1.000000*58.249370*0.0000*1*N*N*0.0000*N*N*',
    'VARMATS*1*',
    'VARMAT*1*VM1*1.60000000*1.38000000*2.70000000*N*0.00000000*0.00000000*0.00000000*N*',
    'ENVIRNS*2*',
    'ENVIRN*1*AIR*K8*AIR*WHITE*IDEAL*3.0000****',
    'ENVIRN*2*AIR*K8*AIR*WHITE*IDEAL*3.0000****',
    'COMMENTS*0*',
    'EOF*',
].join('\n');
const b = parseTFCalcDesign(BACK, 'a1.tfd');
ok(b.back.length === 2 && b.back[0].material === 'SIO2' && b.back[1].material === 'TIO2', 'back layers keep the file order (substrate first)');
near(b.back[0].thicknessNm, 47.690245, 1e-9, 'back layer thickness');
ok(b.exitMedium === 'AIR' && b.substrateThicknessMm === 3, 'exit medium and 3 mm substrate');
ok(b.backSurface === true, 'an exit medium other than the substrate means TFCalc evaluated the back surface');
ok(Object.keys(b.constants).length === 0, 'a variable material no layer uses is ignored');
ok(b.angleDeg === 45, 'incident angle recorded');
ok(b.notes.some(n => n.code === 'environments' && n.count === 2), 'extra environments noted');

let message = '';
try { parseTFCalcDesign(BACK.replace('LAYER*1*ZRO2*', 'LAYER*1*VM1*'), 'graded.tfd'); } catch (e) { message = e.message; }
ok(/variable material VM1/.test(message), 'a layer of a variable material is refused as a rugate mechanism');

// Only the first token of a line opens a record, so a key word inside a
// comment is text and does not end the file or start a layer.
const commented = parseTFCalcDesign(AR.replace('COMMENT*1*Four-Layer Coating~second line*', 'COMMENT*1*Before EOF * LAYER notes*'), 'C.TFD');
ok(commented.front.length === 4 && commented.comments[0] === 'Before EOF*LAYER notes', 'a key word inside a comment stays text');

// Layers are taken by their number, not by the order they were written in.
const lines = AR.split('\r\n');
const l1 = lines.findIndex(l => l.startsWith('LAYER*1*')), l4 = lines.findIndex(l => l.startsWith('LAYER*4*'));
[lines[l1], lines[l4]] = [lines[l4], lines[l1]];
const shuffled = parseTFCalcDesign(lines.join('\r\n'), 'SHUFFLED.TFD');
ok(shuffled.front.map(l => l.material).join() === d.front.map(l => l.material).join() && shuffled.front[0].thicknessNm === d.front[0].thicknessNm, 'layer records out of order import in number order');

let threw = false;
try { parseTFCalcDesign('<xml/>', 'X.TFD'); } catch (_) { threw = true; }
ok(threw, 'non-TFCalc text rejected');
threw = false;
try { parseTFCalcDesign('VERSION*1*\nENVIRON*400*700*10*550*0*AIR*BK7*\nLAYERS*0*\nEOF*', 'EMPTY.TFD'); } catch (_) { threw = true; }
ok(threw, 'a design with no layers is rejected');

// ── Maintainer-only: the local TFCalc install ────────────────────────────────
const ROOT = 'D:\\Kalovaya_massa\\TFCALc';
if (fs.existsSync(ROOT)) {
    const errors = [];
    let parsed = 0, withBack = 0, cyrillic = 0, graded = 0, unitNoted = 0;
    const decode = (buf) => {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (_) { return new TextDecoder('windows-1251').decode(buf); }
    };
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(p); continue; }
            if (!/\.tfd$/i.test(entry.name)) continue;
            try {
                const item = parseTFCalcDesign(decode(fs.readFileSync(p)), entry.name);
                parsed++;
                if (item.back.length) withBack++;
                if (/[\u0400-\u04FF]/.test(item.substrate)) cyrillic++;
                if (item.notes.some(n => /^unit/.test(n.code)) || item.wavelengthUnit !== 'nm') unitNoted++;
                for (const layer of [...item.front, ...item.back]) {
                    if (!(layer.thicknessNm >= 0)) errors.push(`${entry.name}: bad thickness`);
                }
            } catch (e) {
                if (/variable material/.test(e.message)) graded++;
                else errors.push(`${entry.name}: ${e.message}`);
            }
        }
    };
    walk(ROOT);
    ok(errors.length === 0 && parsed > 0, `all ${parsed} TFCalc designs parse, ${graded} refused for a variable material (${withBack} with back layers, ${cyrillic} with a Cyrillic substrate name)${errors.length ? ': ' + errors.slice(0, 5).join('; ') : ''}`);
    ok(unitNoted === 0, `every design of this nm installation pins nanometres (${unitNoted} did not)`);
} else {
    console.log('(maintainer section not run: local TFCalc install not present)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
