// Min thickness in the synthesis windows. Each window proposes a floor (GE and
// Structural the strictest enabled MNT row of the merit function, Needle a
// fixed thin floor for its needles) and `deriveDMinDefault` keeps the field on
// it: the proposal is taken again when the design changes, and a value the
// user typed stays until then. A stored value counts as typed, so reopening a
// window does not overwrite it.

// The strictest enabled MNT target of `operands`, or 0 without one (nm).
export function strictestMnt(operands) {
    return (operands || []).reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
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
