import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { strictestMnt, deriveDMinDefault } from '../synthesisShared/minThickness.js';
import { STRUCTURAL_DEFAULTS } from './structuralSettings.js';

const { useCallback, useEffect, useRef } = React;

// Structural's Min thickness follows the strictest MNT row of the merit
// function, as GE's does, and the window default without one
// (synthesisShared/minThickness.js). Returns the field's value, its setter for
// a typed value, and the MNT floor the window shows its note against.
export function useMinThickness(design, runningRef) {
    const [dMin, setDMin, dMinFromStorage] = usePersistentNumber('tfstudio_struct_dMin', STRUCTURAL_DEFAULTS.dMin);
    const maxMNT = strictestMnt(design?.meritOperands);
    const dMinRef = useRef(dMin);
    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin = useRef(null);
    useEffect(() => { dMinRef.current = dMin; }, [dMin]);
    useEffect(() => {
        deriveDMinDefault(design, maxMNT > 0 ? maxMNT : STRUCTURAL_DEFAULTS.dMin,
            { dMinTouchedRef, lastIdForDMin, runningRef, dMinRef, setDMin });
    }, [maxMNT, design?.id]);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);
    return { dMin, setDMin: handleDMin, maxMNT };
}
