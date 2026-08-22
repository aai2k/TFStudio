import { mirrorLayers } from '../../../../utils/physics/optimizer.js';

const keyOf = (side) => side === 'back' ? 'backLayers' : 'frontLayers';
const newLayerId = () => `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ── Index-based layer helpers (used by keyboard shortcuts) ─────
// These complement the id-based DesignContext API so that callers who
// already know the underlying-array splice position don't pay an
// id-lookup round-trip and can pass a source layer for material defaults.

export function insertLayerAt(design, updateDesign, side, splicePos, source) {
    const key = keyOf(side);
    const cur = design[key] || [];
    const id  = newLayerId();
    const newLayer = source
        ? { id, material: source.material, thickness: source.thickness, locked: false }
        : { id, material: 'SiO2', thickness: 100, locked: false };
    const pos = Math.max(0, Math.min(splicePos, cur.length));
    const next = [...cur.slice(0, pos), newLayer, ...cur.slice(pos)];
    applyLayers(design, updateDesign, side, next);
    return id;
}

export function removeLayerAt(design, updateDesign, side, splicePos) {
    const key = keyOf(side);
    const cur = design[key] || [];
    if (splicePos < 0 || splicePos >= cur.length) return false;
    if (cur[splicePos].locked) return false;
    const next = [...cur.slice(0, splicePos), ...cur.slice(splicePos + 1)];
    applyLayers(design, updateDesign, side, next);
    return true;
}

export function duplicateLayerAt(design, updateDesign, side, splicePos) {
    const key = keyOf(side);
    const cur = design[key] || [];
    if (splicePos < 0 || splicePos >= cur.length) return null;
    const src = cur[splicePos];
    const id  = newLayerId();
    const copy = { ...src, id, locked: false };
    const next = [...cur.slice(0, splicePos + 1), copy, ...cur.slice(splicePos + 1)];
    applyLayers(design, updateDesign, side, next);
    return id;
}

function applyLayers(design, updateDesign, side, next) {
    const key = keyOf(side);
    const patch = { [key]: next };
    if (design.surfaceMode === 'symmetric' && side === 'front') {
        patch.backLayers = mirrorLayers(next);
    }
    updateDesign(patch);
}

/** Remove an explicit selection in one undoable design update. */
export function removeLayers(design, updateDesign, side, layerIds) {
    const key = keyOf(side);
    const ids = new Set(layerIds || []);
    if (!ids.size) return false;
    const current = design[key] || [];
    const next = current.filter(layer => !ids.has(layer.id));
    if (next.length === current.length) return false;
    applyLayers(design, updateDesign, side, next);
    return true;
}

/** Insert copied layers at a display-order boundary and assign fresh ids. */
export function pasteLayersAtDisplayIndex(design, updateDesign, side, displayIndex, sources, reversed) {
    const key = keyOf(side);
    const current = design[key] || [];
    if (!Array.isArray(sources) || !sources.length) return [];
    const display = reversed ? [...current].reverse() : [...current];
    const inserted = sources.map(source => ({
        id: newLayerId(),
        material: source.material || 'SiO2',
        thickness: Number.isFinite(Number(source.thickness)) ? Number(source.thickness) : 100,
        locked: !!source.locked,
    }));
    const index = Math.max(0, Math.min(Number(displayIndex) || 0, display.length));
    display.splice(index, 0, ...inserted);
    applyLayers(design, updateDesign, side, reversed ? display.reverse() : display);
    return inserted.map(layer => layer.id);
}

/** Reorder one or more rows in display order, committing exactly one update. */
export function reorderLayers(design, updateDesign, side, movedIds, targetId, position, reversed) {
    const key = keyOf(side);
    const current = design[key] || [];
    const display = reversed ? [...current].reverse() : [...current];
    const movedSet = new Set(movedIds || []);
    const moved = display.filter(layer => movedSet.has(layer.id));
    if (!moved.length || movedSet.has(targetId)) return false;

    const remaining = display.filter(layer => !movedSet.has(layer.id));
    const targetIndex = remaining.findIndex(layer => layer.id === targetId);
    if (targetIndex < 0) return false;
    const insertion = targetIndex + (position === 'after' ? 1 : 0);
    const nextDisplay = [
        ...remaining.slice(0, insertion),
        ...moved,
        ...remaining.slice(insertion),
    ];
    if (nextDisplay.every((layer, index) => layer.id === display[index]?.id)) return false;
    applyLayers(design, updateDesign, side, reversed ? nextDisplay.reverse() : nextDisplay);
    return true;
}

// Lock / unlock every layer's thickness on a side in one shot. In symmetric
// mode the back stack is re-mirrored so the two sides stay identical.
export function setAllLocked(design, updateDesign, side, locked) {
    const key = keyOf(side);
    const cur = design[key] || [];
    if (cur.length === 0) return;
    const next = cur.map(l => ({ ...l, locked }));
    applyLayers(design, updateDesign, side, next);
}

export function copyToOther(design, updateDesign, activeSide) {
    const srcLayers = activeSide === 'front' ? (design.frontLayers || []) : (design.backLayers || []);
    // Reverse order: back coating is illuminated from the substrate side,
    // so layer order is mirrored relative to the front.
    const cloned = [...srcLayers].reverse().map(l => ({ ...l, id: newLayerId() }));
    if (activeSide === 'front') {
        updateDesign({ backLayers: cloned });
    } else {
        updateDesign({ frontLayers: cloned });
    }
}

// Flip the active stack's layer order on the substrate (1st ↔ last).
// In symmetric mode the back stack is re-mirrored from the new front
// so the two sides stay physically identical.
export function invertActiveSide(design, updateDesign, activeSide) {
    const key = activeSide === 'front' ? 'frontLayers' : 'backLayers';
    const reversed = [...(design[key] || [])].reverse();
    if (design.surfaceMode === 'symmetric' && activeSide === 'front') {
        updateDesign({ frontLayers: reversed, backLayers: mirrorLayers(reversed) });
    } else {
        updateDesign({ [key]: reversed });
    }
}
