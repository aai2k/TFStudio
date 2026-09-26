import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import { wrapMaterial } from '../../../../utils/misc/variator.js';

export function resolveMat(design, id) {
    return designMaterialLookup(design)(id);
}

export function matLabel(mat) {
    if (!mat) return '—';
    return mat.name || mat.id || '?';
}

/** The thicknesses a Variator session measures its sliders from, by layer id. */
export function captureVariatorBaseline(design) {
    return {
        baseFront: (design.frontLayers || []).map(l => ({ id: l.id, thickness: l.thickness })),
        baseBack: (design.backLayers || []).map(l => ({ id: l.id, thickness: l.thickness })),
        baseSubstrateMm: design.substrate?.thickness ?? 1.0,
    };
}

export function buildBaseMaps(baseline, design) {
    const baseFrontById = new Map((baseline?.baseFront || []).map(l => [l.id, l.thickness]));
    const baseBackById  = new Map((baseline?.baseBack  || []).map(l => [l.id, l.thickness]));
    const baseSubMm = baseline?.baseSubstrateMm ?? (design.substrate?.thickness ?? 1.0);
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
    const resolveMaterial = designMaterialLookup(design);
    const ids = new Set();
    const out = [];
    const collect = (id) => {
        if (!id || ids.has(id)) return;
        ids.add(id);
        out.push({ id, mat: resolveMaterial(id) });
    };
    (design.frontLayers || []).forEach(l => collect(l.material));
    (design.backLayers  || []).forEach(l => collect(l.material));
    collect(design.incidentMedium);
    collect(design.substrate?.material);
    collect(design.exitMedium);
    return out;
}

// One side's layers with each at its baseline thickness plus its slider,
// stopping at zero. A layer the baseline does not know keeps its thickness.
// `changed` is false when every layer already stands there.
function variedLayers(layers, base, deltas) {
    const baseById = new Map(base.map(l => [l.id, l.thickness]));
    let changed = false;
    const next = layers.map(l => {
        const from = baseById.has(l.id) ? baseById.get(l.id) : l.thickness;
        const thickness = Math.max(0, from + (deltas[l.id] || 0));
        if (thickness === l.thickness) return l;
        changed = true;
        return { ...l, thickness };
    });
    return { next, changed };
}

/**
 * Whether the back coating has sliders of its own. In symmetric mode it is the
 * front's mirror, rebuilt from the front on every write, so it follows the
 * front sliders and cannot be moved on its own.
 */
export function backIsVaried(design) {
    return design.surfaceMode !== 'symmetric';
}

/**
 * The design patch that puts the sliders' thicknesses on `design`, or null when
 * the design already has them or there is no baseline yet.
 */
export function buildThicknessPatch(design, baseline, nextDF, nextDB, nextDSubMm) {
    if (!baseline?.baseFront) return null;
    const front = variedLayers(design.frontLayers || [], baseline.baseFront, nextDF);
    const back = backIsVaried(design)
        ? variedLayers(design.backLayers || [], baseline.baseBack, nextDB)
        : { changed: false };
    const nextSubMm = Math.max(0, (baseline.baseSubstrateMm ?? 1.0) + (nextDSubMm || 0));
    const patch = {};
    if (front.changed) patch.frontLayers = front.next;
    if (back.changed) patch.backLayers = back.next;
    if (design.substrate?.thickness !== nextSubMm) {
        patch.substrate = { ...design.substrate, thickness: nextSubMm };
    }
    return Object.keys(patch).length ? patch : null;
}

function sameLayerIds(layers, base) {
    const ids = new Set(base.map(l => l.id));
    return layers.length === base.length && layers.every(l => ids.has(l.id));
}

/**
 * Whether `design` holds the thicknesses the session's sliders put there: the
 * same layers as its baseline, each at its baseline plus its slider. An undo,
 * an edit in another window or a design loaded over this one makes it false,
 * and the session then starts again from the design as it is.
 */
export function designFollowsSession(design, session) {
    const baseline = session?.baseline;
    if (!baseline?.baseFront) return false;
    const backMatches = !backIsVaried(design) || sameLayerIds(design.backLayers || [], baseline.baseBack);
    return backMatches && sameLayerIds(design.frontLayers || [], baseline.baseFront)
        && !buildThicknessPatch(design, baseline, session.dThkFront, session.dThkBack, session.dSubMm);
}

// Computes the Variator preview spectrum.
// Perturbed arm = current design thicknesses + materials wrapped with local
//                 Δn,Δk offsets.
// Baseline arm  = original thicknesses from `baseline` + raw materials (no
//                 Δn,Δk) — this is what Revert restores to, so the dotted
//                 curve stays put regardless of which slider the user
//                 touches (thickness AND n/k).
export function computeVariatorSpectrum({ design, params, evalMode, dN, dK, baseline }) {
    const resolveMaterial = designMaterialLookup(design);
    const { baseFrontById, baseBackById, baseSubMm } = buildBaseMaps(baseline, design);

    const wrap = (id) => {
        const base = resolveMaterial(id);
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
    const incMatB  = resolveMaterial(design.incidentMedium);
    const subMatB  = resolveMaterial(design.substrate?.material);
    const exitMatB = resolveMaterial(design.exitMedium);
    const frontB = (design.frontLayers || []).map(l => {
        const t0 = baseFrontById.has(l.id) ? baseFrontById.get(l.id) : l.thickness;
        return { material: resolveMaterial(l.material), thickness: t0 };
    }).filter(l => l.thickness > 0);
    const backB = (design.backLayers || []).map(l => {
        const t0 = baseBackById.has(l.id) ? baseBackById.get(l.id) : l.thickness;
        return { material: resolveMaterial(l.material), thickness: t0 };
    }).filter(l => l.thickness > 0);
    const subThickB = baseSubMm;

    let result, unvaried;
    if (evalMode === 'back') {
        result   = evaluateSpectrumBack({ ...params }, exitMat,  subMat,  back);
        unvaried = evaluateSpectrumBack({ ...params }, exitMatB, subMatB, backB);
    } else if (evalMode === 'total') {
        result   = evaluateSpectrumTotal({ ...params }, incMat,  subMat,  exitMat,  front,  back,  subThick);
        unvaried = evaluateSpectrumTotal({ ...params }, incMatB, subMatB, exitMatB, frontB, backB, subThickB);
    } else {
        result   = evaluateSpectrum({ ...params }, incMat,  subMat,  front);
        unvaried = evaluateSpectrum({ ...params }, incMatB, subMatB, frontB);
    }
    result.Tbase = unvaried.T;
    result.Rbase = unvaried.R;
    return result;
}
