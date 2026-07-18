/**
 * Per-trial deviation draws (thickness + refractive-index) and the perturbed
 * layer stacks built from them. See ../errorAnalysis.js for the full
 * statistical model and references.
 */

import { sampleDeviation } from './sampling.js';
import { makeShiftedMaterial } from './spectrumEval.js';

function drawThicknessDeviations(layers, config) {
    const deviations = new Float64Array(layers.length);
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].thickness <= 0) {
            deviations[i] = 0;
            continue;
        }
        const level = config.rmsAbsNm + (config.rmsRelPct / 100) * layers[i].thickness;
        deviations[i] = sampleDeviation(level, config.distribution, config.rng);
    }
    return deviations;
}

function reuseMaterialDeviations(layers, idDraws) {
    const dn = new Float64Array(layers.length);
    const dk = new Float64Array(layers.length);
    for (let i = 0; i < layers.length; i++) {
        const deviation = idDraws.get(layers[i].material);
        if (deviation) {
            dn[i] = deviation.dn;
            dk[i] = deviation.dk;
        }
    }
    return [dn, dk];
}

function drawPerMaterialIndexDeviations(config) {
    // Front-first insertion order is part of the seeded Monte Carlo sequence.
    const needed = new Set();
    for (const layer of config.front) if (layer.thickness > 0) needed.add(layer.material);
    for (const layer of config.back) if (layer.thickness > 0) needed.add(layer.material);

    const idDraws = new Map();
    for (const id of needed) {
        idDraws.set(id, {
            dn: sampleDeviation(config.rmsReN, config.distribution, config.rng),
            dk: sampleDeviation(config.rmsImN, config.distribution, config.rng),
        });
    }
    const [dnF, dkF] = reuseMaterialDeviations(config.front, idDraws);
    const [dnB, dkB] = reuseMaterialDeviations(config.back, idDraws);
    return { dnF, dkF, dnB, dkB };
}

function drawLayerIndexDeviations(count, config) {
    const dn = new Float64Array(count);
    const dk = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        // Keep dn/dk interleaved for each layer to preserve RNG draw order.
        dn[i] = sampleDeviation(config.rmsReN, config.distribution, config.rng);
        dk[i] = sampleDeviation(config.rmsImN, config.distribution, config.rng);
    }
    return [dn, dk];
}

function drawPerLayerIndexDeviations(config) {
    const [dnF, dkF] = drawLayerIndexDeviations(config.front.length, config);
    const [dnB, dkB] = drawLayerIndexDeviations(config.back.length, config);
    return { dnF, dkF, dnB, dkB };
}

function linkOpticalThickness(layers, materials, dn, thicknessDeviations, lambdaReference) {
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].thickness <= 0 || !materials[i]) continue;
        const [nNom] = materials[i].getNK(lambdaReference);
        const nNew = nNom + dn[i];
        if (nNew > 1e-3) {
            thicknessDeviations[i] = layers[i].thickness * (nNom / nNew - 1);
        }
    }
}

function maskUnusedSides(draws, config) {
    if (!config.usesFront) {
        draws.dThkF.fill(0);
        draws.dnF.fill(0);
        draws.dkF.fill(0);
    }
    if (!config.usesBack) {
        draws.dThkB.fill(0);
        draws.dnB.fill(0);
        draws.dkB.fill(0);
    }
}

function perturbLayers(layers, thicknessDeviations) {
    return layers.map((layer, index) => ({
        ...layer,
        thickness: Math.max(0, layer.thickness + thicknessDeviations[index]),
    }));
}

function makeTrialMaterialResolver(draws, state, config) {
    if (!config.hasIndexErrors) return null;
    return (side, index) => {
        const baseMaterials = side === 'front' ? state.frontMaterials : state.backMaterials;
        const dn = side === 'front' ? draws.dnF : draws.dnB;
        const dk = side === 'front' ? draws.dkF : draws.dkB;
        const base = baseMaterials[index];
        if (!base) return base;
        const indexK = dk[index];
        const baseK = base.getNK(config.lambdaReference)[1];
        // A shifted material cannot cross into negative absorption.
        const clampedK = (baseK + indexK < 0) ? -baseK : indexK;
        return makeShiftedMaterial(base, dn[index], clampedK);
    };
}

export function prepareMCTrial(config, state) {
    // Draw front and back unconditionally; side masking occurs only after all draws.
    const dThkF = drawThicknessDeviations(config.front, config);
    const dThkB = drawThicknessDeviations(config.back, config);
    const indexDraws = config.perMaterialErrors
        ? drawPerMaterialIndexDeviations(config)
        : drawPerLayerIndexDeviations(config);
    const draws = { dThkF, dThkB, ...indexDraws };

    if (config.keepOpticalThickness) {
        linkOpticalThickness(config.front, state.frontMaterials, draws.dnF,
            draws.dThkF, config.lambdaReference);
        linkOpticalThickness(config.back, state.backMaterials, draws.dnB,
            draws.dThkB, config.lambdaReference);
    }
    maskUnusedSides(draws, config);

    const frontLayers = perturbLayers(config.front, draws.dThkF);
    const backLayers = perturbLayers(config.back, draws.dThkB);
    return {
        ...draws,
        frontLayers,
        backLayers,
        getMatForLayer: makeTrialMaterialResolver(draws, state, config),
    };
}
