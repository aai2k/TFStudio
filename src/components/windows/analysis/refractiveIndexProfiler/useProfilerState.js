import { buildMatColorMap, computeProfileForSide, computeTotalRegions } from './profileModel.js';
import { resolveAvailableSide } from '../availableSide.js';

const { useEffect, useState } = React;

export function useProfilerState(design, rp) {
    const [lambda, setLambda] = useState(() => design?.referenceWavelength || 550);
    const [lambdaStr, setLambdaStr] = useState(() => String(design?.referenceWavelength || 550));
    const [quantity, setQuantity] = useState('n');
    const [side, setSide] = useState('front');
    const [profile, setProfile] = useState(null);
    const [regions, setRegions] = useState([]);
    const [matColorMap, setMatColorMap] = useState({});

    useEffect(() => {
        if (design?.referenceWavelength) {
            setLambda(design.referenceWavelength);
            setLambdaStr(String(design.referenceWavelength));
        }
    }, [design?.id]);

    const hasFront = (design?.frontLayers?.length ?? 0) > 0;
    const hasBack = (design?.backLayers?.length ?? 0) > 0;
    const availableSide = resolveAvailableSide(side, hasFront, hasBack);

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
            setMatColorMap(allLayers.length ? buildMatColorMap(allLayers) : {});
        } else {
            const result = computeProfileForSide(design, lambda, side);
            setProfile(result);
            setRegions([]);
            if (result?.validLayers) setMatColorMap(buildMatColorMap(result.validLayers));
            else setMatColorMap({});
        }
    }, [design, lambda, side, rp]);

    return {
        lambda, lambdaStr, quantity, side, profile, regions, matColorMap,
        setLambda, setLambdaStr, setQuantity, setSide,
    };
}
