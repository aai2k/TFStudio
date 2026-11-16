// Min thickness in the synthesis windows. Each window proposes a floor (GE and
// Structural the strictest enabled MNT row of the rows the run fits, Needle a
// fixed thin floor for its needles) and `deriveDMinDefault` keeps the field on
// it: the proposal is taken again when the design changes, and a value the
// user typed stays until then. The id of the design a value was typed for is
// stored beside it, so the value is back when the window opens again on that
// design and gives way on any other. A window unmounts whenever another tab of
// its group is picked, so opening is not treated as a design switch.

import { hasEnvironments } from '../../../../utils/environments/environments.js';
import { thicknessBound } from '../../../../utils/environments/environmentMerit.js';
import { synthesisRows } from './synthesisMath.js';

// The strictest enabled MNT target of `operands`, or 0 without one (nm).
export function strictestMnt(operands) {
    return (operands || []).reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
}

// The ids of the materials a run on `design` can lay down: those its layers
// are made of, on both sides, and `pool` (material ids), each once.
export function runMaterialIds(design, pool = []) {
    const layers = [...(design?.frontLayers || []), ...(design?.backLayers || [])];
    return [...new Set([...layers.map(layer => layer.material), ...pool])];
}

// The floor the MNT rows a synthesis run on `design` fits set (synthesisMath.js
// synthesisRows), or 0 without one (nm). On a design with environments each
// row is read in every environment it is scored in, at target / f under a
// factor f below 1 by which the environment scales the layers of a material
// the layers or `pool` (material ids) hold, its thickness factor times the
// change its temperature makes (environmentMerit.js thicknessBound).
export function synthesisMntFloor(design, operands = design?.meritOperands || [], pool = []) {
    const rows = synthesisRows(design, operands);
    if (!hasEnvironments(design)) return strictestMnt(rows);
    return Math.max(0, thicknessBound(design, rows, 'MNT', runMaterialIds(design, pool)) ?? 0);
}

const typedForKey = key => `${key}_design`;

// What a window keeps about its field stored under `key`: the design it shows
// and the design the stored value was typed for (null for none).
export function loadDMinTrack(key) {
    let typedFor = null;
    try { typedFor = localStorage.getItem(typedForKey(key)); } catch (_) { /* none stored */ }
    return { key, designId: null, typedFor };
}

function setTypedFor(track, id) {
    track.typedFor = id;
    try {
        if (id == null) localStorage.removeItem(typedForKey(track.key));
        else localStorage.setItem(typedForKey(track.key), id);
    } catch (_) { /* kept while the window stays open */ }
}

// Mark the field's value as typed for the design the window shows.
export function dMinTyped(track) {
    setTypedFor(track, track.designId);
}

// Move the field to `def` unless the user typed its value for this design or a
// run is going. ctx: { track, runningRef, dMinRef, setDMin }, `track` from loadDMinTrack.
export function deriveDMinDefault(design, def, ctx) {
    const { track, runningRef, dMinRef, setDMin } = ctx;
    track.designId = design?.id ?? null;
    if (runningRef.current) return;
    if (track.typedFor != null) {
        if (track.typedFor === track.designId) return;
        setTypedFor(track, null);
    }
    if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
}
