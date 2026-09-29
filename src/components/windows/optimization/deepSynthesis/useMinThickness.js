import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { strictestMnt, deriveDMinDefault } from '../synthesisShared/minThickness.js';
import { DEEP_DMIN_KEY, DEEP_SYNTHESIS_WINDOW_DEFAULTS } from './deepSynthesisSettings.js';

const { useCallback, useEffect, useRef } = React;

// The thickness floor follows the strictest MNT row of the merit function and
// the window default without one (synthesisShared/minThickness.js); a value
// the user typed stays until the design changes. Stored under the window's own
// key, so it moves independently of the Structural and GE floors. Returns the
// floor (nm), its setter for a typed value, and the MNT floor the note under
// the field compares against.
export function useMinThickness(design, runningRef) {
    const fallback = DEEP_SYNTHESIS_WINDOW_DEFAULTS.dMin;
    const [dMin, setDMin, typedBefore] = usePersistentNumber(DEEP_DMIN_KEY, fallback);
    const maxMNT = strictestMnt(design?.meritOperands);
    const track = useRef(null);
    if (!track.current) {
        track.current = { dMinRef: { current: dMin }, dMinTouchedRef: { current: typedBefore }, lastIdForDMin: { current: null } };
    }
    useEffect(() => { track.current.dMinRef.current = dMin; }, [dMin]);
    useEffect(() => {
        deriveDMinDefault(design, maxMNT > 0 ? maxMNT : fallback, { ...track.current, runningRef, setDMin });
    }, [maxMNT, design?.id]);
    const onTyped = useCallback((value) => { track.current.dMinTouchedRef.current = true; setDMin(value); }, []);
    return { dMin, setDMin: onTyped, maxMNT };
}
