import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { synthesisMntFloor, deriveDMinDefault, loadDMinTrack, dMinTyped } from '../synthesisShared/minThickness.js';
import { STRUCTURAL_DEFAULTS } from '../../../../utils/structural/settings.js';

const { useCallback, useEffect, useRef, useState } = React;

const DMIN_KEY = 'tfstudio_struct_dMin';

// Structural's Min thickness follows the strictest MNT row of the merit
// function, as GE's does, and the window default without one
// (synthesisShared/minThickness.js). Returns the field's value, its setter for
// a typed value, and the MNT floor the window shows its note against.
export function useMinThickness(design, runningRef) {
    const [dMin, setDMin] = usePersistentNumber(DMIN_KEY, STRUCTURAL_DEFAULTS.dMin);
    const maxMNT = synthesisMntFloor(design);
    const dMinRef = useRef(dMin);
    const [track] = useState(() => loadDMinTrack(DMIN_KEY));
    useEffect(() => { dMinRef.current = dMin; }, [dMin]);
    useEffect(() => {
        deriveDMinDefault(design, maxMNT > 0 ? maxMNT : STRUCTURAL_DEFAULTS.dMin,
            { track, runningRef, dMinRef, setDMin });
    }, [maxMNT, design?.id]);
    const handleDMin = useCallback((v) => { dMinTyped(track); setDMin(v); }, []);
    return { dMin, setDMin: handleDMin, maxMNT };
}
