import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import { wrapMaterial } from '../../../../utils/misc/variator.js';

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function matLabel(mat) {
    if (!mat) return '—';
    return mat.name || mat.id || '?';
}

// Per-design baseline cache — survives docking-window unmount/remount so the
// Revert reference is still meaningful after switching tabs.
const _variatorCache = {};   // { [designId]: { baseFront, baseBack, baseSubstrateMm } }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => { if (e.detail?.id) delete _variatorCache[e.detail.id]; });

export function getVariatorCache(id) {
    if (!id) return null;
    if (!_variatorCache[id]) _variatorCache[id] = { baseFront: null, baseBack: null, baseSubstrateMm: null };
    return _variatorCache[id];
}

export function buildBaseMaps(cache, design) {
    const baseFrontById = new Map((cache?.baseFront || []).map(l => [l.id, l.thickness]));
    const baseBackById  = new Map((cache?.baseBack  || []).map(l => [l.id, l.thickness]));
    const baseSubMm = cache?.baseSubstrateMm ?? (design.substrate?.thickness ?? 1.0);
    return { baseFrontById, baseBackById, baseSubMm };
}

function hasNonzeroDelta(deltas) {
    return Object.values(deltas).some(x => Math.abs(x) > 1e-9);
}

export function computeAnyVaried(dThkFront, dThkBack, dSubMm, dN, dK) {
    return [dThkFront, dThkBack, dN, dK].some(hasNonzeroDelta) || Math.abs(dSubMm) > 1e-9;
}

// Unique-by-material-id list for the n/k offset sliders — one row per
// material actually used somewhere in the stack (front, back, incident,
// substrate, exit).
export function collectUniqueMaterials(design) {
    const ids = new Set();
    const out = [];
    const collect = (id) => {
        if (!id || ids.has(id)) return;
        ids.add(id);
        out.push({ id, mat: resolveMat(id) });
    };
    (design.frontLayers || []).forEach(l => collect(l.material));
    (design.backLayers  || []).forEach(l => collect(l.material));
    collect(design.incidentMedium);
    collect(design.substrate?.material);
    collect(design.exitMedium);
    return out;
}

// Applies slider deltas to the design's thicknesses; returns a design patch
// for updateDesign(), or null if the baseline snapshot isn't ready yet.
export function buildThicknessPatch(design, cache, nextDF, nextDB, nextDSubMm) {
    if (!cache?.baseFront) return null;
    const baseFrontById = new Map(cache.baseFront.map(l => [l.id, l.thickness]));
    const baseBackById  = new Map(cache.baseBack.map(l => [l.id, l.thickness]));

    const front = (design.frontLayers || []).map(l => {
        const base = baseFrontById.has(l.id) ? baseFrontById.get(l.id) : l.thickness;
        const d = nextDF[l.id] || 0;
        const next = Math.max(0, base + d);
        return next === l.thickness ? l : { ...l, thickness: next };
    });
    const back = (design.backLayers || []).map(l => {
        const base = baseBackById.has(l.id) ? baseBackById.get(l.id) : l.thickness;
        const d = nextDB[l.id] || 0;
        const next = Math.max(0, base + d);
        return next === l.thickness ? l : { ...l, thickness: next };
    });
    const subBase = cache.baseSubstrateMm ?? 1.0;
    const nextSubMm = Math.max(0, subBase + (nextDSubMm || 0));
    const subPatch = (design.substrate?.thickness !== nextSubMm)
        ? { substrate: { ...design.substrate, thickness: nextSubMm } }
        : null;

    return { frontLayers: front, backLayers: back, ...(subPatch || {}) };
}

// Computes the Variator preview spectrum.
// Perturbed arm = current design thicknesses + materials wrapped with local
//                 Δn,Δk offsets.
// Baseline arm  = original thicknesses from `cache` + raw materials (no
//                 Δn,Δk) — this is what Revert restores to, so the dotted
//                 curve stays put regardless of which slider the user
//                 touches (thickness AND n/k).
export function computeVariatorSpectrum({ design, params, evalMode, dN, dK, cache }) {
    const baseFrontById = new Map((cache.baseFront || []).map(l => [l.id, l.thickness]));
    const baseBackById  = new Map((cache.baseBack  || []).map(l => [l.id, l.thickness]));
    const baseSubMm     = cache.baseSubstrateMm ?? (design.substrate?.thickness ?? 1.0);

    const wrap = (id) => {
        const base = resolveMat(id);
        return wrapMaterial(base, dN[id] || 0, dK[id] || 0);
    };
    const incMat  = wrap(design.incidentMedium);
    const subMat  = wrap(design.substrate?.material);
    const exitMat = wrap(design.exitMedium);
    const subThick = design.substrate?.thickness ?? 1.0;

    const front = (design.frontLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: wrap(l.material), thickness: l.thickness }));
    const back = (design.backLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: wrap(l.material), thickness: l.thickness }));

    // Baseline arm — original snapshot thicknesses, raw materials.
    const incMatB  = resolveMat(design.incidentMedium);
    const subMatB  = resolveMat(design.substrate?.material);
    const exitMatB = resolveMat(design.exitMedium);
    const frontB = (design.frontLayers || []).map(l => {
        const t0 = baseFrontById.has(l.id) ? baseFrontById.get(l.id) : l.thickness;
        return { material: resolveMat(l.material), thickness: t0 };
    }).filter(l => l.thickness > 0);
    const backB = (design.backLayers || []).map(l => {
        const t0 = baseBackById.has(l.id) ? baseBackById.get(l.id) : l.thickness;
        return { material: resolveMat(l.material), thickness: t0 };
    }).filter(l => l.thickness > 0);
    const subThickB = baseSubMm;

    let result, baseline;
    if (evalMode === 'back') {
        result   = evaluateSpectrumBack({ ...params }, exitMat,  subMat,  back);
        baseline = evaluateSpectrumBack({ ...params }, exitMatB, subMatB, backB);
    } else if (evalMode === 'total') {
        result   = evaluateSpectrumTotal({ ...params }, incMat,  subMat,  exitMat,  front,  back,  subThick);
        baseline = evaluateSpectrumTotal({ ...params }, incMatB, subMatB, exitMatB, frontB, backB, subThickB);
    } else {
        result   = evaluateSpectrum({ ...params }, incMat,  subMat,  front);
        baseline = evaluateSpectrum({ ...params }, incMatB, subMatB, frontB);
    }
    result.Tbase = baseline.T;
    result.Rbase = baseline.R;
    return result;
}
