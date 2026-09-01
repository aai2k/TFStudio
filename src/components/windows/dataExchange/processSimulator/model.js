import { evaluateDepositionSpectra, evaluateSpectrumTotal } from '../../../../utils/physics/thinFilmMath.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

function resolveLayers(layers, resolveMaterial) {
    return layers.map((layer, index) => ({
        id: `${layer.id || index}-${layer.material}`,
        materialId: layer.material,
        thickness: layer.thickness,
        matObj: resolveMaterial(layer.material),
    }));
}

export function buildDepositionModel(design, activeSide) {
    let model;
    if (!design) {
        model = {
            activeDep: [], otherDep: [], materials: [],
            incidentMat: getMaterial('Air'), substrateMat: getMaterial('BK7'),
            exitMat: getMaterial('Air'), substrateThk: 1.0,
        };
    } else {
        const resolveMaterial = designMaterialLookup(design);
        // Front layers are stored outermost-to-substrate; back layers are stored
        // substrate-to-exit. Deposition order is substrate-side first on both sides.
        const frontStored = (design.frontLayers || []).filter(layer => layer && layer.thickness > 0);
        const backStored = (design.backLayers || []).filter(layer => layer && layer.thickness > 0);
        const frontDep = [...frontStored].reverse();
        const backDep = backStored.slice();
        const active = activeSide === 'front' ? frontDep : backDep;
        const other = activeSide === 'front' ? backDep : frontDep;
        const activeDep = resolveLayers(active, resolveMaterial);
        const otherDep = resolveLayers(other, resolveMaterial);
        const materialIds = new Set();
        for (const layer of [...activeDep, ...otherDep]) materialIds.add(layer.materialId);
        model = {
            activeDep,
            otherDep,
            materials: Array.from(materialIds),
            incidentMat: resolveMaterial(design.incidentMedium),
            substrateMat: resolveMaterial(design.substrate?.material),
            exitMat: resolveMaterial(design.exitMedium),
            substrateThk: design.substrate?.thickness ?? 1.0,
        };
    }
    return model;
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

function partialDepositionState(activeDep, layerIdx, frac) {
    return activeDep.map((layer, index) => {
        const depositionNumber = index + 1;
        let thickness = 0;
        if (depositionNumber < layerIdx) thickness = layer.thickness;
        if (depositionNumber === layerIdx) {
            thickness = layer.thickness * Math.max(0, Math.min(1, frac));
        }
        return { material: layer.matObj, thickness };
    });
}

function storageStacks(options, activeState) {
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

export function computeSpectrum(options) {
    // layerIdx is one-based in deposition order; zero represents the uncoated
    // active side. Wavelengths and thicknesses are in nanometers.
    const activeState = partialDepositionState(options.activeDep, options.layerIdx, options.frac);
    const { frontStored, backStored } = storageStacks(options, activeState);
    const spec = evaluateSpectrumTotal(
        {
            lambdaStart: options.lambdaStart,
            lambdaEnd: options.lambdaEnd,
            lambdaStep: options.lambdaStep,
            theta: options.aoi,
            polarization: options.polarization,
        },
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
 * A front-side run goes through evaluateDepositionSpectra, which computes all
 * steps in one pass over the growing stack. A back-side run keeps the per-step
 * path: its coating grows on the far side of the substrate, where each pass
 * runs at the refracted angle per wavelength, and that geometry is not worth a
 * second kernel for the rarer direction.
 */
export function computeStepSpectra(options) {
    if (!options.activeDep.length) return [];
    if (options.activeSide === 'front') {
        const deposition = options.activeDep.map(
            layer => ({ material: layer.matObj, thickness: layer.thickness }));
        const backStored = options.secondSurface === 'coated'
            ? options.otherDep.map(layer => ({ material: layer.matObj, thickness: layer.thickness }))
            : [];
        const specs = evaluateDepositionSpectra(
            {
                lambdaStart: options.lambdaStart,
                lambdaEnd: options.lambdaEnd,
                lambdaStep: options.lambdaStep,
                theta: options.aoi,
                polarization: options.polarization,
            },
            options.incidentMat,
            options.substrateMat,
            options.exitMat,
            deposition,
            backStored,
            options.substrateThk,
        );
        return specs.map(spec => pickQuantity(spec, options.quantity));
    }
    return options.activeDep.map((_, index) =>
        computeSpectrum({ ...options, layerIdx: index + 1, frac: 1 }));
}
