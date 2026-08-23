import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import {
    buildEvalContext, calcMF, evaluateOperands, mirrorLayers,
} from '../../../../utils/physics/optimizer.js';

const TWO_PI = 2 * Math.PI;
const layerId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function herpinError(code, detail) {
    const error = new Error(code);
    error.code = code;
    error.detail = detail;
    return error;
}

export function withSideLayers(design, side, layers, extra = {}) {
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    const next = { ...design, ...extra, [key]: layers };
    if (design.surfaceMode === 'symmetric' && side === 'front') {
        next.backLayers = mirrorLayers(layers);
    }
    return next;
}

export function designMerit(design) {
    const operands = design?.meritOperands || [];
    if (!operands.length) return null;
    try {
        const resolveMaterial = designMaterialLookup(design);
        const ctx = buildEvalContext(design, resolveMaterial);
        const value = calcMF(operands, evaluateOperands(operands, ctx));
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

export function quantizeLayers(layers, design, options = {}) {
    const mode = options.mode || 'step';
    const value = Number(options.value);
    const lambda = Number(options.referenceWavelength || design?.referenceWavelength || 550);
    const resolveMaterial = designMaterialLookup(design);
    return (layers || []).map(layer => {
        if (layer.locked) return layer;
        const d = Number(layer.thickness);
        if (!Number.isFinite(d)) return layer;
        let thickness = d;
        if (mode === 'decimals') {
            const places = Math.max(0, Math.min(8, Math.round(Number.isFinite(value) ? value : 2)));
            const scale = 10 ** places;
            thickness = Math.round(d * scale) / scale;
        } else if (mode === 'qwot') {
            const multiple = Number.isFinite(value) && value > 0 ? value : 1;
            const n = resolveMaterial(layer.material)?.getNK?.(lambda)?.[0];
            if (!(Number.isFinite(n) && n > 0 && lambda > 0)) return layer;
            const step = multiple * lambda / (4 * n);
            thickness = Math.round(d / step) * step;
        } else {
            const step = Number.isFinite(value) && value > 0 ? value : 0.1;
            thickness = Math.round(d / step) * step;
        }
        return Math.abs(thickness - d) < 1e-12 ? layer : { ...layer, thickness: Math.max(0, thickness) };
    });
}

export function quantizeDesignSide(design, side, options) {
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    return withSideLayers(design, side, quantizeLayers(design[key] || [], design, options));
}

export function makePerturbationMap(layers, random = Math.random) {
    return Object.fromEntries((layers || []).map(layer => [layer.id, random() * 2 - 1]));
}

export function perturbLayers(layers, percent, perturbationMap) {
    const amplitude = Math.max(0, Number(percent) || 0) / 100;
    return (layers || []).map(layer => {
        if (layer.locked) return layer;
        const kick = Number(perturbationMap?.[layer.id]);
        if (!Number.isFinite(kick)) return layer;
        return { ...layer, thickness: Math.max(0, layer.thickness * (1 + amplitude * kick)) };
    });
}

export function perturbDesignSide(design, side, percent, perturbationMap) {
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    return withSideLayers(
        design, side, perturbLayers(design[key] || [], percent, perturbationMap),
    );
}

function multiplyMatrices(left, right) {
    // Lossless characteristic matrices have real diagonals and imaginary
    // off-diagonals. Store M12/i and M21/i as real b/c to avoid complex-number
    // machinery: [[a, i b], [i c, d]].
    return {
        a: left.a * right.a - left.b * right.c,
        b: left.a * right.b + left.b * right.d,
        c: left.c * right.a + left.d * right.c,
        d: left.d * right.d - left.c * right.b,
    };
}

function nearestEquivalentPhase(cosine, totalPhase, offDiagonal) {
    const base = Math.acos(Math.max(-1, Math.min(1, cosine)));
    const centre = Math.round(totalPhase / TWO_PI);
    const candidates = [];
    for (let k = centre - 2; k <= centre + 2; k++) {
        candidates.push(base + TWO_PI * k, -base + TWO_PI * k);
    }
    const sign = Math.sign(offDiagonal);
    const matching = candidates.filter(gamma => gamma >= 0 && (
        sign === 0 || Math.abs(Math.sin(gamma)) < 1e-10 || Math.sign(Math.sin(gamma)) === sign
    ));
    const pool = matching.length ? matching : candidates.filter(gamma => gamma >= 0);
    return pool.reduce((best, gamma) => (
        Math.abs(gamma - totalPhase) < Math.abs(best - totalPhase) ? gamma : best
    ), pool[0]);
}

function symmetricGroup(layers) {
    for (let i = 0; i < Math.floor(layers.length / 2); i++) {
        const a = layers[i], b = layers[layers.length - 1 - i];
        const scale = Math.max(1, Math.abs(a.thickness), Math.abs(b.thickness));
        if (a.material !== b.material || Math.abs(a.thickness - b.thickness) > 1e-8 * scale) return false;
    }
    return true;
}

// Herpin reduction for a lossless symmetric period. Macleod, Thin-Film
// Optical Filters, 5th ed., section 7.2.2, equations 7.5 through 7.10:
// M11 = M22 = cos(gamma), M12 = i sin(gamma)/E, M21 = i E sin(gamma).
export function herpinCollapsePreview(design, side, selectedIds, referenceWavelength) {
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    const layers = design?.[key] || [];
    const ids = new Set(selectedIds || []);
    const indices = layers.map((layer, index) => ids.has(layer.id) ? index : -1).filter(index => index >= 0);
    if (indices.length < 2) throw herpinError('HERPIN_MIN_SELECTION');
    const first = Math.min(...indices), last = Math.max(...indices);
    if (last - first + 1 !== indices.length) throw herpinError('HERPIN_CONTIGUOUS');
    const group = layers.slice(first, last + 1);
    if (!symmetricGroup(group)) throw herpinError('HERPIN_SYMMETRIC');

    const lambda = Number(referenceWavelength || design.referenceWavelength || 550);
    if (!(lambda > 0)) throw herpinError('HERPIN_REFERENCE');
    const resolveMaterial = designMaterialLookup(design);
    let matrix = { a: 1, b: 0, c: 0, d: 1 };
    let totalPhase = 0;
    for (const layer of group) {
        const [n, k = 0] = resolveMaterial(layer.material).getNK(lambda);
        if (!(Number.isFinite(n) && n > 0)) throw herpinError('HERPIN_INDEX', layer.material);
        if (Math.abs(k) > 1e-7) {
            throw herpinError('HERPIN_LOSSY');
        }
        const delta = TWO_PI * n * layer.thickness / lambda;
        totalPhase += delta;
        matrix = multiplyMatrices(matrix, {
            a: Math.cos(delta), b: Math.sin(delta) / n,
            c: n * Math.sin(delta), d: Math.cos(delta),
        });
    }

    const symmetryError = Math.abs(matrix.a - matrix.d);
    if (symmetryError > 1e-7 * Math.max(1, Math.abs(matrix.a), Math.abs(matrix.d))) {
        throw herpinError('HERPIN_MATRIX');
    }
    const cosine = (matrix.a + matrix.d) / 2;
    if (Math.abs(cosine) > 1 + 1e-9) {
        throw herpinError('HERPIN_STOPBAND');
    }
    if (Math.abs(matrix.b) < 1e-12 || Math.abs(matrix.c) < 1e-12 || matrix.c / matrix.b <= 0) {
        throw herpinError('HERPIN_SINGULAR');
    }
    const equivalentIndex = Math.sqrt(matrix.c / matrix.b);
    const phase = nearestEquivalentPhase(cosine, totalPhase, matrix.b);
    const thickness = phase * lambda / (TWO_PI * equivalentIndex);
    if (!(Number.isFinite(equivalentIndex) && equivalentIndex > 0 && Number.isFinite(thickness))) {
        throw herpinError('HERPIN_CONSTRUCT');
    }

    const materialId = layerId('herpin');
    const originalLayers = group.map(layer => ({ ...layer }));
    const equivalentLayer = {
        id: layerId('l'), material: materialId, thickness,
        locked: group.some(layer => layer.locked),
        herpin: {
            version: 1, referenceWavelength: lambda, equivalentIndex, phase,
            originalLayers,
        },
    };
    const material = {
        id: materialId,
        name: `Herpin E=${equivalentIndex.toFixed(6)} @ ${lambda} nm`,
        color: '#8b5cf6', group: 'Herpin', formulaNum: -1,
        coefficients: [], kTable: [],
        tabData: [[1, equivalentIndex, 0], [10000000, equivalentIndex, 0]],
    };
    const nextLayers = [...layers.slice(0, first), equivalentLayer, ...layers.slice(last + 1)];
    const next = withSideLayers(design, side, nextLayers, {
        materials: { ...(design.materials || {}), [materialId]: material },
    });
    return { design: next, equivalentLayer, group, matrix };
}

export function isHerpinLayer(layer) {
    return !!(layer?.herpin?.version === 1 && Array.isArray(layer.herpin.originalLayers));
}

export function expandHerpinLayer(design, side, layerIdToExpand) {
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    const layers = design?.[key] || [];
    const index = layers.findIndex(layer => layer.id === layerIdToExpand);
    const layer = layers[index];
    if (index < 0 || !isHerpinLayer(layer)) throw herpinError('HERPIN_SELECT_ONE');
    const originals = layer.herpin.originalLayers.map(original => ({ ...original }));
    const nextLayers = [...layers.slice(0, index), ...originals, ...layers.slice(index + 1)];
    let materials = design.materials;
    // In symmetric mode the old back stack is about to be regenerated from the
    // expanded front stack, so do not let its stale mirrored Herpin layer keep
    // an otherwise-orphaned design-scoped material alive.
    const otherSide = design.surfaceMode === 'symmetric' && side === 'front'
        ? [] : side === 'front' ? design.backLayers || [] : design.frontLayers || [];
    const stillUsed = [...nextLayers, ...otherSide]
        .some(candidate => candidate.material === layer.material);
    if (!stillUsed && materials?.[layer.material]) {
        materials = { ...materials };
        delete materials[layer.material];
    }
    return withSideLayers(design, side, nextLayers, { materials });
}
