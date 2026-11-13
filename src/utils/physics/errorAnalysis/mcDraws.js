/**
 * Per-trial deviation draws (thickness + refractive-index) and the perturbed
 * layer stacks built from them. See ../errorAnalysis.js for the full
 * statistical model and references.
 */

import { sampleDeviation } from './sampling.js';
import { makeShiftedMaterial } from './spectrumEval.js';
import { materialsIn } from './mcConfig.js';
import { BASE_ENVIRONMENT, environmentDesign } from '../../environments/environments.js';

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

/**
 * The trial's material of each layer, `(side, index) => material`: the
 * material `materials` gives the layer (`{ front, back }`, on the layer lists'
 * own indices) moved by the layer's Δn and Δk. Null when the run draws no
 * index errors.
 */
export function makeTrialMaterialResolver(draws, materials, config) {
    if (!config.hasIndexErrors) return null;
    return (side, index) => {
        const baseMaterials = side === 'front' ? materials.front : materials.back;
        const dn = side === 'front' ? draws.dnF : draws.dnB;
        const dk = side === 'front' ? draws.dkF : draws.dkB;
        const base = baseMaterials[index];
        if (!base) return base;
        return makeShiftedMaterial(base, dn[index], dk[index]);
    };
}

/**
 * The trial's material of each layer in environment `id`, as
 * makeTrialMaterialResolver gives it: the environment's material for the
 * layer moved by the trial's Δn and Δk.
 */
export function trialMaterialsIn(config, state, data, id) {
    return id === BASE_ENVIRONMENT ? data.getMatForLayer : makeTrialMaterialResolver(data, materialsIn(config, state, id), config);
}

/**
 * The trial coating `data` in environment `id`, as evaluateChar takes it:
 * `{ design, frontLayers, backLayers, getMatForLayer }`. In environment 1 the
 * trial itself; in another environment that environment's coating with the
 * trial's errors: each layer f·(d + Δd) thick, f the factor of its material
 * there, made of the environment's material for it moved by the same Δn and
 * Δk, between the environment's media.
 */
export function trialIn(config, state, data, id) {
    if (id === BASE_ENVIRONMENT) {
        return { design: config.design, frontLayers: data.frontLayers, backLayers: data.backLayers, getMatForLayer: data.getMatForLayer };
    }
    const seen = environmentDesign({ ...config.design, frontLayers: data.frontLayers, backLayers: data.backLayers }, id);
    return {
        design: seen, frontLayers: seen.frontLayers, backLayers: seen.backLayers,
        getMatForLayer: trialMaterialsIn(config, state, data, id),
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
        getMatForLayer: makeTrialMaterialResolver(draws, { front: state.frontMaterials, back: state.backMaterials }, config),
    };
}
