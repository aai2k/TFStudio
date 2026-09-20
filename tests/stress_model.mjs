/**
 * The film stress model against the worked examples of the papers it is
 * transcribed from.
 *
 * Every number asserted here is printed in one of those papers, so this file
 * is where a transcription error shows up: a dropped factor, a sign, a
 * biaxial modulus written where Young's modulus belongs. The papers print
 * three or four digits, and the tolerances say so.
 *
 *   C. A. Klein, Opt. Eng. 40, 1115 (2001), §5: CVD diamond on ZnS
 *   E. Suhir, J. Appl. Phys. 88, 2363 (2000), §III: titanium on silicon
 *   E. Klokholm, IBM J. Res. Dev. 31, 585 (1987), Table 1: cracking thickness
 */
import assert from 'node:assert/strict';
import {
    filmForceNm, filmStressPa, interfaceForcesNm, missingStressFields,
} from '../src/utils/physics/stress/filmStress.js';
import {
    centreDeflectionM, curvaturePerM, edgeShearPa, interfaceSubstrateStressPa,
    radiusM, shearParameterPerM, substrateStressPa,
} from '../src/utils/physics/stress/stoney.js';
import {
    crackingThicknessM, strainEnergyJm2, totalStrainEnergyJm2,
} from '../src/utils/physics/stress/strainEnergy.js';

const GPA = 1e9;
const MPA = 1e6;
const UM = 1e-6;
const PSI = 6894.757293168361;

function close(actual, expected, tolerance, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}: ${actual} is not within ${tolerance} of ${expected}`);
}

// ── Klein 2001 §5: CVD diamond on ZnS ────────────────────────────────────────
//
// A 50 µm diamond coating on a ZnS window 5 mm thick and 100 mm across, with
// a mismatch strain of -0.0045 left by the cooling from deposition.

const znsYoungsPa = 74.5 * GPA;
const znsPoissons = 0.29;
const zns = {
    youngsPa: znsYoungsPa,
    poissonsRatio: znsPoissons,
    biaxialPa: znsYoungsPa / (1 - znsPoissons),
    thicknessM: 5e-3,
};
const windowRadiusM = 50e-3;
close(zns.biaxialPa / GPA, 105, 0.5, "the substrate's biaxial modulus");

const diamondYoungsPa = 1143 * GPA;
const diamondPoissons = 0.069;
const diamondBiaxialPa = diamondYoungsPa / (1 - diamondPoissons);
close(diamondBiaxialPa / GPA, 1228, 1, "the coating's biaxial modulus");

const diamond = {
    stressPa: diamondBiaxialPa * -0.0045,
    thicknessM: 50 * UM,
    youngsPa: diamondYoungsPa,
    poissonsRatio: diamondPoissons,
};
close(diamond.stressPa / GPA, -5.53, 0.01, 'the stress the mismatch strain makes (Eq. 2)');

const diamondForce = filmForceNm([diamond]);
const diamondCurvature = curvaturePerM(diamondForce, zns);

assert.ok(radiusM(diamondCurvature) > 0, 'a compressive coating leaves the coated face convex');
close(centreDeflectionM(diamondCurvature, windowRadiusM) * 1e3, 0.8, 0.02,
    'the deflection of the centre of the window in mm (Eq. 47), positive as the radius is');
close(interfaceSubstrateStressPa(diamondForce, zns) / MPA, 220, 2,
    'the stress the substrate carries under the coating (Eq. 5)');
close(substrateStressPa(diamondForce, zns, 0), 2 * diamondForce / zns.thicknessM, 1,
    'and 2F/t at its uncoated face (Eq. 4)');

const diamondK = shearParameterPerM([diamond], zns);
close(diamondK / 100, 5.49, 0.01, 'the shear parameter in cm⁻¹ (Eq. 8)');
close(diamondK * windowRadiusM, 27.5, 0.1, 'k r₀, far above one, so the edge strip is narrow');
close(edgeShearPa(diamondK, interfaceForcesNm([diamond])[0]) / MPA, 150, 3,
    'the peak shear at the edge of the coating (Eq. 46)');

// The buffer layer of Eq. (34): a CaLa2S4 film of the opposite mismatch,
// thick enough to cancel the diamond's force, leaves the window flat.
const bufferStressPa = (96 * GPA / (1 - 0.25)) * 0.0065;
const bufferThicknessM = -diamondForce / bufferStressPa;
close(bufferThicknessM / diamond.thicknessM, 6.64, 0.01,
    'the buffer thickness that nulls the bending force, in diamond thicknesses');
const buffered = [
    { stressPa: bufferStressPa, thicknessM: bufferThicknessM, youngsPa: 96 * GPA, poissonsRatio: 0.25 },
    diamond,
];
close(filmForceNm(buffered), 0, 1e-6, 'so the two films together carry no force');
close(curvaturePerM(filmForceNm(buffered), zns), 0, 1e-15, 'and the window stays flat');

// ── Suhir 2000 §III: titanium on a thin silicon substrate ────────────────────
//
// 0.01 µm of titanium on 3.5 µm of silicon, 250 µm in radius, cooled 625 °C
// from deposition. Suhir prints psi; the engine works in Pa.

const siliconYoungsPa = 17.5e6 * PSI;
const siliconPoissons = 0.22;
const silicon = {
    youngsPa: siliconYoungsPa,
    poissonsRatio: siliconPoissons,
    biaxialPa: siliconYoungsPa / (1 - siliconPoissons),
    thicknessM: 3.5 * UM,
};
const siliconRadiusM = 250 * UM;

const titaniumStressPa = filmStressPa(
    { youngsModulusGPa: 16e6 * PSI / GPA, poissonsRatio: 0.30, linearExpansionPerK: 8.6e-6 },
    { substrateExpansionPerK: 3.2e-6, temperatureC: 0, depositionTemperatureC: 625 },
);
close(titaniumStressPa / PSI, 77142, 2, 'the mismatch stress after cooling by 625 °C (Eq. 28)');
assert.ok(titaniumStressPa > 0, 'a film that expands more than its substrate goes tensile on cooling');

const titanium = {
    stressPa: titaniumStressPa,
    thicknessM: 0.01 * UM,
    youngsPa: 16e6 * PSI,
    poissonsRatio: 0.30,
};
const titaniumForce = filmForceNm([titanium]);
const titaniumCurvature = curvaturePerM(titaniumForce, silicon);
close(titaniumCurvature * 1e-3, 0.016841, 1e-6, 'the curvature in mm⁻¹');
// Suhir prints the deflection as a magnitude; the tensile film here pulls the
// coated face concave, which is the negative sign of this convention.
close(centreDeflectionM(titaniumCurvature, siliconRadiusM) / UM, -0.5263, 1e-3,
    'the deflection of the centre in µm (Eq. 44)');

const titaniumK = shearParameterPerM([titanium], silicon);
close(titaniumK * UM, 5.913, 1e-3, 'the shear parameter in µm⁻¹ (Eq. 13)');
close(edgeShearPa(titaniumK, titaniumForce) / PSI, 4561.5, 1,
    'the peak interfacial shear in psi (Eq. 27)');

// ── Klokholm 1987 Table 1: the thickness at which a film cracks ──────────────
//
// His numbers are cgs: 1 dyn/cm² is 0.1 Pa, 1 erg/cm² is 1e-3 J/m². He drops
// (1 − ν), which is the ν = 0 case of the expression here.

const DYN_PER_CM2 = 0.1;
const ERG_PER_CM2 = 1e-3;

const crackingUm = (stressDyn, energyErg) => crackingThicknessM({
    stressPa: stressDyn * DYN_PER_CM2,
    youngsPa: 1e12 * DYN_PER_CM2,
    poissonsRatio: 0,
    surfaceEnergyJm2: energyErg * ERG_PER_CM2,
}) / UM;

close(crackingUm(1e9, 500), 10, 1e-9, 'a 1e9 dyn/cm² film cracks above 10 µm with γ = 500 erg/cm²');
close(crackingUm(1e9, 2000), 40, 1e-9, 'and above 40 µm with γ = 2000');
close(crackingUm(1e10, 500), 0.1, 1e-12, 'ten times the stress is a hundredth of the thickness');
close(crackingUm(1e10, 2000), 0.4, 1e-12, 'the same at the higher surface energy');

// ── The temperature bookkeeping ──────────────────────────────────────────────
//
// Essential Macleod manual pp. 231-234, written out in filmStress.js.

const film = {
    youngsModulusGPa: 200, poissonsRatio: 0.3,
    linearExpansionPerK: 10e-6, intrinsicStressMPa: -180, referenceTemperatureC: 250,
};
const withSubstrate = { substrateExpansionPerK: 0.5e-6, temperatureC: 250, depositionTemperatureC: 250 };

close(filmStressPa(film, withSubstrate) / MPA, -180, 1e-9,
    'with the three temperatures equal the stress is the reference stress');
close(filmStressPa(film, { ...withSubstrate, temperatureC: 20 }) / MPA, 444.29, 0.01,
    'cooling to room temperature adds the mismatch term');
close(filmStressPa(film, { substrateExpansionPerK: 0.5e-6, temperatureC: 20, depositionTemperatureC: 20 }) / MPA,
    477.14, 0.01,
    'and depositing below the reference temperature adds the correction to the reference stress');

close(filmStressPa({ intrinsicStressMPa: -300 }, withSubstrate) / MPA, -300, 1e-9,
    'a material with a measured stress but no elastic constants keeps the stress and gains no thermal term');
assert.equal(filmStressPa({ youngsModulusGPa: 70, poissonsRatio: 0.17 }, withSubstrate), null,
    'and one that states neither has no stress to report');
assert.deepEqual(missingStressFields({ intrinsicStressMPa: -300 }),
    ['youngsModulusGPa', 'poissonsRatio', 'linearExpansionPerK', 'referenceTemperatureC'],
    'what a stress is missing is named rather than substituted for');
assert.deepEqual(missingStressFields(film), [], 'a material that states them all lacks nothing');

// ── A stack, and a mirrored back coating ─────────────────────────────────────

const stack = [
    { stressPa: 100 * MPA, thicknessM: 200e-9, youngsPa: 100 * GPA, poissonsRatio: 0.25 },
    { stressPa: -300 * MPA, thicknessM: 100e-9, youngsPa: 70 * GPA, poissonsRatio: 0.17 },
];
assert.deepEqual(interfaceForcesNm(stack).map(force => +force.toFixed(9)), [-10, -30],
    'each interface carries the films outside it, the substrate interface all of them');
close(interfaceForcesNm(stack)[0], filmForceNm(stack), 1e-12, 'which is the whole film force');
const stackK = shearParameterPerM(stack, zns);
close(edgeShearPa(stackK, interfaceForcesNm(stack)[0]), stackK * Math.abs(filmForceNm(stack)), 1e-9,
    'and the shear at the lowest interface is k times it');

close(strainEnergyJm2({ ...diamond, stressPa: -diamond.stressPa }), strainEnergyJm2(diamond), 1e-12,
    'a tensile film stores the energy a compressive one of the same stress does');

const mirrored = filmForceNm([diamond]) - filmForceNm([diamond]);
assert.equal(mirrored, 0, 'a mirrored back coating nulls the bending force');
assert.equal(curvaturePerM(mirrored, zns), 0, 'so the substrate stays flat');
assert.equal(radiusM(curvaturePerM(mirrored, zns)), null, 'and has no radius to print');
close(totalStrainEnergyJm2([diamond, diamond]), 2 * strainEnergyJm2(diamond), 1e-9,
    'while the strain energy it stores doubles');

console.log('stress_model: ok');
