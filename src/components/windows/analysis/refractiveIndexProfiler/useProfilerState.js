import { buildMatColorMap, computeProfileForSide, computeTotalRegions } from './profileModel.js';
import { resolveAvailableSide } from '../availableSide.js';
import { profilerSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useState } = React;

export function useProfilerState(design, rp) {
    const [session, setField] = useWindowSession(profilerSession, design);
    const { lambda, lambdaStr, quantity, side } = session;
    const [profile, setProfile] = useState(null);
    const [regions, setRegions] = useState([]);
    const [matColorMap, setMatColorMap] = useState({});
    const setSide = value => setField('side', value);

    const hasFront = (design?.frontLayers?.length ?? 0) > 0;
    const hasBack = (design?.backLayers?.length ?? 0) > 0;
    const availableSide = resolveAvailableSide(side, hasFront, hasBack);

    // Follows edits to the design, not just a change of design: emptying a side
    // while it is showing has to move the view to one that still has layers.
    useEffect(() => {
        if (availableSide !== side) setSide(availableSide);
    }, [availableSide, side]);

    useEffect(() => {
        if (!design) { setProfile(null); setRegions([]); return; }
        if (side === 'total') {
            const regs = computeTotalRegions(design, lambda, rp);
            setRegions(regs);
            setProfile(null);
            const allLayers = regs.flatMap(r => r.validLayers || []);
            setMatColorMap(allLayers.length ? buildMatColorMap(design, allLayers) : {});
        } else {
            const result = computeProfileForSide(design, lambda, side);
            setProfile(result);
            setRegions([]);
            if (result?.validLayers) setMatColorMap(buildMatColorMap(design, result.validLayers));
            else setMatColorMap({});
        }
    }, [design, lambda, side, rp]);

    return {
        lambda, lambdaStr, quantity, side, profile, regions, matColorMap,
        setLambda: value => setField('lambda', value),
        setLambdaStr: value => setField('lambdaStr', value),
        setQuantity: value => setField('quantity', value),
        setSide,
    };
}
