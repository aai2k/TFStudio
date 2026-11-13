// Min thickness in the synthesis windows. Each window proposes a floor (GE and
// Structural the strictest enabled MNT row of the rows the run fits, Needle a
// fixed thin floor for its needles) and `deriveDMinDefault` keeps the field on
// it: the proposal is taken again when the design changes, and a value the
// user typed stays until then. A stored value counts as typed, so reopening a
// window does not overwrite it.

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

// Move the field to `def` unless the user typed a value for this design or a
// run is going. ctx: { dMinTouchedRef, lastIdForDMin, runningRef, dMinRef, setDMin }.
export function deriveDMinDefault(design, def, ctx) {
    const { dMinTouchedRef, lastIdForDMin, runningRef, dMinRef, setDMin } = ctx;
    const id = design?.id ?? null;
    if (lastIdForDMin.current !== id) {
        const firstMount = lastIdForDMin.current === null;
        lastIdForDMin.current = id;
        if (!firstMount) dMinTouchedRef.current = false;   // a real design switch re-derives
    }
    if (runningRef.current || dMinTouchedRef.current) return;
    if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
}
