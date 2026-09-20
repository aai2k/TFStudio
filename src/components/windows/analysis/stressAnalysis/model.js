/**
 * The stress state of a finished design on its substrate: what each film
 * carries, and what the stack as a whole does to the part.
 *
 * The physics is transcribed in `src/utils/physics/stress/`; this module only
 * assembles it from a design. Two rules shape it:
 *
 *   Nothing is substituted. A constant the material does not state leaves the
 *   quantities that need it null, and `missing` names the material and the
 *   fields, so a blank row always has a reason attached to it.
 *
 *   The per-film quantities belong to one coating and the bending belongs to
 *   the part. Strain energy, the delamination factor and the edge shear are
 *   computed per side against that side's own stack; the curvature comes from
 *   the net force, F_front − F_back, because the two coatings bend the
 *   substrate against each other.
 *
 * Which coatings count follows the design's evaluation mode, the same rule the
 * STR merit operand reads, so the force this window bends the substrate with is
 * the force that operand minimizes.
 */

import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { effectiveBackLayers } from '../../../../utils/physics/optimizer.js';
import {
    biaxialModulusPa, interfaceForcesNm, missingStressFields, youngsModulusPa,
} from '../../../../utils/physics/stress/filmStress.js';
import {
    layerStressPa, statesStress, stressCountedSides, stressRun,
} from '../../../../utils/physics/stress/stackForce.js';
import {
    centreDeflectionM, curvaturePerM, edgeShearPa, radiusM, shearParameterPerM,
} from '../../../../utils/physics/stress/stoney.js';
import {
    crackingParameter, delaminationFactors, strainEnergyJm2,
} from '../../../../utils/physics/stress/strainEnergy.js';

const NM = 1e-9;
const UM = 1e-6;
const MM = 1e-3;
const MPA = 1e6;

// What the window reads off the substrate's material. A substrate carries no
// intrinsic stress here and has no reference temperature, so those two are not
// asked of it. A film's list is the stress model's own, `missingStressFields`,
// plus the surface energy the cracking and delamination rows need.
const SUBSTRATE_FIELDS = [
    'youngsModulusGPa', 'poissonsRatio', 'linearExpansionPerK', 'surfaceEnergyJm2',
];

const stated = value => typeof value === 'number' && Number.isFinite(value);

/**
 * The temperatures a run is evaluated at, or null where the design states
 * none. Without them each film carries its intrinsic stress and nothing
 * thermal; inventing a deposition temperature for a design that names none
 * would put a thermal term on a process nobody described.
 *
 * The rule itself is `stressRun`, the one the STR merit operand reads through
 * its evaluation context, so the window and the operand cannot come to
 * different temperatures for the same file.
 */
export function stressRunOf(design, substrateMaterial) {
    return stressRun({ stress: design?.stress || null, nsmat: substrateMaterial });
}

function substrateBundle(design, material) {
    const mechanical = material?.mechanical;
    return {
        materialName: material?.name || design?.substrate?.material || '?',
        mechanical,
        youngsPa: youngsModulusPa(mechanical),
        poissonsRatio: stated(mechanical?.poissonsRatio) ? mechanical.poissonsRatio : null,
        biaxialPa: biaxialModulusPa(mechanical),
        surfaceEnergyJm2: stated(mechanical?.surfaceEnergyJm2) ? mechanical.surfaceEnergyJm2 : null,
        thicknessM: (design?.substrate?.thickness || 0) * MM,
        radiusM: stated(design?.substrate?.diameterMm) ? design.substrate.diameterMm * MM / 2 : null,
    };
}

// One coating as the SI bundles the stress modules take, numbered from the
// substrate outwards. Front stacks are stored air-first, so the front is walked
// in reverse; back stacks are already stored substrate-first.
function filmsOf(layers, side, resolveMaterial, run) {
    const ordered = side === 'back' ? layers : [...layers].reverse();
    return ordered.map((layer, index) => {
        const material = layer.material ? resolveMaterial(layer.material) : null;
        const mechanical = material?.mechanical;
        return {
            side,
            layerNumber: index + 1,
            materialId: layer.material || null,
            materialName: material?.name || layer.material || '?',
            mechanical,
            // Zero for a material that states no intrinsic stress, which is the
            // rule the STR operand follows too; `statesStress` is what tells a
            // real zero from an unknown.
            stressPa: layerStressPa(material, run),
            statesStress: statesStress(material),
            thicknessM: (layer.thickness || 0) * NM,
            youngsPa: youngsModulusPa(mechanical),
            poissonsRatio: stated(mechanical?.poissonsRatio) ? mechanical.poissonsRatio : null,
            surfaceEnergyJm2: stated(mechanical?.surfaceEnergyJm2) ? mechanical.surfaceEnergyJm2 : null,
        };
    });
}

// The shear parameter sums the elastic constants of every film. One that states
// none would drop out of that sum and leave k too large, so it is withheld
// rather than computed from part of the stack.
function shearOf(films, substrate) {
    const complete = films.every(film => film.youngsPa > 0 && stated(film.poissonsRatio));
    return complete ? shearParameterPerM(films, substrate) : null;
}

/** The rows of one coating, and what it contributes to the whole part. */
function sideResult(films, substrate) {
    const energies = films.map(strainEnergyJm2);
    const factors = delaminationFactors(films, substrate.surfaceEnergyJm2);
    const forces = interfaceForcesNm(films);
    const shearParameter = shearOf(films, substrate);
    const rows = films.map((film, index) => ({
        side: film.side,
        layerNumber: film.layerNumber,
        materialId: film.materialId,
        materialName: film.materialName,
        thicknessNm: film.thicknessM / NM,
        stressMPa: film.statesStress ? film.stressPa / MPA : null,
        strainEnergy: energies[index],
        delamination: factors[index],
        shearMPa: shearParameter == null ? null : edgeShearPa(shearParameter, forces[index]) / MPA,
    }));
    return {
        rows,
        forceNm: forces.length ? forces[0] : 0,
        // A partial sum reads as a small one, so both totals need every film.
        strainEnergy: energies.every(stated) ? energies.reduce((sum, value) => sum + value, 0) : null,
        cracking: films.length ? crackingParameter(films) : 0,
    };
}

const addOrNull = (a, b) => (stated(a) && stated(b) ? a + b : null);

function wholePart(front, back, substrate) {
    const forceNm = front.forceNm - back.forceNm;
    const curvature = curvaturePerM(forceNm, substrate);
    const deflectionM = centreDeflectionM(curvature, substrate.radiusM);
    return {
        forceNm,
        radiusM: radiusM(curvature),
        deflectionUm: deflectionM == null ? null : deflectionM / UM,
        strainEnergy: addOrNull(front.strainEnergy, back.strainEnergy),
        cracking: addOrNull(front.cracking, back.cracking),
    };
}

// One entry per material that leaves something out, in the order the layers
// meet it. The substrate is named too, since the curvature and the lowest
// delamination factor read its constants.
function missingConstants(films, substrate) {
    const missing = [];
    const seen = new Set();
    for (const film of films) {
        if (seen.has(film.materialId)) continue;
        seen.add(film.materialId);
        const fields = [
            ...missingStressFields(film.mechanical),
            ...(stated(film.mechanical?.surfaceEnergyJm2) ? [] : ['surfaceEnergyJm2']),
        ];
        if (fields.length) missing.push({ name: film.materialName, fields });
    }
    const substrateFields = SUBSTRATE_FIELDS.filter(field => !stated(substrate.mechanical?.[field]));
    if (substrateFields.length) missing.push({ name: substrate.materialName, fields: substrateFields });
    return missing;
}

/** Bar colour per material, as Layer Thicknesses tints its bars. */
function colorMap(films, resolveMaterial) {
    const map = {};
    for (const film of films) {
        if (!film.materialId || map[film.materialId]) continue;
        const material = resolveMaterial(film.materialId);
        map[film.materialId] = material ? resolveColor(material) : null;
    }
    return map;
}

/**
 * The whole analysis for one design.
 *
 * @param {Object} design    the design, with its `stress` block and substrate
 * @param {string} evalMode  'front' | 'back' | 'total', from `resolveEvalMode`
 */
export function computeStress(design, evalMode) {
    const resolveMaterial = designMaterialLookup(design);
    const substrateMaterial = resolveMaterial(design?.substrate?.material ?? 'BK7');
    const run = stressRunOf(design, substrateMaterial);
    const substrate = substrateBundle(design, substrateMaterial);
    const sides = stressCountedSides(design?.surfaceMode, evalMode);

    const front = sides.front ? filmsOf(design?.frontLayers || [], 'front', resolveMaterial, run) : [];
    const back = sides.back ? filmsOf(effectiveBackLayers(design), 'back', resolveMaterial, run) : [];
    const frontResult = sideResult(front, substrate);
    const backResult = sideResult(back, substrate);
    const films = [...front, ...back];

    return {
        run, substrate, sides,
        bothSides: front.length > 0 && back.length > 0,
        rows: [...frontResult.rows, ...backResult.rows],
        whole: wholePart(frontResult, backResult, substrate),
        missing: missingConstants(films, substrate),
        matColorMap: colorMap(films, resolveMaterial),
    };
}
