/**
 * Material file import dispatcher: a mixed batch of TFCalc, Essential Macleod
 * and OptiLayer files goes to the right parser, ids stay unique, units follow
 * the batch settings, and unreadable files come back as errors, not throws.
 *
 * Run: node tests/material_file_import.mjs
 */
import { parseMaterialFiles, programForExtension, DEFAULT_IMPORT_UNITS, MATERIAL_FILE_EXTENSIONS } from '../src/utils/materials/materialFileImport.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

ok(MATERIAL_FILE_EXTENSIONS.every(e => programForExtension(e)), 'every listed extension has a program');
ok(programForExtension('MAT') === 'tfcalc' && programForExtension('tfx') === 'macleod' && programForExtension('sub') === 'optilayer', 'extension routing');
ok(programForExtension('agf') === null, 'AGF is not a per-file import');

const tfcalcTable = 'VERSION*1*\nFORMAT*1*\nPOINTS*1*\nDATA1*1*550.0*2.6*0.0*\nEOF*\n';
const macleodSell = '<EssentialMacleodMaterial Name="Sell" NType="2" KType="1" TType="-1"><Sellmeier Max="2500" Min="300"><Parameter N="0" A="1.03961212" B="6000.69867"/></Sellmeier><KPoints><KPoint W="400" k="0"/></KPoints></EssentialMacleodMaterial>';
const macleodSellUm = macleodSell.replace('B="6000.69867"', 'B="0.00600069867"').replace('Max="2500" Min="300"', 'Max="2.5" Min="0.3"').replace('W="400"', 'W="0.4"');
const optilayer = JSON.stringify({ name: 'OL', nType: 0, wavelength: [400, 500, 600], n: [1.5, 1.49, 1.48], k: [0, 0, 0] });

const files = [
    { name: 'ZNSE', ext: 'mat', dir: 'MATERIAL', text: tfcalcTable },
    { name: 'ZNSE', ext: 'mat', dir: 'SUBSTRAT', text: tfcalcTable },
    { name: 'M13', ext: 'tfx', dir: 'Standard', text: macleodSell },
    { name: 'M13', ext: 'tfx', dir: 'microns', text: macleodSellUm, unitsText: '"Wavelength",.000001,"µm","####0.00"' },
    { name: 'ol', ext: 'lm', dir: 'lm', text: optilayer },
    { name: 'broken', ext: 'mat', dir: 'MATERIAL', text: 'not a material' },
    { name: 'glass', ext: 'agf', dir: 'x', text: '' },
    { name: 'M2', ext: 'tfx', dir: 'eV', text: macleodSell, unitsText: '"Wavelength",1,"eV","####0.00"' },
];
const { items, errors } = parseMaterialFiles(files);

ok(items.length === 5 && errors.length === 3, `5 parsed, 3 errors (${items.length}/${errors.length})`);
ok(errors[2].file === 'M2.tfx' && /units\.tfp/.test(errors[2].error), 'a database in another wavelength unit is refused, not read as nm');
ok(parseMaterialFiles(files.slice(7), { ...DEFAULT_IMPORT_UNITS, macleod: 'nm' }).items.length === 1, 'an explicit unit overrides the refusal');
ok(items.map(i => i.program).join() === 'tfcalc,tfcalc,macleod,macleod,optilayer', 'programs by extension');
ok(items[0].entry.id === 'ZNSE' && items[1].entry.id === 'ZNSE_2', 'duplicate names get unique ids');
ok(items[0].entry.group === 'Imported' && items[1].entry.group === 'Substrate', 'SUBSTRAT folder marks substrates');
ok(items[0].fileIndex === 0 && items[1].fileIndex === 1 && items[4].fileIndex === 4, 'items keep their file index');
ok(items[2].unit === 'nm' && items[3].unit === 'um', 'Macleod unit: nm without units.tfp, µm from units.tfp');
ok(Math.abs(items[2].entry.coefficients[2] - items[3].entry.coefficients[2]) < 1e-15, 'same material from nm and µm databases gives the same coefficients');
ok(items[4].entry.formulaNum === -1 && items[4].entry.tabData.length === 3, 'OptiLayer table parsed');
ok(errors[0].file === 'broken.mat' && errors[0].program === 'tfcalc' && /TFCalc/.test(errors[0].error), 'unreadable file reported with its program');
ok(errors[1].file === 'glass.agf' && errors[1].program === null && errors[1].code === 'unsupported-type', 'unsupported extension reported by code');

const forced = parseMaterialFiles(files.slice(2, 4), { ...DEFAULT_IMPORT_UNITS, macleod: 'um' });
ok(forced.items[0].unit === 'um' && Math.abs(forced.items[0].entry.coefficients[2] - 6000.69867) < 1e-9, 'unit override applies to every Macleod file');

const tfUm = parseMaterialFiles(files.slice(0, 1), { ...DEFAULT_IMPORT_UNITS, tfcalc: 'um' });
ok(tfUm.items[0].entry.tabData[0][0] === 550000, 'TFCalc µm setting scales the table');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
