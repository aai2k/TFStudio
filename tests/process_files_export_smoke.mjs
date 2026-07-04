// Smoke test for processFileExport.js — calls buildResFileContent directly
// with stub materials and compares the layer-table + data-header rows against
// the reference 02.res for a 2-layer ZrO2/SiO2 design.

import { buildResFileContent } from '../src/utils/io/processFileExport.js';
import fs from 'node:fs';

const makeMat = (n, k = 0) => ({ getNK: () => [n, k] });

const allLayers = [
    // Deposition order: substrate-side first.
    { materialId: 'ZrO2', thickness: 46.429,  matObj: makeMat(2.100) },
    { materialId: 'SiO2', thickness: 199.251, matObj: makeMat(1.468) },
];

// Step 2 = full deposition (both layers at full thickness).
const content = buildResFileContent({
    designName: 'Test 50/50',
    controlLambda: 390,
    aoi: 0,
    polarization: 'avg',
    quantity: 'T',
    lambdaStart: 400,
    lambdaEnd: 1100,
    lambdaStep: 0.4375,
    allLayers,
    stepK: 2,
    substrateMat: makeMat(1.52, 0),
    substrateThk: 1.0,
    incidentMat: makeMat(1.0, 0),
    exitMat: makeMat(1.0, 0),
    otherSideLayers: [],
    activeSide: 'front',
    outputDir: 'X:\\TFStudio Dev\\Test Output',
    appVersion: '0.1.0',
    projectLabel: 'Test 50/50',
});

const lines = content.split('\r\n');
console.log(`Generated content: ${content.length} chars, ${lines.length} lines`);
console.log('\n--- First 25 lines ---');
for (let i = 0; i < 25; i++) console.log(JSON.stringify(lines[i]));

// Compare against reference 02.res
const refPath = 'X:/TFStudio Dev/reference/For spectrophotometer/02.res';
const ref = fs.readFileSync(refPath).toString('binary').split(/\r?\n/);

// Reference layer rows (indices 14, 15):
const refRow1 = '   1     46.429      97.500     0.250000     1.000000   H    A   ZrO2';
const refRow2 = '   2    199.251     292.500     0.750000     3.000000   L    A   SiO2';

console.log('\n--- Layer table rows ---');
console.log('REF row 1:', JSON.stringify(refRow1));
console.log('OUR row 1:', JSON.stringify(lines[14]));
console.log('MATCH:    ', lines[14] === refRow1);
console.log('REF row 2:', JSON.stringify(refRow2));
console.log('OUR row 2:', JSON.stringify(lines[15]));
console.log('MATCH:    ', lines[15] === refRow2);

console.log('\n--- Data column header ---');
console.log('REF:', JSON.stringify(' Wavelength      Ta    '));
console.log('OUR:', JSON.stringify(lines[23]));

console.log('\n--- AOI line ---');
console.log('REF:', JSON.stringify('Page # 1,  Angle of incidence =  0.00'));
console.log('OUR:', JSON.stringify(lines[22]));

console.log('\n--- First 3 data rows (wavelength format) ---');
for (let i = 24; i < 27; i++) {
    console.log('OUR:', JSON.stringify(lines[i]));
    console.log('REF:', JSON.stringify(ref[i]));
}

// Final sanity: count of data rows must match reference.
const dataStart = 24;
const ourDataRows = lines.length - dataStart - 1;  // last is empty after final CRLF
const refDataRows = ref.length - dataStart - 1;
console.log(`\nData rows OUR=${ourDataRows} REF=${refDataRows}  ${ourDataRows === refDataRows ? 'OK' : 'MISMATCH'}`);
