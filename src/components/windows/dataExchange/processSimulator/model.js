import { evaluateSpectrumTotal } from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';

export function resolveMaterial(id) {
    return id ? getMaterialById(id) || getMaterial(id) || getMaterial('Air') : getMaterial('Air');
}

function resolveLayers(layers) {
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
        // Front layers are stored outermost-to-substrate; back layers are stored
        // substrate-to-exit. Deposition order is substrate-side first on both sides.
        const frontStored = (design.frontLayers || []).filter(layer => layer && layer.thickness > 0);
        const backStored = (design.backLayers || []).filter(layer => layer && layer.thickness > 0);
        const frontDep = [...frontStored].reverse();
        const backDep = backStored.slice();
        const active = activeSide === 'front' ? frontDep : backDep;
        const other = activeSide === 'front' ? backDep : frontDep;
        const activeDep = resolveLayers(active);
        const otherDep = resolveLayers(other);
        const materialIds = new Set();
        for (const layer of [...activeDep, ...otherDep]) materialIds.add(layer.materialId);
        model = {
            activeDep,
            otherDep,
            materials: Array.from(materialIds),
            incidentMat: resolveMaterial(design.incidentMedium),
            substrateMat: resolveMaterial(design.substrate?.material),
            exitMat: resolveMaterial(design.exitMedium),
            substrateThk: design.substrate?.thickness || 1.0,
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
