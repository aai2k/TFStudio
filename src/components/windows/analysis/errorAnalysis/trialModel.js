import { designMaterialName } from '../../../../utils/materials/designMaterials.js';
import { displayLayerLabel } from '../layerSensitivity/viewModel.js';

// A layer as the Design Editor shows it: front layers are stored air side
// first but F1 is the one on the substrate, and the material goes by its name,
// not its catalog id.
function layerIdentity(design, side, index, layer, frontCount) {
    return {
        label: displayLayerLabel({ side: side === 'F' ? 'front' : 'back', layerIndex: index }, frontCount),
        material: designMaterialName(design, layer.material),
    };
}

export function hasPerturbableLayers(design, evalMode) {
    const hasFront = !!design?.frontLayers?.length;
    const hasBack = !!design?.backLayers?.length;
    const byMode = { back: hasBack, front: hasFront };
    return evalMode in byMode ? byMode[evalMode] : (hasFront || hasBack);
}

function layerAccumulator(side, idx, layer, identity) {
    return {
        side,
        idx,
        ...identity,
        nominal: layer.thickness || 0,
        sumSq: 0,
        sumAbsFail: 0,
        nFail: 0,
        sumAbsPass: 0,
        nPass: 0,
    };
}

function accumulateTrial(acc, trial) {
    const hasSpec = !!trial.spec;
    const failed = hasSpec && trial.spec.allPass === false;
    const dF = trial.dThkF || [];
    const dB = trial.dThkB || [];
    for (const layer of acc) {
        const d = layer.side === 'F' ? (dF[layer.idx] || 0) : (dB[layer.idx] || 0);
        layer.sumSq += d * d;
        if (hasSpec && failed) {
            layer.sumAbsFail += Math.abs(d);
            layer.nFail++;
        } else if (hasSpec) {
            layer.sumAbsPass += Math.abs(d);
            layer.nPass++;
        }
    }
    return { hasSpec, failed };
}

function finalizeLayerStatistics(acc, trialCount) {
    const n = trialCount || 1;
    for (const layer of acc) {
        layer.rms = Math.sqrt(layer.sumSq / n);
        layer.meanFail = layer.nFail ? layer.sumAbsFail / layer.nFail : 0;
        layer.meanPass = layer.nPass ? layer.sumAbsPass / layer.nPass : 0;
        layer.offender = layer.meanFail - layer.meanPass;
    }
}

export function buildLayerStatistics({ trials, design, front, back, hasFront, hasBack }) {
    const acc = [];
    const add = side => (layer, i) =>
        acc.push(layerAccumulator(side, i, layer, layerIdentity(design, side, i, layer, front.length)));
    if (hasFront) front.forEach(add('F'));
    if (hasBack) back.forEach(add('B'));

    let nFailTrials = 0;
    let nPassTrials = 0;
    for (const trial of trials) {
        const { hasSpec, failed } = accumulateTrial(acc, trial);
        if (hasSpec && failed) nFailTrials++;
        else if (hasSpec) nPassTrials++;
    }
    finalizeLayerStatistics(acc, trials.length);
    return {
        byOffender: [...acc].sort((x, y) => y.offender - x.offender),
        byRms: [...acc].sort((x, y) => y.rms - x.rms),
        nFailTrials,
        nPassTrials,
    };
}

export function buildSpectralSpread(result, corridorSigma) {
    const lam = result.lambda || [];
    const sd = result.stdev || [];
    const mean = result.mean || [];
    const k = corridorSigma > 0 ? corridorSigma : 1;
    const n = sd.length || 1;
    let sumSig = 0;
    let sumWidth = 0;
    let maxSig = -1;
    let maxLam = null;
    for (let i = 0; i < sd.length; i++) {
        sumSig += sd[i];
        const lo = Math.max(0, (mean[i] ?? 0) - k * sd[i]);
        const hi = Math.min(1, (mean[i] ?? 0) + k * sd[i]);
        sumWidth += hi - lo;
        if (sd[i] > maxSig) {
            maxSig = sd[i];
            maxLam = lam[i];
        }
    }
    return {
        meanSig: sumSig / n,
        meanWidth: sumWidth / n,
        maxSig: Math.max(0, maxSig),
        maxLam,
    };
}

export function buildTrialDetailRows({ design, front, back, trial, hasFront, hasBack }) {
    const rows = [];
    if (hasFront) front.forEach((layer, i) => rows.push({
        ...layerIdentity(design, 'F', i, layer, front.length), nominal: layer.thickness || 0,
        dThk: trial?.dThkF?.[i] ?? 0, dn: trial?.dnF?.[i], dk: trial?.dkF?.[i],
    }));
    if (hasBack) back.forEach((layer, i) => rows.push({
        ...layerIdentity(design, 'B', i, layer, front.length), nominal: layer.thickness || 0,
        dThk: trial?.dThkB?.[i] ?? 0, dn: trial?.dnB?.[i], dk: trial?.dkB?.[i],
    }));
    return rows;
}

function applyThicknessDeltas(layers, deltas) {
    return layers.map((layer, i) => {
        if (!deltas) return layer;
        return { ...layer, thickness: Math.max(0, (layer.thickness || 0) + (deltas[i] || 0)) };
    });
}

export function loadTrialThicknesses({ front, back, dThkF, dThkB, checkpoint, updateDesign }) {
    const patch = {};
    if (front.length) patch.frontLayers = applyThicknessDeltas(front, dThkF);
    if (back.length) patch.backLayers = applyThicknessDeltas(back, dThkB);
    checkpoint?.();
    updateDesign(patch);
}
