import { buildMatColorMap, computeProfile } from './profileModel.js';
import { eFieldSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useState } = React;

export function useEFieldState(design) {
    const [session, setField] = useWindowSession(eFieldSession, design);
    const { lambda, lambdaStr, theta, pol, side } = session;
    const [profile, setProfile] = useState(null);
    const [matColorMap, setMatColorMap] = useState({});

    useEffect(() => {
        if (!design) { setProfile(null); return; }
        const result = computeProfile(design, lambda, theta, pol, side);
        setProfile(result);
        if (result?.validLayers) setMatColorMap(buildMatColorMap(design, result.validLayers));
        else setMatColorMap({});
    }, [design, lambda, theta, pol, side]);

    return {
        lambda, lambdaStr, theta, pol, side, profile, matColorMap,
        setLambda: value => setField('lambda', value),
        setLambdaStr: value => setField('lambdaStr', value),
        setTheta: value => setField('theta', value),
        setPol: value => setField('pol', value),
        setSide: value => setField('side', value),
    };
}
