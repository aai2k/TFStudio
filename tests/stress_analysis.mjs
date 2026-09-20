/**
 * The stress model against Essential Macleod's own table.
 *
 * The papers settle the formulas and `tests/stress_model.mjs` checks them
 * against their worked examples. Two quantities are not in any of them:
 * Macleod's cracking parameter and its delamination factor, which are its own
 * construction on top of Klokholm. Its reading of the intrinsic stress across
 * three temperatures is not printed anywhere either, only described in words
 * in its manual.
 *
 * So the case was built in Essential Macleod and its Tools, Analysis, Stress
 * table copied out on 2026-09-20, at three settings of the dialog. The design,
 * the materials and the script that writes them are under
 * `validation\macleod\Stress validation case\`, with the tables and what they
 * settled beside them.
 *
 * What the three runs pin down between them:
 *   - the intrinsic-stress bookkeeping, on two films whose two thermal terms
 *     carry opposite signs, at three deposition and evaluation temperatures;
 *   - the cracking parameter as the sum over films of U/(2γ), each film
 *     against its own surface energy, not the stack against a mean one;
 *   - the delamination factor as belonging to the interface on the substrate
 *     side of each film, counting that film and everything outside it;
 *   - the radius and the deflection both positive for the convex coated face
 *     a compressive coating leaves;
 *   - the substrate thickness and diameter entering only the geometry, which
 *     the three runs vary by a factor of three and fifteen.
 *
 * One thing the program gets wrong: its shear column is headed GPa and holds
 * MPa. Every value matches k|F| in MPa across all three runs.
 */
import assert from 'node:assert/strict';
import { filmForceNm, filmStressPa, interfaceForcesNm } from '../src/utils/physics/stress/filmStress.js';
import {
    centreDeflectionM, curvaturePerM, edgeShearPa, radiusM, shearParameterPerM,
} from '../src/utils/physics/stress/stoney.js';
import {
    crackingParameter, delaminationFactors, strainEnergyJm2, totalStrainEnergyJm2,
} from '../src/utils/physics/stress/strainEnergy.js';

const GPA = 1e9;
const MPA = 1e6;

// The table prints two or three figures and rounds. Expected values are kept
// as the strings it showed, and the tolerance is half of the last place it
// printed, or a twentieth of a percent of the value, whichever is looser: a
// number shown as 4400 is three figures, not four.
function close(actual, printed, message) {
    const expected = Number(printed);
    const decimals = (String(printed).split('.')[1] || '').length;
    const tolerance = Math.max(0.5 * 10 ** -decimals, Math.abs(expected) * 0.005);
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}: ${actual} is not within ${tolerance} of ${expected}`);
}

// ── The case, as the materials carry it ──────────────────────────────────────

const H = {
    youngsModulusGPa: 200, poissonsRatio: 0.25, linearExpansionPerK: 3.0e-6,
    intrinsicStressMPa: -300, referenceTemperatureC: 300, surfaceEnergyJm2: 1.0,
};
const L = {
    youngsModulusGPa: 70, poissonsRatio: 0.17, linearExpansionPerK: 10.0e-6,
    intrinsicStressMPa: 150, referenceTemperatureC: 200, surfaceEnergyJm2: 0.3,
};
const SUBSTRATE = {
    youngsModulusGPa: 80, poissonsRatio: 0.22, linearExpansionPerK: 5.0e-6, surfaceEnergyJm2: 0.5,
};

// Essential Macleod numbers layers from the incident medium; this engine, like
// the rest of TFStudio, numbers them from the substrate.
const MACLEOD_LAYERS = [
    { material: H, thicknessNm: 300 },
    { material: L, thicknessNm: 250 },
    { material: H, thicknessNm: 450 },
    { material: L, thicknessNm: 400 },
];

// ── The three runs of the dialog ─────────────────────────────────────────────

const CASES = [
    {
        dialog: { temperatureC: 20, depositionTemperatureC: 3000, thicknessMm: 15, diameterMm: 33 },
        whole: { energy: '53.1', radius: '1050', deflectionMm: '0.000129', cracking: '34.8' },
        layers: [
            { stressGPa: '-4.05', energy: '18.4', delamination: '14.2', shearMPa: '6.84' },
            { stressGPa: '-0.955', energy: '2.7', delamination: '16.3', shearMPa: '8.18' },
            { stressGPa: '-4.05', energy: '27.7', delamination: '37.6', shearMPa: '18.4' },
            { stressGPa: '-0.955', energy: '4.32', delamination: '66.4', shearMPa: '20.6' },
        ],
    },
    {
        dialog: { temperatureC: 10, depositionTemperatureC: 5000, thicknessMm: 40, diameterMm: 500 },
        whole: { energy: '152', radius: '4410', deflectionMm: '0.00709', cracking: '105' },
        layers: [
            { stressGPa: '-6.72', energy: '50.8', delamination: '39.1', shearMPa: '6.95' },
            { stressGPa: '-1.79', energy: '9.54', delamination: '46.4', shearMPa: '8.5' },
            { stressGPa: '-6.72', energy: '76.2', delamination: '105', shearMPa: '18.9' },
            { stressGPa: '-1.79', energy: '15.3', delamination: '190', shearMPa: '21.4' },
        ],
    },
    {
        dialog: { temperatureC: -40, depositionTemperatureC: 5000, thicknessMm: 40, diameterMm: 500 },
        whole: { energy: '152', radius: '4400', deflectionMm: '0.0071', cracking: '104' },
        layers: [
            { stressGPa: '-6.75', energy: '51.2', delamination: '39.4', shearMPa: '6.98' },
            { stressGPa: '-1.77', energy: '9.32', delamination: '46.6', shearMPa: '8.51' },
            { stressGPa: '-6.75', energy: '76.8', delamination: '106', shearMPa: '19' },
            { stressGPa: '-1.77', energy: '14.9', delamination: '190', shearMPa: '21.4' },
        ],
    },
];

for (const runCase of CASES) {
    const { temperatureC, depositionTemperatureC, thicknessMm, diameterMm } = runCase.dialog;
    const label = `T ${temperatureC}, deposited at ${depositionTemperatureC}, ${thicknessMm} mm by ${diameterMm} mm`;

    const run = {
        substrateExpansionPerK: SUBSTRATE.linearExpansionPerK,
        temperatureC,
        depositionTemperatureC,
    };
    const substrate = {
        youngsPa: SUBSTRATE.youngsModulusGPa * GPA,
        poissonsRatio: SUBSTRATE.poissonsRatio,
        biaxialPa: SUBSTRATE.youngsModulusGPa * GPA / (1 - SUBSTRATE.poissonsRatio),
        thicknessM: thicknessMm * 1e-3,
    };
    const discRadiusM = diameterMm * 1e-3 / 2;

    const films = MACLEOD_LAYERS.slice().reverse().map(layer => ({
        stressPa: filmStressPa(layer.material, run),
        thicknessM: layer.thicknessNm * 1e-9,
        youngsPa: layer.material.youngsModulusGPa * GPA,
        poissonsRatio: layer.material.poissonsRatio,
        surfaceEnergyJm2: layer.material.surfaceEnergyJm2,
    }));

    const shearParameter = shearParameterPerM(films, substrate);
    const forces = interfaceForcesNm(films);
    const factors = delaminationFactors(films, SUBSTRATE.surfaceEnergyJm2);

    runCase.layers.forEach((row, index) => {
        // Row 1 of the table is the outermost film, the last of this list.
        const film = films.length - 1 - index;
        const where = `${label}, table layer ${index + 1}`;
        close(films[film].stressPa / GPA, row.stressGPa, `${where}: the stress the three temperatures leave`);
        close(strainEnergyJm2(films[film]), row.energy, `${where}: strain energy`);
        close(factors[film], row.delamination, `${where}: delamination factor`);
        close(edgeShearPa(shearParameter, forces[film]) / MPA, row.shearMPa,
            `${where}: peak shear at the interface below it, in MPa whatever the column is headed`);
    });

    const curvature = curvaturePerM(filmForceNm(films), substrate);
    close(totalStrainEnergyJm2(films), runCase.whole.energy, `${label}: total strain energy, the plain sum over the films`);
    close(radiusM(curvature), runCase.whole.radius, `${label}: radius of curvature, positive for a convex coated face`);
    close(centreDeflectionM(curvature, discRadiusM) * 1e3, runCase.whole.deflectionMm,
        `${label}: centre deflection in mm, positive with the radius`);
    close(crackingParameter(films), runCase.whole.cracking, `${label}: cracking parameter`);

    // The reading Essential Macleod does not use, kept so a later change
    // cannot quietly swap one for the other.
    const meanSurfaceEnergy = films.reduce((sum, film) => sum + film.surfaceEnergyJm2 * film.thicknessM, 0)
        / films.reduce((sum, film) => sum + film.thicknessM, 0);
    const alternative = totalStrainEnergyJm2(films) / (2 * meanSurfaceEnergy);
    assert.ok(Math.abs(alternative - Number(runCase.whole.cracking)) > 1,
        `${label}: the two readings of the cracking parameter are far enough apart to tell apart`);
}

console.log(`stress_analysis: ok (${CASES.length} runs of the dialog)`);
