import { evaluateDepositionSpectra, evaluateSpectrumTotal } from '../../../../utils/physics/thinFilmMath.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { CHAMBER_MEDIUM_ID } from '../../../../utils/monitoring/chamberMedium.js';
import { chipsInRunOrder } from '../../../../utils/monitoring/monoSim.js';

// One side's layers in deposition order, the empty ones dropped. Each keeps
// its step over the whole side, so a chip plan indexed by step still applies
// after the drop, and carries the thickness the piece being read receives.
function resolveLayers(layers, resolveMaterial, { chipByStep = null, witnessRatio = 1 } = {}) {
    return layers
        .map((layer, step) => ({ layer, step }))
        .filter(({ layer }) => layer && layer.thickness > 0)
        .map(({ layer, step }, index) => ({
            id: `${layer.id || index}-${layer.material}`,
            step,
            materialId: layer.material,
            partThickness: layer.thickness,
            thickness: layer.thickness * witnessRatio,
            matObj: resolveMaterial(layer.material),
            chip: chipByStep ? (chipByStep[step] ?? 1) : null,
        }));
}

/**
 * The run as the exporter models it: the active side in deposition order, the
 * other side, and the media the spectrum is read through.
 *
 * The part or the witness chip sits in the chamber, so the spectrum the
 * monitor sees has air on both sides of it whatever media the design is
 * embedded in.
 *
 * With `chips` the run is split over witness chips: each layer carries its
 * chip number and the thickness the witness receives, the substrate is the
 * chip glass, and `chips` lists the chips in the order they enter the run with
 * the deposition indices on each.
 *
 * @param {object|null} chips  { chipByStep, chipMaterial, witnessRatio } for a
 *                             witness-chip run, null for the part
 */
export function buildDepositionModel(design, activeSide, chips = null) {
    if (!design) {
        return {
            activeDep: [], otherDep: [], materials: [], chips: null,
            incidentMat: getMaterial('Air'), substrateId: null, substrateMat: getMaterial('BK7'),
            exitMat: getMaterial('Air'), substrateThk: 1.0,
        };
    }
    const resolveMaterial = designMaterialLookup(design);
    // Front layers are stored outermost-to-substrate; back layers are stored
    // substrate-to-exit. Deposition order is substrate-side first on both sides.
    const frontDep = [...(design.frontLayers || [])].reverse();
    const backDep = (design.backLayers || []).slice();
    const active = activeSide === 'front' ? frontDep : backDep;
    const other = activeSide === 'front' ? backDep : frontDep;
    const activeDep = resolveLayers(active, resolveMaterial, chips
        ? { chipByStep: chips.chipByStep, witnessRatio: chips.witnessRatio || 1 }
        : {});
    const otherDep = resolveLayers(other, resolveMaterial);
    const materialIds = new Set();
    for (const layer of [...activeDep, ...otherDep]) materialIds.add(layer.materialId);
    const air = resolveMaterial(CHAMBER_MEDIUM_ID);
    const substrateId = (chips && chips.chipMaterial) || design.substrate?.material || null;
    return {
        activeDep,
        otherDep,
        materials: Array.from(materialIds),
        chips: chips ? chipsInRunOrder(activeDep.map(layer => layer.chip)) : null,
        incidentMat: air,
        substrateId,
        substrateMat: resolveMaterial(substrateId),
        exitMat: air,
        substrateThk: design.substrate?.thickness ?? 1.0,
    };
}

/**
 * Every material the spectrum is computed with, for the data-range check: the
 * chamber medium, the glass of the piece, the layers being deposited, and the
 * other side's layers when the part is read with them on. The design's own
 * media are not among them, because the piece is read in air.
 *
 * @returns {{ id: string, material: object }[]}
 */
export function evaluatedMaterials(deposition, secondSurface) {
    const asEntry = layer => ({ id: layer.materialId, material: layer.matObj });
    const withOther = !deposition.chips && secondSurface === 'coated';
    return [
        { id: CHAMBER_MEDIUM_ID, material: deposition.incidentMat },
        { id: deposition.substrateId, material: deposition.substrateMat },
        ...deposition.activeDep.map(asEntry),
        ...(withOther ? deposition.otherDep.map(asEntry) : []),
    ];
}

export function effectiveRate(rates, materialId) {
    const rate = parseFloat(rates[materialId]);
    return isFinite(rate) && rate > 0 ? rate : 1.0;
}

export function buildLayerTimes(activeDep, rates) {
    return activeDep.map(layer => layer.thickness / effectiveRate(rates, layer.materialId));
}

export function buildCumulativeTimes(layerTimes) {
    const cumulative = [0];
    for (const time of layerTimes) cumulative.push(cumulative[cumulative.length - 1] + time);
    return cumulative;
}

/**
 * Timeline position that puts a chosen layer under the readouts.
 *
 * A boundary belongs to the layer after it, so stopping exactly at the end of
 * layer k reports layer k+1 at zero thickness. Stopping a hair short leaves the
 * layer that was asked for as the current one, with its full thickness down.
 */
export function stepSeekTime(cumulativeTimes, layerTimes, step) {
    const index = step - 1;
    return cumulativeTimes[index] + layerTimes[index] * (1 - 1e-9);
}

export function deriveProgressState(progress, cumulativeTimes, layerTimes, layerCount) {
    let state = { layerIdx: layerCount, frac: 1, completedSteps: layerCount };
    if (layerCount === 0) {
        state = { layerIdx: 0, frac: 0, completedSteps: 0 };
    } else {
        for (let index = 0; index < layerCount; index++) {
            if (progress < cumulativeTimes[index + 1] - 1e-12) {
                const start = cumulativeTimes[index];
                const duration = layerTimes[index];
                const fraction = duration > 0
                    ? Math.max(0, Math.min(1, (progress - start) / duration))
                    : 1;
                state = { layerIdx: index + 1, frac: fraction, completedSteps: index };
                break;
            }
        }
    }
    return state;
}

// The stack on the piece the current layer grows on, in deposition order:
// the layers before it at full thickness, the current one at `frac`, the rest
// at zero. On witness chips only the layers assigned to that chip are on the
// piece, and before the first layer there is nothing on it.
function partialDepositionState(activeDep, layerIdx, frac, chips) {
    const chip = chips && layerIdx >= 1 ? activeDep[layerIdx - 1].chip : null;
    const state = [];
    activeDep.forEach((layer, index) => {
        if (chips && layer.chip !== chip) return;
        const depositionNumber = index + 1;
        let thickness = 0;
        if (depositionNumber < layerIdx) thickness = layer.thickness;
        if (depositionNumber === layerIdx) {
            thickness = layer.thickness * Math.max(0, Math.min(1, frac));
        }
        state.push({ material: layer.matObj, thickness });
    });
    return state;
}

// A witness chip is grown like a front coating whichever side of the part the
// run deposits, and its back face is bare.
function storageStacks(options, activeState) {
    if (options.chips) return { frontStored: [...activeState].reverse(), backStored: [] };
    let frontStored;
    let backStored;
    if (options.activeSide === 'front') {
        frontStored = [...activeState].reverse();
        backStored = options.secondSurface === 'coated'
            ? options.otherDep.map(layer => ({ material: layer.matObj, thickness: layer.thickness }))
            : [];
    } else {
        backStored = activeState;
        frontStored = options.secondSurface === 'coated'
            ? [...options.otherDep].reverse().map(layer => ({ material: layer.matObj, thickness: layer.thickness }))
            : [];
    }
    return { frontStored, backStored };
}

function spectrumParams(options) {
    return {
        lambdaStart: options.lambdaStart,
        lambdaEnd: options.lambdaEnd,
        lambdaStep: options.lambdaStep,
        theta: options.aoi,
        polarization: options.polarization,
    };
}

export function computeSpectrum(options) {
    // layerIdx is one-based in deposition order; zero represents the uncoated
    // active side. Wavelengths and thicknesses are in nanometers.
    const activeState = partialDepositionState(options.activeDep, options.layerIdx, options.frac, options.chips);
    const { frontStored, backStored } = storageStacks(options, activeState);
    const spec = evaluateSpectrumTotal(
        spectrumParams(options),
        options.incidentMat,
        options.substrateMat,
        options.exitMat,
        frontStored,
        backStored,
        options.substrateThk,
    );
    let values = spec.T;
    if (options.quantity === 'R') values = spec.R;
    if (options.quantity === 'A') values = spec.A;
    return { lambda: spec.lambda, values };
}

function pickQuantity(spec, quantity) {
    let values = spec.T;
    if (quantity === 'R') values = spec.R;
    if (quantity === 'A') values = spec.A;
    return { lambda: spec.lambda, values };
}

/**
 * The finished-layer spectrum for every step of the run.
 *
 * A witness-chip run is a short run per chip, each from bare glass, whose
 * spectra land on the steps of the run its layers occupy. A front-side run on
 * the part goes through evaluateDepositionSpectra, which computes all steps in
 * one pass over the growing stack. A back-side run keeps the per-step path:
 * its coating grows on the far side of the substrate, where each pass runs at
 * the refracted angle per wavelength, and that geometry is not worth a second
 * kernel for the rarer direction.
 */
export function computeStepSpectra(options) {
    if (!options.activeDep.length) return [];
    const params = spectrumParams(options);
    const asDeposition = layer => ({ material: layer.matObj, thickness: layer.thickness });
    if (options.chips) {
        const out = new Array(options.activeDep.length);
        for (const { steps } of options.chips) {
            const specs = evaluateDepositionSpectra(
                params, options.incidentMat, options.substrateMat, options.exitMat,
                steps.map(index => asDeposition(options.activeDep[index])), [], options.substrateThk,
            );
            steps.forEach((index, k) => { out[index] = pickQuantity(specs[k], options.quantity); });
        }
        return out;
    }
    if (options.activeSide === 'front') {
        const backStored = options.secondSurface === 'coated'
            ? options.otherDep.map(asDeposition)
            : [];
        const specs = evaluateDepositionSpectra(
            params,
            options.incidentMat,
            options.substrateMat,
            options.exitMat,
            options.activeDep.map(asDeposition),
            backStored,
            options.substrateThk,
        );
        return specs.map(spec => pickQuantity(spec, options.quantity));
    }
    return options.activeDep.map((_, index) =>
        computeSpectrum({ ...options, layerIdx: index + 1, frac: 1 }));
}
