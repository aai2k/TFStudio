// The stress state of a design on its substrate, per film and for the part as a
// whole, as the Stress window computes it (stressAnalysis/model.js, physics in
// utils/physics/stress/).

import { computeStress } from '../components/windows/analysis/stressAnalysis/model.js';
import { resolveEvalMode } from '../utils/physics/optimizer.js';
import { requireResolved } from './materials.js';

const stated = value => typeof value === 'number' && Number.isFinite(value);

/**
 * The stress each film carries and what the coating does to the part, as the
 * [Stress](/analysis/stress/) window computes them from the constants on the
 * materials' Mechanical tab and the design's run: its two temperatures, the
 * substrate thickness and its diameter, which `newDesign` and
 * `setDesignSetup` set. A film's stress is σ_ref plus the thermal terms of
 * the run, tensile positive; the force is Σ σ·d, the quantity Stoney's
 * equation turns into a curvature and the one the `STR` merit row reads. The
 * coatings that count follow the design's
 * [evaluation mode](/design/evaluation-modes/), as the window and the `STR`
 * row count them. With coatings on both faces the force is F_front − F_back,
 * since the two bend the substrate against each other; a coating on one face
 * alone is referred to that face, so it reads the same on the back as on the
 * front. The radius and the deflection are positive for the convex face a
 * compressive coating leaves.
 *
 * A film whose material states no intrinsic stress has a stress of null. It
 * counts as carrying none in the force and the edge shear, as in the `STR`
 * row, and leaves null what sums its strain energy: its own, the delamination
 * factor of it and of every film below it, the total strain energy and the
 * cracking parameter. Nothing else is substituted: any other constant a
 * material does not state leaves the quantities that need it null, and
 * `missing` names the material and the fields. The built-in materials state no
 * constants, so a design of them reads a force of 0; constants come from the
 * catalogs (`init({ dataDir })`) or the materials a design carries.
 *
 * @param design The design.
 * @returns The films and the whole part.
 * @property mode The coatings counted: `'front'`, `'back'` or `'total'`, both faces.
 * @property run The temperatures, `{ temperature, depositionTemperature }` in °C, the one not set reading 20, or null when the design sets neither and each film carries its intrinsic stress alone.
 * @property substrate `{ material, thickness, diameter }`: the material by id, the thickness and the diameter in mm, the diameter null when it is not set.
 * @property whole The part: `force`, N/m; `radius`, the radius of curvature, m, null at no force, since a flat substrate has none; `deflection`, the centre deflection, µm, null without a diameter; `strainEnergy`, the films' total, J/m²; `cracking`, the sum over the films of U/2γ, at 1 the energy to pay for the two faces of a crack. Each null when a constant it needs is missing; a film that states no stress counts as carrying none in the force, the radius and the deflection, and leaves the strain energy and the cracking parameter null.
 * @property films One per film counted, front first, each `{ side, number, material, name, thickness, stress, strainEnergy, delamination, shear }`: number from 1 at the substrate, as the Design Editor numbers layers; material by id and name as the window shows it; thickness in nm; stress in MPa; strainEnergy in J/m²; delamination, the strain energy of the film and every film outside it against the surface energy of the two materials meeting below it, at 1 the energy to let go there; shear, the peak shear at the coating's edge, MPa. `stress` is null when the material states none; `strainEnergy` is then null too, and so is the `delamination` of that film and of every film below it, while `shear` counts it as carrying none. Each is null when another constant it needs is missing.
 * @property missing The materials that leave a constant out, the substrate's included, each `{ material, name, fields }`: material by id, and fields the constants it lacks by their names on the material's `mechanical` record, such as `'youngsModulusGPa'`. Each material is listed once: one that is the substrate and a film, or that two ids name, as `SiO2` and `builtin:SiO2` do, is one entry, under the id the films name it by first.
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror', depositionTemperatureC: 250, substrateDiameterMm: 25.4 }), { formula: '(HL)^4 H' });
 * const s = tf.stress(design);
 * console.log(s.mode, 'force', s.whole.force, 'N/m;', s.films.length, 'films;', s.missing.map(m => m.material).join(', '), 'state no constants');
 */
export function stress(design) {
    requireResolved(design);
    const mode = resolveEvalMode(design);
    const { run, rows, whole, missing } = computeStress(design, mode);
    return {
        mode,
        run: run && { temperature: run.temperatureC, depositionTemperature: run.depositionTemperatureC },
        substrate: {
            material: design.substrate?.material ?? 'BK7',
            thickness: design.substrate?.thickness ?? null,
            diameter: stated(design.substrate?.diameterMm) ? design.substrate.diameterMm : null,
        },
        whole: {
            force: whole.forceNm, radius: whole.radiusM, deflection: whole.deflectionUm,
            strainEnergy: whole.strainEnergy, cracking: whole.cracking,
        },
        films: rows.map(row => ({
            side: row.side, number: row.layerNumber, material: row.materialId, name: row.materialName,
            thickness: row.thicknessNm, stress: row.stressMPa, strainEnergy: row.strainEnergy,
            delamination: row.delamination, shear: row.shearMPa,
        })),
        missing: missing.map(({ materialId, name, fields }) => ({ material: materialId, name, fields })),
    };
}
